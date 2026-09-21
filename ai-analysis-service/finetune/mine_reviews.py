"""Phase 6a: mine real (diff_hunk, review_comment) pairs from public GitHub
PR review comments, via the `gh` CLI (already authenticated in this
environment - `gh auth status`). Same technique the task brief points to
(ts-bench's pipeline/miner.py: clone/query PRs, extract diffs + review
comments) applied to a different corpus (code-review comments instead of
whatever ts-bench mines) - this is a from-scratch implementation of that
technique for this repo, not a copy of that file (which lives in a
different, unavailable repo).

Filters out trivial approvals ("LGTM", "+1", etc.) - only comments that say
something substantive about the code survive. Writes one JSON object per
line to finetune/data/mined_raw.jsonl.

Run: venv/Scripts/python.exe -m finetune.mine_reviews
"""

import json
import re
import subprocess  # nosec B404 - fixed argv, no shell, calls the already-authenticated `gh` CLI
import sys
from pathlib import Path

REPOS = [
    "pallets/flask",
    "psf/requests",
    "encode/httpx",
    "tiangolo/fastapi",
    "pytest-dev/pytest",
]
PRS_PER_REPO = 100
_THIS_DIR = Path(__file__).resolve().parent
_OUTPUT_PATH = _THIS_DIR / "data" / "mined_raw.jsonl"

_TRIVIAL_PATTERNS = [
    re.compile(r"^\s*(lgtm|looks good|ship it|nice|thanks|thank you|\+1|👍|approved?)\s*[.!]?\s*$", re.IGNORECASE),
]
_MIN_COMMENT_LENGTH = 20


def _gh_api(path: str) -> list | dict:
    proc = subprocess.run(  # nosec B603 B607 - fixed argv, no shell; `gh` resolved via PATH is intentional (a local one-shot dev script, not a deployed service, matching however the operator has `gh auth login`-ed)
        ["gh", "api", path],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=60, check=False,
    )
    if proc.returncode != 0:
        print(f"  gh api {path} failed: {proc.stderr[:300]}", file=sys.stderr)
        return []
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return []


def _is_substantive(comment_body: str) -> bool:
    body = comment_body.strip()
    if len(body) < _MIN_COMMENT_LENGTH:
        return False
    return not any(p.match(body) for p in _TRIVIAL_PATTERNS)


def _mine_repo(repo: str, limit: int) -> list[dict]:
    examples = []
    # Search API directly filters to merged PRs (repos/{repo}/pulls?state=closed
    # includes closed-without-merge PRs too, which have no useful review
    # comments and wasted most of a first run's rate-limit budget - real
    # miss, fixed here) - sorted by comment count so PRs that actually had
    # a real review conversation are fetched first.
    query = f"repo:{repo}+is:pr+is:merged"
    search_result = _gh_api(f"search/issues?q={query}&sort=comments&order=desc&per_page={limit}")
    merged_prs = search_result.get("items", []) if isinstance(search_result, dict) else []
    print(f"{repo}: {len(merged_prs)} merged PRs found via search, fetching review comments...")

    for pr in merged_prs:
        number = pr["number"]
        comments = _gh_api(f"repos/{repo}/pulls/{number}/comments")
        if not isinstance(comments, list):
            continue
        for c in comments:
            body = c.get("body", "")
            diff_hunk = c.get("diff_hunk", "")
            if not diff_hunk or not _is_substantive(body):
                continue
            examples.append({
                "repo": repo,
                "pr_number": number,
                "diff_hunk": diff_hunk,
                "comment": body,
                "source": "real",
            })

    print(f"{repo}: {len(examples)} substantive review comments kept")
    return examples


def main():
    all_examples = []
    for repo in REPOS:
        all_examples.extend(_mine_repo(repo, PRS_PER_REPO))

    _OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_OUTPUT_PATH, "w", encoding="utf-8") as f:
        for ex in all_examples:
            f.write(json.dumps(ex) + "\n")

    print(f"\nWrote {len(all_examples)} real mined examples to {_OUTPUT_PATH}")


if __name__ == "__main__":
    main()
