// See results/03_gateway_overhead.md for the full methodology. This half:
// GET /problems/getAll direct to problem-service:8082, no gateway hop.
// Needs its own token from auth-service (not the gateway) - both issue
// identical RS256 JWTs against the same JWKS, so the token itself isn't
// what's being compared here, only the extra network/routing hop.
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 10,
  duration: '30s',
};

const AUTH_URL = __ENV.AUTH_URL || 'http://localhost:8086';
const DIRECT_URL = __ENV.DIRECT_URL || 'http://localhost:8082';

export function setup() {
  const res = http.post(
    `${AUTH_URL}/auth/login`,
    JSON.stringify({ email: 'perftest@example.com', password: 'PerfTest123!' }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  return { token: JSON.parse(res.body).accessToken };
}

export default function (data) {
  const res = http.get(`${DIRECT_URL}/problems/getAll`, {
    headers: { Authorization: `Bearer ${data.token}` },
  });
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(0.2);
}
