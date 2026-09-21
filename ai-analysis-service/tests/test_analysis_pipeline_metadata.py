"""Covers services/analysis_pipeline.py's metadata_json persistence - the
toolCalls/criticVerdict/revised fields the frontend now needs (see
frontend/src/api/submissions.ts) to show trust signals for a submission's
AI review, whether that review came from a fresh LLM call or a cache hit.

Uses a real (in-memory SQLite) DB round-trip rather than a mock, since
what's being verified here is specifically "does the data survive a
write-then-read cycle," not just "was a function called.\""""

import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from db.models import Base
from services import analysis_pipeline
from services.critic_agent import CriticVerdict


@pytest.fixture
def sqlite_session(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(bind=engine)
    monkeypatch.setattr(analysis_pipeline, "SessionLocal", session_factory)
    return session_factory


SUBMISSION = {"userId": "user-1", "problemId": 7, "status": "PASSED", "code": "def f():\n    return 1\n"}
PROBLEM = {"description": "Return 1."}


def test_run_analysis_persists_and_returns_tool_calls_and_critic_verdict(sqlite_session, monkeypatch):
    fake_result = {
        "analysisType": "PASSED",
        "parsedAnalysis": {"analysisType": "PASSED"},
        "rawResponse": json.dumps({"analysisType": "PASSED"}),
        "toolCalls": [{"tool": "run_linter", "args": {}, "result": {"issues": []}}],
        "criticVerdict": {"verdict": "REVISE", "feedback": "be more specific"},
        "revised": True,
    }
    monkeypatch.setattr("services.analysis_service.AnalysisService.analyze", lambda *a, **k: fake_result)

    result = analysis_pipeline.run_analysis(101, SUBMISSION, PROBLEM)

    assert result["source"] == "AI"
    assert result["toolCalls"] == fake_result["toolCalls"]
    assert result["criticVerdict"] == fake_result["criticVerdict"]
    assert result["revised"] is True

    # Second call with the same (problem_id, code, status) is a cache hit -
    # the metadata must survive the round trip through the DB, not just
    # live in the first call's in-memory return value.
    cached_result = analysis_pipeline.run_analysis(102, SUBMISSION, PROBLEM)
    assert cached_result["source"] == "CACHE"
    assert cached_result["toolCalls"] == fake_result["toolCalls"]
    assert cached_result["criticVerdict"] == fake_result["criticVerdict"]
    assert cached_result["revised"] is True


def test_get_cached_returns_metadata_for_a_previously_analyzed_submission(sqlite_session, monkeypatch):
    fake_result = {
        "analysisType": "FAILED",
        "parsedAnalysis": {"analysisType": "FAILED"},
        "rawResponse": json.dumps({"analysisType": "FAILED"}),
        "toolCalls": [],
        "criticVerdict": CriticVerdict(verdict="APPROVE", feedback="").model_dump(),
        "revised": False,
    }
    monkeypatch.setattr("services.analysis_service.AnalysisService.analyze", lambda *a, **k: fake_result)

    analysis_pipeline.run_analysis(201, {**SUBMISSION, "status": "FAILED"}, PROBLEM)
    cached = analysis_pipeline.get_cached(201)

    assert cached is not None
    assert cached["criticVerdict"] == {"verdict": "APPROVE", "feedback": ""}
    assert cached["revised"] is False


def test_get_cached_on_a_pre_existing_row_with_no_metadata_defaults_safely(sqlite_session):
    """A row written before metadata_json existed (or by run_analysis_stream,
    which never runs the critic) has metadata_json=NULL - must not crash,
    must report "we don't know" rather than fabricate a verdict."""
    from db.models import AnalysisCache, SubmissionAnalysisMap

    session_factory = sqlite_session
    db = session_factory()
    db.add(AnalysisCache(
        cache_key="legacy-key", problem_id=1, analysis_type="PASSED",
        raw_response=json.dumps({"analysisType": "PASSED"}),
    ))
    db.add(SubmissionAnalysisMap(submission_id=301, cache_key="legacy-key", user_id="user-1"))
    db.commit()
    db.close()

    cached = analysis_pipeline.get_cached(301)

    assert cached["toolCalls"] == []
    assert cached["criticVerdict"] is None
    assert cached["revised"] is False
