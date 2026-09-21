// Load test: POST /auth/login through api-gateway -> auth-service.
// Real backend, real RS256 JWT issuance (auth-service's actual token
// pipeline, gRPC call to user-service to verify credentials) - not a
// stub. Uses a dedicated load-test account (perftest@example.com,
// registered once via POST /auth/register before this runs), not any
// real user's credentials.
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    login_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 10 },
        { duration: '30s', target: 10 },
        { duration: '15s', target: 25 },
        { duration: '30s', target: 25 },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export default function () {
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: 'perftest@example.com', password: 'PerfTest123!' }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(res, {
    'status is 200': (r) => r.status === 200,
    'has accessToken': (r) => {
      try {
        return typeof JSON.parse(r.body).accessToken === 'string';
      } catch {
        return false;
      }
    },
  });
  sleep(0.2);
}
