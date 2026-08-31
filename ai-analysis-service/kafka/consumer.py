import asyncio
import json
import os
import ssl
import time

import httpx
from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
from aiokafka.structs import ConsumerRecord

from auth.token_client import get_service_token
from db.database import SessionLocal
from db.models import ProcessedEvent
from discovery.service_resolver import get_service_url
from logging_config import get_logger
from services import analysis_pipeline
from services.circuit_breaker import get_breaker
from tracing import extract_trace_context, inject_trace_headers, tracer

log = get_logger(__name__)

# Consumes analysis.trigger.v1, published by execution-result-service right
# after it persists a judged result (see ExecutionResultService). This is
# what makes complexity/failure analysis run automatically instead of
# requiring the user to hit POST /ai/analyze themselves - see CLAUDE.md's
# "two independent layers" design: this LLM analysis is a separate,
# best-effort enrichment on top of worker-service-go's own deterministic
# complexity estimate, not a replacement for it.
#
# Retry/DLQ topology: a message that fails processing (upstream fetch
# error, LLM/validation error, etc.) isn't dropped outright anymore - it's
# forwarded to a delayed retry topic (with a "not before" timestamp header),
# and after exhausting both retry tiers, to a DLQ topic for manual
# inspection. Offsets are committed manually, only once a message has been
# fully handled - meaning either processed successfully, or successfully
# forwarded to the next tier - never on a bare processing failure, so a
# crash before that point redelivers the message rather than losing it.
# ProcessedEvent (db/models.py) is the idempotency guard against that
# redelivery (and against any other at-least-once duplicate) turning into a
# second LLM call / second forward.

MAX_RETRY_TIERS = 2
RETRY_DELAYS_SECONDS = [30, 300]  # tier 1: 30s, tier 2: 5min
HEADER_RETRY_COUNT = "retry-count"
HEADER_NOT_BEFORE = "not-before"
HEADER_ERROR = "error"


def _build_ssl_context() -> ssl.SSLContext:
    ca_path = os.getenv("KAFKA_TLS_CA_CERT_PATH", "/certs/ca.crt")
    context = ssl.create_default_context(cafile=ca_path)
    return context


def _topic_names() -> dict:
    base = os.getenv("KAFKA_TOPIC_ANALYSIS_TRIGGER", "analysis.trigger.v1")
    return {
        "main": base,
        "retries": [f"{base}.retry-{i + 1}" for i in range(MAX_RETRY_TIERS)],
        "dlq": f"{base}.dlq",
    }


def _retry_tier_of(topic: str, topics: dict) -> int:
    """-1 for the main topic, 0/1/... for a retry topic's tier index."""
    if topic == topics["main"]:
        return -1
    return topics["retries"].index(topic)


def _header_value(record: ConsumerRecord, key: str) -> str | None:
    for header_key, header_value in record.headers or []:
        if header_key == key:
            return header_value.decode("utf-8")
    return None


def _is_processed(event_key: str) -> bool:
    db = SessionLocal()
    try:
        return db.query(ProcessedEvent).filter(
            ProcessedEvent.event_key == event_key
        ).first() is not None
    finally:
        db.close()


def _mark_processed(event_key: str) -> None:
    db = SessionLocal()
    try:
        if db.query(ProcessedEvent).filter(
            ProcessedEvent.event_key == event_key
        ).first() is None:
            db.add(ProcessedEvent(event_key=event_key))
            db.commit()
    finally:
        db.close()


async def _fetch_submission_and_problem(submission_id: int) -> tuple[dict, dict]:
    token = await get_service_token()
    headers = {"Authorization": f"Bearer {token}"}

    submission_service_url = await get_service_url("SUBMISSION-SERVICE")
    problem_service_url = await get_service_url("PROBLEM-SERVICE")

    submission_breaker = get_breaker("submission-service")
    problem_breaker = get_breaker("problem-service")

    async with httpx.AsyncClient(timeout=10.0) as client:
        submission_response = await submission_breaker.call(
            client.get,
            f"{submission_service_url}/internal/submissions/{submission_id}",
            headers=headers,
        )
        submission_response.raise_for_status()
        submission = submission_response.json()

        problem_response = await problem_breaker.call(
            client.get,
            f"{problem_service_url}/problems/{submission['problemId']}",
            headers=headers,
        )
        problem_response.raise_for_status()
        problem = problem_response.json()

    return submission, problem


async def _process_event(submission_id: int) -> None:
    """Raises on any failure - callers decide retry/DLQ routing."""
    submission, problem = await _fetch_submission_and_problem(submission_id)
    analysis_pipeline.run_analysis(submission_id, submission, problem)


async def _forward(
    producer: AIOKafkaProducer,
    topic: str,
    payload: bytes,
    retry_count: int,
    delay_seconds: float | None,
    error: str | None,
) -> None:
    headers = [(HEADER_RETRY_COUNT, str(retry_count).encode("utf-8"))]
    if delay_seconds is not None:
        headers.append((HEADER_NOT_BEFORE, str(time.time() + delay_seconds).encode("utf-8")))
    if error is not None:
        headers.append((HEADER_ERROR, error[:2000].encode("utf-8", errors="replace")))
    headers = inject_trace_headers(headers)
    await producer.send_and_wait(topic, payload, headers=headers)


async def _handle_message(
    record: ConsumerRecord, producer: AIOKafkaProducer, topics: dict
) -> None:
    tier = _retry_tier_of(record.topic, topics)
    parent_context = extract_trace_context(record.headers)

    with tracer.start_as_current_span("analysis.trigger.handle", context=parent_context) as span:
        span.set_attribute("messaging.kafka.topic", record.topic)
        span.set_attribute("analysis.retry_tier", tier)

        if tier >= 0:
            not_before = _header_value(record, HEADER_NOT_BEFORE)
            if not_before is not None:
                remaining = float(not_before) - time.time()
                if remaining > 0:
                    await asyncio.sleep(remaining)

        try:
            event = json.loads(record.value)
            submission_id = int(event["submissionId"])
        except (json.JSONDecodeError, KeyError, TypeError, ValueError):
            log.warning("analysis_trigger.unparseable_message", payload=repr(record.value))
            return

        span.set_attribute("analysis.submission_id", submission_id)
        event_key = f"{topics['main']}:{submission_id}"
        if _is_processed(event_key):
            return

        try:
            if analysis_pipeline.get_cached(submission_id) is None:
                await _process_event(submission_id)
            _mark_processed(event_key)
            log.info("analysis_trigger.analyzed", submission_id=submission_id)
        except Exception as exc:
            next_tier = tier + 1
            if next_tier < len(topics["retries"]):
                await _forward(
                    producer,
                    topics["retries"][next_tier],
                    record.value,
                    retry_count=next_tier + 1,
                    delay_seconds=RETRY_DELAYS_SECONDS[next_tier],
                    error=str(exc),
                )
                log.warning(
                    "analysis_trigger.retry_scheduled",
                    submission_id=submission_id,
                    retry_tier=next_tier + 1,
                    error=str(exc),
                )
            else:
                await _forward(
                    producer,
                    topics["dlq"],
                    record.value,
                    retry_count=tier + 1,
                    delay_seconds=None,
                    error=str(exc),
                )
                _mark_processed(event_key)
                log.error(
                    "analysis_trigger.dlq",
                    submission_id=submission_id,
                    error=str(exc),
                )


async def run_consumer_loop() -> None:
    bootstrap_servers = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9093")
    username = os.getenv("KAFKA_SASL_USERNAME", "ai_analysis_service")
    password = os.getenv("KAFKA_AI_ANALYSIS_SERVICE_PASSWORD", "ai-analysis-service-dev-secret")
    group_id = os.getenv("KAFKA_CONSUMER_GROUP_ID", "ai-analysis-group")
    topics = _topic_names()

    common_kwargs = dict(
        bootstrap_servers=bootstrap_servers,
        security_protocol="SASL_SSL",
        sasl_mechanism="PLAIN",
        sasl_plain_username=username,
        sasl_plain_password=password,
        ssl_context=_build_ssl_context(),
    )

    consumer = AIOKafkaConsumer(
        topics["main"],
        *topics["retries"],
        group_id=group_id,
        auto_offset_reset="earliest",
        enable_auto_commit=False,
        **common_kwargs,
    )
    producer = AIOKafkaProducer(**common_kwargs)

    await consumer.start()
    await producer.start()
    log.info(
        "analysis_trigger.consumer_started",
        topics=[topics["main"], *topics["retries"]],
        group_id=group_id,
    )
    try:
        async for record in consumer:
            # Best-effort by design (see module docstring) - a failure here
            # never affects the submission's already-persisted judged
            # result. Only successfully-handled messages (processed, or
            # forwarded to the next retry/DLQ tier) advance the offset;
            # anything else is redelivered on restart.
            try:
                await _handle_message(record, producer, topics)
                await consumer.commit()
            except Exception as exc:
                log.error("analysis_trigger.unexpected_error", error=str(exc))
    finally:
        await consumer.stop()
        await producer.stop()


def start_background(loop: asyncio.AbstractEventLoop) -> asyncio.Task:
    """Starts the consumer loop as a background task. Failures inside the
    loop are logged (see run_consumer_loop's own try/except per message) -
    this task is fire-and-forget, matching the "AI analysis is best-effort,
    never blocks the judged result" design."""
    return loop.create_task(run_consumer_loop())
