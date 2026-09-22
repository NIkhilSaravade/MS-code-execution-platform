"""Phase A: graduated, no-spoiler hint generation for POST /ai/hint and
POST /ai/hint/reveal-solution (see main.py). Reuses existing infra rather
than rebuilding it: services/llm_provider.py (retry/fallback), the RAG
corpus via services/hybrid_search.py (Phase 2), services/redaction.py
(Phase 4), a dedicated rate limiter (services/rate_limiter.py), and the
MCP tool layer (services/mcp_client.py, Phase 5) for an on-demand
problem-metadata lookup - see services/tools.py's get_problem_metadata.

Escalation is server-controlled, not client-controlled: request_hint()
always advances the session's own current_level by exactly one (capped at
MAX_ESCALATING_LEVEL), regardless of what the caller sends - there is no
"give me level 3" request shape, so a client can't skip ahead by
construction, not just by convention. Level 4 (the full solution) is a
structurally separate function/endpoint entirely - reveal_solution() is
never reachable as a side effect of repeated request_hint() calls.

Guardrail enforcement (services/hint_guardrails.py) runs on every level
1-3 response, independent of the prompt instructions in
prompts/hint_prompt.py - see that module's docstring for why prompt
instructions alone aren't treated as sufficient enforcement.
"""

import json

from db.database import SessionLocal
from db.models import HintEvent, HintSession
from logging_config import get_logger
from prompts.hint_prompt import (
    HINT_TEMPLATE,
    SOLUTION_SYSTEM_PROMPT,
    SOLUTION_TEMPLATE,
    SYSTEM_PROMPT,
    level_instruction,
)
from services import mcp_client
from services.hint_guardrails import looks_like_code, strip_code_fences
from services.hybrid_search import hybrid_retrieve
from services.llm_provider import LLMProvider
from services.redaction import redact_secrets

log = get_logger(__name__)

MAX_ESCALATING_LEVEL = 3

# The hint agent gets exactly one tool, unlike the full review agent's
# 4-step, multi-tool loop (services/agent_loop.py) - there's only one tool
# relevant here and no reason a single hint would need to call it twice,
# so this is a bounded single-step resolution rather than a reuse of
# agent_loop.resolve_tool_calls's step cap/stuck-detection machinery.
_METADATA_TOOL_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "get_problem_metadata",
            "description": "Fetch a problem's tags, constraints and difficulty by problem id, when the hint needs them.",
            "parameters": {
                "type": "object",
                "properties": {"problemId": {"type": "integer"}},
                "required": ["problemId"],
            },
        },
    }
]


def _get_or_create_session(db, user_id: str, problem_id: int) -> HintSession:
    session = db.query(HintSession).filter(
        HintSession.user_id == user_id, HintSession.problem_id == problem_id
    ).first()
    if session is None:
        session = HintSession(user_id=user_id, problem_id=problem_id, current_level=0)
        db.add(session)
        db.flush()
    return session


def get_session_state(user_id: str, problem_id: int) -> dict:
    """Lets the frontend restore hint state on page load (e.g. after a
    refresh) instead of only ever seeing it as the return value of a
    request_hint() call."""
    db = SessionLocal()
    try:
        session = db.query(HintSession).filter(
            HintSession.user_id == user_id, HintSession.problem_id == problem_id
        ).first()
        current_level = session.current_level if session else 0

        history = db.query(HintEvent).filter(
            HintEvent.user_id == user_id, HintEvent.problem_id == problem_id
        ).order_by(HintEvent.created_at.asc()).all()

        return {
            "currentLevel": current_level,
            "history": [
                {
                    "level": h.level,
                    "isSolutionReveal": h.is_solution_reveal,
                    "response": h.response_text,
                    "createdAt": h.created_at.isoformat(),
                }
                for h in history
            ],
        }
    finally:
        db.close()


def _resolve_metadata_tool_call(messages: list[dict]) -> dict | None:
    response = LLMProvider.complete_with_tools(messages, _METADATA_TOOL_SCHEMA)
    message = response.choices[0].message
    tool_calls = getattr(message, "tool_calls", None) or []
    if not tool_calls:
        return None

    tc = tool_calls[0]
    try:
        args = json.loads(tc.function.arguments or "{}")
    except json.JSONDecodeError:
        args = {}

    result = mcp_client.call_tool_sync("get_problem_metadata", args)

    messages.append({
        "role": "assistant",
        "content": message.content,
        "tool_calls": [{
            "id": tc.id,
            "type": "function",
            "function": {"name": tc.function.name, "arguments": tc.function.arguments},
        }],
    })
    messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result)})
    return result


def _grounding_context(problem_description: str, stuck_description: str) -> str:
    query = f"{problem_description}\n{stuck_description}".strip()
    chunks = hybrid_retrieve(query, top_k=3)
    return "\n".join(c.text for c in chunks)


def request_hint(
    user_id: str,
    problem_id: int,
    problem_description: str,
    code: str,
    stuck_description: str,
) -> dict:
    """Escalates the session one level (capped at MAX_ESCALATING_LEVEL) and
    returns the generated hint. Takes no caller-supplied level - the
    server always decides the next level from stored session state."""
    redacted_code, redacted_patterns = redact_secrets(code)
    if redacted_patterns:
        log.warning("hint.code_redacted", problem_id=problem_id, patterns=sorted(set(redacted_patterns)))

    db = SessionLocal()
    try:
        session = _get_or_create_session(db, user_id, problem_id)
        level = min(session.current_level + 1, MAX_ESCALATING_LEVEL)

        context = _grounding_context(problem_description, stuck_description)
        prompt_text = HINT_TEMPLATE.format(
            level=level,
            level_instruction=level_instruction(level),
            problem=problem_description,
            code=redacted_code,
            stuck_description=stuck_description or "(none given)",
            context=context,
        )
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt_text},
        ]

        tool_result = _resolve_metadata_tool_call(messages)

        response = LLMProvider.complete_with_tools(messages, tools=None)
        hint_text = (response.choices[0].message.content or "").strip()

        guardrail_flagged = False
        if looks_like_code(hint_text):
            guardrail_flagged = True
            log.warning("hint.guardrail_flagged", problem_id=problem_id, level=level)
            messages.append({"role": "assistant", "content": hint_text})
            messages.append({
                "role": "user",
                "content": (
                    "That response included code or code-like syntax, which is "
                    "not allowed at this hint level. Rewrite it as plain-English "
                    "prose only, with no code fences and no programming syntax."
                ),
            })
            retry_response = LLMProvider.complete_with_tools(messages, tools=None)
            retried_text = (retry_response.choices[0].message.content or "").strip()
            hint_text = retried_text if not looks_like_code(retried_text) else strip_code_fences(retried_text)

        session.current_level = level
        db.add(HintEvent(
            user_id=user_id,
            problem_id=problem_id,
            level=level,
            is_solution_reveal=False,
            guardrail_flagged=guardrail_flagged,
            stuck_description=stuck_description,
            response_text=hint_text,
        ))
        db.commit()
    finally:
        db.close()

    return {
        "level": level,
        "hint": hint_text,
        "usedProblemMetadata": tool_result is not None,
        "guardrailFlagged": guardrail_flagged,
    }


def reveal_solution(
    user_id: str,
    problem_id: int,
    problem_description: str,
    code: str,
    stuck_description: str,
) -> dict:
    """Level 4 - only reachable through this separate function (and its own
    separate endpoint, POST /ai/hint/reveal-solution, which gates on an
    explicit confirm=true before calling this at all - see main.py). Every
    call here is logged as is_solution_reveal=True regardless of the
    session's current_level, since the caller already passed that
    confirmation gate before this runs."""
    redacted_code, redacted_patterns = redact_secrets(code)
    if redacted_patterns:
        log.warning("hint.solution_code_redacted", problem_id=problem_id, patterns=sorted(set(redacted_patterns)))

    context = _grounding_context(problem_description, stuck_description)
    prompt_text = SOLUTION_TEMPLATE.format(
        problem=problem_description,
        code=redacted_code,
        stuck_description=stuck_description or "(none given)",
        context=context,
    )
    messages = [
        {"role": "system", "content": SOLUTION_SYSTEM_PROMPT},
        {"role": "user", "content": prompt_text},
    ]
    response = LLMProvider.complete_with_tools(messages, tools=None)
    solution_text = (response.choices[0].message.content or "").strip()

    db = SessionLocal()
    try:
        session = _get_or_create_session(db, user_id, problem_id)
        # A solution reveal doesn't retroactively mean the user "earned"
        # level 3 through the graduated track - but it also shouldn't leave
        # a stale, lower current_level sitting around once they've already
        # seen the answer, so this just pins it at the escalating track's
        # ceiling rather than inventing a level-4 value for current_level.
        session.current_level = max(session.current_level, MAX_ESCALATING_LEVEL)
        db.add(HintEvent(
            user_id=user_id,
            problem_id=problem_id,
            level=4,
            is_solution_reveal=True,
            guardrail_flagged=False,
            stuck_description=stuck_description,
            response_text=solution_text,
        ))
        db.commit()
        log.info("hint.solution_revealed", user_id=user_id, problem_id=problem_id)
    finally:
        db.close()

    return {"level": 4, "solution": solution_text}
