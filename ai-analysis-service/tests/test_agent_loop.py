import json

from services import agent_loop
from services.llm_provider import LLMProvider
from tests.fakes import completion_response, tool_call


def test_resolve_tool_calls_executes_tool_and_feeds_result_back(monkeypatch):
    """A tool the model requests must actually run and its result must land
    back in the message history as a 'tool' role message the next LLM call
    will see."""
    calls = {"n": 0}

    def fake_complete_with_tools(messages, tools=None):
        calls["n"] += 1
        if calls["n"] == 1:
            return completion_response(
                tool_calls=[tool_call("call-1", "run_linter", {
                    "language": "python",
                    "code": "import os\ndef f():\n    return 1\n",
                })]
            )
        return completion_response(content="done", tool_calls=None)

    monkeypatch.setattr(LLMProvider, "complete_with_tools", staticmethod(fake_complete_with_tools))

    messages = [{"role": "user", "content": "review this"}]
    transcript = agent_loop.resolve_tool_calls(messages)

    assert calls["n"] == 2
    assert len(transcript) == 1
    assert transcript[0]["tool"] == "run_linter"
    assert any(issue["code"] == "F401" for issue in transcript[0]["result"]["issues"])

    tool_messages = [m for m in messages if m.get("role") == "tool"]
    assert len(tool_messages) == 1
    fed_back = json.loads(tool_messages[0]["content"])
    assert any(issue["code"] == "F401" for issue in fed_back["issues"])


def test_resolve_tool_calls_respects_max_steps(monkeypatch):
    """A model that keeps requesting a *different* tool call every step must
    still be cut off at MAX_TOOL_STEPS, never looping forever."""
    calls = {"n": 0}

    def fake_complete_with_tools(messages, tools=None):
        calls["n"] += 1
        return completion_response(
            tool_calls=[tool_call(f"call-{calls['n']}", "get_style_guide_section", {"topic": f"topic-{calls['n']}"})]
        )

    monkeypatch.setattr(LLMProvider, "complete_with_tools", staticmethod(fake_complete_with_tools))

    messages = [{"role": "user", "content": "review this"}]
    transcript = agent_loop.resolve_tool_calls(messages)

    assert calls["n"] == agent_loop.MAX_TOOL_STEPS
    assert len(transcript) == agent_loop.MAX_TOOL_STEPS


def test_resolve_tool_calls_stops_early_on_stuck_repeat(monkeypatch):
    """A model that requests the exact same tool call twice in a row is
    'stuck' and the loop should bail out well before MAX_TOOL_STEPS."""
    calls = {"n": 0}

    def fake_complete_with_tools(messages, tools=None):
        calls["n"] += 1
        return completion_response(
            tool_calls=[tool_call(f"call-{calls['n']}", "get_style_guide_section", {"topic": "naming"})]
        )

    monkeypatch.setattr(LLMProvider, "complete_with_tools", staticmethod(fake_complete_with_tools))

    messages = [{"role": "user", "content": "review this"}]
    transcript = agent_loop.resolve_tool_calls(messages)

    assert calls["n"] == 2  # first call executes it, second sees the repeat and stops
    assert len(transcript) == 2
    assert calls["n"] < agent_loop.MAX_TOOL_STEPS
