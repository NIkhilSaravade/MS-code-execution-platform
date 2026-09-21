import asyncio
import json
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import httpx

from logging_config import get_logger
from services import analysis_pipeline
from services.circuit_breaker import CircuitOpenError, get_breaker
from services.exceptions import AnalysisOutputInvalid
from services.rate_limiter import get_analysis_rate_limiter
from db.database import engine
from db.init_db import create_tables
from discovery.eureka_client import deregister_from_eureka, register_with_eureka
from discovery.service_resolver import get_service_url
from security.jwt_verifier import get_current_claims
from kafka.consumer import start_background as start_kafka_consumer
from tracing import configure_tracing

log = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_tables()
    await register_with_eureka()
    # Best-effort, fire-and-forget - see kafka/consumer.py's module docstring
    # for why a failure here must never affect judged results or this
    # service's own HTTP endpoints.
    consumer_task = start_kafka_consumer(asyncio.get_event_loop())

    yield

    # Runs on SIGTERM (uvicorn/Kubernetes) - without this, a rolling deploy
    # kills the Kafka consumer mid-message (see run_consumer_loop's own
    # try/finally, which never gets a chance to run) and leaves this
    # instance registered in Eureka until its lease expires, so other
    # services keep routing to a process that's already gone.
    consumer_task.cancel()
    try:
        await consumer_task
    except asyncio.CancelledError:
        pass
    await deregister_from_eureka()
    engine.dispose()


app = FastAPI(lifespan=lifespan)

# Must happen here, not inside lifespan's startup handler: Starlette caches
# its middleware stack on the very first ASGI call, which is the
# "lifespan" scope invocation itself - by the time a startup handler runs,
# that stack is already built, so FastAPIInstrumentor.instrument_app's
# added middleware would silently never take effect (confirmed - every
# request traced 0 spans until this moved out of lifespan).
configure_tracing(app)


@app.get("/health")
async def health():
    return {"status": "UP"}


class AnalyzeRequest(BaseModel):
    submissionId: int


async def _fetch_submission_and_problem(submission_id: int, authorization: str) -> tuple[dict, dict]:
    """Shared by POST /ai/analyze and POST /ai/analyze/stream - both need the
    same ownership-scoped fetch of the submission (via the caller's own JWT,
    not a service token - see submission-service's IDOR-scoped GET
    /submissions/{id}) plus its problem."""
    headers = {"Authorization": authorization}

    submission_service_url = await get_service_url("SUBMISSION-SERVICE")
    problem_service_url = await get_service_url("PROBLEM-SERVICE")

    submission_breaker = get_breaker("submission-service")
    problem_breaker = get_breaker("problem-service")

    async with httpx.AsyncClient(timeout=10.0) as client:
        submission_response = await submission_breaker.call(
            client.get,
            f"{submission_service_url}/submissions/{submission_id}",
            headers=headers,
        )
        if submission_response.status_code != 200:
            raise HTTPException(
                status_code=submission_response.status_code,
                detail=submission_response.text
            )
        submission = submission_response.json()

        problem_response = await problem_breaker.call(
            client.get,
            f"{problem_service_url}/problems/{submission['problemId']}",
            headers=headers,
        )
        if problem_response.status_code != 200:
            raise HTTPException(
                status_code=problem_response.status_code,
                detail=problem_response.text
            )
        problem = problem_response.json()

    return submission, problem


@app.post("/ai/analyze")
async def analyze_code(
    request: AnalyzeRequest,
    authorization: str = Header(None),
    claims: dict = Depends(get_current_claims),
):
    if not get_analysis_rate_limiter().allow(claims.get("sub", "unknown")):
        raise HTTPException(status_code=429, detail="Too many analysis requests - try again shortly.")

    cached = analysis_pipeline.get_cached(request.submissionId)
    if cached:
        log.info("analyze.cache_hit", submission_id=request.submissionId)
        return {
            "analysis": cached["analysis"],
            "source": cached["source"],
            "toolCalls": cached.get("toolCalls", []),
            "criticVerdict": cached.get("criticVerdict"),
            "revised": cached.get("revised", False),
        }

    log.info("analyze.cache_miss", submission_id=request.submissionId)

    try:
        submission, problem = await _fetch_submission_and_problem(request.submissionId, authorization)
    except CircuitOpenError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    try:
        return analysis_pipeline.run_analysis(request.submissionId, submission, problem)
    except AnalysisOutputInvalid as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/ai/analyze/stream")
async def analyze_code_stream(
    request: AnalyzeRequest,
    authorization: str = Header(None),
    claims: dict = Depends(get_current_claims),
):
    """SSE variant of POST /ai/analyze - each event is `data: <json>\\n\\n`,
    one of {"type": "tool_call", ...} / {"type": "token", "content": ...} /
    {"type": "done", "result": ...} / {"type": "error", "message": ...}.
    Auth/ownership/circuit-breaker behavior is identical to POST /ai/analyze;
    the only difference is the response is streamed as it's generated
    instead of returned as one blocking JSON body."""
    if not get_analysis_rate_limiter().allow(claims.get("sub", "unknown")):
        raise HTTPException(status_code=429, detail="Too many analysis requests - try again shortly.")

    try:
        submission, problem = await _fetch_submission_and_problem(request.submissionId, authorization)
    except CircuitOpenError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    async def event_generator():
        for event in analysis_pipeline.run_analysis_stream(request.submissionId, submission, problem):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/ai/analysis/{submission_id}")
async def get_analysis(submission_id: int, claims: dict = Depends(get_current_claims)):
    """Cache-only lookup, polled by the frontend after a submission is
    judged (see execution-result-service's analysis.trigger.v1 auto-trigger).
    Returns PENDING rather than 404 while the Kafka-triggered analysis is
    still in flight or ai-analysis-service hasn't gotten to it yet.

    Object-level authz: the cached row's userId must match the caller's own
    subject, same "not found rather than forbidden" pattern submission-service
    uses - this is a straight cache read, unlike POST /ai/analyze, which
    naturally enforces ownership via submission-service's own ownership-scoped
    GET /submissions/{id}.
    """
    cached = analysis_pipeline.get_cached(submission_id)
    if cached is None:
        return {"status": "PENDING"}
    if cached.get("userId") != claims.get("sub"):
        return {"status": "PENDING"}
    return {
        "status": "READY",
        "analysis": cached["analysis"],
        "source": cached["source"],
        "toolCalls": cached.get("toolCalls", []),
        "criticVerdict": cached.get("criticVerdict"),
        "revised": cached.get("revised", False),
    }
