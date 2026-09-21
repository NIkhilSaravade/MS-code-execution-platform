"""Phase 4 Done-when: "a planted fake secret in a test submission is shown
to be redacted/blocked before the LLM call is made (verify via a test that
intercepts the outbound prompt)." Intercepts every message actually sent to
LLMProvider.complete_with_tools and asserts the planted secret never
appears in it."""

import json

from services.analysis_service import AnalysisService
from services.llm_provider import LLMProvider
from tests.fakes import completion_response

PLANTED_SECRET = "AKIAABCDEFGHIJKLMNOP"
SUBMISSION = {
    "userId": "user-1",
    "problemId": 42,
    "status": "PASSED",
    "code": f'aws_key = "{PLANTED_SECRET}"\ndef add(a, b):\n    return a + b\n',
}
PROBLEM = {"description": "Add two numbers."}


class _NullRag:
    def retrieve(self, query):
        return []


def test_planted_secret_never_reaches_the_llm(monkeypatch):
    monkeypatch.setattr("services.analysis_service.get_rag_service", lambda: _NullRag())
    monkeypatch.setattr("services.analysis_service.record_usage", lambda **kwargs: None)

    captured_messages = []

    def fake_complete_with_tools(messages, tools=None):
        captured_messages.append([dict(m) for m in messages])
        payload = {
            "analysisType": "PASSED", "timeComplexity": "O(1)", "spaceComplexity": "O(1)",
            "optimizationSuggestions": "None.", "codeSmells": "None.", "alternativeApproach": "None.",
        }
        return completion_response(content=json.dumps(payload), tool_calls=None)

    monkeypatch.setattr(LLMProvider, "complete_with_tools", staticmethod(fake_complete_with_tools))

    AnalysisService.analyze("sub-1", SUBMISSION, PROBLEM)

    assert captured_messages, "expected at least one outbound LLM call to be intercepted"
    for messages in captured_messages:
        for message in messages:
            content = message.get("content") or ""
            assert PLANTED_SECRET not in content, "planted secret leaked into an outbound LLM message"
    # The redaction placeholder should be present instead, proving the
    # secret was actively redacted rather than the code being dropped
    # entirely.
    assert any("[REDACTED-SECRET:aws_access_key_id]" in (m.get("content") or "") for m in captured_messages[0])
