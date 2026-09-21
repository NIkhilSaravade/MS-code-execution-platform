# ai-analysis-service: Agentic Code-Review Architecture (post Phase 5)

This documents the current shape of `ai-analysis-service` after the 5-phase agentic upgrade
recorded in `docs/ai-agent-build-log.md`. It replaced a single blocking LLM call with a
tool-calling agent, real hybrid RAG, an eval harness, security guardrails, and a real MCP +
critic-agent layer. Read `ai-agent-build-log.md` for the phase-by-phase history, real test/eval
numbers, and honest scope deviations; this file is the current-state map.

## Request flow

```
Kafka (analysis.trigger.v1)  ──┐
                                ├──> analysis_pipeline.run_analysis[_stream]
POST /ai/analyze[/stream]  ────┘         │
                                          │  (cache miss)
                                          v
                              AnalysisService.analyze[_stream]
                                          │
                      ┌───────────────────┼────────────────────────┐
                      v                   v                        v
              redact_secrets()   RAGService.retrieve()      SYSTEM_PROMPT +
              (services/            (context injected         <problem_description>/
               redaction.py)         into the prompt)          <submitted_code> tags
                      │                                     (prompt-injection defense)
                      └───────────────────┬────────────────────────┘
                                          v
                              agent_loop.resolve_tool_calls()
                                          │
                                          │  bounded loop, MAX_TOOL_STEPS=4
                                          v
                              services/mcp_client.py  ───(stdio, JSON-RPC)──>  mcp_server/server.py
                              (spawns the server as a                          run_linter
                               subprocess per call)                            run_security_scan
                                          │                                    fetch_similar_past_reviews
                                          │                                    get_style_guide_section
                                          │<───────────────────────────────────────┘
                                          v                                    (each delegates to
                              agent_loop.finalize_non_stream()                  services/tools.py)
                              / finalize_stream()
                              (tools=None - forces a final answer)
                                          │
                                          v
                              Pydantic schema validation
                              (PassedAnalysis / FailedAnalysis)
                                          │
                                          v
                              services/critic_agent.py::critique()
                              (separate LLM call, own prompt/schema)
                                          │
                              ┌───────────┴───────────┐
                          APPROVE                   REVISE
                              │                         │
                              │                         v
                              │           one more finalize_non_stream() call,
                              │           fed the critic's feedback as a new
                              │           user turn - its output REPLACES the
                              │           rejected draft (capped at 1 round)
                              │                         │
                              └───────────┬─────────────┘
                                          v
                          AnalysisCache / SubmissionAnalysisMap
                          (content-addressed: sha256(problem_id + code + status))
```

Notes on what's real vs. simplified, so this diagram doesn't overclaim:
- `fetch_similar_past_reviews` itself does hybrid retrieval (BM25 + vector, RRF-fused) and
  cross-encoder reranking internally before returning to the agent - see `services/hybrid_search.py`
  / `services/reranker.py`. That's inside the single MCP tool call shown above, not a separate hop.
- The critic pass currently only runs on the non-streaming path (Kafka-triggered analysis and
  `POST /ai/analyze`'s cache-miss path) - `POST /ai/analyze/stream` does not yet call the critic
  (see the build log's Phase 5 "known scope deviations").
- `mcp_client.py` spawns a fresh MCP server subprocess per tool call rather than reusing one
  session across a whole analysis - a disclosed inefficiency, not a claim of a pooled/persistent
  MCP connection.

## Module map

| Concern | File(s) |
|---|---|
| Agent loop (tool resolution + finalize) | `services/agent_loop.py` |
| LLM calls (litellm, rate-limit retry) | `services/llm_provider.py` |
| Tool implementations (static analysis only) | `services/tools.py` |
| MCP server (protocol wrapper over the tools above) | `mcp_server/server.py` |
| MCP client (spawns the server, speaks the protocol) | `services/mcp_client.py` |
| Critic/verifier agent | `services/critic_agent.py` |
| Secret/PII redaction | `services/redaction.py` |
| Per-user rate limiting | `services/rate_limiter.py` |
| Chunking (heading-based prose, AST-based code) | `services/chunking.py` |
| Real corpus (repo docs + curated anti-patterns) | `services/corpus.py`, `knowledge/anti_patterns.md`, `knowledge/corpus.json` |
| Hybrid search (BM25 + vector, RRF fusion) | `services/hybrid_search.py` |
| Cross-encoder reranking | `services/reranker.py` |
| Vector store (semantic-only piece of the hybrid search) | `services/rag_service.py` |
| Pipeline orchestration + caching | `services/analysis_pipeline.py`, `services/analysis_service.py` |
| Eval harness (golden dataset, mutation testing, LLM-as-judge) | `evals/`, `scripts/eval_retrieval.py`, `results/` |
| CI (test/lint/SAST/dependency-scan gates) | `.github/workflows/ai-analysis-service-ci.yml`, `ruff.toml` |

## Reliability primitives (extended, not replaced, across all 5 phases)

- **Circuit breaker** (`services/circuit_breaker.py`) - unchanged since before this upgrade; still
  guards HTTP calls to submission-service/problem-service.
- **litellm fallback** (`fallbacks=[FALLBACK_MODEL_NAME]`) - still wraps every LLM call.
- **Rate-limit retry** (`services/llm_provider.py::_completion_with_rate_limit_retry`) - added in
  Phase 3 after hitting Groq's real TPM cap; a 3-attempt fixed backoff on top of the fallback.
- **Content-addressed caching** (`services/analysis_pipeline.py`) - unchanged; the whole
  tool-loop → critic pipeline above only runs on a cache miss.
- **Bounded agent loop** (`MAX_TOOL_STEPS=4` + stuck-detection) - added in Phase 1; also catches a
  real failure mode (a hallucinated tool call crashing the whole analysis) added in Phase 3.

## Evidence, not assertions

Every claim on this page has a real test, a real eval run, or a real captured protocol trace behind
it in `docs/ai-agent-build-log.md` - including the Phase 2 A/B eval that did NOT show the hoped-for
improvement, and the Phase 3 eval's real 100%/0% numbers. Read that file for the actual evidence;
this file is only the map.
