"""Phase 5 core Done-when: "a test case exists where the critic agent
catches and forces a revision of a deliberately bad primary-agent draft."

The fake LLM below plays both roles (distinguished by which system prompt
each call carries - SYSTEM_PROMPT for the primary reviewer,
CRITIC_SYSTEM_PROMPT for the critic - a real model would of course be one
process, but this proves the *topology*: two distinct roles/prompts, the
critic rejecting the primary's first draft, and the primary's revision
actually replacing it in the final result, not just being logged and
ignored."""

import json

from services.agent_loop import SYSTEM_PROMPT
from services.analysis_service import AnalysisService
from services.critic_agent import CRITIC_SYSTEM_PROMPT
from services.llm_provider import LLMProvider
from tests.fakes import completion_response

SUBMISSION = {
    "userId": "user-1",
    "problemId": 42,
    "status": "PASSED",
    "code": "def sum_all(nums):\n    total = 0\n    for n in nums:\n        total += n\n    return total\n",
}
PROBLEM = {"description": "Return the sum of all numbers in the list."}

BAD_DRAFT = {
    "analysisType": "PASSED",
    "timeComplexity": "O(1)",  # deliberately, obviously wrong - this is a linear scan
    "spaceComplexity": "O(1)",
    "optimizationSuggestions": "None needed, already constant time.",
    "codeSmells": "None.",
    "alternativeApproach": "None.",
}
GOOD_DRAFT = {
    "analysisType": "PASSED",
    "timeComplexity": "O(n)",
    "spaceComplexity": "O(1)",
    "optimizationSuggestions": "Could use the builtin sum() function instead of a manual loop.",
    "codeSmells": "None.",
    "alternativeApproach": "return sum(nums)",
}


class _NullRag:
    def retrieve(self, query):
        return []


def test_critic_rejects_bad_draft_and_forces_a_revision_that_replaces_it(monkeypatch):
    monkeypatch.setattr("services.analysis_service.get_rag_service", lambda: _NullRag())
    monkeypatch.setattr("services.analysis_service.record_usage", lambda **kwargs: None)

    calls = {"n": 0}

    def fake_complete_with_tools(messages, tools=None):
        calls["n"] += 1
        system_content = messages[0]["content"]

        if tools is not None:
            # resolve_tool_calls' poll - this draft needs no tools.
            return completion_response(content="", tool_calls=None)

        if system_content == CRITIC_SYSTEM_PROMPT:
            # The critic is judging the LAST assistant draft in the
            # conversation it was given - reject the obviously wrong O(1)
            # claim for a function that clearly does a linear scan.
            return completion_response(content=json.dumps({
                "verdict": "REVISE",
                "feedback": "timeComplexity is claimed as O(1) but the code contains a for loop over the full input - that is O(n).",
            }))

        assert system_content == SYSTEM_PROMPT
        if calls["n"] == 2:
            # Primary agent's first draft: the deliberately bad one.
            return completion_response(content=json.dumps(BAD_DRAFT))
        # Primary agent's revision, after being fed the critic's feedback.
        assert "O(n)" in messages[-1]["content"] or "for loop" in messages[-1]["content"].lower()
        return completion_response(content=json.dumps(GOOD_DRAFT))

    monkeypatch.setattr(LLMProvider, "complete_with_tools", staticmethod(fake_complete_with_tools))

    result = AnalysisService.analyze("sub-critic", SUBMISSION, PROBLEM)

    assert result["criticVerdict"]["verdict"] == "REVISE"
    assert "O(n)" in result["criticVerdict"]["feedback"]
    assert result["revised"] is True
    # The final result must be the REVISED draft, not the rejected one.
    assert result["parsedAnalysis"]["timeComplexity"] == "O(n)"
    assert result["parsedAnalysis"] != BAD_DRAFT


def test_critic_approval_does_not_trigger_a_revision(monkeypatch):
    monkeypatch.setattr("services.analysis_service.get_rag_service", lambda: _NullRag())
    monkeypatch.setattr("services.analysis_service.record_usage", lambda **kwargs: None)

    def fake_complete_with_tools(messages, tools=None):
        system_content = messages[0]["content"]
        if tools is not None:
            return completion_response(content="", tool_calls=None)
        if system_content == CRITIC_SYSTEM_PROMPT:
            return completion_response(content=json.dumps({"verdict": "APPROVE", "feedback": ""}))
        return completion_response(content=json.dumps(GOOD_DRAFT))

    monkeypatch.setattr(LLMProvider, "complete_with_tools", staticmethod(fake_complete_with_tools))

    result = AnalysisService.analyze("sub-approve", SUBMISSION, PROBLEM)

    assert result["criticVerdict"]["verdict"] == "APPROVE"
    assert result["revised"] is False
    assert result["parsedAnalysis"]["timeComplexity"] == "O(n)"
