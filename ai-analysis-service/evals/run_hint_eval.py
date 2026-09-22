"""Phase C eval harness. Run for real:
    venv/Scripts/python.exe -m evals.run_hint_eval
(or `make hint-eval` - see Makefile)

Makes REAL Groq calls through the real services.hint_service.request_hint,
the same code path POST /ai/hint goes through, against every problem in
evals/golden_dataset.py at levels 1-3, then against every adversarial case
in evals/hint_adversarial_dataset.py (level-1 jailbreak attempts). Every
response is checked two ways: services/hint_guardrails.py's structural
heuristic (already exercised live in the request_hint call itself) and a
second, independent LLM-as-judge call (evals/hint_judge.py) that can catch
a prose-only leak the heuristic can't. Writes results/hint_eval.json with
real numbers - published honestly per the task brief, including if the
leak rate is above zero.

Two infra substitutions, same shape and same reason as evals/run_eval.py
(no usable live pgvector in this dev environment - see that module's
docstring):
  - hint_service.hybrid_retrieve is stubbed to a fixed context string.
  - hint_service._resolve_metadata_tool_call is stubbed to always skip the
    MCP tool call, keeping this eval focused on the hint/guardrail
    behavior being measured, not the (already covered by
    tests/test_hint_service.py) metadata-tool path.
Session state uses an in-memory SQLite DB (real writes/reads, just not
against the deployed Postgres), same as tests/test_hint_service.py.
"""

import json
import time
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import services.hint_service as hint_service_module
from db.models import Base
from evals.golden_dataset import GOLDEN_DATASET
from evals.hint_adversarial_dataset import ADVERSARIAL_CASES
from evals.hint_judge import judge_hint_leak
from services.hint_service import request_hint

_RESULTS_PATH = Path(__file__).resolve().parent.parent / "results" / "hint_eval.json"

_engine = create_engine("sqlite:///:memory:")
Base.metadata.create_all(bind=_engine)
hint_service_module.SessionLocal = sessionmaker(bind=_engine)
hint_service_module.hybrid_retrieve = lambda query, top_k=3: []
hint_service_module._resolve_metadata_tool_call = lambda messages: None

_PROBLEMS_BY_ID = {entry["id"]: entry for entry in GOLDEN_DATASET}
# HintSession.problem_id is an Integer column - golden-dataset ids are
# slugs ("two_sum"), so map each to a stable synthetic int id for the
# duration of this eval run only.
_PROBLEM_INT_ID = {entry["id"]: i for i, entry in enumerate(GOLDEN_DATASET)}


def _run_escalation_case(problem_id: str, problem_description: str) -> list[dict]:
    user_id = f"hint-eval-{problem_id}"
    int_problem_id = _PROBLEM_INT_ID[problem_id]
    per_level = []
    for expected_level in (1, 2, 3):
        result = request_hint(user_id, int_problem_id, problem_description, "", "")
        judge_verdict = judge_hint_leak(problem_description, result["level"], result["hint"])
        per_level.append({
            "level": result["level"],
            "heuristicFlagged": result["guardrailFlagged"],
            "judgeLeaked": judge_verdict.leaked,
            "judgeRationale": judge_verdict.rationale,
            "leaked": result["guardrailFlagged"] or judge_verdict.leaked,
            "responsePreview": result["hint"][:200],
        })
        time.sleep(2)  # spread token usage - see llm_provider.py's TPM note
    return per_level


def _run_adversarial_case(case: dict) -> dict:
    problem = _PROBLEMS_BY_ID[case["problem_id"]]
    user_id = f"hint-eval-adversarial-{case['id']}"
    int_problem_id = 1000 + _PROBLEM_INT_ID[case["problem_id"]]  # distinct session from the escalation run above
    result = request_hint(user_id, int_problem_id, problem["problem_description"], "", case["stuck_description"])
    judge_verdict = judge_hint_leak(problem["problem_description"], result["level"], result["hint"])
    leaked = result["guardrailFlagged"] or judge_verdict.leaked
    time.sleep(2)
    return {
        "id": case["id"],
        "problemId": case["problem_id"],
        "level": result["level"],
        "heuristicFlagged": result["guardrailFlagged"],
        "judgeLeaked": judge_verdict.leaked,
        "judgeRationale": judge_verdict.rationale,
        "leaked": leaked,
        "refused": not leaked,
        "responsePreview": result["hint"][:200],
    }


def main():
    escalation_results = {}
    leaks_by_level = {1: 0, 2: 0, 3: 0}
    total_by_level = {1: 0, 2: 0, 3: 0}

    for entry in GOLDEN_DATASET:
        entry_id = entry["id"]
        print(f"[{entry_id}] running hint escalation (levels 1-3)...")
        per_level = _run_escalation_case(entry_id, entry["problem_description"])
        escalation_results[entry_id] = per_level
        for row in per_level:
            total_by_level[row["level"]] += 1
            leaks_by_level[row["level"]] += int(row["leaked"])

    adversarial_results = []
    for case in ADVERSARIAL_CASES:
        print(f"[adversarial:{case['id']}] running jailbreak attempt...")
        adversarial_results.append(_run_adversarial_case(case))

    leak_rate_by_level = {
        level: (leaks_by_level[level] / total_by_level[level] if total_by_level[level] else None)
        for level in (1, 2, 3)
    }
    adversarial_refused = sum(1 for r in adversarial_results if r["refused"])
    adversarial_refusal_rate = adversarial_refused / len(adversarial_results) if adversarial_results else None

    results = {
        "datasetSize": len(GOLDEN_DATASET),
        "leakRateByLevel": leak_rate_by_level,
        "leaksByLevel": leaks_by_level,
        "totalByLevel": total_by_level,
        "adversarialCaseCount": len(adversarial_results),
        "adversarialRefusalRate": adversarial_refusal_rate,
        "escalationResults": escalation_results,
        "adversarialResults": adversarial_results,
    }

    _RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    _RESULTS_PATH.write_text(json.dumps(results, indent=2), encoding="utf-8")

    print()
    for level in (1, 2, 3):
        rate = leak_rate_by_level[level]
        print(f"level {level} leak rate: {leaks_by_level[level]}/{total_by_level[level]} = {rate:.2%}" if rate is not None else f"level {level}: no data")
    print(f"adversarial refusal rate: {adversarial_refused}/{len(adversarial_results)} = {adversarial_refusal_rate:.2%}")
    print(f"wrote {_RESULTS_PATH}")


if __name__ == "__main__":
    main()
