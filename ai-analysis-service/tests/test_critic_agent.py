import json

from services.critic_agent import critique
from services.llm_provider import LLMProvider
from tests.fakes import completion_response


def test_critique_parses_approve_verdict(monkeypatch):
    monkeypatch.setattr(
        LLMProvider, "complete_with_tools",
        staticmethod(lambda messages, tools=None: completion_response(
            content=json.dumps({"verdict": "APPROVE", "feedback": ""})
        )),
    )
    verdict = critique("Add two numbers.", "def add(a,b): return a+b", {"analysisType": "PASSED"})
    assert verdict.verdict == "APPROVE"
    assert verdict.needs_revision is False


def test_critique_parses_revise_verdict(monkeypatch):
    monkeypatch.setattr(
        LLMProvider, "complete_with_tools",
        staticmethod(lambda messages, tools=None: completion_response(
            content=json.dumps({"verdict": "REVISE", "feedback": "Complexity claim is wrong."})
        )),
    )
    verdict = critique("Add two numbers.", "def add(a,b): return a+b", {"analysisType": "PASSED"})
    assert verdict.needs_revision is True
    assert verdict.feedback == "Complexity claim is wrong."


def test_critique_fails_open_on_unparseable_output(monkeypatch):
    monkeypatch.setattr(
        LLMProvider, "complete_with_tools",
        staticmethod(lambda messages, tools=None: completion_response(content="not json at all")),
    )
    verdict = critique("Add two numbers.", "def add(a,b): return a+b", {"analysisType": "PASSED"})
    assert verdict.verdict == "APPROVE"


def test_critique_receives_the_draft_it_is_judging(monkeypatch):
    captured = {}

    def fake(messages, tools=None):
        captured["messages"] = messages
        return completion_response(content=json.dumps({"verdict": "APPROVE", "feedback": ""}))

    monkeypatch.setattr(LLMProvider, "complete_with_tools", staticmethod(fake))

    draft = {"analysisType": "PASSED", "timeComplexity": "O(n^2)"}
    critique("Add two numbers.", "def add(a,b): return a+b", draft)

    user_message = captured["messages"][1]["content"]
    assert "O(n^2)" in user_message
    assert "def add(a,b): return a+b" in user_message
