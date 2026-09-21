"""Basic per-user rate limiting on top of the existing CircuitBreaker
(services/circuit_breaker.py) - the breaker protects this service from a
struggling upstream (submission-service/problem-service); this protects the
Groq spend/TPM budget from one user hammering POST /ai/analyze[/stream]
(each call can be several LLM calls deep via the tool loop - see
services/agent_loop.py - so a single user's requests can burn through the
TPM budget Phase 3 already ran into for real, see docs/ai-agent-build-log.md).

Fixed-window per-user counter, in-process only - same "no shared state
across instances" scoping CircuitBreaker already uses and documents; a
real multi-replica deployment would need this backed by Redis (the platform
already runs Redis - see CLAUDE.md - so that's the natural follow-up, not
done here to keep this phase's scope to "basic rate limiting" as stated)."""

import time
from collections import defaultdict, deque


class RateLimiter:
    def __init__(self, max_requests: int, window_seconds: float):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._requests: dict[str, deque] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        timestamps = self._requests[key]
        while timestamps and now - timestamps[0] >= self.window_seconds:
            timestamps.popleft()

        if len(timestamps) >= self.max_requests:
            return False

        timestamps.append(now)
        return True


_analysis_rate_limiter = RateLimiter(max_requests=10, window_seconds=60.0)


def get_analysis_rate_limiter() -> RateLimiter:
    return _analysis_rate_limiter
