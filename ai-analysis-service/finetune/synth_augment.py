"""Phase 6a: synthetic augmentation. Generates new small Python coding
problems (correct solution + one injected bug, across bug classes) via
real Groq calls, then produces a target review completion for each -
either through this service's REAL pipeline (tool loop + critic pass, via
AnalysisService.analyze() itself - "criticGated": true) for a subset, or
via a single direct completion call for the rest (bounded call/time
budget; "criticGated": false). Both are logged per-example so the
manifest can report exactly how many examples got which treatment - never
blended without a label, per the task brief's own instruction.

Complements finetune/mine_reviews.py's real-but-generic PR comments with
examples that ARE this platform's actual task shape (a LeetCode-style
problem + a known bug class + the exact JSON schema this service
produces), which the real-mined partition structurally cannot provide
(see build_dataset.py's docstring on why real-partition fields are mostly
placeholders beyond the human comment itself).

Run: venv/Scripts/python.exe -m finetune.synth_augment
"""

import json
import re
import sys
from pathlib import Path

import services.analysis_service as analysis_service_module
import services.hybrid_search as hybrid_search_module
from services.analysis_service import AnalysisService
from services.llm_provider import LLMProvider

# Windows console default codepage (cp1252) can't encode arbitrary
# characters an LLM might generate (e.g. U+2011 non-breaking hyphen) -
# hit for real as an UnicodeEncodeError crashing a `print()` of raw model
# output mid-run. Force UTF-8 stdout so any generated text can be printed.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")


# Same infra substitutions as evals/run_eval.py (Phase 3) - no live
# Postgres/pgvector in this dev environment. See docs/ai-agent-build-log.md.
class _NullRag:
    def retrieve(self, query):
        return []


analysis_service_module.record_usage = lambda **kwargs: None
analysis_service_module.get_rag_service = lambda: _NullRag()
hybrid_search_module._default_vector_search = lambda query, k: []

_THIS_DIR = Path(__file__).resolve().parent
_OUTPUT_PATH = _THIS_DIR / "data" / "synthetic_raw.jsonl"

BUG_CLASSES = [
    "off_by_one", "missing_none_check", "comparator_flip", "resource_leak",
    "mutable_default_argument", "unhandled_exception", "incorrect_boundary_condition",
    "wrong_operator", "integer_division_truncation", "incorrect_loop_range",
]
PROBLEMS_PER_BATCH = 3
N_BATCHES = 20
N_CRITIC_GATED = 15

GENERATION_PROMPT = """Generate {k} small, DISTINCT Python coding-interview-style problems.
For each one, inject exactly one bug from this list (use a different one for each of the {k},
cycling through: {bug_classes}).

Return ONLY a JSON array, each element exactly:
{{
  "problemDescription": "...",
  "correctCode": "... a correct Python function solving the problem ...",
  "bugClass": "<one of the list above>",
  "mutatedCode": "... the same function with exactly that one bug injected ...",
  "correctnessAffected": true or false (false only if the bug is a pure code-quality issue like a resource leak or mutable default that doesn't change output for typical inputs)
}}

No markdown fences, no commentary - just the JSON array.
"""


def _clean_json_array(text: str) -> str:
    cleaned = re.sub(r"```json", "", text, flags=re.IGNORECASE)
    cleaned = re.sub(r"```", "", cleaned)
    match = re.search(r"\[.*\]", cleaned, re.DOTALL)
    return match.group(0) if match else cleaned.strip()


def _generate_problem_batch(k: int) -> list[dict]:
    prompt = GENERATION_PROMPT.format(k=k, bug_classes=", ".join(BUG_CLASSES))
    response = LLMProvider.complete_with_tools([{"role": "user", "content": prompt}], tools=None)
    raw = response.choices[0].message.content
    try:
        return json.loads(_clean_json_array(raw))
    except json.JSONDecodeError:
        print(f"  batch generation failed to parse, skipping. raw[:200]={raw[:200]!r}")
        return []


def _direct_completion(problem: dict) -> dict | None:
    """Single-call completion (no tool loop, no critic) - the bulk-generation path."""
    from prompts.failed_prompt import failed_prompt
    from prompts.passed_prompt import passed_prompt

    status = "PASSED" if problem["correctnessAffected"] is False else "FAILED"
    if status == "PASSED":
        prompt_text = passed_prompt.format(problem=problem["problemDescription"], code=problem["mutatedCode"])
    else:
        prompt_text = failed_prompt.format(
            problem=problem["problemDescription"], code=problem["mutatedCode"],
            error="Test case failed: unexpected output or runtime error.",
        )
    response = LLMProvider.complete_with_tools([{"role": "user", "content": prompt_text}], tools=None)
    raw = response.choices[0].message.content
    cleaned = re.sub(r"```json", "", raw, flags=re.IGNORECASE)
    cleaned = re.sub(r"```", "", cleaned)
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if not match:
        return None
    try:
        json.loads(match.group(0))  # validate it's parseable JSON
    except json.JSONDecodeError:
        return None
    return {"prompt": prompt_text, "completion": match.group(0)}


def _critic_gated_completion(problem: dict, index: int) -> dict | None:
    """Runs the REAL pipeline (tool loop + finalize + critic pass) via
    AnalysisService.analyze() itself - the same code path a real submission
    goes through."""
    status = "PASSED" if problem["correctnessAffected"] is False else "FAILED"
    submission = {
        "userId": "synth-augment",
        "problemId": f"synth-{index}",
        "status": status,
        "code": problem["mutatedCode"],
        "errorMessage": "Test case failed: unexpected output or runtime error." if status == "FAILED" else None,
    }
    from services.exceptions import AnalysisOutputInvalid

    problem_dict = {"description": problem["problemDescription"]}
    try:
        result = AnalysisService.analyze(f"synth-{index}", submission, problem_dict)
    except AnalysisOutputInvalid as exc:
        print(f"    critic-gated generation failed schema validation, skipping: {exc}")
        return None

    from prompts.failed_prompt import failed_prompt
    from prompts.passed_prompt import passed_prompt
    if status == "PASSED":
        prompt_text = passed_prompt.format(problem=problem["problemDescription"], code=problem["mutatedCode"])
    else:
        prompt_text = failed_prompt.format(
            problem=problem["problemDescription"], code=problem["mutatedCode"],
            error=submission["errorMessage"],
        )
    return {
        "prompt": prompt_text,
        "completion": json.dumps(result["parsedAnalysis"]),
        "revised": result["revised"],
    }


def main():
    problems: list[dict] = []
    for batch_i in range(N_BATCHES):
        print(f"Generating problem batch {batch_i + 1}/{N_BATCHES}...")
        problems.extend(_generate_problem_batch(PROBLEMS_PER_BATCH))

    print(f"Generated {len(problems)} synthetic problems total.")

    examples = []
    for i, problem in enumerate(problems):
        required = {"problemDescription", "correctCode", "bugClass", "mutatedCode", "correctnessAffected"}
        if not required.issubset(problem):
            continue

        if i < N_CRITIC_GATED:
            completion = _critic_gated_completion(problem, i)
            source = "synthetic_critic_gated"
        else:
            completion = _direct_completion(problem)
            source = "synthetic_direct"

        if completion is None:
            continue

        examples.append({
            "prompt": completion["prompt"],
            "completion": completion["completion"],
            "source": source,
            "bugClass": problem["bugClass"],
            "criticGated": i < N_CRITIC_GATED,
        })
        print(f"  [{i + 1}/{len(problems)}] {problem['bugClass']} -> {source}")

    _OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_OUTPUT_PATH, "w", encoding="utf-8") as f:
        for ex in examples:
            f.write(json.dumps(ex) + "\n")

    print(f"\nWrote {len(examples)} synthetic examples to {_OUTPUT_PATH}")


if __name__ == "__main__":
    main()
