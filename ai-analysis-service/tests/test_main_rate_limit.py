from fastapi.testclient import TestClient

import main
from security.jwt_verifier import get_current_claims
from services.rate_limiter import RateLimiter


def test_analyze_endpoint_returns_429_when_rate_limited(monkeypatch):
    monkeypatch.setattr(main, "get_analysis_rate_limiter", lambda: RateLimiter(max_requests=0, window_seconds=60.0))
    main.app.dependency_overrides[get_current_claims] = lambda: {"sub": "user-1"}

    try:
        client = TestClient(main.app)
        response = client.post(
            "/ai/analyze", json={"submissionId": 1},
            headers={"Authorization": "Bearer test-token"},
        )
    finally:
        main.app.dependency_overrides.pop(get_current_claims, None)

    assert response.status_code == 429


def test_analyze_stream_endpoint_returns_429_when_rate_limited(monkeypatch):
    monkeypatch.setattr(main, "get_analysis_rate_limiter", lambda: RateLimiter(max_requests=0, window_seconds=60.0))
    main.app.dependency_overrides[get_current_claims] = lambda: {"sub": "user-1"}

    try:
        client = TestClient(main.app)
        response = client.post(
            "/ai/analyze/stream", json={"submissionId": 1},
            headers={"Authorization": "Bearer test-token"},
        )
    finally:
        main.app.dependency_overrides.pop(get_current_claims, None)

    assert response.status_code == 429
