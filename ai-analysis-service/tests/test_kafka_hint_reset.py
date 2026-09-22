"""Integration coverage for kafka/consumer.py's automatic hint-session
reset: a fresh PASSED submission for a (user, problem) that already has an
advanced HintSession must reset it to level 1's starting point, not leave
it wherever a past solve session left off (docs/ai-code-review-known-
limitations.md item 8).

Exercises the real services.hint_service functions against a real
in-memory SQLite DB (same pattern as tests/test_hint_service.py), but
drives them through kafka.consumer._process_event / _maybe_reset_hint_session
- the actual code path a real analysis.trigger.v1 message goes through -
rather than calling hint_service directly, so this is genuinely testing
the Kafka-triggered wiring, not just the underlying reset function Phase A
already covers on its own.
"""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import kafka.consumer as consumer_module
import services.hint_service as hint_service
from db.models import Base
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
    monkeypatch.setattr(
        hint_service, "hybrid_retrieve",
        lambda query, top_k=3: [Chunk(text="stub context", source="test", kind="prose")],
    )
    monkeypatch.setattr(hint_service, "_resolve_metadata_tool_call", lambda messages: None)


def _mock_llm(monkeypatch, responses: list[str]):
    calls = {"n": 0}

    def fake(messages, tools=None):
        idx = min(calls["n"], len(responses) - 1)
        calls["n"] += 1
        return completion_response(content=responses[idx])

    monkeypatch.setattr(LLMProvider, "complete_with_tools", staticmethod(fake))


PROBLEM_DESC = "Given an array, find two numbers that add up to a target."


@pytest.mark.asyncio
async def test_process_event_resets_hint_session_on_passed_submission(sqlite_session, monkeypatch):
    # Advance this (user, problem)'s hint session to level 2 first, exactly
    # as if they'd been stuck on an earlier attempt.
    _mock_llm(monkeypatch, ["hint one", "hint two"])
    hint_service.request_hint("user-1", 42, PROBLEM_DESC, "", "")
    hint_service.request_hint("user-1", 42, PROBLEM_DESC, "", "")
    assert hint_service.get_session_state("user-1", 42)["currentLevel"] == 2

    passed_submission = {"userId": "user-1", "problemId": 42, "status": "PASSED", "code": "def f(): return 1"}
    problem = {"description": PROBLEM_DESC}

    async def fake_fetch(submission_id):
        return passed_submission, problem

    monkeypatch.setattr(consumer_module, "_fetch_submission_and_problem", fake_fetch)
    monkeypatch.setattr(consumer_module.analysis_pipeline, "get_cached", lambda submission_id: {"analysis": {}, "source": "CACHE"})

    await consumer_module._process_event(999)

    # The already-advanced session must now be back at 0 - the user's next
    # hint request comes back at level 1, not a continuation of level 2.
    state = hint_service.get_session_state("user-1", 42)
    assert state["currentLevel"] == 0
    assert state["attemptNumber"] == 2

    _mock_llm(monkeypatch, ["fresh level-1 hint"])
    result = hint_service.request_hint("user-1", 42, PROBLEM_DESC, "", "")
    assert result["level"] == 1


@pytest.mark.asyncio
async def test_process_event_does_not_reset_on_a_failed_submission(sqlite_session, monkeypatch):
    _mock_llm(monkeypatch, ["hint one"])
    hint_service.request_hint("user-2", 43, PROBLEM_DESC, "", "")
    assert hint_service.get_session_state("user-2", 43)["currentLevel"] == 1

    failed_submission = {"userId": "user-2", "problemId": 43, "status": "FAILED", "code": "def f(): pass"}
    problem = {"description": PROBLEM_DESC}

    async def fake_fetch(submission_id):
        return failed_submission, problem

    monkeypatch.setattr(consumer_module, "_fetch_submission_and_problem", fake_fetch)
    monkeypatch.setattr(consumer_module.analysis_pipeline, "get_cached", lambda submission_id: {"analysis": {}, "source": "CACHE"})

    await consumer_module._process_event(1000)

    # A FAILED submission is not a "new attempt" trigger - the session
    # must be left exactly where it was.
    state = hint_service.get_session_state("user-2", 43)
    assert state["currentLevel"] == 1
    assert state["attemptNumber"] == 1


@pytest.mark.asyncio
async def test_hint_session_reset_failure_does_not_break_analysis_processing(sqlite_session, monkeypatch):
    """_maybe_reset_hint_session is best-effort - a bug in it must never
    prevent the actual analysis pipeline (the primary thing this consumer
    exists for) from completing."""
    passed_submission = {"userId": "user-3", "problemId": 44, "status": "PASSED", "code": "def f(): return 1"}
    problem = {"description": PROBLEM_DESC}

    async def fake_fetch(submission_id):
        return passed_submission, problem

    def broken_reset(user_id, problem_id):
        raise RuntimeError("boom")

    monkeypatch.setattr(consumer_module, "_fetch_submission_and_problem", fake_fetch)
    monkeypatch.setattr(consumer_module.analysis_pipeline, "get_cached", lambda submission_id: {"analysis": {}, "source": "CACHE"})
    monkeypatch.setattr(hint_service, "reset_session_for_new_attempt", broken_reset)

    await consumer_module._process_event(1001)  # must not raise
