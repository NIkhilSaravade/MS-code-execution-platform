# ai-analysis-service Agentic Upgrade — Build Log

Branch: `claude/practical-darwin-8xlb0w`. This log is a real record, not a status report — every
entry includes actual file paths/function names, real problems hit and how they were fixed, and
the literal Done-when check output for that step. No aspirational language ("should work") is
used; if something wasn't verified, that's stated explicitly.

---

## Pre-work — audit confirmation (2026-09-21)

Read the existing `ai-analysis-service` source before writing anything. Confirmed against the task
prompt's "known gaps" list by direct inspection:

- `services/analysis_service.py::AnalysisService.analyze` — one blocking `litellm.completion()`
  call, no tools, no streaming. Confirmed.
- `services/llm_provider.py::LLMProvider.complete` — single prompt string, no `tools=` param.
  Confirmed.
- `services/rag_service.py::RAGService` — real PGVector store, but `seed_knowledge.py` seeds only
  5 hardcoded one-liners. Confirmed — real retrieval mechanism, fake corpus (Phase 2 problem, not
  Phase 1).
- No `tests/` directory anywhere in the service. No pytest config. `ruff`, `bandit`, `pytest`,
  `pytest-asyncio` are not installed (`pip show` returned "Package(s) not found" for all four).
  This means Phase 1's "every existing test must stay green" starts from a baseline of zero tests
  — there is nothing to regress, but also no existing test harness/conftest pattern to follow, so
  one is being created from scratch in this phase.
- `services/rag_service.py` instantiates `RAGService()` — and `services/analysis_service.py`
  instantiates it again at **module import time** (`rag_service = RAGService()` at module scope).
  `RAGService.__init__` eagerly connects to Postgres/pgvector and loads
  `HuggingFaceEmbeddings("all-MiniLM-L6-v2")`. This makes the module untestable without a live
  Postgres + a real embedding-model download, which is a blocker for any test that imports
  `services.analysis_service`. Fixed as part of Phase 1 (see below): switched to lazy
  initialization behind a getter so importing the module doesn't require live infra.
- `db/database.py` raises at import time if `DATABASE_URL` is unset, but does not eagerly connect
  (SQLAlchemy `create_engine` is lazy) — a dummy `DATABASE_URL` env var in test setup is enough,
  no real Postgres needed for the tests added in this phase.

---
