"""Proves Phase 1 Done-when (b): streaming is verified by an integration
test that reads the stream incrementally, not just a final blob."""

import json

from services.analysis_service import AnalysisService
from services.llm_provider import LLMProvider
from tests.fakes import completion_response, stream_chunks, tool_call

SUBMISSION = {
    "userId": "user-1",
    "problemId": 42,
    "status": "PASSED",
    "code": "def add(a, b):\n    return a + b\n",
}
PROBLEM = {"description": "Add two numbers."}

FINAL_JSON = json.dumps({
    "analysisType": "PASSED",
    "timeComplexity": "O(1)",
    "spaceComplexity": "O(1)",
    "optimizationSuggestions": "None.",
    "codeSmells": "None.",
    "alternativeApproach": "None.",
})


class _NullRag:
    def retrieve(self, query):
        return []


def test_analyze_stream_yields_incremental_token_events_before_done(monkeypatch):
    monkeypatch.setattr("services.analysis_service.get_rag_service", lambda: _NullRag())
    monkeypatch.setattr("services.analysis_service.record_usage", lambda **kwargs: None)

    monkeypatch.setattr(
        LLMProvider, "complete_with_tools",
        staticmethod(lambda messages, tools=None: completion_response(content="", tool_calls=None)),
    )
    monkeypatch.setattr(
        LLMProvider, "stream",
        staticmethod(lambda messages: stream_chunks(FINAL_JSON, chunk_size=6)),
    )

    events = list(AnalysisService.analyze_stream("sub-1", SUBMISSION, PROBLEM))

    token_events = [e for e in events if e["type"] == "token"]
    done_events = [e for e in events if e["type"] == "done"]

    # Genuinely incremental: more than one token chunk arrived (not one
    # single blob), and every token event precedes the terminal done event -
    # this is what "reads the stream incrementally" actually checks, not
    # just that a final result eventually showed up.
    assert len(token_events) > 1
    assert len(done_events) == 1
    assert events.index(done_events[0]) == len(events) - 1
    for te in token_events:
        assert events.index(te) < events.index(done_events[0])

    # The concatenation of incremental chunks must reconstruct exactly the
    # same text the final parsed result was validated from - streaming
    # can't be allowed to drop or reorder bytes.
    reconstructed = "".join(e["content"] for e in token_events)
    assert reconstructed == FINAL_JSON

    result = done_events[0]["result"]
    assert result["parsedAnalysis"]["analysisType"] == "PASSED"


def test_analyze_stream_emits_tool_call_event_before_any_tokens(monkeypatch):
    monkeypatch.setattr("services.analysis_service.get_rag_service", lambda: _NullRag())
    monkeypatch.setattr("services.analysis_service.record_usage", lambda **kwargs: None)

    calls = {"n": 0}

    def fake_complete_with_tools(messages, tools=None):
        calls["n"] += 1
        if calls["n"] == 1:
            return completion_response(
                tool_calls=[tool_call("call-1", "get_style_guide_section", {"topic": "naming"})]
            )
        return completion_response(content="", tool_calls=None)

    monkeypatch.setattr(LLMProvider, "complete_with_tools", staticmethod(fake_complete_with_tools))
    monkeypatch.setattr(LLMProvider, "stream", staticmethod(lambda messages: stream_chunks(FINAL_JSON)))

    events = list(AnalysisService.analyze_stream("sub-2", SUBMISSION, PROBLEM))

    assert events[0]["type"] == "tool_call"
    assert events[0]["tool"] == "get_style_guide_section"
    first_token_index = next(i for i, e in enumerate(events) if e["type"] == "token")
    assert first_token_index > 0
