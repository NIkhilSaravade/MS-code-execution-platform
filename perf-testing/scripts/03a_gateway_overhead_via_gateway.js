// See 03_gateway_overhead_README (results/03_gateway_overhead.md) for the
// full methodology. This half: GET /problems/getAll through api-gateway.
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 10,
  duration: '30s',
};

const GATEWAY_URL = __ENV.GATEWAY_URL || 'http://localhost:8080';

export function setup() {
  const res = http.post(
    `${GATEWAY_URL}/auth/login`,
    JSON.stringify({ email: 'perftest@example.com', password: 'PerfTest123!' }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  return { token: JSON.parse(res.body).accessToken };
}

export default function (data) {
  const res = http.get(`${GATEWAY_URL}/problems/getAll`, {
    headers: { Authorization: `Bearer ${data.token}` },
  });
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(0.2);
}
