import time
from typing import Awaitable, Callable, TypeVar

T = TypeVar("T")


class CircuitOpenError(Exception):
    """Raised instead of even attempting a call while a breaker is OPEN -
    lets a struggling upstream (submission-service/problem-service) fail
    fast instead of every caller hanging on its own timeout."""

    def __init__(self, name: str):
        super().__init__(f"circuit '{name}' is open")
        self.name = name


class CircuitBreaker:
    """Minimal in-process breaker (CLOSED -> OPEN -> HALF_OPEN -> CLOSED).
    No shared state across instances of this service - each pod trips
    independently, which is fine for this best-effort enrichment path (see
    CLAUDE.md's "AI analysis is best-effort" design)."""

    CLOSED = "CLOSED"
    OPEN = "OPEN"
    HALF_OPEN = "HALF_OPEN"

    def __init__(self, name: str, failure_threshold: int = 5, reset_timeout_seconds: float = 30.0):
        self.name = name
        self.failure_threshold = failure_threshold
        self.reset_timeout_seconds = reset_timeout_seconds
        self._state = self.CLOSED
        self._failure_count = 0
        self._opened_at = 0.0

    def _current_state(self) -> str:
        if self._state == self.OPEN and time.monotonic() - self._opened_at >= self.reset_timeout_seconds:
            self._state = self.HALF_OPEN
        return self._state

    def _on_success(self) -> None:
        self._state = self.CLOSED
        self._failure_count = 0

    def _on_failure(self) -> None:
        self._failure_count += 1
        if self._state == self.HALF_OPEN or self._failure_count >= self.failure_threshold:
            self._state = self.OPEN
            self._opened_at = time.monotonic()

    async def call(self, func: Callable[..., Awaitable[T]], *args, **kwargs) -> T:
        if self._current_state() == self.OPEN:
            raise CircuitOpenError(self.name)

        try:
            result = await func(*args, **kwargs)
        except Exception:
            self._on_failure()
            raise
        else:
            self._on_success()
            return result


_breakers: dict[str, CircuitBreaker] = {}


def get_breaker(name: str) -> CircuitBreaker:
    if name not in _breakers:
        _breakers[name] = CircuitBreaker(name)
    return _breakers[name]
