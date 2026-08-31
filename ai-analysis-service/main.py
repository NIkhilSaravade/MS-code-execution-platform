import asyncio

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel
import httpx

from services import analysis_pipeline
from services.exceptions import AnalysisOutputInvalid
from db.init_db import create_tables
from discovery.eureka_client import register_with_eureka
from discovery.service_resolver import get_service_url
from security.jwt_verifier import get_current_claims
from kafka.consumer import start_background as start_kafka_consumer


app = FastAPI()


@app.on_event("startup")
async def startup():
    create_tables()
    await register_with_eureka()
    # Best-effort, fire-and-forget - see kafka/consumer.py's module docstring
    # for why a failure here must never affect judged results or this
    # service's own HTTP endpoints.
    start_kafka_consumer(asyncio.get_event_loop())


class AnalyzeRequest(BaseModel):
    submissionId: int


@app.post("/ai/analyze")
async def analyze_code(
    request: AnalyzeRequest,
    authorization: str = Header(None),
    claims: dict = Depends(get_current_claims),
):
    cached = analysis_pipeline.get_cached(request.submissionId)
    if cached:
        print("Returning from CACHE")
        return {"analysis": cached["analysis"], "source": cached["source"]}

    print("Not found in cache. Calling services via Eureka...")

    headers = {"Authorization": authorization}

    submission_service_url = await get_service_url("SUBMISSION-SERVICE")
    problem_service_url = await get_service_url("PROBLEM-SERVICE")

    async with httpx.AsyncClient(timeout=10.0) as client:
        submission_response = await client.get(
            f"{submission_service_url}/submissions/{request.submissionId}",
            headers=headers
        )
        if submission_response.status_code != 200:
            raise HTTPException(
                status_code=submission_response.status_code,
                detail=submission_response.text
            )
        submission = submission_response.json()

        problem_response = await client.get(
            f"{problem_service_url}/problems/{submission['problemId']}",
            headers=headers
        )
        if problem_response.status_code != 200:
            raise HTTPException(
                status_code=problem_response.status_code,
                detail=problem_response.text
            )
        problem = problem_response.json()

    try:
        return analysis_pipeline.run_analysis(request.submissionId, submission, problem)
    except AnalysisOutputInvalid as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


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
    return {"status": "READY", "analysis": cached["analysis"], "source": cached["source"]}
