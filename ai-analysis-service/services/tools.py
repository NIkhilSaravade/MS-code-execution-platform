"""Tool definitions for the agentic review loop (services/agent_loop.py).

Each tool is (a) an OpenAI-style function schema, bound to the LLM call via
litellm's tools= param, and (b) a plain Python callable that executes it and
returns a JSON-serializable dict. Tools here run static analysis only
(linting, security-rule scanning, retrieval) - none of them execute the
submitted code. Executing untrusted code stays exclusively on the existing
hardened path (submission-service -> Kafka -> worker-service-go's
Kubernetes-sandboxed pods); this service never runs a user's program itself.

run_linter/run_security_scan currently only support Python (ruff/bandit,
both pure static analysis over source text via a temp file + subprocess,
never `exec`/`eval`/import of the submitted code). Extending to the other 6
judged languages (Java/C++/C/JS/TS/Go) is unfinished - each needs its own
static analyzer wired in the same "write to temp file, run analyzer
subprocess, parse output" shape. Flagged as a Phase 1 follow-up in the build
log rather than silently claimed as done.
"""

import asyncio
import json
# All subprocess.run() calls below use a fixed argv list (never shell=True)
# against a tempfile this module created itself - see the nosec B603
# annotations at each call site.
import subprocess  # nosec B404
import sys
import tempfile
from pathlib import Path

import httpx

from services.hybrid_search import hybrid_retrieve
from services.reranker import rerank

LINTER_TIMEOUT_SECONDS = 10

# Deliberately tiny for now - a real style guide corpus is Phase 2 (real RAG
# ingestion, chunking, hybrid search). This is a placeholder retrieval
# surface so the tool exists and is exercised by the agent loop; do not
# mistake this dict for the "real corpus" Phase 2 is supposed to build.
_STYLE_GUIDE_SECTIONS = {
    "naming": "Use descriptive, intention-revealing names. Avoid single-letter "
    "identifiers outside of tight loop counters.",
    "complexity": "Prefer the asymptotically optimal approach for the problem's "
    "constraints; note when a simpler but slower approach is acceptable given "
    "small input bounds.",
    "error-handling": "Validate inputs at trust boundaries only; do not add "
    "defensive checks for states the judge harness cannot produce.",
}


def run_linter(language: str, code: str) -> dict:
    """Static lint pass. Python only for now (ruff)."""
    language = (language or "").lower()
    if language != "python":
        return {"supported": False, "message": f"No linter wired for '{language}' yet."}

    with tempfile.TemporaryDirectory() as tmp_dir:
        src_path = Path(tmp_dir) / "submission.py"
        src_path.write_text(code, encoding="utf-8")
        try:
            proc = subprocess.run(  # nosec B603
                [sys.executable, "-m", "ruff", "check", "--output-format=json", str(src_path)],
                capture_output=True,
                text=True,
                timeout=LINTER_TIMEOUT_SECONDS,
                check=False,  # ruff exits non-zero when it finds issues - that's not a failure here
            )
        except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
            return {"supported": True, "error": str(exc), "issues": []}

        try:
            raw_issues = json.loads(proc.stdout or "[]")
        except json.JSONDecodeError:
            return {"supported": True, "error": proc.stderr[:2000], "issues": []}

        issues = [
            {
                "code": issue.get("code"),
                "message": issue.get("message"),
                "line": issue.get("location", {}).get("row"),
            }
            for issue in raw_issues
        ]
        return {"supported": True, "issues": issues}


def run_security_scan(language: str, code: str) -> dict:
    """Static security-rule pass. Python only for now (bandit)."""
    language = (language or "").lower()
    if language != "python":
        return {"supported": False, "message": f"No security scanner wired for '{language}' yet."}

    with tempfile.TemporaryDirectory() as tmp_dir:
        src_path = Path(tmp_dir) / "submission.py"
        src_path.write_text(code, encoding="utf-8")
        try:
            proc = subprocess.run(  # nosec B603
                [sys.executable, "-m", "bandit", "-f", "json", "-q", str(src_path)],
                capture_output=True,
                text=True,
                timeout=LINTER_TIMEOUT_SECONDS,
                check=False,  # bandit exits non-zero when it finds issues - that's not a failure here
            )
        except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
            return {"supported": True, "error": str(exc), "findings": []}

        try:
            report = json.loads(proc.stdout or "{}")
        except json.JSONDecodeError:
            return {"supported": True, "error": proc.stderr[:2000], "findings": []}

        findings = [
            {
                "testId": r.get("test_id"),
                "issue": r.get("issue_text"),
                "severity": r.get("issue_severity"),
                "line": r.get("line_number"),
            }
            for r in report.get("results", [])
        ]
        return {"supported": True, "findings": findings}


def fetch_similar_past_reviews(query: str) -> dict:
    """Phase 2: hybrid (vector + BM25, RRF-fused) retrieval over the real
    corpus (services/corpus.py - repo docs + knowledge/anti_patterns.md),
    reranked with a cross-encoder (services/reranker.py) before the top
    results are handed to the LLM. See services/hybrid_search.py and
    scripts/eval_retrieval.py for how this was evaluated."""
    candidates = hybrid_retrieve(query, top_k=10)
    top = rerank(query, candidates, top_k=3)
    return {"results": [{"source": c.source, "title": c.title, "text": c.text} for c in top]}


def get_style_guide_section(topic: str) -> dict:
    section = _STYLE_GUIDE_SECTIONS.get((topic or "").lower())
    if section is None:
        return {"found": False, "availableTopics": sorted(_STYLE_GUIDE_SECTIONS)}
    return {"found": True, "topic": topic, "content": section}


async def _get_problem_metadata_async(problem_id: int) -> dict:
    # Same OAuth2 client-credentials pattern submission-service's
    # HarnessApplier and this service's own auth/token_client.py module
    # already use for service-to-service calls - problem-service's
    # GET /problems/{id} route allows the SERVICE role (see CLAUDE.md's
    # warning against narrowing that route), so this doesn't need the
    # end user's own JWT forwarded through the hint request.
    from auth.token_client import get_service_token
    from discovery.service_resolver import get_service_url

    token = await get_service_token()
    problem_service_url = await get_service_url("PROBLEM-SERVICE")
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(
            f"{problem_service_url}/problems/{problem_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
    if response.status_code != 200:
        return {"found": False, "status": response.status_code}
    body = response.json()
    return {
        "found": True,
        "tags": body.get("tags", []),
        "constraints": body.get("constraints", ""),
        "difficulty": body.get("difficulty"),
    }


def get_problem_metadata(problem_id: int) -> dict:
    """Used by the hint agent (services/hint_service.py) to look up a
    problem's tags/constraints on demand, instead of every hint prompt
    (including the cheapest level-1 nudge) statically carrying that data
    whether or not it's relevant. Bridges to the async HTTP call the same
    way services/mcp_client.py bridges its own sync/async boundary -
    asyncio.run() per call."""
    return asyncio.run(_get_problem_metadata_async(problem_id))


TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "run_linter",
            "description": "Run a static linter over the submitted code and return style/quality issues.",
            "parameters": {
                "type": "object",
                "properties": {
                    "language": {"type": "string", "description": "Language id, e.g. 'python'."},
                    "code": {"type": "string", "description": "Source code to lint."},
                },
                "required": ["language", "code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_security_scan",
            "description": "Run a static security-rule scan over the submitted code and return findings.",
            "parameters": {
                "type": "object",
                "properties": {
                    "language": {"type": "string", "description": "Language id, e.g. 'python'."},
                    "code": {"type": "string", "description": "Source code to scan."},
                },
                "required": ["language", "code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_similar_past_reviews",
            "description": "Retrieve context from the knowledge base most relevant to a query about this problem/code.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "What to search for."},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_style_guide_section",
            "description": "Look up a section of the project's style guide by topic (e.g. 'naming', 'complexity', 'error-handling').",
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string"},
                },
                "required": ["topic"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_problem_metadata",
            "description": "Fetch a problem's tags, constraints and difficulty by problem id.",
            "parameters": {
                "type": "object",
                "properties": {
                    "problemId": {"type": "integer", "description": "The problem's numeric id."},
                },
                "required": ["problemId"],
            },
        },
    },
]

TOOL_DISPATCH = {
    "run_linter": lambda args: run_linter(args.get("language", ""), args.get("code", "")),
    "run_security_scan": lambda args: run_security_scan(args.get("language", ""), args.get("code", "")),
    "fetch_similar_past_reviews": lambda args: fetch_similar_past_reviews(args.get("query", "")),
    "get_style_guide_section": lambda args: get_style_guide_section(args.get("topic", "")),
    "get_problem_metadata": lambda args: get_problem_metadata(args.get("problemId", 0)),
}
