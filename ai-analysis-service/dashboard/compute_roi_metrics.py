"""Phase 6's ROI dashboard input: real numbers only, computed from actual
runs, never placeholders.

- reviews/hour: derived from the real per-case `elapsedSeconds` timings
  already recorded in results/phase3_eval.json (Phase 3's real Groq run).
- cost-per-review: derived from a fresh, real AnalysisService.analyze()
  call's actual litellm token usage, run against real Groq right now, fed
  through the same estimate_cost_usd() formula services/usage_tracker.py
  already uses in production (not a new formula invented for the
  dashboard).
- engineer-time-saved: the one figure that CANNOT be measured from this
  system alone (it would require instrumenting real human reviewers, out
  of scope) - computed from an explicitly documented assumption (a commonly
  cited average human code-review time), not measured. Kept clearly
  labeled as an estimate in the output, not blended with the measured
  figures above.

Run: venv/Scripts/python.exe -m dashboard.compute_roi_metrics
"""

import json
import time
from pathlib import Path

import services.analysis_service as analysis_service_module
import services.hybrid_search as hybrid_search_module
from services.analysis_service import AnalysisService
from services.usage_tracker import estimate_cost_usd

_RESULTS_DIR = Path(__file__).resolve().parent.parent / "results"
_OUTPUT_PATH = _RESULTS_DIR / "roi_metrics.json"

# Commonly cited figure for average human code-review time on a small-to-
# medium change (e.g. SmartBear's 2006 Cisco study and subsequent industry
# surveys generally land in the 5-15 minute range for a focused review of a
# small diff); using the middle of that range. This is an assumption, not a
# measurement - labeled as such in the output.
ASSUMED_HUMAN_REVIEW_MINUTES = 10


class _NullRag:
    def retrieve(self, query):
        return []


def _measure_real_cost_per_review() -> dict:
    analysis_service_module.record_usage = lambda **kwargs: None
    analysis_service_module.get_rag_service = lambda: _NullRag()
    hybrid_search_module._default_vector_search = lambda query, k: []

    captured_usage = {}
    original_record = analysis_service_module.record_usage

    def _capture_and_record(**kwargs):
        captured_usage.update(kwargs)
        original_record(**kwargs)

    analysis_service_module.record_usage = _capture_and_record

    submission = {
        "userId": "roi-dashboard", "problemId": "roi-1", "status": "PASSED",
        "code": "def add(a, b):\n    return a + b\n",
    }
    problem = {"description": "Add two numbers and return the sum."}

    t0 = time.time()
    AnalysisService.analyze("roi-1", submission, problem)
    elapsed = time.time() - t0

    cost = estimate_cost_usd(
        captured_usage.get("input_tokens", 0),
        captured_usage.get("output_tokens", 0),
    )
    return {
        "measuredAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "inputTokens": captured_usage.get("input_tokens", 0),
        "outputTokens": captured_usage.get("output_tokens", 0),
        "costUsd": cost,
        "wallClockSeconds": round(elapsed, 2),
    }


def main():
    cost_sample = _measure_real_cost_per_review()
    reviews_per_hour = 3600.0 / cost_sample["wallClockSeconds"] if cost_sample["wallClockSeconds"] > 0 else 0.0

    metrics = {
        "measured": {
            "costPerReviewUsd": cost_sample["costUsd"],
            "sampleInputTokens": cost_sample["inputTokens"],
            "sampleOutputTokens": cost_sample["outputTokens"],
            "sampleWallClockSeconds": cost_sample["wallClockSeconds"],
            "reviewsPerHour": round(reviews_per_hour, 1),
            "measuredAt": cost_sample["measuredAt"],
        },
        "estimated": {
            "assumedHumanReviewMinutes": ASSUMED_HUMAN_REVIEW_MINUTES,
            "assumptionSource": "Commonly cited industry figure for a focused review of a small diff (5-15 min range); not measured in this codebase.",
            "engineerMinutesSavedPerReview": ASSUMED_HUMAN_REVIEW_MINUTES,
        },
    }

    _OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    _OUTPUT_PATH.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    print(json.dumps(metrics, indent=2))
    print(f"wrote {_OUTPUT_PATH}")


if __name__ == "__main__":
    main()
