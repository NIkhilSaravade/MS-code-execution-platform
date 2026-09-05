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
	KafkaBrokers               []string
	KafkaConsumerGroupID       string
	KafkaSubmissionTopic       string
	KafkaExecutionResultTopic  string
	KafkaExecutionFailTopic    string
	KafkaDLQTopic              string
	KafkaMaxRetryAttempts      int
	KafkaDialTimeout           time.Duration
	KafkaSessionTimeout        time.Duration

	// Kafka SASL_SSL - principal "worker": read-only on the submission topic,
	// write-only on the execution-result topics (see infra/kafka/acls.sh).
	KafkaTLSCACertPath string
	KafkaSASLUsername  string
	KafkaSASLPassword  string

	// Eureka (discovery-service). EurekaAppName is what THIS worker registers
	// itself as; EurekaServerURL is used for that registration - the worker
	// no longer calls problem-service/submission-service itself (see the
	// embedded-job-payload / single-result-topic redesign), so there's
	// nothing else here to resolve through Eureka.
	EurekaServerURL string
	EurekaAppName   string

	// S3 / MinIO
	S3Endpoint        string
	S3Region          string
	S3AccessKey       string
	S3SecretKey       string
	S3BucketArtifacts string
	S3BucketTestCases string
	S3ForcePathStyle  bool

	// Sandbox resource limits (enforced per execution, not per test case)
	//
	// SandboxRuntime now names a Kubernetes RuntimeClass (e.g. "gvisor"), not
	// a Docker --runtime value - empty means "no RuntimeClass", i.e. the
	// node's default (runc). See the k3s-migration design note: gVisor is a
	// deliberately deferred, config-gated follow-up, not part of this first
	// pass, because OCI's ARM shapes likely lack the nested-virtualization
	// support gVisor's fast KVM platform needs, forcing the much slower
	// ptrace platform - exactly the same "ship on runc, matching what
	// docker-compose.yml already does in production" posture as before.
	SandboxRuntime     string
	SandboxMemoryMB    int
	SandboxCPUQuota    float64 // fractional CPUs, e.g. 1.0
	SandboxPidsLimit   int     // NOT enforced per-pod (see K8sPodPidsLimitNote) - kept only for documentation/logging parity with the old Docker config
	SandboxOutputCapKB int     // stdout+stderr combined cap
	SandboxWallTimeout time.Duration // enforced by worker, not the container

	// Kubernetes sandbox execution. Replaces the old Docker-outside-of-Docker
	// scratch-volume design entirely: sandbox.go now launches one pooled,
	// pre-warmed Pod per language via the Kubernetes API, execs into it
	// (compile once, then once per test case) via the pods/exec subresource,
	// and deletes it after the submission finishes - see internal/sandbox.
	K8sNamespace              string        // namespace sandbox pods are created in - MUST have a default-deny NetworkPolicy applied (see infra/k8s)
	K8sInCluster              bool          // true in the real cluster (reads the Pod's mounted ServiceAccount token); false + K8sKubeconfigPath for local dev against a kubeconfig
	K8sKubeconfigPath         string        // only used when K8sInCluster is false
	SandboxRuntimeClassName   string        // Kubernetes RuntimeClass name, e.g. "gvisor" - empty means the node's default runtime (runc)
	SandboxSeccompProfile     string        // path relative to the kubelet's seccomp root (/var/lib/kubelet/seccomp/<this>) - empty falls back to RuntimeDefault
	SandboxPoolSize           int           // pre-warmed idle pods kept ready per language
	SandboxPoolCheckoutTimeout time.Duration // how long to wait on an empty pool before falling back to an on-demand pod create (eating the 1-3s Pod-start latency for that one submission)
	SandboxPodStartupTimeout  time.Duration // how long a freshly-created pod is given to reach Running
	SandboxMemSamplePeriod    time.Duration // polling interval for the in-pod cgroup memory.current sampler

	// Language → Docker image mapping (loaded from env like LANG_IMAGE_PYTHON)
	LanguageImages map[string]string

	// Observability
	OTLPEndpoint string
	LogLevel     string

	// Kubernetes liveness probe. This worker otherwise has no HTTP server at
	// all (it's a pure Kafka consumer), so there's nothing else for a probe
	// to hit.
	HealthPort string
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
	cfg.KafkaExecutionResultTopic = getEnvOrDefault("KAFKA_TOPIC_EXECUTION_RESULT", "execution-result-topic")
	cfg.KafkaExecutionFailTopic = getEnvOrDefault("KAFKA_TOPIC_EXECUTIONS_FAILED", "executions.failed.v1")
	cfg.KafkaDLQTopic = getEnvOrDefault("KAFKA_TOPIC_DLQ", "dlq.submissions.created.v1")
	cfg.KafkaMaxRetryAttempts = getEnvInt("KAFKA_MAX_RETRY_ATTEMPTS", 3, &errs)
	cfg.KafkaDialTimeout = getEnvDuration("KAFKA_DIAL_TIMEOUT", 10*time.Second, &errs)
	cfg.KafkaSessionTimeout = getEnvDuration("KAFKA_SESSION_TIMEOUT", 30*time.Second, &errs)

	cfg.KafkaTLSCACertPath = getEnvOrDefault("KAFKA_TLS_CA_CERT_PATH", "/certs/ca.crt")
	cfg.KafkaSASLUsername = getEnvOrDefault("KAFKA_SASL_USERNAME", "worker")
	cfg.KafkaSASLPassword = getEnvOrDefault("KAFKA_SASL_PASSWORD", "worker-dev-secret")

	// Eureka
	cfg.EurekaServerURL = getEnvOrDefault("EUREKA_SERVER_URL", "http://localhost:8761/eureka")
	cfg.EurekaAppName = getEnvOrDefault("EUREKA_APP_NAME", "WORKER-SERVICE-GO")

	// S3 / MinIO
	cfg.S3Endpoint = getEnvOrDefault("S3_ENDPOINT", "http://localhost:9000")
	cfg.S3Region = getEnvOrDefault("S3_REGION", "us-east-1")
	cfg.S3AccessKey = getEnvOrDefault("S3_ACCESS_KEY", "minioadmin")
	cfg.S3SecretKey = getEnvOrDefault("S3_SECRET_KEY", "minioadmin")
	cfg.S3BucketArtifacts = getEnvOrDefault("S3_BUCKET_ARTIFACTS", "platform-artifacts")
	cfg.S3BucketTestCases = getEnvOrDefault("S3_BUCKET_TEST_CASES", "platform-test-cases")
	cfg.S3ForcePathStyle = getEnvBool("S3_FORCE_PATH_STYLE", true)

	// Sandbox
	cfg.SandboxRuntime = getEnvOrDefault("SANDBOX_RUNTIME_CLASS", "")
	cfg.SandboxMemoryMB = getEnvInt("SANDBOX_MEMORY_MB", 256, &errs)
	cfg.SandboxCPUQuota = getEnvFloat("SANDBOX_CPU_QUOTA", 1.0, &errs)
	cfg.SandboxPidsLimit = getEnvInt("SANDBOX_PIDS_LIMIT", 64, &errs)
	cfg.SandboxOutputCapKB = getEnvInt("SANDBOX_OUTPUT_CAP_KB", 512, &errs)
	cfg.SandboxWallTimeout = getEnvDuration("SANDBOX_WALL_TIMEOUT", 10*time.Second, &errs)

	// Kubernetes sandbox execution
	cfg.K8sNamespace = getEnvOrDefault("K8S_SANDBOX_NAMESPACE", "sandbox-execution")
	cfg.K8sInCluster = getEnvBool("K8S_IN_CLUSTER", true)
	cfg.K8sKubeconfigPath = getEnvOrDefault("KUBECONFIG_PATH", "")
	cfg.SandboxRuntimeClassName = cfg.SandboxRuntime
	cfg.SandboxSeccompProfile = getEnvOrDefault("SANDBOX_SECCOMP_PROFILE", "profiles/execution.json")
	cfg.SandboxPoolSize = getEnvInt("SANDBOX_POOL_SIZE", 3, &errs)
	cfg.SandboxPoolCheckoutTimeout = getEnvDuration("SANDBOX_POOL_CHECKOUT_TIMEOUT", 5*time.Second, &errs)
	cfg.SandboxPodStartupTimeout = getEnvDuration("SANDBOX_POD_STARTUP_TIMEOUT", 30*time.Second, &errs)
	cfg.SandboxMemSamplePeriod = getEnvDuration("SANDBOX_MEM_SAMPLE_PERIOD", 20*time.Millisecond, &errs)

	// Language → image mapping
	cfg.LanguageImages = map[string]string{
		"python": getEnvOrDefault("LANG_IMAGE_PYTHON", "python:3.12-slim"),
		// jdk, not jre - Java submissions need javac to compile, which the
		// JRE-only image doesn't have. Never caught before since this was
		// the first Java submission ever run through this worker.
		"java": getEnvOrDefault("LANG_IMAGE_JAVA", "eclipse-temurin:21-jdk-alpine"),
		// gcc has no "-slim" variant on Docker Hub (only bare version tags) -
		// "gcc:14-slim" doesn't exist and every C++ submission failed to
		// even start a container until this was caught.
		"cpp":        getEnvOrDefault("LANG_IMAGE_CPP", "gcc:14"),
		"c":          getEnvOrDefault("LANG_IMAGE_C", "gcc:14"),
		"javascript": getEnvOrDefault("LANG_IMAGE_JAVASCRIPT", "node:20-slim"),
		// Locally-built image (docker build -t platform/node-typescript:20
		// infra/sandbox-images/node-typescript) - no official image ships
		// both Node and tsc, and the sandbox's --network none rules out
		// installing typescript at request time. Must be built once before
		// this default resolves to a real image.
		"typescript": getEnvOrDefault("LANG_IMAGE_TYPESCRIPT", "platform/node-typescript:20"),
		"go":         getEnvOrDefault("LANG_IMAGE_GO", "golang:1.22-alpine"),
	}

	// Observability
	cfg.OTLPEndpoint = getEnvOrDefault("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
	cfg.LogLevel = getEnvOrDefault("LOG_LEVEL", "info")

	cfg.HealthPort = getEnvOrDefault("HEALTH_PORT", "8091")

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
