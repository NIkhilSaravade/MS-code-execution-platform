"""GET /ai/analysis/{id} and POST /ai/analyze's cache-hit path must surface
toolCalls/criticVerdict/revised to the frontend, not just the raw analysis
- see frontend/src/api/submissions.ts's AiAnalysisResponse type."""

from fastapi.testclient import TestClient

import main
from security.jwt_verifier import get_current_claims

FAKE_CACHED = {
    "analysis": {"analysisType": "PASSED", "codeSmells": "None."},
    "source": "CACHE",
    "userId": "user-1",
    "toolCalls": [{"tool": "run_linter", "args": {}, "result": {"issues": []}}],
    "criticVerdict": {"verdict": "APPROVE", "feedback": ""},
    "revised": False,
}


def test_get_analysis_includes_tool_calls_and_critic_verdict(monkeypatch):
    monkeypatch.setattr(main.analysis_pipeline, "get_cached", lambda submission_id: FAKE_CACHED)
    main.app.dependency_overrides[get_current_claims] = lambda: {"sub": "user-1"}

    try:
        client = TestClient(main.app)
        response = client.get("/ai/analysis/1", headers={"Authorization": "Bearer test-token"})
    finally:
        main.app.dependency_overrides.pop(get_current_claims, None)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "READY"
    assert body["toolCalls"] == FAKE_CACHED["toolCalls"]
    assert body["criticVerdict"] == FAKE_CACHED["criticVerdict"]
    assert body["revised"] is False


def test_analyze_cache_hit_includes_tool_calls_and_critic_verdict(monkeypatch):
    monkeypatch.setattr(main, "get_analysis_rate_limiter", lambda: __import__("services.rate_limiter", fromlist=["RateLimiter"]).RateLimiter(max_requests=10, window_seconds=60.0))
    monkeypatch.setattr(main.analysis_pipeline, "get_cached", lambda submission_id: FAKE_CACHED)
    main.app.dependency_overrides[get_current_claims] = lambda: {"sub": "user-1"}

    try:
        client = TestClient(main.app)
        response = client.post(
            "/ai/analyze", json={"submissionId": 1},
            headers={"Authorization": "Bearer test-token"},
        )
    finally:
        main.app.dependency_overrides.pop(get_current_claims, None)

    assert response.status_code == 200
    body = response.json()
    assert body["toolCalls"] == FAKE_CACHED["toolCalls"]
    assert body["criticVerdict"] == FAKE_CACHED["criticVerdict"]
    assert body["revised"] is False
