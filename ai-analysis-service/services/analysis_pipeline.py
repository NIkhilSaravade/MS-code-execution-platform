import hashlib
import json
from typing import Optional

from db.database import SessionLocal
from db.models import AnalysisCache, SubmissionAnalysisMap
from services.analysis_service import AnalysisService

# Shared by both trigger paths - POST /ai/analyze (user-triggered, forwards
# the caller's own JWT) and the analysis.trigger.v1 Kafka consumer
# (auto-triggered right after a submission is judged, authenticated as this
# service itself - see auth/token_client.py). Neither path duplicates the
# cache-check/LLM-call/persist logic.
#
# Caching is content-addressed (AnalysisCache, keyed by sha256(problem_id +
# normalized code)) rather than submission_id-keyed, so two submissions with
# identical code share one LLM call. SubmissionAnalysisMap is the thin
# per-submission pointer into that shared cache - it's what carries user_id
# for GET /ai/analysis/{id}'s ownership check.


def _normalize_code(code: str) -> str:
    return "\n".join(line.rstrip() for line in code.strip().splitlines())


def _cache_key(problem_id: int, code: str) -> str:
    normalized = _normalize_code(code)
    return hashlib.sha256(f"{problem_id}:{normalized}".encode("utf-8")).hexdigest()


def _parse_raw_response(raw_response: str):
    try:
        return json.loads(AnalysisService.clean_llm_response(raw_response))
    except Exception:
        return raw_response


def get_cached(submission_id: int) -> Optional[dict]:
    db = SessionLocal()
    try:
        mapping = db.query(SubmissionAnalysisMap).filter(
            SubmissionAnalysisMap.submission_id == submission_id
        ).first()
        if mapping is None:
            return None

        cache_row = db.query(AnalysisCache).filter(
            AnalysisCache.cache_key == mapping.cache_key
        ).first()
        if cache_row is None:
            return None

        return {
            "analysis": _parse_raw_response(cache_row.raw_response),
            "source": "CACHE",
            "userId": mapping.user_id,
        }
    finally:
        db.close()


def run_analysis(submission_id: int, submission: dict, problem: dict) -> dict:
    """Runs the LLM analysis (or reuses a content-cache hit) and persists a
    submission_id -> cache_key mapping - NOT cache-checked by submission_id
    here, callers should call get_cached first (see main.py's POST
    /ai/analyze and kafka/consumer.py, which both do). This still checks the
    content cache by (problem_id, code) before calling the LLM, since a
    submission_id miss doesn't imply a content miss."""

    problem_id = submission["problemId"]
    user_id = submission["userId"]
    cache_key = _cache_key(problem_id, submission["code"])

    db = SessionLocal()
    try:
        cache_row = db.query(AnalysisCache).filter(
            AnalysisCache.cache_key == cache_key
        ).first()

        if cache_row is None:
            result = AnalysisService.analyze(submission, problem)
            cache_row = AnalysisCache(
                cache_key=cache_key,
                problem_id=problem_id,
                analysis_type=result["analysisType"],
                raw_response=result["rawResponse"],
            )
            db.add(cache_row)
            db.flush()
            source = "AI"
            parsed_analysis = result["parsedAnalysis"]
            analysis_type = result["analysisType"]
        else:
            source = "CACHE"
            parsed_analysis = _parse_raw_response(cache_row.raw_response)
            analysis_type = cache_row.analysis_type

        mapping = db.query(SubmissionAnalysisMap).filter(
            SubmissionAnalysisMap.submission_id == submission_id
        ).first()
        if mapping is None:
            db.add(SubmissionAnalysisMap(
                submission_id=submission_id,
                cache_key=cache_key,
                user_id=user_id,
            ))
        else:
            mapping.cache_key = cache_key
            mapping.user_id = user_id

        db.commit()
    finally:
        db.close()

    return {
        "analysis": parsed_analysis,
        "analysisType": analysis_type,
        "source": source,
    }
