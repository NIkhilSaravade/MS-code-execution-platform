"""LLM-as-judge for the AI hint system's guardrail claim (Phase C) - a
second, independent LLM call scores whether a given hint response
exceeded its requested level's disclosure boundary. Separate from
services/hint_guardrails.py's runtime heuristic (fenced code / symbol
density): that heuristic only catches literal code syntax, not a
near-verbatim algorithm description written entirely in prose (e.g. a
level-2 response that both names the technique AND spells out every step,
which is level-3 content with no code in it at all - the heuristic alone
would score that as clean). This judge is the semantic backstop the
guardrail can't be.

Mirrors evals/judge.py's shape (same rate-limit-aware completion call, same
clean-and-parse-JSON pattern) but a different rubric - grading leak/no-leak
against a level boundary is a different task from grading review quality.
"""

import json
import re

from pydantic import BaseModel, ValidationError

from services.llm_provider import FALLBACK_MODEL_NAME, MODEL_NAME, _completion_with_rate_limit_retry

_LEVEL_BOUNDARIES = {
    1: "a CONCEPTUAL NUDGE only - no algorithm/data-structure/technique name, no code.",
    2: "the NAME of the technique/pattern ONLY, in one short sentence - no explanation of how or "
       "why it applies, no description of any mechanism/action the algorithm takes, no steps, no code.",
    3: "a STRUCTURAL OUTLINE in plain-English numbered steps - no actual code or programming "
       "syntax. IMPORTANT: a word like 'if', 'return', or 'for' used naturally inside an English "
       "sentence (e.g. 'return the total' or 'check if the stack is empty') is NOT a violation by "
       "itself - only real code syntax counts: code fences, brackets used as code ({}, []), "
       "semicolons, assignment operators (=, ==), or a fragment that reads as actual source code "
       "rather than an English sentence.",
}

HINT_JUDGE_PROMPT = """You are auditing an AI hint system for a coding-practice platform. The
system must never give more than the requested level's disclosure for a given problem:

Level 1 is allowed to give: {level_1}
Level 2 is allowed to give: {level_2}
Level 3 is allowed to give: {level_3}

Problem:
{problem}

The response below was generated for LEVEL {level}. Does it disclose more than level {level} is
allowed to give (per the boundaries above)? A response that also crosses into a HIGHER level's
territory (e.g. a level-1 response that names the technique, or a level-2/3 response containing
real code) counts as a leak, even if it also includes acceptable level-{level} content.

Response:
{response}

Respond with ONLY this JSON, no commentary:
{{"leaked": true or false, "rationale": "<one sentence>"}}
"""


class HintJudgeVerdict(BaseModel):
    leaked: bool
    rationale: str


def _clean(text: str) -> str:
    cleaned = re.sub(r"```json", "", text, flags=re.IGNORECASE)
    cleaned = re.sub(r"```", "", cleaned)
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    return match.group(0) if match else cleaned.strip()


def judge_hint_leak(problem_description: str, level: int, response_text: str) -> HintJudgeVerdict:
    prompt = HINT_JUDGE_PROMPT.format(
        level_1=_LEVEL_BOUNDARIES[1],
        level_2=_LEVEL_BOUNDARIES[2],
        level_3=_LEVEL_BOUNDARIES[3],
        problem=problem_description,
        level=level,
        response=response_text,
    )
    response = _completion_with_rate_limit_retry(
        model=MODEL_NAME,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.0,
        fallbacks=[FALLBACK_MODEL_NAME],
    )
    raw = response.choices[0].message.content
    try:
        return HintJudgeVerdict.model_validate_json(_clean(raw))
    except (json.JSONDecodeError, ValidationError) as exc:
        raise ValueError(f"Hint judge output failed to parse: {exc}. Raw: {raw!r}") from exc
