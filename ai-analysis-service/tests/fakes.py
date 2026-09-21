"""Minimal fakes shaped like litellm's response objects (attribute access,
not dict indexing) - just enough surface for services/agent_loop.py and
services/analysis_service.py to work against in tests, without a real Groq
call."""

from types import SimpleNamespace


def fake_usage(prompt_tokens=10, completion_tokens=5):
    return SimpleNamespace(prompt_tokens=prompt_tokens, completion_tokens=completion_tokens)


def tool_call(call_id: str, name: str, arguments: dict):
    import json
    return SimpleNamespace(
        id=call_id,
        function=SimpleNamespace(name=name, arguments=json.dumps(arguments)),
    )


def completion_response(content: str | None = None, tool_calls=None, model="groq/openai/gpt-oss-20b"):
    message = SimpleNamespace(content=content, tool_calls=tool_calls)
    return SimpleNamespace(
        choices=[SimpleNamespace(message=message)],
        usage=fake_usage(),
        model=model,
    )


def stream_chunks(text: str, model="groq/openai/gpt-oss-20b", chunk_size=8):
    """Yields fake streaming chunks whose concatenated .choices[0].delta.content
    reproduces `text`, plus a terminal usage-only chunk - mirrors litellm's
    stream=True, stream_options={'include_usage': True} shape closely enough
    for services/analysis_service.py's analyze_stream to consume."""
    for i in range(0, len(text), chunk_size):
        piece = text[i:i + chunk_size]
        yield SimpleNamespace(
            choices=[SimpleNamespace(delta=SimpleNamespace(content=piece))],
            usage=None,
            model=model,
        )
    yield SimpleNamespace(
        choices=[SimpleNamespace(delta=SimpleNamespace(content=None))],
        usage=fake_usage(),
        model=model,
    )
