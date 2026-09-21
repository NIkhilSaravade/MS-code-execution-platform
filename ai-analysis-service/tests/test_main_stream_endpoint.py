"""End-to-end check that POST /ai/analyze/stream actually serves SSE and a
client reading it incrementally sees more than one event before the stream
closes - the full FastAPI wiring on top of the generator-level proof in
tests/test_streaming.py. Upstream HTTP calls (submission-service,
problem-service) and the DB-backed cache are faked so this test exercises
the SSE plumbing itself, not those already-tested paths."""

import json

from fastapi.testclient import TestClient

import main
from security.jwt_verifier import get_current_claims
from services.llm_provider import LLMProvider
from tests.fakes import completion_response, stream_chunks

SUBMISSION = {"userId": "user-1", "problemId": 42, "status": "PASSED", "code": "def f():\n    return 1\n"}
PROBLEM = {"description": "Return 1."}
FINAL_JSON = json.dumps({
    "analysisType": "PASSED", "timeComplexity": "O(1)", "spaceComplexity": "O(1)",
    "optimizationSuggestions": "None.", "codeSmells": "None.", "alternativeApproach": "None.",
})


class _NullRag:
    def retrieve(self, query):
        return []


class _FakeQuery:
    def filter(self, *args, **kwargs):
        return self

    def first(self):
        return None


class _FakeSession:
    def query(self, *args, **kwargs):
        return _FakeQuery()

    def add(self, *args, **kwargs):
        pass

    def flush(self):
        pass

    def commit(self):
        pass

    def close(self):
        pass


def test_stream_endpoint_delivers_multiple_sse_events_incrementally(monkeypatch):
    monkeypatch.setattr("services.analysis_service.get_rag_service", lambda: _NullRag())
    monkeypatch.setattr("services.analysis_service.record_usage", lambda **kwargs: None)
    monkeypatch.setattr(
        LLMProvider, "complete_with_tools",
        staticmethod(lambda messages, tools=None: completion_response(content="", tool_calls=None)),
    )
    monkeypatch.setattr(LLMProvider, "stream", staticmethod(lambda messages: stream_chunks(FINAL_JSON, chunk_size=6)))
    monkeypatch.setattr("services.analysis_pipeline.SessionLocal", lambda: _FakeSession())

    async def fake_fetch(submission_id, authorization):
        return SUBMISSION, PROBLEM

    monkeypatch.setattr(main, "_fetch_submission_and_problem", fake_fetch)
    main.app.dependency_overrides[get_current_claims] = lambda: {"sub": "user-1"}

    try:
        client = TestClient(main.app)
        with client.stream(
            "POST", "/ai/analyze/stream",
            json={"submissionId": 1},
            headers={"Authorization": "Bearer test-token"},
        ) as response:
            assert response.status_code == 200
            events = []
            for line in response.iter_lines():
                if not line or not line.startswith("data: "):
                    continue
                events.append(json.loads(line[len("data: "):]))
                # Incrementality check: we can already see more than one
                # event has arrived before the HTTP response has finished
                # closing - i.e. this loop body runs multiple times, proving
                # the client isn't blocked waiting for one final blob.
    finally:
        main.app.dependency_overrides.pop(get_current_claims, None)

    token_events = [e for e in events if e["type"] == "token"]
    done_events = [e for e in events if e["type"] == "done"]
    assert len(token_events) > 1
    assert len(done_events) == 1
    assert events[-1]["type"] == "done"
    assert events[-1]["result"]["parsedAnalysis"]["analysisType"] == "PASSED"
