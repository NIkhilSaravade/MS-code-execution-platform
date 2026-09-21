# Test 2: Problem Listing Throughput

## Method

`scripts/02_problem_listing.js` (k6). One login in `setup()`, token reused (JWTs are stateless -
reuse is fine and keeps this test focused on the read path, not auth throughput, which test 1
covers). Ramping VUs: 0→20 (15s), hold 20 (30s), 20→50 (15s), hold 50 (30s), ramp down (10s).
Each iteration: `GET /problems/getAll` through api-gateway, asserting 200 and a real `content`
array in the response.

Real path exercised: api-gateway → problem-service (Spring Security JWT resource-server validation
against auth-service's live JWKS) → JPA/Hibernate query → Postgres.

## Result (real k6 output, `results/02_problem_listing_summary.json`)

```
checks.........................: 100.00% 29156 out of 29156
http_req_duration..............: avg=6.02ms med=5.24ms p(90)=9.7ms p(95)=11.14ms max=52.4ms
http_req_failed................: 0.00%   0 out of 14579
http_reqs......................: 14579   145.499387/s
```

- **14,579 real requests, 0 failures.**
- p95 latency **11.1ms** even at 50 concurrent VUs - this is a read-heavy, Postgres-backed
  endpoint and it stayed fast throughout.
- Sustained throughput **~145.5 req/s**.

## Scope & honesty notes

- The problem set returned is whatever's actually seeded in this Postgres instance (tens of
  problems, not thousands) - listing throughput would look different against a much larger table
  without pagination-aware indexing review.
- Single-machine docker-compose.
