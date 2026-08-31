import os

from opentelemetry import propagate, trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter

_configured = False

# trace.get_tracer() is safe to call before configure_tracing() - the
# otel API returns a proxy that defers to whatever TracerProvider is
# registered later via trace.set_tracer_provider.
tracer = trace.get_tracer("ai-analysis-service")


def configure_tracing(app=None) -> None:
    """Sets up the SDK TracerProvider and (if an OTLP endpoint is
    configured) exports spans there; otherwise falls back to console export
    so tracing is still visible locally. Instruments the FastAPI app when
    one is passed (main.py's startup hook)."""
    global _configured
    if _configured:
        return

    resource = Resource.create({"service.name": os.getenv("OTEL_SERVICE_NAME", "ai-analysis-service")})
    provider = TracerProvider(resource=resource)

    otlp_endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
    if otlp_endpoint:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=otlp_endpoint)))
    else:
        provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))

    trace.set_tracer_provider(provider)

    if app is not None:
        FastAPIInstrumentor.instrument_app(app)

    _configured = True


def inject_trace_headers(headers: list[tuple[str, bytes]]) -> list[tuple[str, bytes]]:
    """Injects the current trace context into a Kafka header list (as
    string->bytes tuples, aiokafka's format) so a consumer on the other end
    can continue the same trace - see extract_trace_context."""
    carrier: dict[str, str] = {}
    propagate.inject(carrier)
    return list(headers) + [(k, v.encode("utf-8")) for k, v in carrier.items()]


def extract_trace_context(headers):
    """Inverse of inject_trace_headers - recovers a parent trace context
    from a consumed Kafka record's headers, or an empty context if the
    message carries none (e.g. published before this change shipped)."""
    carrier = {}
    for key, value in headers or []:
        if isinstance(value, bytes):
            carrier[key] = value.decode("utf-8")
    return propagate.extract(carrier)
