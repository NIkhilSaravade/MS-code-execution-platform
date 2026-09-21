"""Regression test for the rate-limit retry surfaced by Phase 3's eval
harness run against real Groq traffic (see docs/ai-agent-build-log.md)."""

import litellm

from services.llm_provider import LLMProvider, _completion_with_rate_limit_retry


def test_retries_on_rate_limit_then_succeeds(monkeypatch):
    calls = {"n": 0}

    def fake_completion(**kwargs):
        calls["n"] += 1
        if calls["n"] < 3:
            raise litellm.RateLimitError(
                message="Rate limit reached for model x on tokens per minute (TPM)",
                model="groq/openai/gpt-oss-20b",
                llm_provider="groq",
            )
        return "ok"

    monkeypatch.setattr(litellm, "completion", fake_completion)
    monkeypatch.setattr("services.llm_provider.time.sleep", lambda seconds: None)

    result = _completion_with_rate_limit_retry(model="x", messages=[])

    assert result == "ok"
    assert calls["n"] == 3


def test_gives_up_after_max_retries(monkeypatch):
    def always_rate_limited(**kwargs):
        raise litellm.RateLimitError(
            message="Rate limit reached for model x on tokens per minute (TPM)",
            model="groq/openai/gpt-oss-20b",
            llm_provider="groq",
        )

    monkeypatch.setattr(litellm, "completion", always_rate_limited)
    monkeypatch.setattr("services.llm_provider.time.sleep", lambda seconds: None)

    try:
        _completion_with_rate_limit_retry(model="x", messages=[])
        assert False, "expected RateLimitError to propagate"
    except litellm.RateLimitError:
        pass


def test_non_rate_limit_error_is_not_retried(monkeypatch):
    calls = {"n": 0}

    def fake_completion(**kwargs):
        calls["n"] += 1
        raise ValueError("some other failure")

    monkeypatch.setattr(litellm, "completion", fake_completion)

    try:
        _completion_with_rate_limit_retry(model="x", messages=[])
        assert False, "expected ValueError to propagate"
    except ValueError:
        pass

    assert calls["n"] == 1  # no retry for a non-rate-limit error


def test_llm_provider_uses_the_retry_helper(monkeypatch):
    """LLMProvider.complete_with_tools must go through the retry wrapper,
    not call litellm.completion directly - otherwise this regression could
    silently come back if someone refactors llm_provider.py later."""
    calls = {"n": 0}

    def fake_completion(**kwargs):
        calls["n"] += 1
        return "ok"

    monkeypatch.setattr("services.llm_provider._completion_with_rate_limit_retry", fake_completion)

    result = LLMProvider.complete_with_tools([{"role": "user", "content": "hi"}])

    assert result == "ok"
    assert calls["n"] == 1
