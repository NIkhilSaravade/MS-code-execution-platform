
# MS Code Execution Platform

A LeetCode-style competitive coding platform built with a microservices architecture. Users can solve coding problems, submit solutions in **7 languages** (Python, Java, C++, C, JavaScript, TypeScript, Go), and receive AI-powered feedback on their code.

> **Frontend:** A React (Vite + TypeScript) frontend lives in `frontend/` — landing page, practice list, and a Monaco-editor-based solve page with Run/Submit. It is **not** part of `docker-compose.yml`; run it separately with `npm run dev` once the backend stack is up. Every API below is also usable directly (curl/Postman) through the gateway.

---

## Architecture Overview

The platform consists of **8 Java/Spring Boot services**, **1 Go service**, **1 Python FastAPI service**, and **1 React frontend**, orchestrated via Spring Cloud + Eureka, with a fully containerized backend infrastructure stack (Postgres, MinIO, Kafka).

```
Frontend (React/Vite, :5173, run separately)
   │
   ▼
Client
   │
   ▼
API Gateway (:8080)  ←── OAuth2 Resource Server (RS256 / JWKS)
   │
   ├── Auth-Service (:8086)         — login/register/refresh, JWKS, client-credentials
   ├── User-Service (:8081, gRPC 9090) — user CRUD, roles, admin bootstrap
   ├── Problem-Service (:8082)      — problem CRUD, test cases (MinIO-backed),
   │                                  per-language harness generation
   └── Submission-Service (:8083)   — fetches + embeds harness/test cases/limits
             │
   [Kafka: submissions.created.v1 — carries the test cases/limits inline,
    not just the code]
             │
      Worker-Service-Go (no HTTP port, Go)
      — no problem-service call per submission; computes its own static
        time/space complexity estimate from the user's code
             │
      [Kafka: execution-result-topic]
             │
     Execution-Result-Service (:8085)  — single source of truth
     for judged results
             │
        ┌────┴─────┐
        ▼          ▼
 [Kafka:            [Kafka: analysis.trigger.v1]
  submission-               │
  update-topic]             ▼
        │            AI-Analysis-Service (:8000)
        ▼            └── Groq LLM + pgvector RAG + Eureka
 Submission-Service          own JWT verification, own Kafka
 (status only)                consumer — auto-runs on every
                               judged submission, not just
                               on a manual POST /ai/analyze
```

**Service Registry:** Eureka (`discovery-service`, :8761) — `worker-service-go` registers for dashboard visibility only; it no longer resolves anything through Eureka (submission-service embeds everything a worker needs into the Kafka event).
**Centralized Config:** Spring Cloud Config Server (`config-service`, :8888) — currently unused by any service; kept for future adoption.

**Result pipeline (see [Complexity & AI Analysis](#complexity--ai-analysis-of-a-submission)):** `worker-service-go` publishes to a single topic, `execution-result-topic`; `execution-result-service` persists the full result (including wall-time, memory, and the worker's own complexity estimate) and is the only thing `submission-service` and `ai-analysis-service` hear back from.

---

## Features

- **Centralized Auth** — RS256/JWKS-based JWTs issued by `auth-service`; every business service independently validates tokens as its own OAuth2 resource server
- **Role-based Access + Admin Provisioning** — idempotent admin seeding at startup, admin-only role promotion endpoint
- **Problem Management** — Create and browse coding problems with test cases stored in MinIO/S3
- **Generated Judging Harnesses** — Admins author a language-agnostic function signature once; `problem-service` auto-generates real, runnable boilerplate (stdin→typed args→call→JSON stdout) for every supported language, so users submit a plain `class Solution { ... }`/function instead of a full script
- **7-Language Code Execution** — Python, Java, C++, C, JavaScript, TypeScript, and Go run in isolated, resource-capped, network-isolated Docker sandboxes (seccomp profile, non-root, cap-drop, `--pids-limit`)
- **Run vs Submit** — "Run" judges only a problem's visible/sample test cases; "Submit" judges everything, hidden cases included — every test case is always evaluated and reported (no short-circuit on first failure)
- **Async Verdict Pipeline** — Kafka-driven submission → execution → result flow, with TLS + SASL + ACLs on Kafka and a dead-letter queue on the Go worker; `execution-result-service` is the single source of truth for a judged result (output, per-test-case breakdown, runtime, memory)
- **Deterministic Complexity Estimate** — `worker-service-go` statically analyzes the user's own submitted code (loop nesting, recursion, sort calls, sized allocations) to estimate time/space Big-O, independent of and always available regardless of the LLM
- **AI Code Analysis** — RAG-powered LLM feedback (including its own, richer complexity guess, optimization suggestions, and code smells) for both passing and failing submissions, auto-triggered right after judging and cached in PostgreSQL
- **Hardened Data Layer** — Flyway-managed schemas, least-privilege DB roles, TLS-only Postgres connections
- **Unified API Gateway** — Single entry point, JWT resource server

---

## Services

| Service | Language | Port | Description |
|---|---|---|---|
| `discovery-service` | Java | 8761 | Eureka service registry |
| `config-service` | Java | 8888 | Centralized config server (currently unused) |
| `auth-service` | Java | 8086 | Token issuance, JWKS, client-credentials grants |
| `user-service` | Java | 8081 (+ gRPC 9090) | User CRUD, roles, admin bootstrap |
| `problem-service` | Java | 8082 | Problem CRUD, test case storage (MinIO), per-language harness generation |
| `submission-service` | Java | 8083 | Accepts submissions, applies the generated harness, fetches + embeds test cases/limits, publishes to Kafka; tracks only lifecycle/status (result detail lives in `execution-result-service`) |
| `worker-service-go` | Go | 8091 (health only) | Docker/sandbox code executor, Kafka consumer + DLQ producer; computes its own static time/space complexity estimate and reports timing/memory |
| `execution-result-service` | Java | 8085 | Single source of truth for judged results (output, per-test-case breakdown, timing, memory, complexity estimate); notifies `submission-service` (status) and `ai-analysis-service` (auto-trigger) via Kafka |
| `ai-analysis-service` | Python | 8000 | FastAPI — LLM code analysis with RAG; now also a Kafka consumer, auto-triggered per judged submission |
| `api-gateway` | Java | 8080 | JWT resource server + reverse proxy |
| `frontend` | React/Vite/TypeScript | 5173 (dev) | Landing page, practice list, Monaco-based solve page. Run separately, not in `docker-compose.yml`. |

A legacy Java worker (`worker-service`) previously ran side by side with `worker-service-go` for a performance comparison. It had no sandbox resource limits or network isolation on submitted code and was removed rather than hardened, since `worker-service-go`'s sandbox (seccomp profile, `--network none`, `--cap-drop ALL`, non-root, `--pids-limit`) was already the production path.

---

## Tech Stack

**Backend (Java)**
- Spring Boot 3.5.11, Spring Cloud 2025.0.1
- Spring Cloud Gateway (WebFlux), Eureka, OpenFeign, gRPC
- Apache Kafka (Confluent 7.5.0, Zookeeper-based, SASL_SSL + ACLs)
- PostgreSQL (one DB per service, Flyway migrations, `ddl-auto=validate`, TLS-only)
- JWT via jjwt 0.13.0 (RS256, JWKS)
- Docker Java client 3.3.4 (`docker-java-transport-zerodep`)

**Worker (Go)**
- Go 1.22, AWS SDK v2 (S3/MinIO), `segmentio/kafka-go`, `rs/zerolog`
- OpenTelemetry SDK + OTLP-HTTP exporter
- seccomp profile, configurable sandbox runtime (`runc` default)
- Hand-written Eureka REST client (`internal/eureka`) — no first-party Go Eureka client exists

**Frontend (React)**
- React 19, TypeScript, Vite
- `react-router-dom` v7 (client-side routing)
- `@monaco-editor/react` (the solve page's code editor)
- `three` (landing page visuals)

**AI Service (Python)**
- FastAPI, LangChain (via `litellm`), Groq LLM
- pgvector (Postgres-backed vector store for RAG context retrieval)
- `py-eureka-client` for service discovery, PyJWT/`PyJWKClient` for JWT verification
- PostgreSQL for analysis result caching

**Infrastructure**
- Docker Compose: Postgres, MinIO, Kafka + Zookeeper + Kafka UI, plus every backend application service (frontend excluded — run separately)
- Object storage: MinIO (`platform-test-cases`, `platform-artifacts` buckets)
- Sandbox execution images — see [Supported Languages](#supported-languages) below

---

## Getting Started

### Prerequisites

- Java 17+ and Maven (or the `./mvnw` wrapper in each service)
- Go 1.22+ (for `worker-service-go`)
- Node.js + npm (for the frontend)
- Docker Desktop running
- Python 3.10+
- A Groq API key (`ai-analysis-service` will not start without one)

### 1. Configure environment

```bash
cp .env.example .env
```

Fill in the required secrets: Postgres per-service passwords, `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`, `ADMIN_EMAIL`/`ADMIN_PASSWORD`, `WORKER_SERVICE_CLIENT_SECRET`, `SUBMISSION_SERVICE_CLIENT_SECRET`, `AI_ANALYSIS_SERVICE_CLIENT_SECRET`, Kafka per-identity SASL passwords (including `KAFKA_AI_ANALYSIS_SERVICE_PASSWORD`), `GROQ_API_KEY`, and `GITHUB_PASSWORD` (required for `config-service` to start, even though nothing consumes it yet). `ACTIVE_WORKER` (`java`/`go`, default `go`) picks which worker judges new submissions — see [THE WORKER SWITCH](#the-worker-switch).

### 2. Build the TypeScript sandbox image (one-time)

TypeScript submissions run in a locally-built image (no official Docker image ships both Node and `tsc`, and the sandbox can't `npm install` at request time since it runs with `--network none`):

```bash
docker build -t platform/node-typescript:20 infra/sandbox-images/node-typescript
```

Every other language's sandbox image (`python`, `eclipse-temurin`, `gcc`, `node`, `golang`) is pulled automatically from Docker Hub on first use — no other manual image step needed.

### 3. Start the full backend stack

```bash
docker-compose up -d
```

This brings up: Postgres (TLS, per-service roles), MinIO, Zookeeper/Kafka (SASL_SSL + ACLs), Kafka UI, `discovery-service`, `config-service`, `auth-service`, `user-service`, `problem-service`, `submission-service`, both workers, `execution-result-service`, `ai-analysis-service`, and `api-gateway`.

Databases, roles, Kafka topics/ACLs, and MinIO buckets are all provisioned automatically by one-shot init containers (`infra/postgres/init-multiple-databases.sh`, `kafka-init`, `minio-init`) — no manual `CREATE DATABASE` step required.

### 4. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. It talks to the backend through the gateway at `http://localhost:8080`.

### 5. Running a backend service outside Docker (for development)

```bash
# Java service
cd <service-dir> && ./mvnw spring-boot:run

# Go worker
cd worker-service-go && go run ./cmd/worker

# Python AI service
cd ai-analysis-service
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirnments.txt
python main.py
```

Point it at the Dockerized dependencies (Postgres, Kafka, MinIO, discovery-service, auth-service) via the same env vars used in `docker-compose.yml`.

---

## API Reference

All requests go through the API Gateway at `http://localhost:8080`. Most endpoints require `Authorization: Bearer <token>`.

### Auth (`auth-service`)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/register` | Register a new user |
| POST | `/auth/login` | Login and receive an access + refresh token |
| POST | `/auth/refresh` | Exchange a refresh token for a new access token |
| POST | `/auth/token` | OAuth2 client-credentials grant (service-to-service) |
| GET | `/auth/.well-known/jwks.json` | Public keys for JWT verification |

### Users (`user-service`)

| Method | Endpoint | Description |
|---|---|---|
| PATCH | `/users/{email}/role` | Promote/change a user's role (ADMIN-only) |

### Problems (`problem-service`)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/problems` | Create a problem (ADMIN-only). Optionally include a `signature` (function name, typed params, return type) to auto-generate a per-language judging harness. |
| GET | `/problems/getAll?page=0&size=10` | Paginated problem list |
| GET | `/problems/{problemId}` | Get problem metadata (includes `harnessByLanguage` if a signature was given) |
| POST | `/problems/{problemId}/harness/regenerate` | Re-run every currently-registered language's harness generator against the problem's stored signature (ADMIN-only). Use this to backfill an existing problem after a new language is added. |

### Submissions (`submission-service`)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/submissions` | Submit code for execution. Body: `{ userId, problemId, code, language, includeHidden }` — `includeHidden: false` = "Run" (visible test cases only), `true`/omitted = "Submit" (all test cases, hidden included). |
| GET | `/submissions/{id}` | Get a submission by ID (caller must own it) — `status` only (`PENDING` → `PASSED`/`FAILED`/etc). Result detail (output, per-test-case breakdown, timing) now lives in `execution-result-service`, not here. |
| GET | `/submissions/user/{userId}` | Get all submissions for a user (caller's JWT subject must match `userId`) |

### Execution Results (`execution-result-service`)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/results/{submissionId}` | The full judged-result detail once `GET /submissions/{id}`'s status goes terminal: `output`, `reason`, `testCaseResults`, `wallTimeMs`, `maxMemoryKb`, `estimatedTimeComplexity`, `estimatedSpaceComplexity` (see [Complexity & AI Analysis](#complexity--ai-analysis-of-a-submission)). Object-level authz, same "caller must own it" rule as submissions. |

### AI Analysis (`ai-analysis-service`)

Routed through the gateway at `/ai/**`.

| Method | Endpoint | Description |
|---|---|---|
| POST | `/ai/analyze` | Get AI feedback on a submission (forwards the caller's own token). Cache-checked first; a cache hit from the auto-trigger below usually means this returns instantly. |
| GET | `/ai/analysis/{submissionId}` | Cache-only lookup — what the frontend actually polls. Returns `{"status": "PENDING"}` until the auto-triggered analysis (see below) has landed, then `{"status": "READY", "analysis": {...}, "source": "AI" \| "CACHE"}`. Object-level authz (the caller must own the submission). |

**POST /ai/analyze request body:**
```json
{ "submissionId": 123 }
```

---

## Code Execution Flow

1. Client POSTs to `/submissions` with `{ problemId, userId, code, language, includeHidden }`.
2. `submission-service` saves the submission (`status: PENDING`), fetches the problem's generated harness for that language (if any) and glues it to the user's code, then also fetches the problem's test cases + judging limits (`InternalProblemClient`, one extra call to `problem-service`'s internal API) and embeds all of it, plus the user's *original* (pre-harness) code, into the Kafka event. Publishes to `submissions.created.v1`.
3. `worker-service-go` consumes the message and runs the harness-glued code in an isolated sandbox, one test case at a time (filtered to visible-only if `includeHidden` was `false`). **It never calls `problem-service` itself** — everything it needs was already in the event.
4. Each test case's output is compared against its expected output; every case is always run and reported (no short-circuit on first failure), producing per-case `PASSED`/`FAILED`/`TLE`/`MLE`/`RE`/`CE` results and an overall verdict. It also measures wall-time (and best-effort peak memory via `docker stats`) per test case, and runs a static complexity analysis on the user's original code (see below). Infra-level failures are also published to a dead-letter queue.
5. It publishes the result to `execution-result-topic` — the single ingestion point.
6. `execution-result-service` consumes and persists the full result (output, per-test-case breakdown, timing/memory, complexity estimate). It then publishes two lightweight Kafka events: `submission-update-topic` (consumed by `submission-service`, which flips its own `status` column) and `analysis.trigger.v1` (consumed by `ai-analysis-service`, which runs its LLM analysis automatically).
7. Client polls `GET /submissions/{id}` for status; once terminal, fetches `GET /api/results/{submissionId}` for the full detail, and separately/non-blockingly polls `GET /ai/analysis/{submissionId}` for the LLM verdict.

### Complexity & AI Analysis of a submission

Two independent layers, so a slow or unreachable AI service never blocks the deterministic result:

- **`worker-service-go`'s own estimate** (`internal/complexity`) — a deterministic, static structural analysis of the user's *original* submitted code: loop nesting depth, recursion (and whether it's linear or branching), sort-call usage, sized-allocation detection. Classifies into standard Big-O buckets (`O(1)` … `O(n^3)`, `O(2^n)` for branching recursion). No LLM, no network call, always produces an answer — this replaced an earlier timing-based regression across test cases that degraded to "insufficient data" for most problems (too few test cases with too little size variation to fit a meaningful curve). Surfaced via `GET /api/results/{submissionId}`'s `estimatedTimeComplexity`/`estimatedSpaceComplexity`.
- **`ai-analysis-service`'s LLM verdict** — a Groq-backed, RAG-grounded analysis returning its own (richer, natural-language) `timeComplexity`/`spaceComplexity` plus optimization suggestions and code smells (passed submissions) or a likely failure reason, debugging suggestion, and edge cases (failed submissions). Auto-triggered by `execution-result-service`'s `analysis.trigger.v1` event — `ai-analysis-service` authenticates to `submission-service`/`problem-service` as itself (OAuth2 client-credentials, no end-user token to forward from a Kafka trigger) to fetch what it needs, then caches the result by `submission_id`. Surfaced via `GET /ai/analysis/{submissionId}`.

The frontend's Solve page renders these as two separate console tabs — **Complexity** (the worker's own estimate + runtime/memory) and **AI Analysis** (the LLM verdict).

### How the harness system works

An admin creates a problem with an optional `signature` — e.g. for Two Sum: function name `twoSum`, params `nums: int[]`, `target: int`, return `int[]`. `problem-service` runs every registered `HarnessGenerator` against that signature and stores the result per language (`harnessByLanguage`). At submission time, `submission-service` glues the right language's harness to the user's raw code (with a small language-specific preamble — imports/includes/package declaration — prepended where the language requires it) before it's judged. A problem with no signature still works as a plain stdin/stdout script judge.

### Supported Languages

| Language | Sandbox image | Compiled? |
|---|---|---|
| Python | `python:3.12-slim` | No |
| Java | `eclipse-temurin:21-jdk-alpine` | Yes |
| C++ | `gcc:14` | Yes |
| C | `gcc:14` | Yes |
| JavaScript | `node:20-slim` | No |
| TypeScript | `platform/node-typescript:20` (locally built — see [step 2](#2-build-the-typescript-sandbox-image-one-time)) | Yes (`tsc`) |
| Go | `golang:1.22-alpine` | Yes |

---

## Authentication & Authorization

- JWTs are RS256, issued by `auth-service`, verified independently by every other business service against `auth-service`'s JWKS endpoint (issuer `https://auth-service`, audience `ms-code-execution`).
- `auth-service` and `user-service` communicate over gRPC (port 9090).
- Machine-to-machine calls (`submission-service` calling `problem-service` for a harness + test cases/limits, `ai-analysis-service` calling `submission-service`/`problem-service` when triggered by Kafka rather than a forwarded user request) use OAuth2 client-credentials tokens obtained from `POST /auth/token`. Registered clients: `submission-service`, `ai-analysis-service` (`service-clients.clients.*` in `auth-service`).
- `user-service` seeds a single admin account idempotently at startup (`ADMIN_EMAIL`/`ADMIN_PASSWORD`); that admin can promote other users via `PATCH /users/{email}/role`, and is required to call `POST /problems`/`POST /problems/{id}/harness/regenerate`.
- Object-level access control: `/submissions/{id}`, `/api/results/{submissionId}`, and `/ai/analysis/{submissionId}` are all scoped to the requesting user (404, not 403, on mismatch); `/submissions/user/{userId}` requires the JWT subject to match `userId`.

---

## AI Analysis Service

The AI service uses a **RAG (Retrieval-Augmented Generation)** pipeline:

1. Retrieves relevant context from **pgvector** using the problem description as a query
2. Selects a prompt template based on submission status (`PASSED` or `FAILED`)
3. Invokes **Groq LLM** via LangChain with the code, problem, and retrieved context
4. Caches the result in PostgreSQL to avoid redundant LLM calls
5. Returns structured JSON feedback (for `PASSED`: `timeComplexity`, `spaceComplexity`, `optimizationSuggestions`, `codeSmells`, `alternativeApproach`; for `FAILED`: `failureReason`, `debuggingSuggestion`, `edgeCases`, `hints`)

It also independently verifies incoming JWTs (PyJWT + `PyJWKClient` against `auth-service`'s JWKS) rather than trusting the caller.

**Two trigger paths, one pipeline:** `POST /ai/analyze` (manual, forwards the caller's own JWT) and an `aiokafka` consumer on `analysis.trigger.v1` (automatic, fired by `execution-result-service` right after judging — no end-user token to forward, so this path authenticates as the service itself via OAuth2 client-credentials, see `auth/token_client.py`) both funnel through the same cache-check → LLM-call → persist logic (`services/analysis_pipeline.py`). `GET /ai/analysis/{submissionId}` is a cache-only read for the frontend to poll.

---

## Project Structure

```
MS-code-execution-platform/
├── docker-compose.yml           # Backend stack: Postgres, MinIO, Kafka, and every backend service
├── .env.example                 # Required secrets/config for the stack
├── infra/
│   ├── kafka/                   # ACLs, JAAS config, TLS certs, kafka-init script
│   ├── postgres/                # Per-service DB/role init, TLS config
│   └── sandbox-images/
│       └── node-typescript/     # Dockerfile for the locally-built TypeScript sandbox image
├── api-gateway/                 # Spring Cloud Gateway + JWT resource server
├── discovery-service/           # Eureka server
├── config-service/               # Spring Cloud Config server (currently unused)
├── auth-service/                # Token issuance, JWKS, client-credentials
├── user-service/                # User CRUD, roles, admin bootstrap, gRPC
├── problem-service/             # Problems + test cases (MinIO-backed) + harness generation
│   └── src/main/java/.../harness/  # One HarnessGenerator per language + JSON-helper resources
├── submission-service/          # Submission intake, harness application, embeds test cases/
│   │                             # limits (InternalProblemClient), Kafka producer + status consumer
├── worker-service-go/           # Go sandbox code executor + Kafka consumer/DLQ
│   └── internal/complexity/     # Static time/space complexity analysis (no problem-service
│                                 # calls left in this worker - everything comes in the job event)
├── execution-result-service/    # Single source of truth for judged results; Kafka consumer
│                                 # (execution-result-topic) + two producers (submission-update-topic,
│                                 # analysis.trigger.v1)
├── ai-analysis-service/         # Python FastAPI + LangChain RAG
│   ├── main.py
│   ├── security/                # JWT verification (JWKS)
│   ├── auth/                    # Service-to-service OAuth2 client-credentials (Kafka trigger path)
│   ├── kafka/                   # analysis.trigger.v1 consumer (aiokafka)
│   ├── services/                # analysis_pipeline.py (shared cache/LLM/persist logic)
│   ├── prompts/
│   ├── discovery/
│   └── db/
├── frontend/                     # React/Vite/TypeScript — landing page, practice list, solve page
│   └── src/
│       ├── pages/                # LandingPage, PracticePage, SolvePage, LoginPage, SignupPage
│       ├── components/
│       ├── api/                  # Backend client (auth, problems, submissions, execution results,
│       │                         # AI analysis)
│       └── data/                 # Problem catalog + starter code per language
└── docker-code/                 # Temp container artifacts (worker output)
```

---

## Development

### Run Tests

```bash
# Java service tests (run from service directory)
./mvnw test
./mvnw test -Dtest=ClassName

# Go worker tests
cd worker-service-go && go test ./...

# Frontend type-check
cd frontend && npx tsc --noEmit
```

### Build for Production

```bash
# Java service
./mvnw clean install -DskipTests

# Go worker
cd worker-service-go && go build ./...

# Frontend
cd frontend && npm run build
```

### Kafka UI

Monitor topics and messages at [http://localhost:8090](http://localhost:8090) (connects via SASL_SSL).

### Eureka Dashboard

View registered services at [http://localhost:8761](http://localhost:8761) — `WORKER-SERVICE-GO` should appear.

### MinIO Console

Browse buckets at [http://localhost:9001](http://localhost:9001).

---

## Known Gaps / Follow-ups

- `config-service` is deployed but not consumed by any service yet.
- Kafka admin credentials are hardcoded in `infra/kafka/kafka_server_jaas.conf` / `admin-client.properties`, not yet env-driven (planned: Vault or similar).
- The frontend is not containerized/added to `docker-compose.yml` — run it separately with `npm run dev`.
- `worker-service-go`'s peak-memory sampling (`docker stats`, streamed for the sandbox container's lifetime) is best-effort and unrelated to the (separate, always-on) static complexity estimate. **This is a hard limit, not a tuning problem**: `dockerd`'s own stats collector has roughly a 1-second minimum latency before its first sample is available, confirmed by testing a container with a 300ms lifetime (its stats stayed empty, `-- / --`, the whole time, regardless of polling strategy) — most sandboxed executions finish well under that, so `maxMemoryKb` reports `0` for anything reasonably fast. A real fix would mean reading the sandbox container's cgroup memory files directly off the host filesystem instead of going through `dockerd`'s stats loop at all — deliberately not done, since the exact cgroup path is host-dependent (v1 vs v2, cgroupfs vs systemd driver) and would need real per-environment verification.
- The static complexity estimate (`internal/complexity`) is a heuristic over the user's source text (loop nesting, recursion, common library calls), not a formal analysis — it can be fooled by unusual code structure, and branching-recursion detection assumes no memoization/DP (always reports `O(2^n)` for 2+ self-calls, even if the user added a memo table).
