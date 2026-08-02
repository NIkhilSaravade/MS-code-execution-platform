package kafka

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
	kafkago "github.com/segmentio/kafka-go"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"

	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/config"
)

// Producer wraps a kafka-go Writer with structured logging and tracing.
// The worker service has no outbox database — it relies on the idempotent
// producer plus exponential retry to guarantee at-least-once delivery.
// Downstream consumers (results-service, ai-analysis-service) are idempotent
// on submission_id, so redelivery is safe.
type Producer struct {
	writer *kafkago.Writer
	cfg    *config.Config
}

// NewProducer creates a producer connected to all configured brokers.
func NewProducer(cfg *config.Config) *Producer {
	w := &kafkago.Writer{
		Addr:                   kafkago.TCP(cfg.KafkaBrokers...),
		Balancer:               &kafkago.Hash{}, // partition by message key
		RequiredAcks:           kafkago.RequireAll, // wait for all in-sync replicas
		Async:                  false,              // synchronous — caller knows if publish succeeded
		MaxAttempts:            5,
		WriteBackoffMin:        100 * time.Millisecond,
		WriteBackoffMax:        5 * time.Second,
		BatchTimeout:           10 * time.Millisecond,
		Compression:            kafkago.Snappy,
		AllowAutoTopicCreation: false, // topics must be pre-created by ops
		Logger: kafkago.LoggerFunc(func(s string, a ...interface{}) {
			log.Debug().Msgf("kafka-go writer: "+s, a...)
		}),
		ErrorLogger: kafkago.LoggerFunc(func(s string, a ...interface{}) {
			log.Error().Msgf("kafka-go writer error: "+s, a...)
		}),
	}
	return &Producer{writer: w, cfg: cfg}
}

// Publish writes a single message to the specified topic.
// It injects the current trace context into the record headers before publishing.
// The message key is used for partition assignment — pass submission_id as the key
// so all events for the same submission land on the same partition.
func (p *Producer) Publish(ctx context.Context, topic string, key, value []byte, extraHeaders []kafkago.Header) error {
	ctx, span := otel.Tracer("worker-service/kafka.Producer").Start(ctx, "producer.publish")
	defer span.End()

	span.SetAttributes(
		attribute.String("messaging.destination", topic),
		attribute.String("messaging.system", "kafka"),
	)

	// Build the header list: OTel trace context first, then caller-supplied extras.
	headers := make([]kafkago.Header, 0, len(extraHeaders)+4)
	InjectTraceContext(ctx, &headers)
	headers = append(headers, extraHeaders...)

	msg := kafkago.Message{
		Topic:   topic,
		Key:     key,
		Value:   value,
		Headers: headers,
		Time:    time.Now().UTC(),
	}

	if err := p.writer.WriteMessages(ctx, msg); err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return fmt.Errorf("kafka publish to %s: %w", topic, err)
	}

	log.Debug().
		Str("topic", topic).
		Int("value_bytes", len(value)).
		Msg("kafka message published")
	return nil
}

// Close flushes pending messages and releases the connection.
func (p *Producer) Close() error {
	return p.writer.Close()
}
