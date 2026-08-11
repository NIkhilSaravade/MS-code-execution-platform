import asyncio
import json
import os
import ssl

import httpx
from aiokafka import AIOKafkaConsumer

from auth.token_client import get_service_token
from discovery.service_resolver import get_service_url
from services import analysis_pipeline

# Consumes analysis.trigger.v1, published by execution-result-service right
# after it persists a judged result (see ExecutionResultService). This is
# what makes complexity/failure analysis run automatically instead of
# requiring the user to hit POST /ai/analyze themselves - see CLAUDE.md's
# "two independent layers" design: this LLM analysis is a separate,
# best-effort enrichment on top of worker-service-go's own deterministic
# complexity estimate, not a replacement for it.


def _build_ssl_context() -> ssl.SSLContext:
    ca_path = os.getenv("KAFKA_TLS_CA_CERT_PATH", "/certs/ca.crt")
    context = ssl.create_default_context(cafile=ca_path)
    return context


async def _fetch_submission_and_problem(submission_id: int) -> tuple[dict, dict]:
    token = await get_service_token()
    headers = {"Authorization": f"Bearer {token}"}

    submission_service_url = await get_service_url("SUBMISSION-SERVICE")
    problem_service_url = await get_service_url("PROBLEM-SERVICE")

    async with httpx.AsyncClient(timeout=10.0) as client:
        submission_response = await client.get(
            f"{submission_service_url}/internal/submissions/{submission_id}",
            headers=headers,
        )
        submission_response.raise_for_status()
        submission = submission_response.json()

        problem_response = await client.get(
            f"{problem_service_url}/problems/{submission['problemId']}",
            headers=headers,
        )
        problem_response.raise_for_status()
        problem = problem_response.json()

    return submission, problem


async def _handle_message(payload: bytes) -> None:
    try:
        event = json.loads(payload)
        submission_id = int(event["submissionId"])
    except (json.JSONDecodeError, KeyError, TypeError, ValueError):
        print(f"analysis.trigger.v1: skipping unparseable message: {payload!r}")
        return

    if analysis_pipeline.get_cached(submission_id) is not None:
        # Already analyzed (e.g. a re-submission triggering the same id
        # again isn't possible, but a redelivered message is) - skip.
        return

    try:
        submission, problem = await _fetch_submission_and_problem(submission_id)
        analysis_pipeline.run_analysis(submission_id, submission, problem)
        print(f"analysis.trigger.v1: analyzed submission {submission_id}")
    except Exception as exc:
        # Best-effort by design (see module docstring) - a failure here never
        # affects the submission's already-persisted judged result, so it's
        # logged and dropped rather than retried/DLQ'd.
        print(f"analysis.trigger.v1: failed to analyze submission {submission_id}: {exc}")


async def run_consumer_loop() -> None:
    bootstrap_servers = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9093")
    topic = os.getenv("KAFKA_TOPIC_ANALYSIS_TRIGGER", "analysis.trigger.v1")
    username = os.getenv("KAFKA_SASL_USERNAME", "ai_analysis_service")
    password = os.getenv("KAFKA_AI_ANALYSIS_SERVICE_PASSWORD", "ai-analysis-service-dev-secret")
    group_id = os.getenv("KAFKA_CONSUMER_GROUP_ID", "ai-analysis-group")

    consumer = AIOKafkaConsumer(
        topic,
        bootstrap_servers=bootstrap_servers,
        group_id=group_id,
        security_protocol="SASL_SSL",
        sasl_mechanism="PLAIN",
        sasl_plain_username=username,
        sasl_plain_password=password,
        ssl_context=_build_ssl_context(),
        auto_offset_reset="earliest",
        enable_auto_commit=True,
    )

    await consumer.start()
    print(f"analysis.trigger.v1: consumer started (topic={topic}, group={group_id})")
    try:
        async for message in consumer:
            await _handle_message(message.value)
    finally:
        await consumer.stop()


def start_background(loop: asyncio.AbstractEventLoop) -> asyncio.Task:
    """Starts the consumer loop as a background task. Failures inside the
    loop are logged (see run_consumer_loop's own try/except per message) -
    this task is fire-and-forget, matching the "AI analysis is best-effort,
    never blocks the judged result" design."""
    return loop.create_task(run_consumer_loop())
