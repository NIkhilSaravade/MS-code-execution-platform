# Observability: Tracing, Logging, Health Checks

## Distributed tracing: OpenTelemetry + Jaeger

`ai-analysis-service` (Python) and `worker-service-go` (Go) were both
already instrumented with OpenTelemetry SDKs, but for a long stretch of the
project **nothing was actually deployed to receive the spans** — traces went
nowhere, silently. `0f22c18` added Jaeger (in-memory storage, UI on `:16686`)
and an OTel Collector to `docker-compose.yml`, receiving OTLP from both
services and forwarding to Jaeger.

Wiring up the collector surfaced **two real, independent bugs** that meant
neither service's traces would have worked *even with* a collector deployed
— both are excellent examples of failures that are silent by construction,
worth knowing as a category of bug to watch for:

1. **A trailing-path bug in the Python exporter.** `tracing.py` passed
   `endpoint=` explicitly to `OTLPSpanExporter`'s constructor — which
   bypasses the SDK's automatic `/v1/traces` path-append (that only happens
   when the exporter reads `OTEL_EXPORTER_OTLP_ENDPOINT` itself, not when a
   caller passes the value through manually). Every export would have
   404'd. Fixed by appending the path manually rather than relying on
   implicit SDK behavior that wasn't actually triggered.
2. **Instrumentation registered too late in FastAPI's lifecycle.**
   `FastAPIInstrumentor.instrument_app(app)` was called inside the
   `lifespan` startup handler — too late, because Starlette caches its
   middleware stack on the very first ASGI call (the lifespan scope
   invocation itself), *before* that handler's added middleware can affect
   it. Every request traced **zero spans, with no error anywhere** — silent
   by construction. Fixed by moving the call immediately after
   `app = FastAPI(...)` is constructed, before the app is ever invoked.

A related, separate bug hit later in this same area (`b2d41d0`, covered in
`07-RESOURCE-TUNING-AND-CAPACITY.md`): `otlptracehttp.WithEndpoint()`
expects a bare `host:port`, but `OTEL_EXPORTER_OTLP_ENDPOINT` is configured
as a full URL — silently double-prefixing the scheme (`http://http://...`)
and dropping every trace. Fixed by switching to `WithEndpointURL()`, which
accepts the full URL as actually documented.

**The pattern across all three bugs**: tracing failures tend to be
*completely silent* — nothing errors, spans just never arrive. Every fix
here was verified against a **real running container** generating a real
request and confirming a span actually showed up in Jaeger, not just that
the code compiled or the collector started.

## Structured logging

Only `ai-analysis-service` (Python `structlog`) and `worker-service-go`
(Go `zerolog`) emitted JSON logs natively. All 9 Java services still logged
Spring Boot's default plain-text console pattern — which can't be reliably
parsed by any real log aggregation system (ELK, Loki, CloudWatch Logs
Insights) once actually deployed. `6698e10` added
`logstash-logback-encoder` + a `logback-spring.xml` to all 9 services:
console-only JSON via `LogstashEncoder`, deliberately with
`includeContext=false` so output carries one clean `service` field rather
than dumping every logback context property redundantly. Uses
`logback-spring.xml` specifically (not `logback.xml`) so Boot's
`springProperty` extension works, pulling the service name from each app's
own `spring.application.name` instead of hardcoding it per file — one
change, applied identically nine times, rather than nine slightly different
snowflake configs.

## Health checks and graceful shutdown

Before `c97afa4`, **nothing** in the Java fleet exposed a liveness/readiness
endpoint or handled `SIGTERM` gracefully — every rolling deploy would have
hard-dropped whatever requests were in flight, and a deadlocked pod would
never get restarted since nothing could detect it. Added
`spring-boot-starter-actuator` +
`management.endpoint.health.probes.enabled` (exposing
`/actuator/health/liveness` and `/readiness`, the standard Kubernetes-probe
wiring) plus `server.shutdown=graceful` with a 20s shutdown-phase timeout,
to all 9 services. Two services needed **no extra thought** for the
Kafka-consumer case: Spring Kafka's listener container stops as part of the
same graceful-shutdown lifecycle automatically, so an in-flight consumer
poll finishes before the context closes.

`ai-analysis-service` and `worker-service-go` got their own equivalent
health/graceful-shutdown treatment separately (`c995d08`, `2cb1611` —
`/health`, `/healthz`, `/readyz`), matching what each framework's idiomatic
pattern actually is rather than forcing one uniform shape onto both.

## Verification discipline worth calling out

A recurring theme across this whole observability effort: every fix was
checked against **a real running instance**, not just "the code compiles."
The health-check commit even cross-checked three `application.yml` files
directly against SnakeYAML to catch a duplicate-key/indentation mistake
`mvn compile` alone wouldn't have caught. This same discipline — reproduce
live, verify live — is what made the much harder debugging sessions later
in this project's life (see `13-INCIDENT-POSTMORTEMS.md`) actually
tractable instead of guesswork.
