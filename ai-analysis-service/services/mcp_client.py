"""Real MCP client for the agent loop - spawns mcp_server/server.py as a
subprocess and talks JSON-RPC over stdio (the official `mcp` SDK's
`stdio_client`/`ClientSession`), rather than calling `services/tools.py`'s
functions in-process as `TOOL_DISPATCH` did through Phase 1-4.

`services/agent_loop.py` is synchronous (it's called from both a sync
Kafka-consumer path and inside a sync generator driving an async FastAPI
SSE endpoint - see analysis_service.py's docstrings), while the `mcp`
SDK's client API is fully async. Rather than rewrite the whole call chain
to async for this one change, `call_tool_sync`/`list_tools_sync` bridge
with `asyncio.run()` per call. This spawns a fresh MCP server subprocess
and session per call - correct and simple, but not efficient (no
connection reuse across calls). A pooled/persistent session per analysis
would be the natural follow-up if this were going into real production
traffic rather than being the Phase 5 deliverable; flagged here rather
than silently left unmentioned.
"""

import asyncio
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

_SERVER_MODULE = "mcp_server.server"
_SERVICE_ROOT = str(Path(__file__).resolve().parent.parent)


def _server_params() -> StdioServerParameters:
    return StdioServerParameters(
        command=sys.executable,
        args=["-m", _SERVER_MODULE],
        cwd=_SERVICE_ROOT,
    )


async def _list_tools_async() -> list[dict]:
    async with stdio_client(_server_params()) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.list_tools()
            return [
                {
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description or "",
                        "parameters": t.input_schema,
                    },
                }
                for t in result.tools
            ]


async def _call_tool_async(name: str, arguments: dict) -> dict:
    async with stdio_client(_server_params()) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(name, arguments)
            for content in result.content:
                if getattr(content, "type", None) == "text":
                    import json
                    return json.loads(content.text)
            return {"error": "MCP tool call returned no text content"}


def list_tools_sync() -> list[dict]:
    """Returns the same OpenAI-function-calling-schema shape
    services/tools.py's TOOL_SCHEMAS uses, but discovered live from the real
    MCP server's list_tools response - not hardcoded, so it's provably
    coming from the protocol, not a copy sitting next to it."""
    return asyncio.run(_list_tools_async())


def call_tool_sync(name: str, arguments: dict) -> dict:
    return asyncio.run(_call_tool_async(name, arguments))
