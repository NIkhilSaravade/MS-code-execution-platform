"""Real resilience/"downtime" demonstration - not a load-testing tool
script, a plain sequenced test: stop problem-service mid-run, show
ai-analysis-service's own CircuitBreaker (services/circuit_breaker.py,
failure_threshold=5, reset_timeout_seconds=30.0) actually trip open, then
restart problem-service and time the real recovery.

Run: python perf-testing/scripts/06_resilience_circuit_breaker.py
Requires: the full docker-compose stack up, `perftest@example.com`
registered (see other scripts in this folder), a real existing submission
id owned by that user (see results/06_resilience_circuit_breaker.md for
which one was used).
"""

import json
import subprocess  # nosec B404 B603 - fixed argv, no shell, local docker CLI calls only
import time
import urllib.error
import urllib.request

GATEWAY_URL = "http://localhost:8080"
AI_URL = "http://localhost:8000"
EMAIL = "perftest@example.com"
PASSWORD = "PerfTest123!"
BASELINE_SUBMISSION_ID = 1373  # already analyzed/cached earlier - proves the system is
# healthy pre-outage without spending a real Groq call.
OUTAGE_SUBMISSION_ID = 1374  # created but deliberately never analyzed before this
# script stops problem-service - its FIRST-ever /ai/analyze call must be a cache miss
# that actually reaches problem-service through the circuit breaker, not a cache hit
# that never touches it at all (the mistake an earlier run of this script made by
# reusing an already-cached id for both the baseline AND the outage calls).


def _post(url, body, headers):
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(), headers=headers, method="POST"
    )
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            elapsed = time.monotonic() - t0
            return resp.status, elapsed, resp.read().decode()
    except urllib.error.HTTPError as e:
        elapsed = time.monotonic() - t0
        return e.code, elapsed, e.read().decode()
    except Exception as e:  # noqa: BLE001 - this script wants to observe every failure mode
        elapsed = time.monotonic() - t0
        return None, elapsed, str(e)


def login():
    status, _, body = _post(
        f"{GATEWAY_URL}/auth/login",
        {"email": EMAIL, "password": PASSWORD},
        {"Content-Type": "application/json"},
    )
    assert status == 200, body
    return json.loads(body)["accessToken"]


def call_analyze(token, submission_id):
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    return _post(f"{AI_URL}/ai/analyze", {"submissionId": submission_id}, headers)


def docker(*args):
    subprocess.run(["docker", *args], check=False, capture_output=True)  # nosec B603 B607


def main():
    token = login()
    print(f"[{time.strftime('%H:%M:%S')}] logged in, problem-service is UP - baseline call (cached, proves the system is healthy without spending a Groq call):")
    print(" ", call_analyze(token, BASELINE_SUBMISSION_ID))

    print(f"\n[{time.strftime('%H:%M:%S')}] stopping problem-service...")
    docker("stop", "problem-service")
    t_stopped = time.monotonic()

    print(f"[{time.strftime('%H:%M:%S')}] firing calls on a submission ai-analysis-service has NEVER seen before (guaranteed cache miss -> real fetch attempt) until the circuit breaker opens:")
    for i in range(8):
        status, elapsed, body = call_analyze(token, OUTAGE_SUBMISSION_ID)
        print(f"  call {i + 1}: status={status} elapsed={elapsed:.2f}s body={body[:200]!r}")
        time.sleep(1)

    print(f"\n[{time.strftime('%H:%M:%S')}] restarting problem-service...")
    docker("start", "problem-service")

    print(f"[{time.strftime('%H:%M:%S')}] polling for recovery (every 5s, up to 90s)...")
    for i in range(18):
        status, elapsed, body = call_analyze(token, OUTAGE_SUBMISSION_ID)
        recovered_at = time.monotonic() - t_stopped
        print(f"  poll {i + 1} (t+{recovered_at:.1f}s since stop): status={status} elapsed={elapsed:.2f}s body={body[:200]!r}")
        if status == 200:
            print(f"\nRECOVERED at t+{recovered_at:.1f}s since problem-service was stopped.")
            break
        time.sleep(5)


if __name__ == "__main__":
    main()
