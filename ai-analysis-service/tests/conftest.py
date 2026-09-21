import os

import pytest

# Must run before any project module is imported (conftest.py loads first).
# db/database.py raises at import time if DATABASE_URL is unset, but
# SQLAlchemy's create_engine is lazy - it never actually connects with these
# dummy values, so no live Postgres is needed to import/test the service.
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test_ai_analysis_db")
os.environ.setdefault("AUTH_SERVICE_JWKS_URL", "http://localhost:9999/.well-known/jwks.json")

# Deliberately NOT stubbing GROQ_API_KEY here (a prior version of this file
# did, with a fake value). services/llm_provider.py's `load_dotenv()` call
# does NOT override an env var that's already set - so a fake value set
# here would silently shadow the real key .env provides, breaking any test
# that needs to make a real Groq call (e.g. tests/test_prompt_injection_live.py,
# tests/test_reranker.py's model download is unaffected since it doesn't
# call Groq). Confirmed as the actual cause of a real
# "Invalid API Key"/401 failure while adding Phase 4's live injection test,
# not assumed. Every other test in this suite mocks LLMProvider directly
# and never reaches this code path, so leaving GROQ_API_KEY unset here (and
# letting the real .env value flow through) doesn't affect them.


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "real_mcp: exercises the real MCP server subprocess/protocol round-trip "
        "(services/mcp_client.py) instead of the fast in-process mock every other "
        "test gets automatically (see the autouse fixture below).",
    )


@pytest.fixture(autouse=True)
def _mock_mcp_tools_by_default(request, monkeypatch):
    """Phase 5 rewired services/agent_loop.py to fetch tool schemas and
    execute tool calls through a real MCP server subprocess
    (services/mcp_client.py) instead of the in-process TOOL_DISPATCH dict.
    Spawning a real subprocess on every one of this suite's ~45 tests that
    exercise the tool loop would make the suite slow and add subprocess-
    startup flakiness to tests that aren't actually about MCP. So: mock the
    MCP boundary back to the same in-process services/tools.py functions
    by default, and only tests explicitly marked @pytest.mark.real_mcp (the
    ones actually proving Phase 5's MCP integration) get the real
    subprocess/protocol round-trip."""
    if "real_mcp" in request.keywords:
        return

    from services import tools as tools_impl

    monkeypatch.setattr("services.agent_loop._get_tool_schemas", lambda: tools_impl.TOOL_SCHEMAS)

    def _fake_call_tool_sync(name: str, args: dict) -> dict:
        handler = tools_impl.TOOL_DISPATCH.get(name)
        return handler(args) if handler else {"error": f"unknown tool '{name}'"}

    monkeypatch.setattr("services.agent_loop.mcp_client.call_tool_sync", _fake_call_tool_sync)
