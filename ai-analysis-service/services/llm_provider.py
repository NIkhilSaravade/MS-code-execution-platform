import os

import litellm
from dotenv import load_dotenv

load_dotenv()

# Provider-agnostic via litellm's "<provider>/<model>" naming - swap models
# or providers by changing these env vars alone, no code change. Defaults
# keep the previous behavior (Groq's llama-3.1-8b-instant) with a larger
# same-provider model as the fallback.
MODEL_NAME = os.getenv("LLM_MODEL", "groq/llama-3.1-8b-instant")
FALLBACK_MODEL_NAME = os.getenv("LLM_FALLBACK_MODEL", "groq/llama-3.1-70b-versatile")


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
