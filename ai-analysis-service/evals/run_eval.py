"""Phase 3 eval harness. Run for real:
    venv/Scripts/python.exe -m evals.run_eval
(or `make eval` from ai-analysis-service/ - see Makefile)

Makes REAL Groq calls through the real AnalysisService.analyze() (the same
code path production submissions go through, tool loop included) against
GOLDEN_DATASET (evals/golden_dataset.py): once with each problem's mutated
(buggy) code, once with the correct code, then scores every generated
review with a second, independent LLM-as-judge call (evals/judge.py).
Writes results/phase3_eval.json with real numbers - this script is the
"make eval" regression gate the task brief asks for: run it again after any
prompt/model change and diff the numbers against the last committed
results file.

Two infra substitutions, both logged here and in docs/ai-agent-build-log.md
(no live Postgres in this dev environment, same limitation Phase 2 hit):
  - record_usage is a no-op (would otherwise write to a real DB).
  - hybrid_search's vector-search arm is disabled (would otherwise need
    live PGVector) - fetch_similar_past_reviews still runs for real through
    BM25 alone, over the real 141-chunk corpus, when the agent calls it.
Neither substitution touches the actual thing being measured: whether the
generated review text catches the injected bug / correctly judges the
review's quality.
"""

import json
import time
from pathlib import Path

import services.analysis_service as analysis_service_module
import services.hybrid_search as hybrid_search_module
from evals.golden_dataset import GOLDEN_DATASET
from evals.judge import judge_review
from services.analysis_service import AnalysisService

_RESULTS_PATH = Path(__file__).resolve().parent.parent / "results" / "phase3_eval.json"

# See module docstring - no usable live Postgres/pgvector in this dev
# environment (a local Postgres is reachable, but the `vector` extension
# isn't installed on it - "extension \"vector\" is not available", confirmed
# by actually hitting it, not assumed).
analysis_service_module.record_usage = lambda **kwargs: None
analysis_service_module.get_rag_service = lambda: _NullRag()
hybrid_search_module._default_vector_search = lambda query, k: []


class _NullRag:
    def retrieve(self, query):
        return []

# Alarming words in a review of code that has NO injected bug - a crude but
# concrete false-positive signal: the review claiming a defect exists when
# the code is actually correct. Documented as a heuristic, not a claim of
# semantic understanding.
_FALSE_POSITIVE_MARKERS = ["bug", "incorrect", "wrong output", "will fail", "broken", "does not work", "doesn't work"]


def _text_from_failed(parsed: dict) -> str:
    parts = [parsed.get("failureReason", ""), parsed.get("debuggingSuggestion", ""), parsed.get("hints", "")]
    parts.extend(parsed.get("edgeCases", []) or [])
    return " ".join(parts).lower()


def _text_from_passed(parsed: dict) -> str:
    return " ".join([
        parsed.get("codeSmells", ""),
        parsed.get("optimizationSuggestions", ""),
        parsed.get("alternativeApproach", ""),
    ]).lower()


def _run_one(submission_id: str, code: str, status: str, problem_description: str) -> dict:
    submission = {
        "userId": "eval-user",
        "problemId": submission_id,
        "status": status,
        "code": code,
        "errorMessage": "Test case failed: unexpected output or runtime error." if status == "FAILED" else None,
    }
    problem = {"description": problem_description}
    t0 = time.time()
    result = AnalysisService.analyze(submission_id, submission, problem)
    elapsed = time.time() - t0
    return {**result, "elapsedSeconds": round(elapsed, 2)}


def main():
    per_case = []
    caught = 0
    total_mutations = len(GOLDEN_DATASET)
    false_positives = 0
    total_clean = len(GOLDEN_DATASET)
    judge_scores = []

    for entry in GOLDEN_DATASET:
        entry_id = entry["id"]
        mutation = entry["mutation"]
        status = "FAILED" if mutation["correctness_affected"] else "PASSED"

        print(f"[{entry_id}] running mutated ({mutation['bug_class']}, status={status})...")
        mutated_result = _run_one(f"{entry_id}-mutated", mutation["mutated_code"], status, entry["problem_description"])
        review_text = _text_from_failed(mutated_result["parsedAnalysis"]) if status == "FAILED" else _text_from_passed(mutated_result["parsedAnalysis"])
        hit = any(kw in review_text for kw in mutation["catch_keywords"])
        caught += int(hit)

        judge_score = judge_review(entry["problem_description"], mutation["mutated_code"], mutated_result["parsedAnalysis"])
        judge_scores.append(judge_score.model_dump())

        time.sleep(3)  # spread token usage - see llm_provider.py's TPM note
        print(f"[{entry_id}] running clean/correct (status=PASSED)...")
        clean_result = _run_one(f"{entry_id}-clean", entry["correct_code"], "PASSED", entry["problem_description"])
        clean_text = _text_from_passed(clean_result["parsedAnalysis"])
        false_positive = any(marker in clean_text for marker in _FALSE_POSITIVE_MARKERS)
        false_positives += int(false_positive)

        clean_judge_score = judge_review(entry["problem_description"], entry["correct_code"], clean_result["parsedAnalysis"])
        judge_scores.append(clean_judge_score.model_dump())
        time.sleep(3)

        per_case.append({
            "id": entry_id,
            "bugClass": mutation["bug_class"],
            "mutationCorrectnessAffected": mutation["correctness_affected"],
            "mutationCaught": hit,
            "mutationToolCalls": [tc["tool"] for tc in mutated_result["toolCalls"]],
            "mutationJudgeScore": judge_score.model_dump(),
            "cleanFalsePositive": false_positive,
            "cleanToolCalls": [tc["tool"] for tc in clean_result["toolCalls"]],
            "cleanJudgeScore": clean_judge_score.model_dump(),
        })

    catch_rate = caught / total_mutations
    false_positive_rate = false_positives / total_clean
    mean_helpfulness = sum(s["helpfulness"] for s in judge_scores) / len(judge_scores)
    mean_accuracy = sum(s["accuracy"] for s in judge_scores) / len(judge_scores)
    mean_actionability = sum(s["actionability"] for s in judge_scores) / len(judge_scores)

    results = {
        "datasetSize": total_mutations,
        "catchRate": catch_rate,
        "falsePositiveRate": false_positive_rate,
        "judge": {
            "meanHelpfulness": mean_helpfulness,
            "meanAccuracy": mean_accuracy,
            "meanActionability": mean_actionability,
            "nScored": len(judge_scores),
        },
        "perCase": per_case,
    }

    _RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    _RESULTS_PATH.write_text(json.dumps(results, indent=2), encoding="utf-8")

    print()
    print(f"catch rate: {caught}/{total_mutations} = {catch_rate:.2%}")
    print(f"false positive rate: {false_positives}/{total_clean} = {false_positive_rate:.2%}")
    print(f"judge means: helpfulness={mean_helpfulness:.2f} accuracy={mean_accuracy:.2f} actionability={mean_actionability:.2f}")
    print(f"wrote {_RESULTS_PATH}")


if __name__ == "__main__":
    main()
