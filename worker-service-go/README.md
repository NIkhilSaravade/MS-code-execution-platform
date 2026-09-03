# worker-service-go

The execution plane of the Code Execution Platform. Pulls submission jobs from
Kafka, runs user code inside hardened sandbox containers, and publishes execution
results back to Kafka. The only worker in the platform — a legacy Java worker
that ran side by side with this one for comparison has been removed.

Written in Go 1.22 for lightweight concurrency and fast startup — both matter
when autoscaling a worker fleet under burst load.

---

## Architecture

```
Kafka: submissions.created.v1
(submission-service has already embedded test cases, limits, and the
 harness-glued code into this event - no problem-service/submission-service
 call happens below)
        │
        ▼
┌──────────────────────────────────────────────────────┐
│  Consumer (kafka/consumer.go)                        │
│  • Manual offset commit after handler returns        │
│  • Extracts W3C trace context from record headers    │
│  • Routes to DLQ on unrecoverable parse errors       │
└──────────────┬───────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────┐
│  Executor (executor/executor.go)                     │
│  1. Download code + tests → S3 / MinIO               │
│  2. Run each test case    → Sandbox                  │
│  3. Aggregate verdict                                │
│  4. Upload artifacts      → S3                       │
│  5. Publish result event  → Kafka                    │
└──────────────┬───────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────┐
│  Sandbox (sandbox/sandbox.go)                        │
│  • Fresh Docker container per test case              │
│  • --runtime runsc (gVisor) by default - the shipped │
│    docker-compose.yml pins runc since gVisor isn't   │
│    installed on the host by default                  │
│  • --network none                                    │
│  • --read-only rootfs                                │
│  • --cap-drop ALL                                    │
│  • --user 65534:65534                                │
│  • --memory, --cpus, --pids-limit                    │
│  • Wall-clock timeout enforced by host process        │
│  • Output size cap (default 512 KB)                  │
│  • Restrictive seccomp profile                       │
└──────────────────────────────────────────────────────┘
               │
               ▼
Kafka: execution-result-topic  →  execution-result-service (the single
                                    ingestion point for a judged result;
                                    it fans out to submission-service and
                                    ai-analysis-service on its own topics)
Kafka: executions.failed.v1    →  worker-side infra-failure reporting
Kafka: dlq.submissions.created.v1 → unrecoverable submission events
```

### Why no database?

The worker has **no durable state**. The dual-write problem (write DB + publish
Kafka atomically) doesn't apply here because there's no business state to
persist — only the execution result, which goes directly to Kafka.

The idempotent Kafka producer (`RequireAll` acks, `MaxAttempts=5`) provides
at-least-once delivery. execution-result-service is idempotent on
`submission_id`.

---

## Security model

Every submission is treated as hostile code. The sandbox enforces:

| Control | Mechanism |
|---|---|
| Kernel isolation | gVisor (`--runtime runsc`) user-space kernel |
| No network | `--network none` + network namespace |
| No filesystem escape | `--read-only` rootfs + tmpfs for `/tmp` only |
| No privilege escalation | `--cap-drop ALL` + `--security-opt no-new-privileges` |
| Syscall filtering | Restrictive seccomp profile (`docker/seccomp/execution.json`) |
| Memory bomb | `--memory` + `--memory-swap` (no swap) |
| Fork bomb | `--pids-limit 64` |
| Infinite loop | Wall-clock timeout in host process (not container) |
| Output flood | `cappedBuffer` truncates stdout+stderr at 512 KB |
| Compiler bomb | Compilation runs in same sandbox with same limits |

---

## Configuration

All configuration is read from environment variables. See `internal/config/config.go`
for the full list. Key variables:

| Variable | Default | Description |
|---|---|---|
| `KAFKA_BROKERS` | `localhost:9092` | Comma-separated broker list |
| `SANDBOX_RUNTIME` | `runsc` | Docker runtime (`runsc` for gVisor, `runc` for plain — `docker-compose.yml` overrides this to `runc`) |
| `SANDBOX_MEMORY_MB` | `256` | Per-container memory cap |
| `SANDBOX_WALL_TIMEOUT` | `10s` | Wall-clock execution timeout |
| `S3_ENDPOINT` | `http://localhost:9000` | MinIO / S3 endpoint |
| `EUREKA_SERVER_URL` | `http://localhost:8761/eureka` | Registers for dashboard visibility only - not used to resolve any other service |

No `SUBMISSION_SERVICE_URL`/`PROBLEM_SERVICE_URL` - this worker doesn't call either service directly (see Architecture above).

---

## Running locally

```bash
# Bring up the full compose stack from the repo root first:
cd ../..
docker compose up -d

# Then run the worker:
cd worker-service-go
make run-with-env
```

To test with plain Docker instead of gVisor (local dev without gVisor installed):
```bash
SANDBOX_RUNTIME=runc make run-with-env
```

---

## Building

```bash
make build          # compile binary to bin/worker
make docker-build   # build Docker image
make test           # run all tests with -race
make check          # fmt + vet + lint + test
```

---

## Observability

- **Traces**: every submission spans from consumer → executor → sandbox → Kafka
  publish, exported via OTLP HTTP. No collector is deployed in
  `docker-compose.yml` yet, so these currently have nowhere to land in the
  default stack - point `OTEL_EXPORTER_OTLP_ENDPOINT` at a real collector
  (e.g. Jaeger/Tempo) to see them.
- **Logs**: structured JSON on stdout, includes `submission_id`, `user_id`,
  `verdict`, `wall_time_ms` on every completion log line.
- **Metrics**: (planned) Prometheus client exposing submission rate, verdict
  distribution, sandbox execution p99, worker queue lag.
