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
# Caching is content-addressed: AnalysisCache is keyed by
# hash(problem_id, normalized_code), so two submissions with identical code
# (a resubmission, or two users converging on the same solution) share one
# LLM call. SubmissionAnalysisMap is the submission_id -> cache_key lookup,
# since callers only ever have a submission_id.


def normalize_code(code: str) -> str:
    """Strips trailing whitespace per line and surrounding blank lines, so
    cosmetic differences (trailing spaces, extra blank lines) don't produce
    a different cache key for otherwise-identical code."""
    lines = [line.rstrip() for line in code.splitlines()]
    return "\n".join(lines).strip()


def make_cache_key(problem_id: int, normalized_code: str) -> str:
    digest_input = f"{problem_id}:{normalized_code}".encode("utf-8")
    return hashlib.sha256(digest_input).hexdigest()


def get_cached(submission_id: int) -> Optional[dict]:
    db = SessionLocal()
    try:
        mapping = db.query(SubmissionAnalysisMap).filter(
            SubmissionAnalysisMap.submission_id == submission_id
        ).first()
        if not mapping:
            return None

        cached = db.query(AnalysisCache).filter(
            AnalysisCache.cache_key == mapping.cache_key
        ).first()
        if not cached:
            return None

        return {
            "analysis": json.loads(cached.analysis),
            "source": "CACHE",
            "userId": mapping.user_id,
        }
    finally:
        db.close()


def run_analysis(submission_id: int, submission: dict, problem: dict) -> dict:
    """Runs the LLM analysis (or reuses an existing cache entry for the same
    problem+code) and maps this submission_id to it - NOT cache-checked by
    submission_id here, callers should call get_cached first (see main.py's
    POST /ai/analyze and kafka/consumer.py, which both do).

    Raises AnalysisService's AnalysisOutputInvalid if the LLM's response
    fails schema validation - nothing is cached or mapped in that case."""

    normalized = normalize_code(submission["code"])
    cache_key = make_cache_key(submission["problemId"], normalized)

    db = SessionLocal()
    try:
        existing = db.query(AnalysisCache).filter(AnalysisCache.cache_key == cache_key).first()

        if existing is None:
            result = AnalysisService.analyze(submission, problem)
            existing = AnalysisCache(
                cache_key=cache_key,
                problem_id=submission["problemId"],
                analysis_type=result["analysisType"],
                analysis=json.dumps(result["parsedAnalysis"]),
            )
            db.add(existing)
            source = "AI"
        else:
            source = "CACHE"

        db.merge(SubmissionAnalysisMap(
            submission_id=submission_id,
            cache_key=cache_key,
            user_id=submission["userId"],
        ))
        db.commit()

        return {
            "analysis": json.loads(existing.analysis),
            "analysisType": existing.analysis_type,
            "source": source,
        }
    finally:
        db.close()
