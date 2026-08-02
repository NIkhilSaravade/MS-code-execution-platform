package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds every setting the worker service needs. All values come from
// environment variables; no hardcoded production credentials anywhere.
type Config struct {
	// Service identity
	ServiceName    string
	ServiceVersion string
	WorkerID       string

	// Kafka
	KafkaBrokers             []string
	KafkaConsumerGroupID     string
	KafkaSubmissionTopic     string
	KafkaExecutionDoneTopic  string
	KafkaExecutionFailTopic  string
	KafkaDLQTopic            string
	KafkaMaxRetryAttempts    int
	KafkaDialTimeout         time.Duration
	KafkaSessionTimeout      time.Duration

	// Upstream service URLs
	SubmissionServiceBaseURL string
	ProblemServiceBaseURL    string

	// Service identity for calls to problem-service/submission-service.
	// The worker authenticates as itself via OAuth2 client-credentials
	// (see internal/auth), not with a user's token - it has none to forward.
	AuthServiceBaseURL string
	WorkerClientID     string
	WorkerClientSecret string

	// S3 / MinIO
	S3Endpoint        string
	S3Region          string
	S3AccessKey       string
	S3SecretKey       string
	S3BucketArtifacts string
	S3BucketTestCases string
	S3ForcePathStyle  bool

	// Sandbox resource limits (enforced per execution, not per test case)
	SandboxRuntime      string        // "runsc" for gVisor, "runc" for plain Docker
	SandboxMemoryMB     int
	SandboxCPUQuota     float64       // fractional CPUs, e.g. 1.0
	SandboxPidsLimit    int
	SandboxOutputCapKB  int           // stdout+stderr combined cap
	SandboxWallTimeout  time.Duration // enforced by worker, not the container

	// Language → Docker image mapping (loaded from env like LANG_IMAGE_PYTHON)
	LanguageImages map[string]string

	// Observability
	OTLPEndpoint string
	LogLevel     string
}

// Load reads all config from the environment. Returns an error if any required
// variable is missing or cannot be parsed.
func Load() (*Config, error) {
	cfg := &Config{}
	var errs []string

	cfg.ServiceName = getEnvOrDefault("SERVICE_NAME", "worker-service")
	cfg.ServiceVersion = getEnvOrDefault("SERVICE_VERSION", "dev")
	cfg.WorkerID = getEnvOrDefault("WORKER_ID", mustHostname())

	// Kafka
	brokerStr := getEnvOrDefault("KAFKA_BROKERS", "localhost:9092")
	cfg.KafkaBrokers = strings.Split(brokerStr, ",")
	cfg.KafkaConsumerGroupID = getEnvOrDefault("KAFKA_CONSUMER_GROUP_ID", "worker-service-cg")
	cfg.KafkaSubmissionTopic = getEnvOrDefault("KAFKA_TOPIC_SUBMISSIONS_CREATED", "submissions.created.v1")
	cfg.KafkaExecutionDoneTopic = getEnvOrDefault("KAFKA_TOPIC_EXECUTIONS_COMPLETED", "executions.completed.v1")
	cfg.KafkaExecutionFailTopic = getEnvOrDefault("KAFKA_TOPIC_EXECUTIONS_FAILED", "executions.failed.v1")
	cfg.KafkaDLQTopic = getEnvOrDefault("KAFKA_TOPIC_DLQ", "dlq.submissions.created.v1")
	cfg.KafkaMaxRetryAttempts = getEnvInt("KAFKA_MAX_RETRY_ATTEMPTS", 3, &errs)
	cfg.KafkaDialTimeout = getEnvDuration("KAFKA_DIAL_TIMEOUT", 10*time.Second, &errs)
	cfg.KafkaSessionTimeout = getEnvDuration("KAFKA_SESSION_TIMEOUT", 30*time.Second, &errs)

	// Upstream services
	cfg.SubmissionServiceBaseURL = getEnvOrDefault("SUBMISSION_SERVICE_URL", "http://localhost:8083")
	cfg.ProblemServiceBaseURL = getEnvOrDefault("PROBLEM_SERVICE_URL", "http://localhost:8082")

	// Service identity (client-credentials grant against auth-service)
	cfg.AuthServiceBaseURL = getEnvOrDefault("AUTH_SERVICE_URL", "http://localhost:8086")
	cfg.WorkerClientID = getEnvOrDefault("WORKER_CLIENT_ID", "worker-service")
	cfg.WorkerClientSecret = getEnvOrDefault("WORKER_CLIENT_SECRET", "dev-only-secret-change-me")

	// S3 / MinIO
	cfg.S3Endpoint = getEnvOrDefault("S3_ENDPOINT", "http://localhost:9000")
	cfg.S3Region = getEnvOrDefault("S3_REGION", "us-east-1")
	cfg.S3AccessKey = getEnvOrDefault("S3_ACCESS_KEY", "minioadmin")
	cfg.S3SecretKey = getEnvOrDefault("S3_SECRET_KEY", "minioadmin")
	cfg.S3BucketArtifacts = getEnvOrDefault("S3_BUCKET_ARTIFACTS", "platform-artifacts")
	cfg.S3BucketTestCases = getEnvOrDefault("S3_BUCKET_TEST_CASES", "platform-test-cases")
	cfg.S3ForcePathStyle = getEnvBool("S3_FORCE_PATH_STYLE", true)

	// Sandbox
	cfg.SandboxRuntime = getEnvOrDefault("SANDBOX_RUNTIME", "runsc")
	cfg.SandboxMemoryMB = getEnvInt("SANDBOX_MEMORY_MB", 256, &errs)
	cfg.SandboxCPUQuota = getEnvFloat("SANDBOX_CPU_QUOTA", 1.0, &errs)
	cfg.SandboxPidsLimit = getEnvInt("SANDBOX_PIDS_LIMIT", 64, &errs)
	cfg.SandboxOutputCapKB = getEnvInt("SANDBOX_OUTPUT_CAP_KB", 512, &errs)
	cfg.SandboxWallTimeout = getEnvDuration("SANDBOX_WALL_TIMEOUT", 10*time.Second, &errs)

	// Language → image mapping
	cfg.LanguageImages = map[string]string{
		"python": getEnvOrDefault("LANG_IMAGE_PYTHON", "python:3.12-slim"),
		"java":   getEnvOrDefault("LANG_IMAGE_JAVA", "eclipse-temurin:21-jre-alpine"),
		"cpp":    getEnvOrDefault("LANG_IMAGE_CPP", "gcc:14-slim"),
	}

	// Observability
	cfg.OTLPEndpoint = getEnvOrDefault("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
	cfg.LogLevel = getEnvOrDefault("LOG_LEVEL", "info")

	if len(errs) > 0 {
		return nil, fmt.Errorf("config errors: %s", strings.Join(errs, "; "))
	}
	return cfg, nil
}

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------

func getEnvOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int, errs *[]string) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		*errs = append(*errs, fmt.Sprintf("%s=%q is not an integer", key, v))
		return fallback
	}
	return n
}

func getEnvFloat(key string, fallback float64, errs *[]string) float64 {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		*errs = append(*errs, fmt.Sprintf("%s=%q is not a float", key, v))
		return fallback
	}
	return f
}

func getEnvDuration(key string, fallback time.Duration, errs *[]string) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		*errs = append(*errs, fmt.Sprintf("%s=%q is not a duration", key, v))
		return fallback
	}
	return d
}

func getEnvBool(key string, fallback bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return fallback
	}
	return b
}

func mustHostname() string {
	h, err := os.Hostname()
	if err != nil {
		return "unknown-worker"
	}
	return h
}
