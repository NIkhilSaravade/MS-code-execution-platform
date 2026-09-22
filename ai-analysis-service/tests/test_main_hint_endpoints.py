"""Covers the HTTP surface of the AI hint system - main.py's POST /ai/hint,
POST /ai/hint/reveal-solution, and GET /ai/hint/{problemId}/session. Mocks
main._fetch_problem and services.hint_service directly (same "mock at the
call site" style as tests/test_main_rate_limit.py), so no live
problem-service or LLM call is needed."""

from fastapi.testclient import TestClient

import main
from security.jwt_verifier import get_current_claims
from services.rate_limiter import RateLimiter


def _client_with_claims(sub="user-1"):
    main.app.dependency_overrides[get_current_claims] = lambda: {"sub": sub}
    return TestClient(main.app)


def test_hint_endpoint_returns_429_when_rate_limited(monkeypatch):
    monkeypatch.setattr(main, "get_hint_rate_limiter", lambda: RateLimiter(max_requests=0, window_seconds=60.0))
    try:
        client = _client_with_claims()
        response = client.post(
            "/ai/hint", json={"problemId": 1, "code": "", "stuckDescription": ""},
            headers={"Authorization": "Bearer test-token"},
        )
    finally:
        main.app.dependency_overrides.pop(get_current_claims, None)

    assert response.status_code == 429


def test_hint_endpoint_calls_hint_service_with_fetched_problem_description(monkeypatch):
    async def fake_fetch_problem(problem_id, authorization):
        assert problem_id == 42
        return {"description": "Some problem description."}

    def fake_request_hint(**kwargs):
        assert kwargs["problem_description"] == "Some problem description."
        assert kwargs["user_id"] == "user-1"
        return {"level": 1, "hint": "a nudge", "usedProblemMetadata": False, "guardrailFlagged": False}

    monkeypatch.setattr(main, "_fetch_problem", fake_fetch_problem)
    monkeypatch.setattr(main.hint_service, "request_hint", fake_request_hint)

    try:
        client = _client_with_claims()
        response = client.post(
            "/ai/hint", json={"problemId": 42, "code": "x=1", "stuckDescription": "help"},
            headers={"Authorization": "Bearer test-token"},
        )
    finally:
        main.app.dependency_overrides.pop(get_current_claims, None)

    assert response.status_code == 200
    assert response.json()["level"] == 1


def test_reveal_solution_endpoint_requires_explicit_confirm(monkeypatch):
    try:
        client = _client_with_claims()
        response = client.post(
            "/ai/hint/reveal-solution",
            json={"problemId": 1, "code": "", "stuckDescription": "", "confirm": False},
            headers={"Authorization": "Bearer test-token"},
        )
    finally:
        main.app.dependency_overrides.pop(get_current_claims, None)

    assert response.status_code == 400


def test_reveal_solution_endpoint_succeeds_when_confirmed(monkeypatch):
    async def fake_fetch_problem(problem_id, authorization):
        return {"description": "desc"}

    def fake_reveal_solution(**kwargs):
        return {"level": 4, "solution": "the full solution"}

    monkeypatch.setattr(main, "_fetch_problem", fake_fetch_problem)
    monkeypatch.setattr(main.hint_service, "reveal_solution", fake_reveal_solution)

    try:
        client = _client_with_claims()
        response = client.post(
            "/ai/hint/reveal-solution",
            json={"problemId": 1, "code": "", "stuckDescription": "", "confirm": True},
            headers={"Authorization": "Bearer test-token"},
        )
    finally:
        main.app.dependency_overrides.pop(get_current_claims, None)

    assert response.status_code == 200
    assert response.json()["level"] == 4


def test_hint_session_endpoint_returns_state(monkeypatch):
    def fake_get_session_state(user_id, problem_id):
        assert user_id == "user-1"
        assert problem_id == 7
        return {"currentLevel": 2, "history": []}

    monkeypatch.setattr(main.hint_service, "get_session_state", fake_get_session_state)

    try:
        client = _client_with_claims()
        response = client.get("/ai/hint/7/session", headers={"Authorization": "Bearer test-token"})
    finally:
        main.app.dependency_overrides.pop(get_current_claims, None)

    assert response.status_code == 200
    assert response.json()["currentLevel"] == 2
