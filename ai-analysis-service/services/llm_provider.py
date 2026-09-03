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
        """Returns litellm's OpenAI-compatible ModelResponse
        (.choices[0].message.content, .usage.prompt_tokens/completion_tokens,
        .model - the model that actually answered, which may be
        FALLBACK_MODEL_NAME). litellm retries with FALLBACK_MODEL_NAME if
        MODEL_NAME's call fails (rate limit, provider outage, etc.)."""
        return litellm.completion(
            model=MODEL_NAME,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            fallbacks=[FALLBACK_MODEL_NAME],
        )
