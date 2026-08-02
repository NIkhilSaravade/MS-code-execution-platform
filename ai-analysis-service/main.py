from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel
import httpx
import json

from services.analysis_service import AnalysisService
from db.database import SessionLocal
from db.models import AIAnalysis
from db.init_db import create_tables
from discovery.eureka_client import register_with_eureka
from discovery.service_resolver import get_service_url
from security.jwt_verifier import get_current_claims


app = FastAPI()


@app.on_event("startup")
async def startup():
    create_tables()
    await register_with_eureka()


class AnalyzeRequest(BaseModel):
    submissionId: int


@app.post("/ai/analyze")
async def analyze_code(
    request: AnalyzeRequest,
    authorization: str = Header(None),
    claims: dict = Depends(get_current_claims),
):

    headers = {"Authorization": authorization}

    db = SessionLocal()

    try:
        # ==============================
        # 1️⃣ Check Cache
        # ==============================
        cached = db.query(AIAnalysis).filter(
            AIAnalysis.submission_id == request.submissionId
        ).first()

        if cached:
            print("Returning from CACHE")

            try:
                parsed_cached = json.loads(
                    AnalysisService.clean_llm_response(cached.analysis)
                )
            except Exception:
                parsed_cached = cached.analysis

            return {
                "analysis": parsed_cached,
                "source": "CACHE"
            }

        print("Not found in cache. Calling services via Eureka...")

        # ==============================
        # 2️⃣ Resolve Services from Eureka
        # ==============================
        submission_service_url = await get_service_url("SUBMISSION-SERVICE")
        problem_service_url = await get_service_url("PROBLEM-SERVICE")

        # ==============================
        # 3️⃣ Async HTTP Calls
        # ==============================
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

        # ==============================
        # 4️⃣ Run AI (still sync but lightweight)
        # ==============================
        result = AnalysisService.analyze(submission, problem)

        parsed_analysis = result.get("parsedAnalysis")
        raw_response = result.get("rawResponse")

        # ==============================
        # 5️⃣ Save Raw Response to DB
        # ==============================
        new_entry = AIAnalysis(
            submission_id=request.submissionId,
            problem_id=submission["problemId"],
            user_id=submission["userId"],
            code=submission["code"],
            analysis=raw_response
        )

        db.add(new_entry)
        db.commit()

        print("Saved to database")

        return {
            "analysis": parsed_analysis,
            "analysisType": result.get("analysisType"),
            "source": "AI"
        }

    finally:
        db.close()