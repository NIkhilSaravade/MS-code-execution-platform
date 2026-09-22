"""Runtime guardrail for the AI hint system - a cheap, always-on
structural check applied to every level 1-3 hint response
(services/hint_service.py), independent of prompts/hint_prompt.py's
instructions. Prompt instructions are not enforcement; this is the actual
enforcement point, in the same spirit Phase 4 treated prompt injection as
something to defend against structurally rather than just ask the model
nicely not to do.

Not a full solution-leak classifier - that's Phase C's LLM-as-judge eval
(scripts/eval_hints.py). This is the fast tripwire: does the response
contain a fenced code block or a high density of code-only symbols, either
of which a levels-1-3 hint should never contain. Deliberately conservative
(false positives just trigger one stricter regeneration in
hint_service.py - a false negative is the real cost, since that's an
undetected leak)."""

import re

_CODE_FENCE = re.compile(r"```")
_CODE_SYMBOLS = re.compile(r"[{};]")
_SYMBOL_DENSITY_THRESHOLD = 3


def looks_like_code(text: str) -> bool:
    if _CODE_FENCE.search(text):
        return True
    return len(_CODE_SYMBOLS.findall(text)) >= _SYMBOL_DENSITY_THRESHOLD


def strip_code_fences(text: str) -> str:
    """Last-resort fallback if even a stricter regeneration still leaks:
    drop fenced code blocks entirely rather than return them to the user."""
    return re.sub(
        r"```.*?```",
        "[code omitted - not available at this hint level]",
        text,
        flags=re.DOTALL,
    )
