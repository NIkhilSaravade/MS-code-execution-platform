// worker-service: pulls submission jobs from Kafka, executes code in hardened
// sandboxes, and publishes execution results back to Kafka.

//The whole service in one sentence:
// main.go builds everything → consumer.go receives a Kafka message
// → executor.go orchestrates → sandbox.go runs Docker → problem/submission clients talk to other services
// → s3client.go moves files → producer.go publishes the result.

// Startup order:
//  1. Load config from environment
//  2. Initialise OpenTelemetry (traces exported via OTLP HTTP)
//  3. Wire up dependencies (S3, HTTP clients, sandbox, executor)
//  4. Start Kafka consumer in a goroutine
//  5. Block on SIGTERM / SIGINT
//  6. Graceful shutdown: cancel consumer context, flush OTLP, close Kafka connections
package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/auth"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/clients"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/config"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/executor"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/kafka"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/sandbox"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/storage"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/telemetry"
)

func main() {
	// ── Config ───────────────────────────────────────────────────────────────
	cfg, err := config.Load()
	if err != nil {
		// Can't use zerolog yet — config not loaded.
		log.Fatal().Err(err).Msg("fatal: failed to load config")
	}

	// ── Logging ──────────────────────────────────────────────────────────────
	level, err := zerolog.ParseLevel(cfg.LogLevel)
	if err != nil {
		level = zerolog.InfoLevel
	}
	zerolog.SetGlobalLevel(level)
	zerolog.TimeFieldFormat = time.RFC3339Nano
	log.Logger = log.Output(os.Stdout).With().
		Str("service", cfg.ServiceName).
		Str("version", cfg.ServiceVersion).
		Str("worker_id", cfg.WorkerID).
		Logger()

	log.Info().
		Str("sandbox_runtime", cfg.SandboxRuntime).
		Str("kafka_group", cfg.KafkaConsumerGroupID).
		Msg("worker-service starting")

	// ── OpenTelemetry ─────────────────────────────────────────────────────────
	ctx := context.Background()
	tp, err := telemetry.Init(ctx, cfg.ServiceName, cfg.ServiceVersion, cfg.OTLPEndpoint)
	if err != nil {
		// Tracing failure is non-fatal — the service can run without it.
		// Log and continue; operators should alert on this via the OTEL collector.
		log.Warn().Err(err).Msg("failed to initialise OpenTelemetry — traces will not be exported")
	}

	// ── S3 / MinIO ────────────────────────────────────────────────────────────
	s3Client, err := storage.NewS3Client(ctx, cfg)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to create S3 client")
	}

	// ── HTTP clients ──────────────────────────────────────────────────────────
	// The worker authenticates to problem-service/submission-service as itself
	// (OAuth2 client-credentials against auth-service), since it has no inbound
	// user request to forward a token from. Both clients share one TokenSource
	// so they share its cache instead of each re-authenticating independently.
	tokenSource := auth.NewTokenSource(cfg.AuthServiceBaseURL, cfg.WorkerClientID, cfg.WorkerClientSecret)
	submissionClient := clients.NewSubmissionClient(cfg, tokenSource)
	problemClient := clients.NewProblemClient(cfg, tokenSource)

	// ── Kafka producer (used by executor to publish result events) ────────────
	producer := kafka.NewProducer(cfg)

	// ── Sandbox ───────────────────────────────────────────────────────────────
	sb := sandbox.New(cfg)

	// ── Executor (the kafka.Handler implementation) ────────────────────────────
	exec := executor.New(cfg, sb, submissionClient, problemClient, s3Client, producer)

	// ── Kafka consumer ────────────────────────────────────────────────────────
	// DLQ producer shares the same underlying writer; it just targets a different topic.
	dlqProducer := kafka.NewProducer(cfg)
	consumer := kafka.NewConsumer(cfg, exec, dlqProducer)

	// ── Run ───────────────────────────────────────────────────────────────────
	// cancelCtx controls the consumer loop. On signal, we cancel it and give
	// in-flight executions time to finish before exiting.
	cancelCtx, cancel := context.WithCancel(ctx)

	// Run the consumer in a goroutine; errors are fatal.
	consumerErrCh := make(chan error, 1)
	go func() {
		consumerErrCh <- consumer.Run(cancelCtx)
	}()

	log.Info().Msg("worker-service ready — waiting for submissions")

	// ── Signal handling ───────────────────────────────────────────────────────
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)

	select {
	case sig := <-sigCh:
		log.Info().Str("signal", sig.String()).Msg("shutdown signal received")
	case err := <-consumerErrCh:
		if err != nil {
			log.Error().Err(err).Msg("consumer exited with error")
		}
	}

	// ── Graceful shutdown ─────────────────────────────────────────────────────
	log.Info().Msg("initiating graceful shutdown")
	cancel()

	// Give in-flight executions a generous drain window.
	// Sandboxes have their own wall-clock timeout (cfg.SandboxWallTimeout),
	// so the worst-case drain time is roughly 2× that for compile + execute.
	drainTimeout := cfg.SandboxWallTimeout*2 + 5*time.Second
	drainCtx, drainCancel := context.WithTimeout(context.Background(), drainTimeout)
	defer drainCancel()

	// Wait for the consumer to exit or timeout.
	select {
	case <-consumerErrCh:
		log.Info().Msg("consumer exited cleanly")
	case <-drainCtx.Done():
		log.Warn().Msg("drain timeout reached — forcing shutdown")
	}

	// Close Kafka connections.
	if err := consumer.Close(); err != nil {
		log.Warn().Err(err).Msg("error closing consumer")
	}
	if err := producer.Close(); err != nil {
		log.Warn().Err(err).Msg("error closing producer")
	}
	if err := dlqProducer.Close(); err != nil {
		log.Warn().Err(err).Msg("error closing DLQ producer")
	}

	// Flush OpenTelemetry spans.
	if tp != nil {
		flushCtx, flushCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer flushCancel()
		if err := tp.Shutdown(flushCtx); err != nil {
			log.Warn().Err(err).Msg("error shutting down tracer provider")
		}
	}

	log.Info().Msg("worker-service stopped")
}
