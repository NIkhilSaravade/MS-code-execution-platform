// Load test: GET /problems/getAll through api-gateway -> problem-service
// (real Postgres query + JPA, real JWT validation against auth-service's
// live JWKS). Logs in once per VU (setup-time token reuse would be
// cheaper, but a single shared token across all VUs also works fine here
// since JWTs are stateless - reused deliberately to keep this script
// focused on read-path throughput, not auth throughput, which
// 01_auth_login.js already covers).
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    listing_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 20 },
        { duration: '30s', target: 20 },
        { duration: '15s', target: 50 },
        { duration: '30s', target: 50 },
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

export function setup() {
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: 'perftest@example.com', password: 'PerfTest123!' }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  return { token: JSON.parse(res.body).accessToken };
}

export default function (data) {
  const res = http.get(`${BASE_URL}/problems/getAll`, {
    headers: { Authorization: `Bearer ${data.token}` },
  });
  check(res, {
    'status is 200': (r) => r.status === 200,
    'has content array': (r) => {
      try {
        return Array.isArray(JSON.parse(r.body).content);
      } catch {
        return false;
      }
    },
  });
  sleep(0.2);
}
