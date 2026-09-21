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


def _cache_key(problem_id: int, code: str, status: str) -> str:
    # status is part of the key so a CE/FAILED-verdict analysis cached for
    # this exact code can never be served back once the same code is
    # resubmitted and actually PASSES (or vice versa) - those are different
    # analyses (different prompt template, different schema) even though
    # the code text is identical.
    normalized = _normalize_code(code)
    return hashlib.sha256(f"{problem_id}:{normalized}:{status}".encode("utf-8")).hexdigest()


def _parse_raw_response(raw_response: str):
    try:
        return json.loads(AnalysisService.clean_llm_response(raw_response))
    except Exception:
        return raw_response


def _metadata_json(result: dict) -> str:
    return json.dumps({
        "toolCalls": result.get("toolCalls", []),
        "criticVerdict": result.get("criticVerdict"),
        "revised": result.get("revised", False),
    })


def _parse_metadata(cache_row: AnalysisCache) -> dict:
    if not cache_row.metadata_json:
        # Pre-existing row from before this field was added, or a stream-
        # cached row (run_analysis_stream doesn't run the critic pass - see
        # services/analysis_service.py's analyze_stream docstring) - either
        # way, "we don't know" is the honest answer, not a fabricated one.
        return {"toolCalls": [], "criticVerdict": None, "revised": False}
    try:
        return json.loads(cache_row.metadata_json)
    except json.JSONDecodeError:
        return {"toolCalls": [], "criticVerdict": None, "revised": False}


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
            **_parse_metadata(cache_row),
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
    cache_key = _cache_key(problem_id, submission["code"], submission["status"])

    db = SessionLocal()
    try:
        cache_row = db.query(AnalysisCache).filter(
            AnalysisCache.cache_key == cache_key
        ).first()

        if cache_row is None:
            result = AnalysisService.analyze(submission_id, submission, problem)
            cache_row = AnalysisCache(
                cache_key=cache_key,
                problem_id=problem_id,
                analysis_type=result["analysisType"],
                raw_response=result["rawResponse"],
                metadata_json=_metadata_json(result),
            )
            db.add(cache_row)
            db.flush()
            source = "AI"
            parsed_analysis = result["parsedAnalysis"]
            analysis_type = result["analysisType"]
            metadata = _parse_metadata(cache_row)
        else:
            source = "CACHE"
            parsed_analysis = _parse_raw_response(cache_row.raw_response)
            analysis_type = cache_row.analysis_type
            metadata = _parse_metadata(cache_row)

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
        **metadata,
    }


def run_analysis_stream(submission_id: int, submission: dict, problem: dict):
    """Streaming counterpart to run_analysis - a generator of the same event
    shape as AnalysisService.analyze_stream (see that docstring), except a
    cache hit short-circuits to a single {"type": "done", ...} event instead
    of re-running the LLM. Persists the same AnalysisCache/
    SubmissionAnalysisMap rows as run_analysis once the stream finishes, so a
    second submission with identical (problem_id, code, status) still gets a
    cache hit afterward - callers should call get_cached first, same as
    run_analysis's callers do, to avoid re-entering this generator on an
    already-cached submission_id."""
    problem_id = submission["problemId"]
    user_id = submission["userId"]
    cache_key = _cache_key(problem_id, submission["code"], submission["status"])

    db = SessionLocal()
    try:
        cache_row = db.query(AnalysisCache).filter(
            AnalysisCache.cache_key == cache_key
        ).first()
    finally:
        db.close()

    if cache_row is not None:
        yield {
            "type": "done",
            "source": "CACHE",
            "result": {
                "analysisType": cache_row.analysis_type,
                "parsedAnalysis": _parse_raw_response(cache_row.raw_response),
                "rawResponse": cache_row.raw_response,
                **_parse_metadata(cache_row),
            },
        }
        return

    result = None
    for event in AnalysisService.analyze_stream(submission_id, submission, problem):
        if event["type"] == "done":
            result = event["result"]
        yield event

    if result is None:
        return  # error event already yielded, nothing to persist

    db = SessionLocal()
    try:
        cache_row = db.query(AnalysisCache).filter(
            AnalysisCache.cache_key == cache_key
        ).first()
        if cache_row is None:
            cache_row = AnalysisCache(
                cache_key=cache_key,
                problem_id=problem_id,
                analysis_type=result["analysisType"],
                raw_response=result["rawResponse"],
                metadata_json=_metadata_json(result),
            )
            db.add(cache_row)
            db.flush()

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
