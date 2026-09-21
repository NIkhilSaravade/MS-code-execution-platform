// Demonstrates (doesn't just claim) that api-gateway's per-user
// Redis-backed rate limiter on /submissions/** actually works:
// replenishRate=2/s, burstCapacity=10 (see application.yml). One user,
// one VU, firing 20 requests back-to-back with no pacing - expect ~10 to
// succeed (the burst bucket) and the rest to get a clean 429, not a
// timeout or a 500. This IS the "how the system defends itself under load"
// story - a single account can't starve the submission pipeline for
// everyone else (see 04a, which shows 20 well-behaved *different* users
// sustaining real throughput with zero 429s in the same window).
import http from 'k6/http';

export const options = { vus: 1, iterations: 20 };

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
  const res = http.post(
    `${BASE_URL}/submissions`,
    JSON.stringify({
      userId: '87541807-916b-4227-8df3-d696cf43d7a9', // perftest@example.com's real sub - fixed once via a manual login (see results/04_submission_ingestion.md)
      problemId: 20,
      code: 'def solve():\n    return None\n',
      language: 'python',
      includeHidden: false,
    }),
    { headers: { Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/json' } },
  );
  console.log(`status=${res.status}`);
}
