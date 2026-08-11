import json
from typing import Optional

from db.database import SessionLocal
from db.models import AIAnalysis
from services.analysis_service import AnalysisService

# Shared by both trigger paths - POST /ai/analyze (user-triggered, forwards
# the caller's own JWT) and the analysis.trigger.v1 Kafka consumer
# (auto-triggered right after a submission is judged, authenticated as this
# service itself - see auth/token_client.py). Neither path duplicates the
# cache-check/LLM-call/persist logic.


def get_cached(submission_id: int) -> Optional[dict]:
    db = SessionLocal()
    try:
        cached = db.query(AIAnalysis).filter(
            AIAnalysis.submission_id == submission_id
        ).first()
        if not cached:
            return None
        try:
            parsed = json.loads(AnalysisService.clean_llm_response(cached.analysis))
        except Exception:
            parsed = cached.analysis
        return {"analysis": parsed, "source": "CACHE", "userId": cached.user_id}
    finally:
        db.close()


def run_analysis(submission_id: int, submission: dict, problem: dict) -> dict:
    """Runs the LLM analysis and persists it - NOT cache-checked here, callers
    should call get_cached first (see main.py's POST /ai/analyze and
    kafka/consumer.py, which both do)."""

    result = AnalysisService.analyze(submission, problem)

    parsed_analysis = result.get("parsedAnalysis")
    raw_response = result.get("rawResponse")

    db = SessionLocal()
    try:
        db.add(AIAnalysis(
            submission_id=submission_id,
            problem_id=submission["problemId"],
            user_id=submission["userId"],
            code=submission["code"],
            analysis=raw_response,
        ))
        db.commit()
    finally:
        db.close()

    return {
        "analysis": parsed_analysis,
        "analysisType": result.get("analysisType"),
        "source": "AI",
    }
