"""Real, committed side-by-side comparison of Phase B's explain walkthrough
(prompts/explain_prompt.py) against the existing post-submission review
prompt (prompts/passed_prompt.py), on the same problem/code, in one run.
Makes real Groq calls through both prompts - not a re-run of either
service's full production pipeline (no tool-calling loop, no critic pass
on the review side; explain never has either) - the point here is
comparing prompt TONE/DEPTH on equal footing, which Phase 3's eval harness
(evals/run_eval.py) already covers for the review pipeline's full
production behavior with real numbers of its own.

Run for real:
    venv/Scripts/python.exe -m scripts.compare_explain_vs_review
(or `make compare-explain` - see Makefile)

Fixes the gap the original Phase B build-log entry disclosed: an earlier,
uncommitted scratch version of this comparison crashed with
`psycopg2.errors.FeatureNotSupported: extension "vector" is not available`
because it called AnalysisService._build_messages directly, which reaches
RAGService's real pgvector connection - unavailable in this dev
environment's local Postgres (pgvector isn't installed for it). Rather
than modify that shared, live Postgres install to add an extension (real
risk to other local dev work depending on it, for a comparison script that
doesn't need it), this uses the exact same infra substitution
evals/run_eval.py already established for this same constraint:
hybrid_search's vector-search arm disabled, BM25 (no Postgres needed)
still runs for real over the real 141-chunk corpus. Both sides of the
comparison below are therefore REAL Groq completions, grounded by REAL
BM25 retrieval - only the vector-similarity half of hybrid search is
stubbed, exactly like Phase 3's own eval already discloses doing.
"""

import json
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows console default (cp1252) can't print some LLM output (e.g. en-dashes)
except AttributeError:
    pass

import services.hybrid_search as hybrid_search_module
from prompts.explain_prompt import EXPLAIN_TEMPLATE, SYSTEM_PROMPT as EXPLAIN_SYSTEM_PROMPT, code_section
from prompts.passed_prompt import passed_prompt
from services.hybrid_search import hybrid_retrieve
from services.llm_provider import LLMProvider

_RESULTS_PATH = Path(__file__).resolve().parent.parent / "results" / "explain_vs_review_comparison.json"

# Same substitution evals/run_eval.py uses, for the same reason (see this
# module's docstring) - only the vector-search arm of hybrid_retrieve needs
# live Postgres/pgvector; BM25 runs for real either way.
hybrid_search_module._default_vector_search = lambda query, k: []

PROBLEM_ID = "max_subarray"
PROBLEM_DESCRIPTION = (
    "Given an integer array nums, find the contiguous subarray with the "
    "largest sum and return its sum (Kadane's algorithm)."
)
CORRECT_CODE = (
    "def max_subarray(nums):\n"
    "    best = nums[0]\n"
    "    current = nums[0]\n"
    "    for num in nums[1:]:\n"
    "        current = max(num, current + num)\n"
    "        best = max(best, current)\n"
    "    return best\n"
)

# Mirrors services/agent_loop.py's SYSTEM_PROMPT closely enough for a raw,
# tool-free completion - the review side of this comparison deliberately
# skips the tool-calling loop and critic pass (see module docstring): this
# is a prompt-tone comparison, not a re-run of the full production pipeline.
REVIEW_SYSTEM_PROMPT = (
    "You are a senior software engineer reviewing a correct solution. Return "
    "ONLY the requested JSON, no commentary."
)


def _run_review() -> str:
    context_chunks = hybrid_retrieve(PROBLEM_DESCRIPTION, top_k=3)
    context_text = "\n".join(c.text for c in context_chunks)
    prompt_text = passed_prompt.format(
        problem=PROBLEM_DESCRIPTION + "\n\nContext:\n" + context_text,
        code=CORRECT_CODE,
    )
    messages = [
        {"role": "system", "content": REVIEW_SYSTEM_PROMPT},
        {"role": "user", "content": prompt_text},
    ]
    response = LLMProvider.complete_with_tools(messages, tools=None)
    return (response.choices[0].message.content or "").strip()


def _run_explain() -> str:
    context_chunks = hybrid_retrieve(PROBLEM_DESCRIPTION, top_k=3)
    context_text = "\n".join(c.text for c in context_chunks)
    prompt_text = EXPLAIN_TEMPLATE.format(
        problem=PROBLEM_DESCRIPTION,
        code_section=code_section(CORRECT_CODE),
        context=context_text,
    )
    messages = [
        {"role": "system", "content": EXPLAIN_SYSTEM_PROMPT},
        {"role": "user", "content": prompt_text},
    ]
    response = LLMProvider.complete_with_tools(messages, tools=None)
    return (response.choices[0].message.content or "").strip()


def main():
    print(f"[{PROBLEM_ID}] running review prompt (passed_prompt.py)...")
    review_output = _run_review()

    print(f"[{PROBLEM_ID}] running explain prompt (explain_prompt.py)...")
    explain_output = _run_explain()

    results = {
        "problemId": PROBLEM_ID,
        "problemDescription": PROBLEM_DESCRIPTION,
        "code": CORRECT_CODE,
        "reviewOutput": review_output,
        "explainOutput": explain_output,
        "reviewCharCount": len(review_output),
        "explainCharCount": len(explain_output),
    }

    _RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    _RESULTS_PATH.write_text(json.dumps(results, indent=2), encoding="utf-8")

    print()
    print("--- review output (terse, schema-shaped) ---")
    print(review_output)
    print()
    print("--- explain output (teaching prose) ---")
    print(explain_output)
    print()
    print(f"review: {len(review_output)} chars, explain: {len(explain_output)} chars")
    print(f"wrote {_RESULTS_PATH}")


if __name__ == "__main__":
    main()
