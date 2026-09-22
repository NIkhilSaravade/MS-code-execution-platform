"""Covers main.py's POST /ai/explain HTTP surface: rate limiting, the
submission-vs-generic mode decision, and the mismatched-problemId guard.
Mocks main._fetch_submission_and_problem/_fetch_problem and
services.explanation_service directly, same style as
tests/test_main_hint_endpoints.py."""

from fastapi.testclient import TestClient

import main
from security.jwt_verifier import get_current_claims
from services.exceptions import ExplanationGenerationFailed
from services.rate_limiter import RateLimiter


def _client_with_claims(sub="user-1"):
    main.app.dependency_overrides[get_current_claims] = lambda: {"sub": sub}
    return TestClient(main.app)


def test_explain_endpoint_returns_429_when_rate_limited(monkeypatch):
    monkeypatch.setattr(main, "get_explain_rate_limiter", lambda: RateLimiter(max_requests=0, window_seconds=60.0))
    try:
        client = _client_with_claims()
        response = client.post(
            "/ai/explain", json={"problemId": 1},
            headers={"Authorization": "Bearer test-token"},
        )
    finally:
        main.app.dependency_overrides.pop(get_current_claims, None)
    assert response.status_code == 429


def test_explain_endpoint_generic_mode_when_no_submission_id(monkeypatch):
    async def fake_fetch_problem(problem_id, authorization):
        return {"description": "desc"}

    def fake_explain(**kwargs):
        assert kwargs["code"] is None
        return {"explanation": "generic walkthrough", "mode": "generic", "source": "AI"}

    monkeypatch.setattr(main, "_fetch_problem", fake_fetch_problem)
    monkeypatch.setattr(main.explanation_service, "explain", fake_explain)

    try:
        client = _client_with_claims()
        response = client.post(
            "/ai/explain", json={"problemId": 1},
            headers={"Authorization": "Bearer test-token"},
        )
    finally:
        main.app.dependency_overrides.pop(get_current_claims, None)

    assert response.status_code == 200
    assert response.json()["mode"] == "generic"


def test_explain_endpoint_submission_mode_when_passed(monkeypatch):
    async def fake_fetch_submission_and_problem(submission_id, authorization):
        return {"problemId": 5, "status": "PASSED", "code": "def f(): pass"}, {"description": "desc"}

    def fake_explain(**kwargs):
        assert kwargs["code"] == "def f(): pass"
        return {"explanation": "submission walkthrough", "mode": "submission", "source": "AI"}

    monkeypatch.setattr(main, "_fetch_submission_and_problem", fake_fetch_submission_and_problem)
    monkeypatch.setattr(main.explanation_service, "explain", fake_explain)

    try:
        client = _client_with_claims()
        response = client.post(
            "/ai/explain", json={"problemId": 5, "submissionId": 100},
            headers={"Authorization": "Bearer test-token"},
        )
    finally:
        main.app.dependency_overrides.pop(get_current_claims, None)

    assert response.status_code == 200
    assert response.json()["mode"] == "submission"


def test_explain_endpoint_falls_back_to_generic_when_submission_not_passed(monkeypatch):
    async def fake_fetch_submission_and_problem(submission_id, authorization):
        return {"problemId": 5, "status": "FAILED", "code": "def f(): pass"}, {"description": "desc"}

    def fake_explain(**kwargs):
        assert kwargs["code"] is None
        return {"explanation": "generic fallback", "mode": "generic", "source": "AI"}

    monkeypatch.setattr(main, "_fetch_submission_and_problem", fake_fetch_submission_and_problem)
    monkeypatch.setattr(main.explanation_service, "explain", fake_explain)

    try:
        client = _client_with_claims()
        response = client.post(
            "/ai/explain", json={"problemId": 5, "submissionId": 100},
            headers={"Authorization": "Bearer test-token"},
        )
    finally:
        main.app.dependency_overrides.pop(get_current_claims, None)

    assert response.status_code == 200
    assert response.json()["mode"] == "generic"


def test_explain_endpoint_rejects_mismatched_problem_id(monkeypatch):
    async def fake_fetch_submission_and_problem(submission_id, authorization):
        return {"problemId": 999, "status": "PASSED", "code": "x"}, {"description": "desc"}

    monkeypatch.setattr(main, "_fetch_submission_and_problem", fake_fetch_submission_and_problem)

    try:
        client = _client_with_claims()
        response = client.post(
            "/ai/explain", json={"problemId": 5, "submissionId": 100},
            headers={"Authorization": "Bearer test-token"},
        )
    finally:
        main.app.dependency_overrides.pop(get_current_claims, None)

    assert response.status_code == 400


def test_explain_endpoint_returns_502_when_generation_fails(monkeypatch):
    async def fake_fetch_problem(problem_id, authorization):
        return {"description": "desc"}

    def fake_explain(**kwargs):
        raise ExplanationGenerationFailed("LLM returned an empty explanation")

    monkeypatch.setattr(main, "_fetch_problem", fake_fetch_problem)
    monkeypatch.setattr(main.explanation_service, "explain", fake_explain)

    try:
        client = _client_with_claims()
        response = client.post(
            "/ai/explain", json={"problemId": 1},
            headers={"Authorization": "Bearer test-token"},
        )
    finally:
        main.app.dependency_overrides.pop(get_current_claims, None)

    assert response.status_code == 502
