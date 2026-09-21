# Test 1: Auth Login Throughput

## Method

`scripts/01_auth_login.js` (k6). Ramping virtual users: 0→10 (15s), hold 10 (30s), 10→25 (15s),
hold 25 (30s), ramp down (10s). Each iteration: `POST /auth/login` through api-gateway with a
dedicated load-test account (`perftest@example.com`), asserting a 200 and a real `accessToken`
field in the response.

What this actually exercises, real: api-gateway's JWT-validation-free `/auth/**` route → auth-service
→ (gRPC call to user-service to verify credentials) → RS256 JWT signing with auth-service's own
private key. Not a stub or a mock of any of this.

## Result (real k6 output, `results/01_auth_login_summary.json`)

```
checks.........................: 100.00% 11134 out of 11134
http_req_duration..............: avg=67.33ms med=65.51ms p(90)=80.3ms  p(95)=84.86ms max=116.41ms
http_req_failed................: 0.00%   0 out of 5567
http_reqs......................: 5567    55.553101/s
```

- **5,567 real logins issued, 0 failures.**
- p95 latency **84.9ms**, max **116.4ms** even at peak (25 concurrent VUs).
- Sustained throughput **~55.5 req/s** on a single machine.

## Scope & honesty notes

- Single shared account across all VUs - this measures the login PATH's throughput, not per-user
  isolation (there's no rate limiter on `/auth/login` in this codebase to interact with, unlike
  the submission endpoint - see test 4).
- Single-machine docker-compose, not the production k8s topology.
