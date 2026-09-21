// Load test: POST /submissions through api-gateway -> submission-service,
// using 25 DISTINCT registered users (one per VU, see load_test_users.json)
// rather than one shared account. Necessary because api-gateway's
// /submissions/** route has a real, per-user Redis-backed token-bucket
// rate limiter (replenishRate=2/s, burstCapacity=10 - see
// api-gateway/src/main/resources/application.yml's RequestRateLimiter and
// RateLimiterConfig.userKeyResolver) - a single shared user hammering this
// endpoint mostly measures THAT limiter firing (see 04b), not the
// platform's real aggregate ingestion throughput across many tenants.
//
// SCOPE NOTE (see results/04_submission_ingestion.md): measures ACCEPTANCE
// throughput only. worker-service-go needs a Kubernetes cluster (not
// running here - see CLAUDE.md), so every submission created here sits at
// PENDING in Kafka forever and is never actually judged.
import http from 'k6/http';
import encoding from 'k6/encoding';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

const users = new SharedArray('users', function () {
  return JSON.parse(open('./load_test_users.json'));
});

export const options = {
  scenarios: {
    submission_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 20 },
        { duration: '40s', target: 20 },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const PROBLEM_ID = Number(__ENV.PROBLEM_ID || 20);

function decodeJwtSub(token) {
  const payload = token.split('.')[1];
  return JSON.parse(encoding.b64decode(payload, 'rawstd', 's')).sub;
}

// Each VU gets its own user (VU IDs are 1-indexed) and its own token -
// logged in once per VU via k6's per-VU init context, not per iteration.
const user = users[(__VU - 1) % users.length];
let token;
let userId;

export function setup() {
  // Pre-warm: log in as every user once up front so the ramp-up period
  // measures submission throughput, not login latency (already covered by
  // 01_auth_login.js).
}

export default function () {
  if (!token) {
    const res = http.post(`${BASE_URL}/auth/login`, JSON.stringify(user), {
      headers: { 'Content-Type': 'application/json' },
    });
    token = JSON.parse(res.body).accessToken;
    userId = decodeJwtSub(token);
  }

  const res = http.post(
    `${BASE_URL}/submissions`,
    JSON.stringify({
      userId,
      problemId: PROBLEM_ID,
      code: 'def solve():\n    return None\n',
      language: 'python',
      includeHidden: false,
    }),
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
  );
  check(res, {
    'status is 200/201': (r) => r.status === 200 || r.status === 201,
    'has submissionId': (r) => {
      try {
        return typeof JSON.parse(r.body).submissionId === 'number';
      } catch {
        return false;
      }
    },
  });
  // Each user stays under their own 2 req/s replenish rate - the point of
  // this test is real multi-tenant throughput, not re-triggering 04b's
  // rate-limit demo.
  sleep(1);
}
