package kafka

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	kafkago "github.com/segmentio/kafka-go"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"

	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/config"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/domain"
)

// Handler is called once per valid submission event.
// Returning an error signals that the message should be routed to the DLQ;
// the consumer will still commit the offset so the partition is never blocked.
type Handler interface {
	Handle(ctx context.Context, job *domain.SubmissionJob) error
}

// Consumer wraps a kafka-go Reader and provides a blocking Run loop that
// processes messages and commits offsets only after the handler returns.
type Consumer struct {
	reader  *kafkago.Reader
	handler Handler
	dlq     *Producer
	cfg     *config.Config

}

// NewConsumer creates a consumer that reads from the submissions.created.v1 topic.
func NewConsumer(cfg *config.Config, handler Handler, dlq *Producer) (*Consumer, error) {
	tlsConfig, err := buildTLSConfig(cfg.KafkaTLSCACertPath)
	if err != nil {
		return nil, fmt.Errorf("kafka consumer TLS config: %w", err)
	}

	dialer := &kafkago.Dialer{
		Timeout:       10 * time.Second,
		DualStack:     true,
		TLS:           tlsConfig,
		SASLMechanism: buildSASLMechanism(cfg.KafkaSASLUsername, cfg.KafkaSASLPassword),
	}

	r := kafkago.NewReader(kafkago.ReaderConfig{
		Brokers:        cfg.KafkaBrokers,
		GroupID:        cfg.KafkaConsumerGroupID,
		Topic:          cfg.KafkaSubmissionTopic,
		Dialer:         dialer,
		MinBytes:       1,
		MaxBytes:       10 << 20, // 10 MB — submission events are small but code can be large
		CommitInterval: 0,        // manual commit only
		StartOffset:    kafkago.FirstOffset,
		// RetentionTime keeps the consumer group from being expired during idle periods.
		RetentionTime:  7 * 24 * time.Hour,
		Logger:         kafkago.LoggerFunc(func(s string, a ...interface{}) {
			log.Debug().Msgf("kafka-go reader: "+s, a...)
		}),
		ErrorLogger: kafkago.LoggerFunc(func(s string, a ...interface{}) {
			log.Error().Msgf("kafka-go reader error: "+s, a...)
		}),
	})

	return &Consumer{
		reader:  r,
		handler: handler,
		dlq:     dlq,
		cfg:     cfg,
	}, nil
}

// Run blocks and processes messages until ctx is cancelled.
// It is safe to call from a goroutine; it returns nil on clean shutdown.
func (c *Consumer) Run(ctx context.Context) error {
	log.Info().
		Str("topic", c.cfg.KafkaSubmissionTopic).
		Str("group", c.cfg.KafkaConsumerGroupID).
		Msg("kafka consumer started")

	for {
		msg, err := c.reader.FetchMessage(ctx)
		if err != nil {
			if ctx.Err() != nil {
				log.Info().Msg("kafka consumer shutting down — context cancelled")
				return nil
			}
			return fmt.Errorf("fetch message: %w", err)
		}

		if err := c.process(ctx, msg); err != nil {
			// process() already logged the error and published to DLQ.
			// We still commit so a bad message never blocks the partition.
			log.Error().Err(err).
				Str("topic", msg.Topic).
				Int("partition", msg.Partition).
				Int64("offset", msg.Offset).
				Msg("message processing failed — committing offset to unblock partition")
		}

		// Offset commit is the acknowledgement. Crash before this and the
		// message will be redelivered — each handler must be idempotent.
		if err := c.reader.CommitMessages(ctx, msg); err != nil {
			log.Error().Err(err).Msg("offset commit failed — redelivery expected")
		}
	}
}

// Close signals the reader to stop. Call after Run returns.
func (c *Consumer) Close() error {
	return c.reader.Close()
}

// --------------------------------------------------------------------------
// internal
// --------------------------------------------------------------------------

func (c *Consumer) process(ctx context.Context, msg kafkago.Message) (retErr error) {
	// Extract W3C trace context from the Kafka record headers so the consumer
	// span is a child of the submission-service span that produced the event.
	carrier := headerCarrier(msg.Headers)
	ctx = otel.GetTextMapPropagator().Extract(ctx, carrier)

	ctx, span := otel.Tracer("worker-service/kafka.Consumer").Start(ctx, "consumer.process")
	defer func() {
		if retErr != nil {
			span.RecordError(retErr)
			span.SetStatus(codes.Error, retErr.Error())
		}
		span.End()
	}()

	attemptCount := extractAttemptCount(msg.Headers)
	submissionID := extractHeader(msg.Headers, domain.HeaderSubmissionID)

	logger := log.With().
		Str("topic", msg.Topic).
		Int("partition", msg.Partition).
		Int64("offset", msg.Offset).
		Str("submission_id", submissionID).
		Int("attempt", attemptCount).
		Logger()

	span.SetAttributes(
		attribute.String("submission_id", submissionID),
		attribute.Int("attempt_count", attemptCount),
	)

	// Parse the event envelope.
	var event domain.SubmissionCreatedEvent
	if err := json.Unmarshal(msg.Value, &event); err != nil {
		logger.Error().Err(err).Msg("failed to unmarshal submission event — sending to DLQ")
		c.sendToDLQ(ctx, msg, "unmarshal_failure", err.Error(), attemptCount)
		return fmt.Errorf("unmarshal: %w", err)
	}

	if event.EventVersion != 1 {
		err := fmt.Errorf("unsupported event version: %d", event.EventVersion)
		logger.Error().Err(err).Msg("unknown event version — sending to DLQ")
		c.sendToDLQ(ctx, msg, "unsupported_version", err.Error(), attemptCount)
		return err
	}

	// Build the job from the event, carrying the raw trace headers so the
	// executor can re-attach them to outgoing spans.
	job := &domain.SubmissionJob{
		EventID:          event.EventID,
		SubmissionID:     event.SubmissionID,
		UserID:           event.UserID,
		ProblemID:        event.ProblemID,
		ProblemVersionID: event.ProblemVersionID,
		Language:         domain.Language(event.Language),
		CodeS3Key:        event.CodeS3Key,
		CodeHash:         event.CodeHash,
		IncludeHidden:    event.IncludeHidden,
		OccurredAt:       event.OccurredAt,
		TraceParent:      carrier.Get(domain.HeaderTraceParent),
		TraceState:       carrier.Get(domain.HeaderTraceState),
	}

	logger.Info().Str("language", string(job.Language)).Msg("dispatching job to executor")

	if err := c.handler.Handle(ctx, job); err != nil {
		logger.Error().Err(err).Msg("handler returned error — sending to DLQ")
		c.sendToDLQ(ctx, msg, "handler_failure", err.Error(), attemptCount)
		return fmt.Errorf("handler: %w", err)
	}

	logger.Info().Msg("job handled successfully")
	return nil
}

func (c *Consumer) sendToDLQ(ctx context.Context, original kafkago.Message, reason, detail string, attempt int) {
	headers := []kafkago.Header{
		{Key: "dlq_original_topic", Value: []byte(original.Topic)},
		{Key: "dlq_original_partition", Value: []byte(strconv.Itoa(original.Partition))},
		{Key: "dlq_original_offset", Value: []byte(strconv.FormatInt(original.Offset, 10))},
		{Key: "dlq_reason", Value: []byte(reason)},
		{Key: "dlq_detail", Value: []byte(detail)},
		{Key: domain.HeaderAttemptCount, Value: []byte(strconv.Itoa(attempt))},
	}
	// Forward any existing OTel headers so the DLQ record is also traceable.
	headers = append(headers, original.Headers...)

	if err := c.dlq.Publish(ctx, c.cfg.KafkaDLQTopic, original.Key, original.Value, headers); err != nil {
		log.Error().Err(err).Msg("failed to publish to DLQ — record may be lost")
	}
}

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------

// headerCarrier adapts []kafkago.Header to the OTel TextMapCarrier interface.
type headerCarrier []kafkago.Header

func (h headerCarrier) Get(key string) string {
	for _, hdr := range h {
		if hdr.Key == key {
			return string(hdr.Value)
		}
	}
	return ""
}

func (h headerCarrier) Set(key, value string) {
	// read-only carrier — we don't mutate incoming headers
}

func (h headerCarrier) Keys() []string {
	keys := make([]string, len(h))
	for i, hdr := range h {
		keys[i] = hdr.Key
	}
	return keys
}

func (h headerCarrier) Inject(ctx context.Context, headers *[]kafkago.Header) {
	carrier := propagation.MapCarrier{}
	otel.GetTextMapPropagator().Inject(ctx, carrier)
	for k, v := range carrier {
		*headers = append(*headers, kafkago.Header{Key: k, Value: []byte(v)})
	}
}

func extractHeader(headers []kafkago.Header, key string) string {
	return headerCarrier(headers).Get(key)
}

func extractAttemptCount(headers []kafkago.Header) int {
	s := extractHeader(headers, domain.HeaderAttemptCount)
	if s == "" {
		return 1
	}
	n, _ := strconv.Atoi(s)
	return n
}

// InjectTraceContext writes the current span's trace context into a slice of
// Kafka headers. Call this before publishing any outbound event.
func InjectTraceContext(ctx context.Context, headers *[]kafkago.Header) {
	headerCarrier(nil).Inject(ctx, headers)
}

// Ensure zerolog.Logger interface is satisfied for the kafka-go logger adapter.
var _ zerolog.Logger
