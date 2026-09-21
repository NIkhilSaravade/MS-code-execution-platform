from services.rate_limiter import RateLimiter


def test_allows_up_to_max_requests_then_blocks():
    limiter = RateLimiter(max_requests=3, window_seconds=60.0)
    assert limiter.allow("user-1") is True
    assert limiter.allow("user-1") is True
    assert limiter.allow("user-1") is True
    assert limiter.allow("user-1") is False


def test_different_users_have_independent_limits():
    limiter = RateLimiter(max_requests=1, window_seconds=60.0)
    assert limiter.allow("user-1") is True
    assert limiter.allow("user-2") is True
    assert limiter.allow("user-1") is False
    assert limiter.allow("user-2") is False


def test_window_expiry_resets_the_limit(monkeypatch):
    limiter = RateLimiter(max_requests=1, window_seconds=10.0)

    current_time = [1000.0]
    monkeypatch.setattr("services.rate_limiter.time.monotonic", lambda: current_time[0])

    assert limiter.allow("user-1") is True
    assert limiter.allow("user-1") is False

    current_time[0] += 11.0  # past the 10s window
    assert limiter.allow("user-1") is True
