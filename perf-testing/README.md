# Performance & Resilience Testing

Real load tests and one real chaos/resilience test run against the actual platform - full
docker-compose stack (Postgres, Redis, Kafka, Zookeeper, MinIO, Eureka, and every Java/Python
service except the Go worker), on a single Windows machine, one physical host, no cluster. Every
number in `results/` came from an actual run of the actual code in this repo - nothing here is
estimated or fabricated. Read each result file's own "Scope & honesty notes" section before citing
a number - several tests deliberately measure something narrower than "the whole platform can
handle N req/s," and that scope matters.

## Tooling

- **k6 v0.54.0** (Grafana's load-testing tool) - portable binary, no admin rights needed on this
  machine. Real HTTP load generation, real latency percentiles (p50/p90/p95), not synthetic math.
- One plain Python script for the resilience/circuit-breaker test (`06_resilience_circuit_breaker.py`)
  - stopping/restarting a real Docker container mid-test isn't something a load-testing tool does;
  this is a sequenced chaos experiment, not a throughput benchmark.

## Environment (real, disclosed - this is NOT a production deployment)

- Single machine, docker-compose (not the k8s cluster `infra/k8s/` targets) - every service on one
  host, competing for the same CPU/RAM/disk as this session's other work (LLM training earlier in
  this session, IDE, browser, etc.). Real numbers on a shared, unisolated machine are still real
  numbers, but a dedicated benchmark host would likely show different absolute figures - the
  *shape* of each finding (rate limiter behavior, gateway overhead, circuit breaker recovery) is
  what should travel to an interview conversation, not the exact millisecond figures as an SLA claim.
- `worker-service-go` (the actual code judge) requires a Kubernetes cluster (see repo `CLAUDE.md`)
  and is NOT running in this environment. Every submission created in these tests queues in Kafka
  and is never actually judged. Tests here measure ACCEPTANCE (ingestion) throughput for the judging
  pipeline, not judging turnaround - stated explicitly in `04_submission_ingestion.md`, not glossed
  over.
- `ai-analysis-service` calls real Groq API endpoints - these tests spend real (tiny) API cost and
  are deliberately low-volume to respect Groq's account-level TPM cap (see `05_ai_analysis_latency.md`).

## Results index

| # | Test | What it measures | Headline real number |
|---|---|---|---|
| 1 | [Auth login](results/01_auth_login.md) | POST /auth/login throughput (gateway -> auth-service, real RS256 JWT issuance + gRPC to user-service) | 55.5 req/s sustained, p95 84.9ms, 0% errors at 25 VUs |
| 2 | [Problem listing](results/02_problem_listing.md) | GET /problems/getAll throughput (gateway -> problem-service -> Postgres) | 145.5 req/s sustained, p95 11.1ms, 0% errors at 50 VUs |
| 3 | [Gateway overhead](results/03_gateway_overhead.md) | Real added latency of routing through api-gateway vs. hitting a service directly | ~1.65ms avg / ~1.96ms p95 added by the gateway hop |
| 4 | [Submission ingestion](results/04_submission_ingestion.md) | POST /submissions acceptance throughput + a real per-user rate limiter discovery | Multi-user: 16.3 req/s, 0% errors. Single-user burst: exactly 10/20 succeed, rest 429 - matches the configured token bucket precisely |
| 5 | [ai-analysis-service latency](results/05_ai_analysis_latency.md) | Real end-to-end LLM-backed review latency (tool loop + critic pass + real Groq calls) | p95 ~1.05s per fresh (non-cached) review |
| 6 | [Resilience / circuit breaker](results/06_resilience_circuit_breaker.md) | Real dependency-outage chaos test: stop a service mid-run, observe failure + recovery behavior | Recovered in 47.7s after a real container stop+restart - AND a real gap this test uncovered (see below) |

## The most interview-worthy finding, upfront

Test 6 didn't just confirm the circuit breaker works - it found a real bug: `main.py`'s
`_fetch_submission_and_problem` wraps the actual HTTP call to a downstream service in the circuit
breaker, but NOT the Eureka service-discovery lookup that happens first (`discovery/service_resolver.py::get_service_url`).
When the target service goes down, Eureka's own client throws
`py_eureka_client.eureka_client.WalkNodeException` during that lookup - a code path the circuit
breaker never sees and FastAPI has no specific handler for, so every request during the outage
returned a generic, unhelpful `500 Internal Server Error` instead of the clean `503` the code is
designed to return via `CircuitOpenError`. The system still recovered correctly once the dependency
came back (confirmed, timed) - but the *degradation* during the outage was worse than the code
intends, and this test is what surfaced that, not a code review. See
`results/06_resilience_circuit_breaker.md` for the full trace and a concrete fix recommendation
(not applied yet - flagged as a follow-up, this session's scope was testing/documentation, not a
new code change).

## Reproducing any of this

```bash
# from repo root, full docker-compose stack must be up:
docker-compose up -d

# k6 scripts (portable binary, no install needed - see scripts/):
k6.exe run --summary-export results/<name>_summary.json scripts/<name>.js

# the resilience test (uses the ai-analysis-service venv already set up
# for this repo's Python services):
ai-analysis-service/venv/Scripts/python.exe perf-testing/scripts/06_resilience_circuit_breaker.py
```

`scripts/load_test_users.json` (25 dedicated load-test accounts, `loadtest0@example.com` ..
`loadtest24@example.com`, all password `LoadTest123!`) is generated by registering against a live
`/auth/register` - regenerate with the snippet in `04_submission_ingestion.md` if starting fresh.
