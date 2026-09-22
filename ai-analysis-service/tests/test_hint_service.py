"""Covers services/hint_service.py's escalation state machine and guardrail
enforcement - the two things the Phase A "Done-when" check cares about:
each level actually escalates without skipping ahead, and the level-4
solution reveal is a structurally separate path, never a side effect of
repeated hint calls.

Uses a real (in-memory SQLite) DB round-trip for session/event persistence
(same pattern as tests/test_analysis_pipeline_metadata.py), and mocks
LLMProvider/mcp_client/hybrid_retrieve at their call sites so no live Groq,
MCP subprocess, or Postgres/pgvector connection is needed.
"""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from db.models import Base, HintEvent, HintSession
from services import hint_service
from services.chunking import Chunk
from services.llm_provider import LLMProvider
from tests.fakes import completion_response


@pytest.fixture
def sqlite_session(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(bind=engine)
    monkeypatch.setattr(hint_service, "SessionLocal", session_factory)
    return session_factory


@pytest.fixture(autouse=True)
def _no_real_rag(monkeypatch):
    """hybrid_retrieve's default vector_search_fn reaches real Postgres/
    pgvector - stub the grounding context so these tests never need live
    infra, same rationale as conftest.py's MCP-mocking fixture."""
    monkeypatch.setattr(
        hint_service, "hybrid_retrieve",
        lambda query, top_k=3: [Chunk(text="stub context", source="test", kind="prose")],
    )


@pytest.fixture(autouse=True)
def _no_metadata_tool_call(monkeypatch):
    """Default: the model doesn't ask for get_problem_metadata. Individual
    tests override this to exercise the tool-call path."""
    monkeypatch.setattr(
        hint_service, "_resolve_metadata_tool_call", lambda messages: None
    )


PROBLEM_DESC = "Given an array, find the maximum sum of a contiguous subarray."


def _mock_llm(monkeypatch, responses: list[str]):
    """Returns successive .content values from complete_with_tools, in order."""
    calls = {"n": 0}

    def fake(messages, tools=None):
        idx = min(calls["n"], len(responses) - 1)
        calls["n"] += 1
        return completion_response(content=responses[idx])

    monkeypatch.setattr(LLMProvider, "complete_with_tools", staticmethod(fake))
    return calls


def test_request_hint_escalates_one_level_per_call(sqlite_session, monkeypatch):
    _mock_llm(monkeypatch, [
        "Think about what running total means here.",
        "This is a dynamic-programming (Kadane's algorithm) problem.",
        "Step 1: track the best sum ending at the current index. Step 2: update a running maximum.",
        "Nothing new - you're already at the top level.",
    ])

    first = hint_service.request_hint("user-1", 7, PROBLEM_DESC, "def f(): pass", "not sure where to start")
    assert first["level"] == 1

    second = hint_service.request_hint("user-1", 7, PROBLEM_DESC, "def f(): pass", "")
    assert second["level"] == 2

    third = hint_service.request_hint("user-1", 7, PROBLEM_DESC, "def f(): pass", "")
    assert third["level"] == 3

    # Level is capped at 3 - repeated calls never auto-advance to the
    # solution (level 4 is a structurally separate function/endpoint).
    fourth = hint_service.request_hint("user-1", 7, PROBLEM_DESC, "def f(): pass", "")
    assert fourth["level"] == 3


def test_request_hint_cannot_skip_ahead_even_if_caller_tries(sqlite_session, monkeypatch):
    """request_hint() takes no caller-supplied level - it always reads the
    next level from stored session state, so there's no request shape that
    lets a caller jump straight to level 3."""
    _mock_llm(monkeypatch, ["a level-1 nudge"])
    result = hint_service.request_hint("user-2", 9, PROBLEM_DESC, "code", "")
    assert result["level"] == 1


def test_request_hint_is_scoped_per_user_and_per_problem(sqlite_session, monkeypatch):
    _mock_llm(monkeypatch, ["hint text"] * 4)

    hint_service.request_hint("user-a", 1, PROBLEM_DESC, "", "")
    result_other_user = hint_service.request_hint("user-b", 1, PROBLEM_DESC, "", "")
    result_other_problem = hint_service.request_hint("user-a", 2, PROBLEM_DESC, "", "")

    assert result_other_user["level"] == 1
    assert result_other_problem["level"] == 1


def test_guardrail_flags_and_regenerates_a_code_leaking_hint(sqlite_session, monkeypatch):
    """First draft leaks code (a fenced block) - the guardrail must detect
    it, force one stricter regeneration, and flag the event, rather than
    silently returning the leaking draft."""
    _mock_llm(monkeypatch, [
        "```python\ndef f(a, b): return a + b\n```",
        "Just think about combining the two inputs.",
    ])

    result = hint_service.request_hint("user-3", 5, PROBLEM_DESC, "", "")

    assert result["guardrailFlagged"] is True
    assert "```" not in result["hint"]

    db = sqlite_session()
    event = db.query(HintEvent).filter(HintEvent.user_id == "user-3").first()
    assert event.guardrail_flagged is True
    db.close()


def test_guardrail_strips_fences_if_regeneration_still_leaks(sqlite_session, monkeypatch):
    _mock_llm(monkeypatch, [
        "```python\nreturn a + b\n```",
        "```python\nstill code\n```",
    ])

    result = hint_service.request_hint("user-4", 5, PROBLEM_DESC, "", "")

    assert result["guardrailFlagged"] is True
    assert "```" not in result["hint"]
    assert "not available at this hint level" in result["hint"]


def test_request_hint_persists_events_and_session(sqlite_session, monkeypatch):
    _mock_llm(monkeypatch, ["a nudge"])

    hint_service.request_hint("user-5", 3, PROBLEM_DESC, "", "stuck on edge cases")

    db = sqlite_session()
    session = db.query(HintSession).filter(
        HintSession.user_id == "user-5", HintSession.problem_id == 3
    ).first()
    assert session.current_level == 1

    events = db.query(HintEvent).filter(HintEvent.user_id == "user-5").all()
    assert len(events) == 1
    assert events[0].is_solution_reveal is False
    assert events[0].stuck_description == "stuck on edge cases"
    db.close()


def test_reveal_solution_is_logged_distinctly_and_does_not_touch_escalation_endpoint(sqlite_session, monkeypatch):
    _mock_llm(monkeypatch, ["Full approach: Kadane's algorithm... ```python\ndef f(): pass\n```"])

    result = hint_service.reveal_solution("user-6", 4, PROBLEM_DESC, "", "just show me")

    assert result["level"] == 4
    assert "Kadane" in result["solution"]

    db = sqlite_session()
    events = db.query(HintEvent).filter(HintEvent.user_id == "user-6").all()
    assert len(events) == 1
    assert events[0].is_solution_reveal is True
    assert events[0].level == 4

    session = db.query(HintSession).filter(
        HintSession.user_id == "user-6", HintSession.problem_id == 4
    ).first()
    assert session.current_level == 3  # pinned at the escalating track's ceiling, not set to 4
    db.close()


def test_get_session_state_reflects_history(sqlite_session, monkeypatch):
    _mock_llm(monkeypatch, ["hint one", "hint two"])

    hint_service.request_hint("user-7", 8, PROBLEM_DESC, "", "")
    hint_service.request_hint("user-7", 8, PROBLEM_DESC, "", "")

    state = hint_service.get_session_state("user-7", 8)
    assert state["currentLevel"] == 2
    assert len(state["history"]) == 2
    assert state["history"][0]["level"] == 1
    assert state["history"][1]["level"] == 2


def test_get_session_state_for_unseen_problem_defaults_to_zero(sqlite_session):
    state = hint_service.get_session_state("user-8", 999)
    assert state["currentLevel"] == 0
    assert state["history"] == []


def test_request_hint_uses_metadata_tool_when_model_requests_it(sqlite_session, monkeypatch):
    """When the model calls get_problem_metadata, the result must be fed
    back into the conversation before the final hint is generated - proves
    the MCP tool layer is genuinely wired into the hint flow, not just
    schema-registered and unused."""
    def fake_resolve(messages):
        messages.append({"role": "assistant", "content": None, "tool_calls": [
            {"id": "call-1", "type": "function", "function": {"name": "get_problem_metadata", "arguments": "{}"}}
        ]})
        messages.append({"role": "tool", "tool_call_id": "call-1", "content": "{\"tags\": [\"dp\"]}"})
        return {"found": True, "tags": ["dp"]}

    monkeypatch.setattr(hint_service, "_resolve_metadata_tool_call", fake_resolve)
    _mock_llm(monkeypatch, ["a nudge informed by metadata"])

    result = hint_service.request_hint("user-9", 11, PROBLEM_DESC, "", "")
    assert result["usedProblemMetadata"] is True
