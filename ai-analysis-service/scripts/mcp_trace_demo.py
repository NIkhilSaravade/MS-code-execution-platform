"""Phase 5 Done-when evidence: "show the protocol messages in the build log
or a test." Speaks raw JSON-RPC 2.0 over the MCP server's stdio pipes by
hand (not through the `mcp` SDK client - services/mcp_client.py uses the
real SDK for actual production calls; this script exists ONLY to print the
literal bytes on the wire, which the SDK doesn't expose a hook for
printing directly) so the build log can show genuine protocol traffic
rather than a claim that MCP is involved.

Run: venv/Scripts/python.exe -m scripts.mcp_trace_demo
"""

import json
import subprocess  # nosec B404 - fixed argv, no shell, spawns our own MCP server module (see call site)
import sys


def _send(proc: subprocess.Popen, message: dict) -> None:
    line = json.dumps(message) + "\n"
    print(f">>> {line.strip()}")
    proc.stdin.write(line.encode("utf-8"))
    proc.stdin.flush()


def _recv(proc: subprocess.Popen) -> dict:
    line = proc.stdout.readline().decode("utf-8")
    print(f"<<< {line.strip()}")
    return json.loads(line)


def main():
    proc = subprocess.Popen(  # nosec B603 - fixed argv, no shell, spawns our own MCP server module
        [sys.executable, "-m", "mcp_server.server"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    try:
        _send(proc, {
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "mcp-trace-demo", "version": "1.0.0"},
            },
        })
        _recv(proc)
        _send(proc, {"jsonrpc": "2.0", "method": "notifications/initialized"})

        _send(proc, {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
        _recv(proc)

        _send(proc, {
            "jsonrpc": "2.0", "id": 3, "method": "tools/call",
            "params": {
                "name": "run_linter",
                "arguments": {"language": "python", "code": "import os\ndef f():\n    return 1\n"},
            },
        })
        _recv(proc)
    finally:
        proc.terminate()
        proc.wait(timeout=5)


if __name__ == "__main__":
    main()
