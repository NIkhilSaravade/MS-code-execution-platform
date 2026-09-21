import os

import litellm
from dotenv import load_dotenv

load_dotenv()

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


class LLMProvider:

    @staticmethod
    def complete(prompt: str):
        """Legacy single-prompt call, kept for anything not yet using the
        tool-calling loop. Returns litellm's OpenAI-compatible ModelResponse."""
        return litellm.completion(
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
        return litellm.completion(**kwargs)

    @staticmethod
    def stream(messages: list[dict]):
        """Final-answer turn, streamed. Tools are deliberately not bound here
        - by the time this is called the agent loop has already resolved any
        tool calls it needed (see services/agent_loop.py), and a tool call
        can't be executed mid-stream without buffering the whole response
        anyway, which would defeat the point of streaming. Returns litellm's
        stream iterator; each chunk's .choices[0].delta.content is a text
        fragment (possibly None on the terminal chunk)."""
        return litellm.completion(
            model=MODEL_NAME,
            messages=messages,
            temperature=0.2,
            fallbacks=[FALLBACK_MODEL_NAME],
            stream=True,
            stream_options={"include_usage": True},
        )
