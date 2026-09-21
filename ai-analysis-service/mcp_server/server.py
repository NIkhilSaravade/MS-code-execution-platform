"""Real MCP server (stdio transport, official `mcp` SDK v2's `MCPServer`)
exposing the same four tools `services/tools.py` implements: `run_linter`,
`run_security_scan`, `fetch_similar_past_reviews`, `get_style_guide_section`.

This is a protocol wrapper, not a reimplementation - every tool call here
delegates straight to `services/tools.py`'s existing, already-tested
functions (static analysis only, never executes submitted code - see that
module's docstring). What changes in Phase 5 is *how the primary reviewer
agent reaches these tools*: through `services/mcp_client.py`'s real MCP
client/session (spawn this file as a subprocess, JSON-RPC over stdio) --
instead of the in-process `TOOL_DISPATCH` dict `services/agent_loop.py`
used through Phase 1-4.

Run standalone (only needed for manual testing - `mcp_client.py` spawns
this itself as a subprocess for the real agent loop):
    venv/Scripts/python.exe -m mcp_server.server
"""

from mcp.server.mcpserver import MCPServer

from services import tools as tools_impl

mcp_server = MCPServer(name="ai-analysis-tools", version="1.0.0")


@mcp_server.tool(description="Run a static linter over the submitted code and return style/quality issues.")
def run_linter(language: str, code: str) -> dict:
    return tools_impl.run_linter(language, code)


@mcp_server.tool(description="Run a static security-rule scan over the submitted code and return findings.")
def run_security_scan(language: str, code: str) -> dict:
    return tools_impl.run_security_scan(language, code)


@mcp_server.tool(description="Retrieve context from the knowledge base most relevant to a query about this problem/code.")
def fetch_similar_past_reviews(query: str) -> dict:
    return tools_impl.fetch_similar_past_reviews(query)


@mcp_server.tool(description="Look up a section of the project's style guide by topic (e.g. 'naming', 'complexity', 'error-handling').")
def get_style_guide_section(topic: str) -> dict:
    return tools_impl.get_style_guide_section(topic)


if __name__ == "__main__":
    mcp_server.run(transport="stdio")
