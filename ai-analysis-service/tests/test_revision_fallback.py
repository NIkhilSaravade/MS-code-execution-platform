"""Regression test for a real bug hit while running Phase 6's synthetic
data generation against live Groq: asked to revise after a critic REVISE
verdict, the model can echo back a verdict-shaped JSON instead of the
actual review schema. analyze() must fall back to the last schema-valid
draft rather than crash the whole analysis."""

import json

from services.analysis_service import AnalysisService
from services.llm_provider import LLMProvider
from tests.fakes import completion_response

SUBMISSION = {"userId": "user-1", "problemId": 42, "status": "PASSED", "code": "def f():\n    return 1\n"}
PROBLEM = {"description": "Return 1."}

GOOD_DRAFT = {
    "analysisType": "PASSED", "timeComplexity": "O(1)", "spaceComplexity": "O(1)",
    "optimizationSuggestions": "None.", "codeSmells": "None.", "alternativeApproach": "None.",
}


class _NullRag:
    def retrieve(self, query):
        return []


def test_falls_back_to_last_valid_draft_when_revision_output_is_malformed(monkeypatch):
    monkeypatch.setattr("services.analysis_service.get_rag_service", lambda: _NullRag())
    monkeypatch.setattr("services.analysis_service.record_usage", lambda **kwargs: None)

    from services.agent_loop import SYSTEM_PROMPT
    from services.critic_agent import CRITIC_SYSTEM_PROMPT

    def fake_complete_with_tools(messages, tools=None):
        system_content = messages[0]["content"]
        if tools is not None:
            return completion_response(content="", tool_calls=None)
        if system_content == CRITIC_SYSTEM_PROMPT:
            return completion_response(content=json.dumps({"verdict": "REVISE", "feedback": "Be more specific."}))
        assert system_content == SYSTEM_PROMPT
        if "reviewer flagged" not in messages[-1]["content"]:
            return completion_response(content=json.dumps(GOOD_DRAFT))
        # The "revision" call: model gets confused and echoes a
        # verdict-shaped JSON instead of the review schema.
        return completion_response(content=json.dumps({"verdict": "FAILED", "feedback": "oops"}))

    monkeypatch.setattr(LLMProvider, "complete_with_tools", staticmethod(fake_complete_with_tools))

    result = AnalysisService.analyze("sub-fallback", SUBMISSION, PROBLEM)

    # Must not raise, and must fall back to the last schema-valid draft.
    assert result["parsedAnalysis"] == GOOD_DRAFT
    assert result["criticVerdict"]["verdict"] == "REVISE"
