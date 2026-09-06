# Architecture Overview

## What this platform is

A LeetCode-style online judge: users write code in a browser IDE, submit it against
a problem's test cases, and get back a verdict (PASSED / WRONG_ANSWER / CE / TLE /
MLE / RE / SYSTEM_ERROR) plus an optional AI-generated analysis of their solution.
Seven languages are supported end-to-end: Java, C++, C, Python, JavaScript,
TypeScript, and Go.

The system is a real microservices architecture — 10 Java Spring Boot services,
1 Go worker, 1 Python AI service, and a React frontend — deployed on a
single-node k3s (lightweight Kubernetes) cluster running on an Oracle Cloud ARM VM.

## Service inventory

| Service | Language/Framework | Responsibility |
|---|---|---|
| `api-gateway` | Java 17 / Spring Boot 3.5.11 / Spring Cloud Gateway | Single public entry point; routes `/auth/**`, `/problems/**`, `/submissions/**`, etc. to the right backend service; CORS termination |
| `discovery-service` | Java / Spring Cloud Netflix Eureka | Service registry — every other service registers itself here and looks up peers by name instead of hardcoded IPs |
| `auth-service` | Java / Spring Security | Registration, login, JWT issuance (RS256, asymmetric key pair), refresh-token rotation with reuse detection |
| `user-service` | Java | User profile data |
| `problem-service` | Java | Problem CRUD, per-language harness generation and storage, test-case metadata |
| `solution-service` | Java | Reference solutions, admin-authored content, visualizer support |
| `submission-service` | Java | Accepts a submission, embeds test cases + limits from problem-service into a Kafka event, tracks submission status, applies each language's harness to the user's raw code before judging |
| `execution-result-service` | Java | Consumes judged results from Kafka, persists them, exposes them to the frontend |
| `worker-service-go` | Go | The actual code executor — see `02-KUBERNETES-MIGRATION.md` and `03-SANDBOX-EXECUTION-ENGINE.md` |
| `ai-analysis-service` | Python / FastAPI | Post-judging LLM analysis of the user's solution (complexity commentary, style feedback) via a RAG pipeline — see `12-AI-ANALYSIS-SERVICE.md` |
| `frontend` | React 19 / TypeScript / Vite 8 / React Router 7 | The browser IDE, problem browser, 2D "Board" view, admin problem editor |

A `config-service` existed early in the project's history and was deliberately
**removed** (`335d171 Remove config-service - deployed but fully unused`) once it
turned out nothing actually used it — a good example of not carrying dead
infrastructure just because it was already built.

A legacy Java `worker-service` (Docker-outside-of-Docker based) was also fully
removed once `worker-service-go` replaced it (`ebd12c2`, `9805295`, `3798270`,
`bef303f`, `8660f4d`, `b0bdac3`) — see `02-KUBERNETES-MIGRATION.md` for why the
rewrite happened at all.

## How a submission actually flows through the system

1. **Frontend** sends the user's raw code + language + problem id to
   `submission-service` via `api-gateway` (JWT bearer token attached).
2. **submission-service** calls `problem-service` to get the harness for that
   language (see `04-LANGUAGE-SUPPORT-AND-HARNESS.md`), glues it onto the user's
   code via `HarnessApplier`, uploads the assembled source to S3/MinIO, and
   publishes a `SubmissionCreatedEvent` to Kafka — embedding the test cases and
   resource limits directly in the event so the worker never needs to call back
   into problem-service mid-judging.
3. **worker-service-go** consumes the event, checks out a pre-warmed, hardened
   Kubernetes Pod from its per-language pool, writes the source in, compiles
   (if the language needs it), runs each test case, and publishes a
   `ExecutionResultEvent` back to Kafka.
4. **execution-result-service** consumes that event, persists the verdict, and
   the frontend polls/reads it back through `api-gateway`.
5. **ai-analysis-service** independently consumes the same result stream (or a
   related topic) to kick off an LLM-based analysis pass once judging finishes.

## Cross-cutting technology choices

- **Service discovery**: Eureka (`discovery-service`) — every service resolves
  peers by logical name (`discovery-service`, `auth-service`, ...), not IP.
  This is also the single biggest source of the "intermittent flakiness" this
  project chased throughout its life — see `13-INCIDENT-POSTMORTEMS.md` and
  `07-RESOURCE-TUNING-AND-CAPACITY.md`.
- **Messaging**: Kafka, with SASL/TLS auth in production (see
  `10-DATA-STORAGE-MESSAGING.md`).
- **Storage**: Postgres (one database per Java service — database-per-service,
  not a shared schema), MinIO (S3-compatible) for submission source code and
  test-case content, Redis for per-user rate limiting.
- **Observability**: OpenTelemetry + Jaeger for distributed tracing, structured
  JSON logging across all Java services, Spring Actuator health checks
  everywhere.
- **Deployment target**: a single 4-vCPU / 24GB ARM VM (Oracle Cloud "Always
  Free" Ampere A1) running k3s + Calico (for real `NetworkPolicy` enforcement,
  since k3s's default Flannel CNI silently ignores `NetworkPolicy` objects).

## Why this shape (modular monolith → microservices)

The git history shows an explicit early phase called "ModularMonolithScaffolding"
(`887ee4a`, `ed91e92`, `7c1f850`) — the project deliberately started as a
modular monolith and was later split into real, independently-deployed
microservices. This is visible in the commit history as a genuine architectural
evolution, not a from-scratch microservices design — worth knowing if asked
about the reasoning in an interview: start simple, split along real
service boundaries once they're understood, not upfront.
