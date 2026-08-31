import os

from db.database import SessionLocal
from db.models import UsageLedger

# Groq's list pricing changes independently of this codebase, so both rates
# are env-overridable rather than hardcoded to one point-in-time number -
# defaults are a rough approximation for llama-3.1-8b-instant.
_INPUT_PRICE_PER_1K_USD = float(os.getenv("LLM_PRICE_INPUT_PER_1K_USD", "0.00005"))
_OUTPUT_PRICE_PER_1K_USD = float(os.getenv("LLM_PRICE_OUTPUT_PER_1K_USD", "0.00008"))


def estimate_cost_usd(input_tokens: int, output_tokens: int) -> float:
    return (
        (input_tokens / 1000.0) * _INPUT_PRICE_PER_1K_USD
        + (output_tokens / 1000.0) * _OUTPUT_PRICE_PER_1K_USD
    )


def record_usage(
    user_id: str,
    submission_id: int,
    model: str,
    input_tokens: int,
    output_tokens: int,
) -> None:
    db = SessionLocal()
    try:
        db.add(UsageLedger(
            user_id=user_id,
            submission_id=submission_id,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            estimated_cost_usd=estimate_cost_usd(input_tokens, output_tokens),
        ))
        db.commit()
    finally:
        db.close()
