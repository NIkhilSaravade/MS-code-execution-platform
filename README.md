
# MS Code Execution Platform

A LeetCode-style competitive coding platform built with a microservices architecture. Users can solve coding problems, submit solutions in multiple languages, and receive AI-powered feedback on their code.

> **Note:** There is currently no frontend. The previous Angular app was removed with the intent to rebuild it in React; that rebuild hasn't started yet. All APIs below are usable directly (e.g. via curl/Postman) through the gateway.

---

## Architecture Overview

The platform consists of **9 Java/Spring Boot services**, **1 Go service**, and **1 Python FastAPI service**, orchestrated via Spring Cloud + Eureka, with a fully containerized infrastructure stack (Postgres, MinIO, Kafka).

```
Client
   │
   ▼
API Gateway (:8080)  ←── OAuth2 Resource Server (RS256 / JWKS)
   │
   ├── Auth-Service (:8086)         — login/register/refresh, JWKS, client-credentials
   ├── User-Service (:8081, gRPC 9090) — user CRUD, roles, admin bootstrap
   ├── Problem-Service (:8082)      — problem CRUD, test cases (MinIO-backed)
   └── Submission-Service (:8083)
             │
        [Kafka: submission-topic]
             │
     ┌───────┴────────┐
Worker-Service      Worker-Service-Go
  (:8084, Java)      (no HTTP port, Go)
     └───────┬────────┘
        [Kafka: execution-result-topic]
             │
     Execution-Result-Service (:8085)

AI-Analysis-Service (Python FastAPI, :8000)
    └── Groq LLM + ChromaDB RAG + Eureka + own JWT verification
```

**Service Registry:** Eureka (`discovery-service`, :8761)
**Centralized Config:** Spring Cloud Config Server (`config-service`, :8888) — currently unused by any service; kept for future adoption.

---

## Features

- **Centralized Auth** — RS256/JWKS-based JWTs issued by `auth-service`; every business service independently validates tokens as its own OAuth2 resource server
- **Role-based Access + Admin Provisioning** — idempotent admin seeding at startup, admin-only role promotion endpoint
- **Problem Management** — Create and browse coding problems with test cases stored in MinIO/S3
- **Multi-language Code Execution** — Python, Java, C++ run in isolated Docker sandboxes with a 30-second timeout, executed by two workers (Java and Go) running side by side for comparison
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

| `problem-service` | Java | 8082 | Problem CRUD, test case storage (MinIO) |
| `submission-service` | Java | 8083 | Accepts submissions, publishes to Kafka |
| `worker-service` | Java | 8084 | Docker code executor, Kafka consumer (legacy, kept for comparison) |
| `worker-service-go` | Go | — | Docker/sandbox code executor, Kafka consumer + DLQ producer |
| `execution-result-service` | Java | 8085 | Consumes results from Kafka, stores verdicts |
| `ai-analysis-service` | Python | 8000 | FastAPI — LLM code analysis with RAG |
| `api-gateway` | Java | 8080 | JWT resource server + reverse proxy |

**Why two workers?** `worker-service` (Java, Docker SDK) and `worker-service-go` (Go, seccomp + `runc`/`runsc` sandbox) run side by side intentionally for a performance comparison — this is not a partial migration.

---

## Tech Stack

**Backend (Java)**
- Spring Boot 3.5.11, Spring Cloud 2025.0.1
- Spring Cloud Gateway (WebFlux), Eureka, OpenFeign, gRPC
- Apache Kafka (Confluent 7.5.0, Zookeeper-based, SASL_SSL + ACLs)
- PostgreSQL (one DB per service, Flyway migrations, `ddl-auto=validate`, TLS-only)
- JWT via jjwt 0.13.0 (RS256, JWKS)
- Docker Java client 3.3.4 (Windows named pipe transport)

**Worker (Go)**
- Go 1.22, AWS SDK v2 (S3/MinIO), `segmentio/kafka-go`, `rs/zerolog`
- OpenTelemetry SDK + OTLP-HTTP exporter
- seccomp profile, configurable sandbox runtime (`runc` default)

**AI Service (Python)**
- FastAPI, LangChain, Groq LLM
- ChromaDB vector store (RAG context retrieval)
- `py-eureke-client` for service discovery, PyJWT/`PyJWKClient` for JWT verification
- PostgreSQL for analysis result caching

**Infrastructure**
- Docker Compose: Postgres, MinIO, Kafka + Zookeeper + Kafka UI, plus every application service
- Code executed in Docker containers: `python:3.10`, `eclipse-temurin:17`, `gcc:12`
- Object storage: MinIO (`platform-test-cases`, `platform-artifacts` buckets)

---

## Getting Started

### Prerequisites

- Java 17+ and Maven (or the `./mvnw` wrapper in each service)
- Go 1.22+ (for `worker-service-go`)
- Docker Desktop running
- Python 3.10+
- A Groq API key (`ai-analysis-service` will not start without one)

### 1. Configure environment

```bash
cp .env.example .env
```

Fill in the required secrets: Postgres per-service passwords, `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`, `ADMIN_EMAIL`/`ADMIN_PASSWORD`, `WORKER_SERVICE_CLIENT_SECRET`, Kafka per-identity SASL passwords, `GROQ_API_KEY`, and `GITHUB_PASSWORD` (required for `config-service` to start, even though nothing consumes it yet).

### 2. Start the full stack

```bash
docker-compose up -d
```

This single command now brings up **everything**: Postgres (TLS, per-service roles), MinIO, Zookeeper/Kafka (SASL_SSL + ACLs), Kafka UI, `discovery-service`, `config-service`, `auth-service`, `user-service`, `problem-service`, `submission-service`, both workers, `execution-result-service`, `ai-analysis-service`, and `api-gateway`.

Databases, roles, Kafka topics/ACLs, and MinIO buckets are all provisioned automatically by one-shot init containers (`infra/postgres/init-multiple-databases.sh`, `kafka-init`, `minio-init`) — no manual `CREATE DATABASE` step required.

### 3. Running a service outside Docker (for development)

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
| POST | `/problems` | Create a problem (ADMIN-only) |
| GET | `/problems/getAll?page=0&size=10` | Paginated problem list |
| GET | `/problems/{problemId}` | Get problem metadata |

### Submissions (`submission-service`)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/submissions` | Submit code for execution |
| GET | `/submissions/{id}` | Get a submission by ID (caller must own it) |
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

1. Client POSTs to `/submissions` with `{ problemId, userId, code, language }`
2. `submission-service` saves the submission and publishes it to **`submission-topic`**
3. `worker-service` or `worker-service-go` consumes the message, fetches test cases from `problem-service`, and runs the code in an isolated sandbox
4. Output is compared against expected test case output to produce a `PASSED` or `FAILED` verdict; failures on the Go worker are also published to a dead-letter queue
5. The result is published to **`execution-result-topic`**
6. `execution-result-service` consumes and persists the verdict
7. Client polls `GET /api/results/{submissionId}` to retrieve the verdict
8. Optionally, client calls `POST /ai/analyze` (directly on port 8000) for LLM-generated feedback

### Supported Languages

| Language | Docker Image | Command |
|---|---|---|
| Python | `python:3.10` | `python main.py < input.txt` |
| Java | `eclipse-temurin:17` | `javac Main.java && java Main < input.txt` |
| C++ | `gcc:12` | `g++ main.cpp -o main && ./main < input.txt` |

---

## Authentication & Authorization

- JWTs are RS256, issued by `auth-service`, verified independently by every other business service against `auth-service`'s JWKS endpoint (issuer `https://auth-service`, audience `ms-code-execution`).
- `auth-service` and `user-service` communicate over gRPC (port 9090).
- Machine-to-machine calls (e.g. workers calling `problem-service`/`submission-service`) use OAuth2 client-credentials tokens obtained from `POST /auth/token`.
- `user-service` seeds a single admin account idempotently at startup (`ADMIN_EMAIL`/`ADMIN_PASSWORD`); that admin can promote other users via `PATCH /users/{email}/role`.
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
├── docker-compose.yml           # Full stack: Postgres, MinIO, Kafka, and every service
├── .env.example                 # Required secrets/config for the stack
├── infra/
│   ├── kafka/                   # ACLs, JAAS config, TLS certs, kafka-init script
│   └── postgres/                # Per-service DB/role init, TLS config
├── api-gateway/                 # Spring Cloud Gateway + JWT resource server
├── discovery-service/           # Eureka server
├── config-service/               # Spring Cloud Config server (currently unused)
├── auth-service/                # Token issuance, JWKS, client-credentials
├── user-service/                # User CRUD, roles, admin bootstrap, gRPC
├── problem-service/             # Problems + test cases (MinIO-backed)
├── submission-service/          # Submission intake + Kafka producer
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
└── docker-code/                 # Temp container artifacts (worker output)
```

There is currently no `frontend/` directory.

---

## Development

### Run Tests

```bash
# Java service tests (run from service directory)
./mvnw test
./mvnw test -Dtest=ClassName

# Go worker tests
cd worker-service-go && go test ./...
```

### Build for Production

```bash
# Java service
./mvnw clean install -DskipTests

# Go worker
cd worker-service-go && go build ./...
```

### Kafka UI

Monitor topics and messages at [http://localhost:8090](http://localhost:8090) (connects via SASL_SSL).

### Eureka Dashboard

View registered services at [http://localhost:8761](http://localhost:8761).

### MinIO Console

Browse buckets at [http://localhost:9001](http://localhost:9001).

---

## Known Gaps / Follow-ups

- `config-service` is deployed but not consumed by any service yet.
- No `/ai/**` gateway route — `ai-analysis-service` must be called directly on port 8000.
- Kafka admin credentials are hardcoded in `infra/kafka/kafka_server_jaas.conf` / `admin-client.properties`, not yet env-driven (planned: Vault or similar).
- No frontend; the previous Angular app was removed pending a React rebuild.