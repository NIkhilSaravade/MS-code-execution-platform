// Measures REAL end-to-end latency of ai-analysis-service's POST
// /ai/analyze: real submission-service + problem-service fetch, real
// tool-calling agent loop (services/agent_loop.py), real Groq calls, real
// critic/verifier pass (services/critic_agent.py). Not called through
// api-gateway - there is no gateway route for ai-analysis-service (see
// CLAUDE.md) - hits :8000 directly, same as the frontend does.
//
// Deliberately LOW volume/concurrency - two independent real ceilings are
// already known and would otherwise dominate this measurement rather than
// the review pipeline's own latency:
//   1. ai-analysis-service's own per-user rate limiter (10 req/60s -
//      services/rate_limiter.py, Phase 4).
//   2. Groq's account-level TPM cap (confirmed 8000 TPM in this Phase 3's
//      build log) shared across ALL calls this process makes, not just
//      this test.
// A fresh submission (unique code per iteration, via a fast-changing
// comment) is created each time specifically so ai-analysis-service's
// own content-addressed cache (sha256 of problem_id+code+status) can't
// silently turn this into a cache-hit latency test instead of a real
// LLM-call latency test.
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = { vus: 1, iterations: 8 };

const GATEWAY_URL = __ENV.GATEWAY_URL || 'http://localhost:8080';
const AI_URL = __ENV.AI_URL || 'http://localhost:8000';
const USER_ID = __ENV.USER_ID || '87541807-916b-4227-8df3-d696cf43d7a9';
const PROBLEM_ID = Number(__ENV.PROBLEM_ID || 20);

export function setup() {
  const res = http.post(
    `${GATEWAY_URL}/auth/login`,
    JSON.stringify({ email: 'perftest@example.com', password: 'PerfTest123!' }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  return { token: JSON.parse(res.body).accessToken };
}

export default function (data) {
  const uniqueCode = `def solve():\n    # variant ${Date.now()}-${__ITER}\n    return 1\n`;
  const subRes = http.post(
    `${GATEWAY_URL}/submissions`,
    JSON.stringify({ userId: USER_ID, problemId: PROBLEM_ID, code: uniqueCode, language: 'python', includeHidden: false }),
    { headers: { Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/json' } },
  );
  const submissionId = JSON.parse(subRes.body).submissionId;

  const analyzeRes = http.post(
    `${AI_URL}/ai/analyze`,
    JSON.stringify({ submissionId }),
    { headers: { Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/json' }, timeout: '60s' },
  );
  check(analyzeRes, {
    'status is 200': (r) => r.status === 200,
    'source is AI (not a cache hit)': (r) => {
      try {
        return JSON.parse(r.body).source === 'AI';
      } catch {
        return false;
      }
    },
  });

  sleep(3); // stay well under both the 10/60s per-user limit and Groq's TPM cap
}
