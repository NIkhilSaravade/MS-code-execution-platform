// worker-service: pulls submission jobs from Kafka, executes code in hardened
// sandboxes, and publishes execution results back to Kafka.

//The whole service in one sentence:
// main.go builds everything → consumer.go receives a Kafka message (already
// carrying test cases/limits, embedded by submission-service) → executor.go
// orchestrates → sandbox.go runs Docker → s3client.go moves files →
// producer.go publishes the result to execution-result-topic.

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
	"net/http"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/config"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/eureka"
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

	// ── Eureka (discovery-service) ─────────────────────────────────────────────
	// Registers this worker for dashboard visibility only now - it no longer
	// calls problem-service/submission-service itself (see the
	// embedded-job-payload / single-result-topic redesign), so there's
	// nothing left to resolve through Eureka.
	eurekaClient := eureka.New(cfg.EurekaServerURL, cfg.EurekaAppName)
	go eurekaClient.RunLifecycle(ctx)

	// ── Kafka producer (used by executor to publish result events) ────────────
	producer, err := kafka.NewProducer(cfg)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to create kafka producer")
	}

	// cancelCtx is created here (earlier than before) so it can bound the
	// sandbox's pool-replenishment goroutines too, not just the Kafka
	// consumer - both need to stop on the same graceful-shutdown signal.
	cancelCtx, cancel := context.WithCancel(ctx)

	// ── Sandbox ───────────────────────────────────────────────────────────────
	sb, err := sandbox.New(cancelCtx, cfg)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to create sandbox (kubernetes client)")
	}
	defer sb.Close()

	// ── Executor (the kafka.Handler implementation) ────────────────────────────
	exec := executor.New(cfg, sb, s3Client, producer)

	// ── Kafka consumer ────────────────────────────────────────────────────────
	// DLQ producer shares the same underlying writer; it just targets a different topic.
	dlqProducer, err := kafka.NewProducer(cfg)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to create kafka DLQ producer")
	}
	consumer, err := kafka.NewConsumer(cfg, exec, dlqProducer)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to create kafka consumer")
	}

	// ── Health endpoint ───────────────────────────────────────────────────────
	// This worker is otherwise a pure Kafka consumer with no HTTP server at
	// all, so Kubernetes has nothing to point a liveness/readiness probe at
	// without this. /healthz answers as soon as the process is up (liveness);
	// /readyz flips to 200 once the consumer goroutine has actually been
	// launched below (readiness) - separate atomics so a probe can tell
	// "process alive but still starting" apart from "actually consuming".
	var ready atomic.Bool
	healthMux := http.NewServeMux()
	healthMux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	healthMux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		if ready.Load() {
			w.WriteHeader(http.StatusOK)
		} else {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
	})
	healthServer := &http.Server{Addr: ":" + cfg.HealthPort, Handler: healthMux}
	go func() {
		if err := healthServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Warn().Err(err).Msg("health server stopped unexpectedly")
		}
	}()

	// ── Run ───────────────────────────────────────────────────────────────────
	// cancelCtx (created above, alongside the sandbox) controls both the
	// sandbox's pool goroutines and the consumer loop. On signal, we cancel
	// it and give in-flight executions time to finish before exiting.

	// Run the consumer in a goroutine; errors are fatal.
	consumerErrCh := make(chan error, 1)
	go func() {
		consumerErrCh <- consumer.Run(cancelCtx)
	}()
	ready.Store(true)

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
	ready.Store(false)
	cancel()

	shutdownHealthCtx, shutdownHealthCancel := context.WithTimeout(context.Background(), 3*time.Second)
	if err := healthServer.Shutdown(shutdownHealthCtx); err != nil {
		log.Warn().Err(err).Msg("error shutting down health server")
	}
	shutdownHealthCancel()

	// Deregister immediately rather than leaving Eureka to expire the lease
	// on its own after ~90s of missed heartbeats - keeps the dashboard
	// accurate right away.
	deregisterCtx, deregisterCancel := context.WithTimeout(context.Background(), 3*time.Second)
	if err := eurekaClient.Deregister(deregisterCtx); err != nil {
		log.Warn().Err(err).Msg("eureka: deregistration failed")
	}
	deregisterCancel()

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
