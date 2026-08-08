
# MS Code Execution Platform

A LeetCode-style competitive coding platform built with a microservices architecture. Users can solve coding problems, submit solutions in **7 languages** (Python, Java, C++, C, JavaScript, TypeScript, Go), and receive AI-powered feedback on their code.

> **Frontend:** A React (Vite + TypeScript) frontend lives in `frontend/` — landing page, practice list, and a Monaco-editor-based solve page with Run/Submit. It is **not** part of `docker-compose.yml`; run it separately with `npm run dev` once the backend stack is up. Every API below is also usable directly (curl/Postman) through the gateway.

---

## Architecture Overview

The platform consists of **9 Java/Spring Boot services**, **1 Go service**, **1 Python FastAPI service**, and **1 React frontend**, orchestrated via Spring Cloud + Eureka, with a fully containerized backend infrastructure stack (Postgres, MinIO, Kafka).

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
   └── Submission-Service (:8083)   — applies the generated harness, THE WORKER SWITCH
             │
   [Kafka: submission-topic  OR  submissions.created.v1 — by ACTIVE_WORKER]
             │
     ┌───────┴────────┐
Worker-Service      Worker-Service-Go
  (:8084, Java)      (no HTTP port, Go)
     └───────┬────────┘
   [Kafka: execution-result-topic / executions.completed.v1]
             │
     Execution-Result-Service (:8085)

AI-Analysis-Service (Python FastAPI, :8000)
    └── Groq LLM + ChromaDB RAG + Eureka + own JWT verification
```

**Service Registry:** Eureka (`discovery-service`, :8761) — **both workers now register**, and worker-service-go resolves problem-service/submission-service/auth-service via Eureka lookups rather than static URLs.
**Centralized Config:** Spring Cloud Config Server (`config-service`, :8888) — currently unused by any service; kept for future adoption.

---

## Features

- **Centralized Auth** — RS256/JWKS-based JWTs issued by `auth-service`; every business service independently validates tokens as its own OAuth2 resource server
- **Role-based Access + Admin Provisioning** — idempotent admin seeding at startup, admin-only role promotion endpoint
- **Problem Management** — Create and browse coding problems with test cases stored in MinIO/S3
- **Generated Judging Harnesses** — Admins author a language-agnostic function signature once; `problem-service` auto-generates real, runnable boilerplate (stdin→typed args→call→JSON stdout) for every supported language, so users submit a plain `class Solution { ... }`/function instead of a full script
- **7-Language Code Execution** — Python, Java, C++, C, JavaScript, TypeScript, and Go run in isolated Docker sandboxes, executed by two workers (Java and Go) running side by side for comparison
- **Run vs Submit** — "Run" judges only a problem's visible/sample test cases; "Submit" judges everything, hidden cases included — every test case is always evaluated and reported (no short-circuit on first failure)
- **Async Verdict Pipeline** — Kafka-driven submission → execution → result flow, with TLS + SASL + ACLs on Kafka and a dead-letter queue on the Go worker
- **AI Code Analysis** — RAG-powered LLM feedback for both passing and failing submissions, with PostgreSQL result caching
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
| `submission-service` | Java | 8083 | Accepts submissions, applies the generated harness, publishes to Kafka |
| `worker-service` | Java | 8084 | Docker code executor, Kafka consumer (legacy, kept for comparison) |
| `worker-service-go` | Go | — | Docker/sandbox code executor, Kafka consumer + DLQ producer |
| `execution-result-service` | Java | 8085 | Consumes results from Kafka, stores verdicts |
| `ai-analysis-service` | Python | 8000 | FastAPI — LLM code analysis with RAG |
| `api-gateway` | Java | 8080 | JWT resource server + reverse proxy |
| `frontend` | React/Vite/TypeScript | 5173 (dev) | Landing page, practice list, Monaco-based solve page. Run separately, not in `docker-compose.yml`. |

**Why two workers?** `worker-service` (Java, Docker SDK) and `worker-service-go` (Go, seccomp + `runc`/`runsc` sandbox) run side by side intentionally for a performance comparison — this is not a partial migration. They consume from **different Kafka topics**, selected per-submission by the `ACTIVE_WORKER` env var on `submission-service` (see below) — never both at once for the same submission.

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
- FastAPI, LangChain, Groq LLM
- ChromaDB vector store (RAG context retrieval)
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

Fill in the required secrets: Postgres per-service passwords, `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`, `ADMIN_EMAIL`/`ADMIN_PASSWORD`, `WORKER_SERVICE_CLIENT_SECRET`, `SUBMISSION_SERVICE_CLIENT_SECRET`, Kafka per-identity SASL passwords, `GROQ_API_KEY`, and `GITHUB_PASSWORD` (required for `config-service` to start, even though nothing consumes it yet). `ACTIVE_WORKER` (`java`/`go`, default `go`) picks which worker judges new submissions — see [THE WORKER SWITCH](#the-worker-switch).

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
| GET | `/submissions/{id}` | Get a submission by ID (caller must own it) — includes a `testCaseResults` array (per-case pass/fail, with content redacted for hidden cases) once judged |
| GET | `/submissions/user/{userId}` | Get all submissions for a user (caller's JWT subject must match `userId`) |

### Execution Results (`execution-result-service`)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/results/{submissionId}` | Get execution verdict for a submission |

### AI Analysis (`ai-analysis-service`)

Not currently routed through the gateway — call it directly on `http://localhost:8000`.

| Method | Endpoint | Description |
|---|---|---|
| POST | `/ai/analyze` | Get AI feedback on a submission |

**Request body:**
```json
{ "submissionId": 123 }
```

---

## Code Execution Flow

1. Client POSTs to `/submissions` with `{ problemId, userId, code, language, includeHidden }`
2. `submission-service` saves the raw submission, fetches the problem's generated harness for that language (if any) and glues it to the user's code, then publishes to Kafka — `submission-topic` or `submissions.created.v1`, depending on `ACTIVE_WORKER`
3. `worker-service` or `worker-service-go` consumes the message, fetches test cases from `problem-service` (filtered to visible-only if `includeHidden` was `false`), and runs the *combined* code in an isolated sandbox — one test case at a time
4. Each test case's output is compared against its expected output; every case is always run and reported (no short-circuit on first failure), producing per-case `PASSED`/`FAILED`/`TLE`/`MLE`/`RE`/`CE` results and an overall verdict; failures on the Go worker are also published to a dead-letter queue
5. The result is published to `execution-result-topic` / `executions.completed.v1`
6. `execution-result-service` consumes and persists the verdict; the Go worker also reports its terminal result directly to `submission-service` over HTTP (nothing currently consumes `executions.completed.v1` back into it)
7. Client polls `GET /submissions/{id}` (or `GET /api/results/{submissionId}`) to retrieve the verdict and per-test-case results
8. Optionally, client calls `POST /ai/analyze` (directly on port 8000) for LLM-generated feedback

### How the harness system works

An admin creates a problem with an optional `signature` — e.g. for Two Sum: function name `twoSum`, params `nums: int[]`, `target: int`, return `int[]`. `problem-service` runs every registered `HarnessGenerator` against that signature and stores the result per language (`harnessByLanguage`). At submission time, `submission-service` glues the right language's harness to the user's raw code (with a small language-specific preamble — imports/includes/package declaration — prepended where the language requires it) before it's judged. A problem with no signature still works as a plain stdin/stdout script judge.

### Supported Languages

| Language | Go worker image | Java worker image | Compiled? |
|---|---|---|---|
| Python | `python:3.12-slim` | `python:3.10` | No |
| Java | `eclipse-temurin:21-jdk-alpine` | `eclipse-temurin:17` | Yes |
| C++ | `gcc:14` | `gcc:12` | Yes |
| C | `gcc:14` | `gcc:12` | Yes |
| JavaScript | `node:20-slim` | `node:20-slim` | No |
| TypeScript | `platform/node-typescript:20` (locally built — see [step 2](#2-build-the-typescript-sandbox-image-one-time)) | `platform/node-typescript:20` | Yes (`tsc`) |
| Go | `golang:1.22-alpine` | `golang:1.22-alpine` | Yes |

### THE WORKER SWITCH

`ACTIVE_WORKER` (env var on `submission-service`, `java` or `go`, default `go`) picks which worker judges every *new* submission. Only one worker ever sees a given submission — dual-publishing would race two independent judges against each other with no way to know which result you'd get. Change it in `.env` and run `docker compose up -d submission-service` to switch; no rebuild needed.

---

## Authentication & Authorization

- JWTs are RS256, issued by `auth-service`, verified independently by every other business service against `auth-service`'s JWKS endpoint (issuer `https://auth-service`, audience `ms-code-execution`).
- `auth-service` and `user-service` communicate over gRPC (port 9090).
- Machine-to-machine calls (e.g. workers calling `problem-service`/`submission-service`, `submission-service` calling `problem-service` for a harness) use OAuth2 client-credentials tokens obtained from `POST /auth/token`.
- `user-service` seeds a single admin account idempotently at startup (`ADMIN_EMAIL`/`ADMIN_PASSWORD`); that admin can promote other users via `PATCH /users/{email}/role`, and is required to call `POST /problems`/`POST /problems/{id}/harness/regenerate`.
- Object-level access control on submissions: `/submissions/{id}` is scoped to the requesting user (404, not 403, on mismatch); `/submissions/user/{userId}` requires the JWT subject to match `userId`.

---

## AI Analysis Service

The AI service uses a **RAG (Retrieval-Augmented Generation)** pipeline:

1. Retrieves relevant context from **ChromaDB** using the problem description as a query
2. Selects a prompt template based on submission status (`PASSED` or `FAILED`)
3. Invokes **Groq LLM** via LangChain with the code, problem, and retrieved context
4. Caches the result in PostgreSQL to avoid redundant LLM calls
5. Returns structured JSON feedback

It also independently verifies incoming JWTs (PyJWT + `PyJWKClient` against `auth-service`'s JWKS) rather than trusting the caller.

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
├── submission-service/          # Submission intake, harness application, Kafka producer
├── worker-service/               # Java Docker code executor + Kafka consumer
├── worker-service-go/           # Go sandbox code executor + Kafka consumer/DLQ
├── execution-result-service/    # Result storage + Kafka consumer
├── ai-analysis-service/         # Python FastAPI + LangChain RAG
│   ├── main.py
│   ├── security/                # JWT verification (JWKS)
│   ├── services/
│   ├── prompts/
│   ├── discovery/
│   └── db/
├── frontend/                     # React/Vite/TypeScript — landing page, practice list, solve page
│   └── src/
│       ├── pages/                # LandingPage, PracticePage, SolvePage, LoginPage, SignupPage
│       ├── components/
│       ├── api/                  # Backend client (auth, problems, submissions)
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

View registered services at [http://localhost:8761](http://localhost:8761) — both `WORKER-SERVICE` and `WORKER-SERVICE-GO` should appear.

### MinIO Console

Browse buckets at [http://localhost:9001](http://localhost:9001).

---

## Known Gaps / Follow-ups

- `config-service` is deployed but not consumed by any service yet.
- No `/ai/**` gateway route — `ai-analysis-service` must be called directly on port 8000.
- Kafka admin credentials are hardcoded in `infra/kafka/kafka_server_jaas.conf` / `admin-client.properties`, not yet env-driven (planned: Vault or similar).
- The frontend is not containerized/added to `docker-compose.yml` — run it separately with `npm run dev`.
- Nothing currently consumes the Go worker's `executions.completed.v1` topic back into `submission-service` — its terminal result is delivered via a direct HTTP call instead (`SubmissionClient.MarkTerminal`).
