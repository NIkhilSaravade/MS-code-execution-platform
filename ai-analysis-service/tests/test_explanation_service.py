"""Covers services/explanation_service.py: the two modes ("submission" -
real passed code walked through; "generic" - no code, gave-up case) and
content-addressed caching. Real in-memory SQLite round-trip for the cache
(same pattern as tests/test_analysis_pipeline_metadata.py); LLMProvider and
hybrid_retrieve mocked at their call sites so no live Groq/Postgres is
needed."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from db.models import Base, ExplanationCache
from services import explanation_service
from services.chunking import Chunk
from services.exceptions import ExplanationGenerationFailed
from services.llm_provider import LLMProvider
from tests.fakes import completion_response

PROBLEM_DESC = "Given an array, find two numbers that add up to a target."


@pytest.fixture
def sqlite_session(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(bind=engine)
    monkeypatch.setattr(explanation_service, "SessionLocal", session_factory)
    return session_factory


@pytest.fixture(autouse=True)
def _no_real_rag(monkeypatch):
    monkeypatch.setattr(
        explanation_service, "hybrid_retrieve",
        lambda query, top_k=3: [Chunk(text="stub context", source="test", kind="prose")],
    )


def _mock_llm(monkeypatch, content: str):
    calls = {"n": 0}

    def fake(messages, tools=None):
        calls["n"] += 1
        return completion_response(content=content)

    monkeypatch.setattr(LLMProvider, "complete_with_tools", staticmethod(fake))
    return calls


def test_explain_with_submission_code_uses_submission_mode(sqlite_session, monkeypatch):
    calls = _mock_llm(monkeypatch, "## The Core Idea\nUse a hash map.")

    result = explanation_service.explain(1, PROBLEM_DESC, "def two_sum(nums, target): pass")

    assert result["mode"] == "submission"
    assert result["source"] == "AI"
    assert "Core Idea" in result["explanation"]
    assert calls["n"] == 1


def test_explain_without_code_uses_generic_mode(sqlite_session, monkeypatch):
    _mock_llm(monkeypatch, "## The Core Idea\nA generic walkthrough.")

    result = explanation_service.explain(2, PROBLEM_DESC, None)

    assert result["mode"] == "generic"
    assert result["source"] == "AI"


def test_explain_is_cached_by_problem_mode_and_code(sqlite_session, monkeypatch):
    calls = _mock_llm(monkeypatch, "explanation text")

    first = explanation_service.explain(3, PROBLEM_DESC, "def f(): pass")
    assert first["source"] == "AI"
    assert calls["n"] == 1

    second = explanation_service.explain(3, PROBLEM_DESC, "def f(): pass")
    assert second["source"] == "CACHE"
    assert second["explanation"] == first["explanation"]
    assert calls["n"] == 1  # no second LLM call


def test_explain_generic_and_submission_modes_are_cached_separately(sqlite_session, monkeypatch):
    calls = _mock_llm(monkeypatch, "text")

    explanation_service.explain(4, PROBLEM_DESC, "def f(): pass")
    explanation_service.explain(4, PROBLEM_DESC, None)

    assert calls["n"] == 2  # distinct cache keys, both hit the LLM

    db = sqlite_session()
    rows = db.query(ExplanationCache).filter(ExplanationCache.problem_id == 4).all()
    assert {r.mode for r in rows} == {"submission", "generic"}
    db.close()


def test_explain_redacts_secrets_before_caching(sqlite_session, monkeypatch):
    """Two different AWS keys redact to the same placeholder, so they must
    hash to the same cache key - proving the cache key (and whatever gets
    sent to the LLM) is derived from the redacted text, not the raw secret."""
    calls = _mock_llm(monkeypatch, "text")

    explanation_service.explain(5, PROBLEM_DESC, "API_KEY = 'AKIAABCDEFGHIJKLMNOP'\ndef f(): pass")
    second = explanation_service.explain(5, PROBLEM_DESC, "API_KEY = 'AKIAZZZZZZZZZZZZZZZZ'\ndef f(): pass")

    assert second["source"] == "CACHE"
    assert calls["n"] == 1


def test_explain_raises_and_does_not_cache_an_empty_response(sqlite_session, monkeypatch):
    """A blank LLM completion must not be silently cached (and re-served
    forever) as if it were a real explanation - it should raise instead,
    same 'don't cache a bad result' rule the review pipeline's
    AnalysisOutputInvalid already enforces."""
    _mock_llm(monkeypatch, "   ")  # whitespace-only - strips to empty

    with pytest.raises(ExplanationGenerationFailed):
        explanation_service.explain(6, PROBLEM_DESC, "def f(): pass")

    db = sqlite_session()
    assert db.query(ExplanationCache).filter(ExplanationCache.problem_id == 6).first() is None
    db.close()


def test_explain_retries_after_an_empty_response_is_not_cached(sqlite_session, monkeypatch):
    """A later, real call for the same (problem, mode, code) after an
    earlier empty one must actually hit the LLM again, not find a bogus
    cached-empty row."""
    _mock_llm(monkeypatch, "")
    with pytest.raises(ExplanationGenerationFailed):
        explanation_service.explain(7, PROBLEM_DESC, "def f(): pass")

    calls = _mock_llm(monkeypatch, "a real explanation this time")
    result = explanation_service.explain(7, PROBLEM_DESC, "def f(): pass")

    assert result["source"] == "AI"
    assert result["explanation"] == "a real explanation this time"
    assert calls["n"] == 1


def test_explain_handles_empty_rag_context_without_crashing(sqlite_session, monkeypatch):
    """hybrid_retrieve returning no chunks at all (e.g. an empty/cold
    corpus) must still produce a normal explanation, not error out while
    formatting the prompt."""
    monkeypatch.setattr(explanation_service, "hybrid_retrieve", lambda query, top_k=3: [])
    _mock_llm(monkeypatch, "an explanation with no grounding context")

    result = explanation_service.explain(8, PROBLEM_DESC, "def f(): pass")

    assert result["source"] == "AI"
    assert result["explanation"] == "an explanation with no grounding context"
