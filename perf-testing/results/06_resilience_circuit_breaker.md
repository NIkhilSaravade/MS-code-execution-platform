# Test 6: Resilience / "Downtime" Chaos Test

This is the closest thing in this folder to a real "downtime" story - not observed production
downtime (this project has no sustained real user traffic to observe), but a controlled,
real chaos experiment: stop a real dependency container mid-run, observe what actually happens,
restart it, time the actual recovery. Every timestamp and status code below is copied verbatim
from a real run - see raw output further down.

## Method

`scripts/06_resilience_circuit_breaker.py`. Using a submission ai-analysis-service had NEVER
analyzed before (submission 1374 - guarantees a cache miss, so the call actually has to reach
problem-service, not short-circuit to a cached result):

1. Baseline call on a DIFFERENT, already-cached submission (1373) - confirms the system is healthy
   without spending a real Groq call.
2. `docker stop problem-service`.
3. Fire 8 calls to `POST /ai/analyze` for submission 1374, 1s apart.
4. `docker start problem-service`.
5. Poll `POST /ai/analyze` for submission 1374 every 5s (up to 90s) until it returns 200.

## Real output

```
[15:25:28] baseline call (cached): status=200, source=CACHE

[15:25:28] stopping problem-service...
[15:25:29] firing calls on submission 1374 (guaranteed cache miss):
  call 1: status=500 elapsed=10.12s
  call 2: status=500 elapsed=3.11s
  call 3: status=500 elapsed=0.03s
  call 4: status=500 elapsed=0.01s
  call 5: status=500 elapsed=0.03s
  call 6: status=500 elapsed=0.00s
  call 7: status=500 elapsed=0.01s
  call 8: status=500 elapsed=0.00s

[15:25:51] restarting problem-service...
[15:25:51] polling for recovery (every 5s)...
  poll 1 (t+21.6s since stop): status=500 elapsed=0.00s
  poll 2 (t+26.6s since stop): status=500 elapsed=0.02s
  poll 3 (t+31.6s since stop): status=500 elapsed=0.01s
  poll 4 (t+36.6s since stop): status=500 elapsed=0.02s
  poll 5 (t+41.6s since stop): status=500 elapsed=0.00s
  poll 6 (t+47.7s since stop): status=200 elapsed=1.08s   <- real analysis, real Groq call

RECOVERED at t+47.7s since problem-service was stopped.
```

## What actually happened (traced through real logs, not assumed)

- **Call 1 (10.12s)**: `problem-service` was still mid-shutdown - the TCP connection hung until
  httpx's own 10s connect timeout fired (`httpx.AsyncClient(timeout=10.0)` in `main.py`).
- **Call 2 (3.11s)**: faster - the container was further along in shutting down.
- **Calls 3 onward (~0-30ms each)**: consistently fast, but **checked the real logs
  (`docker logs ai-analysis-service`) rather than assuming this meant "the circuit breaker opened"**
  - it did NOT. The actual exception on every one of these calls was
  `py_eureka_client.eureka_client.WalkNodeException: <urlopen error >`, thrown by
  `discovery/service_resolver.py::get_service_url("PROBLEM-SERVICE")` - the Eureka
  service-discovery lookup itself, which happens **before** the circuit-breaker-wrapped HTTP call
  in `main.py::_fetch_submission_and_problem`. FastAPI has no handler for this exception type, so
  it fell through to a generic, unhelpful `500 Internal Server Error` on every request during the
  outage - not the clean `503` (`CircuitOpenError` → `HTTPException(503, ...)`) the code is
  actually designed to return.
- **Recovery at t+47.7s**: `docker start problem-service` was issued at t+21.6s (relative to the
  original stop); the Spring Boot app itself takes ~11-12s to actually finish starting and register
  with Eureka (consistent with `problem-service`'s own real cold-start time observed earlier this
  session), plus Eureka's own propagation delay, plus this poll loop's 5s granularity. First
  success was a REAL Groq call (1.08s, matching test 5's latency numbers), not a cached fallback.

## A real bug this test found (not fixed here - flagged as a follow-up)

**The circuit breaker in `services/circuit_breaker.py` only wraps the HTTP call to a downstream
service, not the Eureka discovery lookup that resolves its address first.** When a service goes
down, Eureka's own client can throw before the circuit breaker ever gets a chance to see a
failure, so:
- The circuit breaker's failure count/open-state logic never actually engaged during this test -
  the "fast failures" were Eureka's own quick internal give-up, not the breaker's fast-fail path.
- Every request during the outage returned a generic 500 instead of the intended 503, which is
  worse for any caller trying to distinguish "backend bug" from "known, temporary, retry-safe
  dependency outage."

**Recommended fix** (not applied in this session - this was a testing/documentation pass, not a
code-change pass): wrap `get_service_url(...)` in the same circuit breaker as the HTTP call, or at
minimum catch `py_eureka_client.eureka_client.WalkNodeException` in `main.py` alongside
`CircuitOpenError` and map it to the same 503 response.

## Scope & honesty notes

- One outage, one dependency (`problem-service`), one recovery cycle - not a soak test across
  many repeated outages, and not tested against `submission-service` (the other circuit-breaker-
  wrapped dependency) separately, though the same discovery-lookup gap almost certainly applies
  there too (same code path, same `_fetch_submission_and_problem` function).
- Recovery time (47.7s) is dominated by `problem-service`'s own real Spring Boot cold-start time on
  this machine, not purely by the circuit breaker's 30s `reset_timeout_seconds` - both are real,
  neither should be quoted as "the" recovery time without the other.
