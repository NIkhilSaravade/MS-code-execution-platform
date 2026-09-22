"""Phase 5 Done-when: "the primary reviewer's tool calls are demonstrably
going through MCP." Marked @pytest.mark.real_mcp so the autouse mock in
conftest.py doesn't intercept it - these tests spawn the real
mcp_server/server.py subprocess and speak the actual Model Context
Protocol over stdio (services/mcp_client.py, the official `mcp` SDK)."""

import json

import pytest

from services import mcp_client
from services.agent_loop import resolve_tool_calls
from services.llm_provider import LLMProvider
from tests.fakes import completion_response, tool_call


@pytest.mark.real_mcp
def test_list_tools_discovers_all_five_tools_via_real_protocol_roundtrip():
    schemas = mcp_client.list_tools_sync()
    names = {s["function"]["name"] for s in schemas}
    # get_problem_metadata was added in Phase A (services/hint_service.py)
    # for the hint agent's on-demand problem-metadata lookup - it's
    # registered on the same MCP server as the original four review tools
    # (mcp_server/server.py), so it shows up here too.
    assert names == {
        "run_linter",
        "run_security_scan",
        "fetch_similar_past_reviews",
        "get_style_guide_section",
        "get_problem_metadata",
    }
    # Each schema's parameters came from the server's own auto-generated
    # JSON schema (see mcp_server/server.py), not a copy sitting next to it.
    run_linter_schema = next(s for s in schemas if s["function"]["name"] == "run_linter")
    assert set(run_linter_schema["function"]["parameters"]["required"]) == {"language", "code"}


@pytest.mark.real_mcp
def test_call_tool_via_real_mcp_server_returns_real_ruff_finding():
    result = mcp_client.call_tool_sync("run_linter", {
        "language": "python",
        "code": "import os\ndef f():\n    return 1\n",
    })
    assert result["supported"] is True
    assert any(issue["code"] == "F401" for issue in result["issues"])


@pytest.mark.real_mcp
def test_agent_loop_resolves_tool_calls_through_the_real_mcp_server(monkeypatch):
    """End-to-end: services/agent_loop.py's resolve_tool_calls, unmocked,
    fetches its tool schemas from the real MCP server and executes the
    tool call through it - only the LLM call itself is faked, so this
    isolates "does the agent loop really use MCP" from "does the LLM
    behave a certain way" (already covered by other tests)."""
    calls = {"n": 0}

    def fake_complete_with_tools(messages, tools=None):
        calls["n"] += 1
        if calls["n"] == 1:
            return completion_response(
                tool_calls=[tool_call("call-1", "run_linter", {
                    "language": "python", "code": "import os\ndef f():\n    return 1\n",
                })]
            )
        return completion_response(content="done", tool_calls=None)

    monkeypatch.setattr(LLMProvider, "complete_with_tools", staticmethod(fake_complete_with_tools))

    # Reset the module-level schema cache so this test proves a fresh,
    # real discovery call rather than reusing whatever another test cached.
    import services.agent_loop as agent_loop_module
    agent_loop_module._tool_schemas_cache = None

    messages = [{"role": "user", "content": "review this"}]
    transcript = resolve_tool_calls(messages)

    assert len(transcript) == 1
    assert transcript[0]["tool"] == "run_linter"
    assert any(issue["code"] == "F401" for issue in transcript[0]["result"]["issues"])

    tool_messages = [m for m in messages if m.get("role") == "tool"]
    fed_back = json.loads(tool_messages[0]["content"])
    assert any(issue["code"] == "F401" for issue in fed_back["issues"])
