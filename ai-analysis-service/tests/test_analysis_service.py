"""Proves Phase 1 Done-when (a): a submission triggers a review that
actually invokes at least one tool mid-conversation, and the tool's real
result changes the final output. The fake LLM below only knows how to
answer with the actual bandit finding it can see in the conversation's tool
message - if the tool never ran, or its result never made it back into the
prompt, the assertions on the final parsedAnalysis content would fail."""

import json

from services.analysis_service import AnalysisService
from services.llm_provider import LLMProvider
from tests.fakes import completion_response, tool_call

VULNERABLE_CODE = "def run(user_input):\n    return eval(user_input)\n"
SUBMISSION = {
    "userId": "user-1",
    "problemId": 42,
    "status": "PASSED",
    "code": VULNERABLE_CODE,
}
PROBLEM = {"description": "Evaluate a user-supplied expression and return the result."}


def _tool_result_from_messages(messages) -> dict:
    for m in reversed(messages):
        if m.get("role") == "tool":
            return json.loads(m["content"])
    return {}


def test_tool_call_result_changes_final_analysis(monkeypatch):
    monkeypatch.setattr("services.analysis_service.get_rag_service", lambda: _NullRag())
    monkeypatch.setattr("services.analysis_service.record_usage", lambda **kwargs: None)

    calls = {"n": 0}

    def fake_complete_with_tools(messages, tools=None):
        calls["n"] += 1
        if calls["n"] == 1:
            # Model decides to run a security scan before answering.
            return completion_response(
                tool_calls=[tool_call("call-1", "run_security_scan", {
                    "language": "python", "code": VULNERABLE_CODE,
                })]
            )
        if calls["n"] == 2 and tools is not None:
            # Tool-resolution loop's second poll: model is satisfied, no more tools.
            return completion_response(content="", tool_calls=None)
        # Finalize call (tools=None): answer using the real tool result that
        # is now sitting in the message history.
        finding = _tool_result_from_messages(messages)["findings"][0]
        payload = {
            "analysisType": "PASSED",
            "timeComplexity": "O(1)",
            "spaceComplexity": "O(1)",
            "optimizationSuggestions": "None needed.",
            "codeSmells": f"Security scanner flagged {finding['testId']}: {finding['issue']}",
            "alternativeApproach": "Use ast.literal_eval instead of eval.",
        }
        return completion_response(content=json.dumps(payload))

    monkeypatch.setattr(LLMProvider, "complete_with_tools", staticmethod(fake_complete_with_tools))

    result = AnalysisService.analyze("sub-1", SUBMISSION, PROBLEM)

    assert len(result["toolCalls"]) == 1
    assert result["toolCalls"][0]["tool"] == "run_security_scan"
    # The defect the tool actually found (bandit B307 = use of eval) must be
    # present in the final structured output, proving the tool's result -
    # not a hallucination - drove this part of the answer.
    assert "B307" in result["parsedAnalysis"]["codeSmells"]


def test_no_tool_call_still_produces_valid_analysis(monkeypatch):
    """Baseline: when the model doesn't need a tool, the loop must not force
    one - the final answer comes straight from the first call."""
    monkeypatch.setattr("services.analysis_service.get_rag_service", lambda: _NullRag())
    monkeypatch.setattr("services.analysis_service.record_usage", lambda **kwargs: None)

    def fake_complete_with_tools(messages, tools=None):
        payload = {
            "analysisType": "PASSED",
            "timeComplexity": "O(n)",
            "spaceComplexity": "O(1)",
            "optimizationSuggestions": "None.",
            "codeSmells": "None.",
            "alternativeApproach": "None.",
        }
        return completion_response(content=json.dumps(payload), tool_calls=None)

    monkeypatch.setattr(LLMProvider, "complete_with_tools", staticmethod(fake_complete_with_tools))

    result = AnalysisService.analyze("sub-2", SUBMISSION, PROBLEM)

    assert result["toolCalls"] == []
    assert result["parsedAnalysis"]["analysisType"] == "PASSED"


class _NullRag:
    def retrieve(self, query):
        return []
