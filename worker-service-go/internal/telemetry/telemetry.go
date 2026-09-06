package telemetry

import (
	"context"
	"fmt"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.24.0"
	"go.opentelemetry.io/otel/trace"
)

// Provider wraps the SDK tracer provider so the caller can shut it down cleanly.
type Provider struct {
	tp *sdktrace.TracerProvider
}

// Shutdown flushes pending spans and releases resources. Call on service exit.
func (p *Provider) Shutdown(ctx context.Context) error {
	return p.tp.Shutdown(ctx)
}

// Init configures the global tracer and propagator.
// The endpoint should be the OTLP HTTP collector (e.g. http://otel-collector:4318).
func Init(ctx context.Context, serviceName, serviceVersion, otlpEndpoint string) (*Provider, error) {
	// WithEndpointURL (not WithEndpoint, which takes a bare host:port and
	// would double up the scheme) since otlpEndpoint is a full URL like
	// "http://otel-collector:4318".
	exp, err := otlptracehttp.New(ctx,
		otlptracehttp.WithEndpointURL(otlpEndpoint),
		otlptracehttp.WithInsecure(), // TLS is handled at the service mesh layer in production
	)
	if err != nil {
		return nil, fmt.Errorf("create OTLP exporter: %w", err)
	}

	res, err := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceName(serviceName),
			semconv.ServiceVersion(serviceVersion),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("build OTel resource: %w", err)
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exp),
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sdktrace.AlwaysSample()), // tune for production via env
	)

	otel.SetTracerProvider(tp)

	// W3C trace context + baggage propagation so traceparent headers cross Kafka.
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	return &Provider{tp: tp}, nil
}

// Tracer returns a named tracer for the given package.
func Tracer(name string) trace.Tracer {
	return otel.Tracer(name)
}
