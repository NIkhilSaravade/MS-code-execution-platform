"""Phase 5 supervisor/critic agent - a second, independent LLM call that
judges the primary reviewer's draft (services/agent_loop.py's
finalize_non_stream output, after schema validation) before it's returned
to the caller. A genuine two-agent topology, not a relabeled single call:
the critic never writes review text itself, only APPROVE/REVISE plus a
reason; only the primary agent (agent_loop.py) ever produces the review a
user sees, whether on the first pass or after a forced revision.
"""

import json
import re

from pydantic import BaseModel, ValidationError

from logging_config import get_logger
from services.llm_provider import LLMProvider

log = get_logger(__name__)

CRITIC_SYSTEM_PROMPT = (
    "You are a strict quality reviewer checking another AI's code review "
    "before it is shown to a user. You do not write reviews yourself - you "
    "only judge the draft you are given for factual accuracy (is the stated "
    "time/space complexity, described bug, etc. actually correct for the "
    "code shown?) and usefulness. If it is materially wrong or unhelpful, "
    "reject it and state exactly what is wrong so it can be corrected. "
    "Respond with ONLY this JSON, nothing else:\n"
    '{"verdict": "APPROVE" or "REVISE", "feedback": "<reason, empty string if APPROVE>"}'
)


class CriticVerdict(BaseModel):
    verdict: str
    feedback: str

    @property
    def needs_revision(self) -> bool:
        return self.verdict.strip().upper() == "REVISE"


def _clean(text: str) -> str:
    cleaned = re.sub(r"```json", "", text, flags=re.IGNORECASE)
    cleaned = re.sub(r"```", "", cleaned)
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    return match.group(0) if match else cleaned.strip()


def critique(problem_description: str, code: str, draft: dict) -> CriticVerdict:
    """`code` must already be redacted (see analysis_service.py's
    _build_messages) - this is a second LLM call and must not be handed
    anything the redaction pass wouldn't have let through the first one."""
    messages = [
        {"role": "system", "content": CRITIC_SYSTEM_PROMPT},
        {"role": "user", "content": (
            f"Problem:\n{problem_description}\n\nCode:\n{code}\n\n"
            f"Draft review (JSON):\n{json.dumps(draft)}"
        )},
    ]
    response = LLMProvider.complete_with_tools(messages, tools=None)
    raw = response.choices[0].message.content
    try:
        return CriticVerdict.model_validate_json(_clean(raw))
    except (json.JSONDecodeError, ValidationError) as exc:
        # Fail open: a critic that can't be parsed shouldn't block the
        # user's review entirely - log it and treat as APPROVE rather than
        # raising, since the primary draft already passed its own schema
        # validation and is a legitimate result on its own.
        log.warning("critic_agent.unparseable_verdict", error=str(exc), raw=raw)
        return CriticVerdict(verdict="APPROVE", feedback="")
