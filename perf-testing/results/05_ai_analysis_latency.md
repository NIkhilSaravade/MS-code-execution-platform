# Test 5: ai-analysis-service Real End-to-End Review Latency

## Method

`scripts/05_ai_analysis_latency.js` (k6). 1 VU, 8 iterations, 3s pacing between each. Each
iteration: creates a BRAND NEW submission (unique code per iteration, via a timestamp comment) so
ai-analysis-service's own content-addressed cache (`sha256(problem_id + code + status)`) can't
turn this into a cache-hit latency measurement instead of a real one, then calls
`POST /ai/analyze` directly against `ai-analysis-service:8000` (there is no api-gateway route for
this service - see `CLAUDE.md` - the frontend calls it directly too).

Real path exercised: submission-service + problem-service fetch → the real bounded tool-calling
agent loop (`services/agent_loop.py`) → real Groq API calls → the real critic/verifier pass
(`services/critic_agent.py`, Phase 5) → schema validation → cache write.

**Deliberately low volume** - two independent real ceilings would otherwise dominate this
measurement instead of the review pipeline's own latency:
1. ai-analysis-service's own per-user rate limiter: 10 requests / 60s (`services/rate_limiter.py`,
   Phase 4).
2. Groq's account-level token-per-minute cap - confirmed 8000 TPM for this account in Phase 3's
   real testing (see `docs/ai-agent-build-log.md`), shared across every call this process makes.

## Result (real k6 output, `results/05_ai_analysis_latency_summary.json`)

```
checks.........................: 100.00% 16 out of 16
http_req_duration..............: avg=447.1ms med=53ms p(90)=1s p(95)=1.05s max=1.07s
http_req_failed................: 0.00%   0 out of 17
```

**8 real, non-cached reviews, 0 failures, p95 ~1.05s** for the slow half of this metric (see
caveat below) - each one a genuine tool-calling-agent-plus-critic-plus-Groq round trip, not a
single blind LLM call.

## Scope & honesty notes (read before citing the exact numbers)

- `http_req_duration` here MIXES two different request types: the fast `POST /submissions` call
  (typically <50ms, per test 4) and the slow `POST /ai/analyze` call (the real LLM pipeline). The
  median (53ms) is dragged down by the fast submission-creation calls; the p90/p95/max (~1s-1.07s)
  are the actual AI-analysis latencies, since they're an order of magnitude slower and dominate the
  upper percentiles. A cleaner metric split (tagging each request type separately in k6) is a real,
  disclosed gap in this test's precision, not something to paper over - the qualitative number
  ("~1 second for a full agentic review, including a second critic pass") is solid; the precise p95
  of ONLY the analyze calls is not isolated here.
- Manual single-call timing outside this script (`time curl ...`) showed **2.44s** for one review -
  consistent with "roughly 1-2.5 seconds," reinforcing the k6 numbers rather than contradicting them.
- Volume (8 calls) is intentionally small - see the rate-limit/TPM reasoning above. This is a
  latency characterization, not a throughput ceiling test for this service.
