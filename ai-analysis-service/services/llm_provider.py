import os
import time

import litellm
from dotenv import load_dotenv

from logging_config import get_logger

load_dotenv()

log = get_logger(__name__)

# Provider-agnostic via litellm's "<provider>/<model>" naming - swap models
# or providers by changing these env vars alone, no code change.
#
# The previous defaults (groq/llama-3.1-8b-instant, groq/llama-3.1-70b-versatile)
# both broke in production: the 70b model was decommissioned by Groq outright,
# and the 8b model returned "does not exist or you do not have access to it"
# for this account specifically, even though Groq's own public model-catalog
# docs still list it - GET https://api.groq.com/openai/v1/models against the
# real GROQ_API_KEY confirmed neither is actually in this key's available
# model list, regardless of what the docs say. Verified these two ARE
# available and complete successfully against the real key/account.
MODEL_NAME = os.getenv("LLM_MODEL", "groq/openai/gpt-oss-20b")
FALLBACK_MODEL_NAME = os.getenv("LLM_FALLBACK_MODEL", "groq/openai/gpt-oss-120b")

_RATE_LIMIT_RETRIES = 3
_RATE_LIMIT_BACKOFF_SECONDS = [2, 5, 10]


def _completion_with_rate_limit_retry(**kwargs):
    """Groq's free tier enforces a per-model tokens-per-minute cap (8000 TPM
    on this account, confirmed by actually hitting it while running Phase
    3's eval harness back-to-back against both MODEL_NAME and
    FALLBACK_MODEL_NAME in the same minute). litellm's own `fallbacks=`
    doesn't help here - the fallback model can be just as rate-limited as
    the primary, and was, in the run that surfaced this. A short
    fixed-backoff retry loop is enough for this service's actual traffic
    pattern (one submission's worth of calls, not sustained high QPS)."""
    for attempt in range(_RATE_LIMIT_RETRIES + 1):
        try:
            return litellm.completion(**kwargs)
        except Exception as exc:
            # litellm's fallbacks= runner sometimes re-wraps the original
            # RateLimitError as a generic APIConnectionError once every
            # fallback in the chain has also been rate-limited (observed
            # directly - see this function's docstring), so matching on
            # litellm.RateLimitError alone isn't reliable here; check the
            # message instead.
            is_rate_limit = (
                isinstance(exc, litellm.RateLimitError)
                or "rate limit" in str(exc).lower()
                or "rate_limit" in str(exc).lower()
                or "429" in str(exc)
            )
            if not is_rate_limit or attempt == _RATE_LIMIT_RETRIES:
                raise
            delay = _RATE_LIMIT_BACKOFF_SECONDS[min(attempt, len(_RATE_LIMIT_BACKOFF_SECONDS) - 1)]
            log.warning("llm_provider.rate_limited_retrying", attempt=attempt, delay_seconds=delay)
            time.sleep(delay)


class LLMProvider:

    @staticmethod
    def complete(prompt: str):
        """Legacy single-prompt call, kept for anything not yet using the
        tool-calling loop. Returns litellm's OpenAI-compatible ModelResponse."""
        return _completion_with_rate_limit_retry(
            model=MODEL_NAME,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            fallbacks=[FALLBACK_MODEL_NAME],
        )

    @staticmethod
    def complete_with_tools(messages: list[dict], tools: list[dict] | None = None):
        """One non-streaming turn of the agent loop. Returns litellm's
        ModelResponse - .choices[0].message may carry .tool_calls (a list of
        {id, function: {name, arguments}} entries) instead of/alongside
        .content, per the OpenAI function-calling wire format litellm
        normalizes every provider to."""
        kwargs = dict(
            model=MODEL_NAME,
            messages=messages,
            temperature=0.2,
            fallbacks=[FALLBACK_MODEL_NAME],
        )
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"
        return _completion_with_rate_limit_retry(**kwargs)

    @staticmethod
    def stream(messages: list[dict]):
        """Final-answer turn, streamed. Tools are deliberately not bound here
        - by the time this is called the agent loop has already resolved any
        tool calls it needed (see services/agent_loop.py), and a tool call
        can't be executed mid-stream without buffering the whole response
        anyway, which would defeat the point of streaming. Returns litellm's
        stream iterator; each chunk's .choices[0].delta.content is a text
        fragment (possibly None on the terminal chunk)."""
        return _completion_with_rate_limit_retry(
            model=MODEL_NAME,
            messages=messages,
            temperature=0.2,
            fallbacks=[FALLBACK_MODEL_NAME],
            stream=True,
            stream_options={"include_usage": True},
        )
