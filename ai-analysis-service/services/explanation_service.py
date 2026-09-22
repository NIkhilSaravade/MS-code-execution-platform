"""Phase B: post-solve walkthrough for POST /ai/explain (see main.py).
Reuses the same infra Phase A/the original review pipeline already
established - services/llm_provider.py, the RAG corpus via
services/hybrid_search.py, services/redaction.py - but is a genuinely
different pipeline from services/analysis_service.py, not a variant of
it: no tool-calling agent loop, no critic pass, no PassedAnalysis/
FailedAnalysis schema validation. The output is free-form teaching prose
(prompts/explain_prompt.py), because this is pedagogy, not a terse review.

Two modes (see prompts/explain_prompt.py's code_section docstring):
"submission" - a real PASSED submission's code is walked through directly.
"generic" - no working code exists (the user gave up), so the walkthrough
explains the intended approach from scratch instead.
"""

import hashlib

from db.database import SessionLocal
from db.models import ExplanationCache
from logging_config import get_logger
from prompts.explain_prompt import EXPLAIN_TEMPLATE, SYSTEM_PROMPT, code_section
from services.exceptions import ExplanationGenerationFailed
from services.hybrid_search import hybrid_retrieve
from services.llm_provider import LLMProvider
from services.redaction import redact_secrets

log = get_logger(__name__)


def _cache_key(problem_id: int, mode: str, code: str | None) -> str:
    normalized_code = (code or "").strip()
    return hashlib.sha256(f"{problem_id}:{mode}:{normalized_code}".encode("utf-8")).hexdigest()


def explain(problem_id: int, problem_description: str, code: str | None) -> dict:
    """`code` should already be a real PASSED submission's source, or None
    for the generic/"gave up" mode - callers (main.py) decide which mode
    applies before calling this, this function doesn't re-derive it from a
    submission status."""
    mode = "submission" if code else "generic"

    redacted_code = None
    if code:
        redacted_code, redacted_patterns = redact_secrets(code)
        if redacted_patterns:
            log.warning("explain.code_redacted", problem_id=problem_id, patterns=sorted(set(redacted_patterns)))

    cache_key = _cache_key(problem_id, mode, redacted_code)

    db = SessionLocal()
    try:
        cache_row = db.query(ExplanationCache).filter(ExplanationCache.cache_key == cache_key).first()
        if cache_row is not None:
            log.info("explain.cache_hit", problem_id=problem_id, mode=mode)
            return {"explanation": cache_row.raw_response, "mode": mode, "source": "CACHE"}

        context_chunks = hybrid_retrieve(problem_description, top_k=3)
        context = "\n".join(c.text for c in context_chunks)

        prompt_text = EXPLAIN_TEMPLATE.format(
            problem=problem_description,
            code_section=code_section(redacted_code),
            context=context,
        )
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt_text},
        ]
        response = LLMProvider.complete_with_tools(messages, tools=None)
        explanation_text = (response.choices[0].message.content or "").strip()

        if not explanation_text:
            # Don't persist a blank result - a transient empty completion
            # would otherwise be cached forever and served to every future
            # caller for this exact (problem_id, mode, code) combination,
            # since ExplanationCache is a permanent content-addressed
            # cache with no TTL/invalidation (see get_cached's own model
            # docstring in analysis_pipeline.py for the equivalent
            # reasoning on the review pipeline's cache).
            log.warning("explain.empty_response", problem_id=problem_id, mode=mode)
            raise ExplanationGenerationFailed(
                f"LLM returned an empty explanation for problem {problem_id} (mode={mode})"
            )

        db.add(ExplanationCache(
            cache_key=cache_key,
            problem_id=problem_id,
            mode=mode,
            raw_response=explanation_text,
        ))
        db.commit()
    finally:
        db.close()

    return {"explanation": explanation_text, "mode": mode, "source": "AI"}
