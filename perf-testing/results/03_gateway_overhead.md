# Test 3: API Gateway Real Added Latency

## Method

Same request (`GET /problems/getAll`), same real backend, same real JWT, two ways - run
sequentially (not concurrently, to isolate each path's own latency rather than having them
compete for CPU): 10 VUs / 30s through `api-gateway:8080` (`scripts/03a_gateway_overhead_via_gateway.js`),
then 10 VUs / 30s direct to `problem-service:8082` (`scripts/03b_gateway_overhead_direct.js`, its
own login against `auth-service:8086` directly - both issue identical RS256 JWTs against the same
JWKS, so the token itself isn't part of what's being compared).

## Result (real k6 output)

| | via api-gateway (`03a_via_gateway_summary.json`) | direct to problem-service (`03b_direct_summary.json`) |
|---|---|---|
| avg | 5.58ms | 3.93ms |
| p90 | 8.12ms | 6.35ms |
| p95 | 9.15ms | 7.19ms |
| max | 56.13ms | 53.42ms |
| req/s | 48.33 | 48.74 |
| failures | 0% (1463 reqs) | 0% (1472 reqs) |

**Real measured gateway overhead: ~1.65ms average, ~1.96ms at p95.** Spring Cloud Gateway's WebFlux
routing + its own JWT validation + Eureka-resolved load-balancing adds under 2ms at p95 on top of
problem-service's own ~3.9-7.2ms - a small, real, quantified cost for centralizing auth/routing/
rate-limiting (test 4) at one layer.

## Scope & honesty notes

- Sequential, not concurrent - this isolates the latency delta cleanly but doesn't test how the
  gateway behaves under simultaneous direct+routed traffic (not a realistic production scenario
  anyway, since nothing should be hitting problem-service directly in production).
- Max latency (~53-56ms) is nearly identical on both paths - that outlier is almost certainly
  Postgres/JVM GC noise shared by both paths, not gateway-specific.
