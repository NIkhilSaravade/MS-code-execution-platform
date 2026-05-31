# MS Code Execution Platform

A LeetCode-style competitive coding platform built with a microservices architecture. Users can solve coding problems, submit solutions in multiple languages, and receive AI-powered feedback on their code.

---

## Architecture Overview

The platform consists of **8 Spring Boot microservices**, **1 Python FastAPI service**, and an **Angular frontend**, all orchestrated via Spring Cloud.

```
Client (Angular :4200)
        │
        ▼
   API Gateway (:8080)  ←── JWT Auth Filter
        │
   ┌────┴────────────────────────────────────┐
   │                                         │
User-Service    Problem-Service    Submission-Service
  (:8081)          (:8082)            (:8083)
                                         │
                                    [Kafka: submission-topic]
                                         │
                                    Worker-Service (:8084)
                                    (Docker Sandbox)
                                         │
                                    [Kafka: execution-result-topic]
                                         │
                               Execution-Result-Service (:8085)

AI-Analysis-Service (Python FastAPI, :8000)
    └── Groq LLM + ChromaDB RAG + Eureka Service Discovery
```

**Service Registry:** Eureka (`discovery-service`, :8761)  
**Centralized Config:** Spring Cloud Config Server (`config-service`, :8888) pulling from [NIkhilSaravade/Centralized-configs-MSCEP](https://github.com/NIkhilSaravade/Centralized-configs-MSCEP)

---

## Features

- **User Authentication** — JWT-based register/login
- **Problem Management** — Create and browse coding problems with test cases
- **Multi-language Code Execution** — Python, Java, C++ run in isolated Docker containers with a 30-second timeout
- **Async Verdict Pipeline** — Kafka-driven submission → execution → result flow
- **AI Code Analysis** — RAG-powered LLM feedback for both passing and failing submissions, with PostgreSQL result caching
- **Unified API Gateway** — Single entry point with JWT validation on all routes

---

## Services

| Service | Port | Description |
|---|---|---|
| `discovery-service` | 8761 | Eureka service registry |
| `config-service` | 8888 | Centralized config server (Git-backed) |
| `api-gateway` | 8080 | JWT auth filter + reverse proxy |
| `user-service` | 8081 | Registration, login, JWT issuance |
| `problem-service` | 8082 | Problem CRUD, test case storage |
| `submission-service` | 8083 | Accepts submissions, publishes to Kafka |
| `worker-service` | 8084 | Consumes from Kafka, runs code in Docker |
| `execution-result-service` | 8085 | Consumes results from Kafka, stores verdicts |
| `ai-analysis-service` | ~8000 | FastAPI — LLM code analysis with RAG |
| Frontend (Angular) | 4200 | Browser UI |

---

## Tech Stack

**Backend (Java)**
- Spring Boot 3.5.11, Spring Cloud 2025.0.1
- Spring Cloud Gateway (WebFlux), Eureka, OpenFeign
- Apache Kafka (Confluent 7.5.0, Zookeeper-based)
- PostgreSQL (one DB per service, Hibernate DDL auto)
- JWT via jjwt 0.13.0
- Docker Java client 3.3.4 (Windows named pipe transport)

**AI Service (Python)**
- FastAPI, LangChain, Groq LLM
- ChromaDB vector store (RAG context retrieval)
- `py-eureka-client` for service discovery
- PostgreSQL for analysis result caching

**Frontend**
- Angular 21.2.0
- Vitest 4.0.8 (test runner)

**Infrastructure**
- Docker + Docker Compose (Kafka, Zookeeper, Kafka UI)
- Code executed in Docker containers: `python:3.10`, `eclipse-temurin:17`, `gcc:12`

---

## Getting Started

### Prerequisites

- Java 17+
- Maven (or use the `./mvnw` wrapper in each service)
- Docker Desktop (running, with Windows named pipe enabled)
- Node.js 20+ and npm
- Python 3.10+
- PostgreSQL running locally on port 5432

### 1. Create Databases

Create the following PostgreSQL databases before starting services:

```sql
CREATE DATABASE user_service;
CREATE DATABASE problem_service;
CREATE DATABASE submission_service;
CREATE DATABASE execution_result_service;
CREATE DATABASE ai_analysis_db;
```

### 2. Start Infrastructure (Kafka)

```bash
docker-compose up -d
```

This starts Zookeeper (:2181), Kafka (:9092), and Kafka UI (:8090).

### 3. Start Services (in order)

```bash
# 1. Eureka service registry
cd discovery-service && ./mvnw spring-boot:run

# 2. Config server
cd config-service && ./mvnw spring-boot:run

# 3. Business services (can run in parallel after config-service is up)
cd user-service && ./mvnw spring-boot:run
cd problem-service && ./mvnw spring-boot:run
cd submission-service && ./mvnw spring-boot:run
cd worker-service && ./mvnw spring-boot:run
cd execution-result-service && ./mvnw spring-boot:run

# 4. API Gateway
cd api-gateway && ./mvnw spring-boot:run

# 5. AI Analysis Service
cd ai-analysis-service
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirnments.txt
python main.py
```

### 4. Start Frontend

```bash
cd frontend
npm install
npm start
```

App available at [http://localhost:4200](http://localhost:4200)

---

## API Reference

All requests go through the API Gateway at `http://localhost:8080`. Most endpoints require `Authorization: Bearer <token>`.

### Auth

| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/register` | Register a new user |
| POST | `/auth/login` | Login and receive JWT |

### Problems

| Method | Endpoint | Description |
|---|---|---|
| POST | `/problems` | Create a problem |
| GET | `/problems/getAll?page=0&size=10` | Paginated problem list |

### Submissions

| Method | Endpoint | Description |
|---|---|---|
| POST | `/submissions` | Submit code for execution |
| GET | `/submissions/{id}` | Get a submission by ID |
| GET | `/submissions/user/{userId}` | Get all submissions for a user |

### Execution Results

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/results/{submissionId}` | Get execution verdict for a submission |

### AI Analysis

| Method | Endpoint | Description |
|---|---|---|
| POST | `/ai/analyze` | Get AI feedback on a submission |

**Request body for `/ai/analyze`:**
```json
{ "submissionId": 123 }
```

---

## Code Execution Flow

1. Client POSTs to `/submissions` with `{ problemId, userId, code, language }`
2. `submission-service` saves the submission and publishes it to **`submission-topic`**
3. `worker-service` consumes the message, fetches test cases from `problem-service`, and spins up a Docker container to run the code
4. The container output is compared against expected test case output to produce a `PASSED` or `FAILED` verdict
5. The result is published to **`execution-result-topic`**
6. `execution-result-service` consumes and persists the verdict
7. Client polls `GET /api/results/{submissionId}` to retrieve the verdict
8. Optionally, client calls `POST /ai/analyze` for LLM-generated feedback

### Supported Languages

| Language | Docker Image | Command |
|---|---|---|
| Python | `python:3.10` | `python main.py < input.txt` |
| Java | `eclipse-temurin:17` | `javac Main.java && java Main < input.txt` |
| C++ | `gcc:12` | `g++ main.cpp -o main && ./main < input.txt` |

---

## AI Analysis Service

The AI service uses a **RAG (Retrieval-Augmented Generation)** pipeline:

1. Retrieves relevant context from **ChromaDB** using the problem description as a query
2. Selects a prompt template based on submission status (`PASSED` or `FAILED`)
3. Invokes **Groq LLM** via LangChain with the code, problem, and retrieved context
4. Caches the result in PostgreSQL to avoid redundant LLM calls
5. Returns structured JSON feedback

---

## Project Structure

```
MS-code-execution-platform/
├── docker-compose.yml           # Kafka + Zookeeper infrastructure
├── api-gateway/                 # Spring Cloud Gateway + JWT filter
├── discovery-service/           # Eureka server
├── config-service/              # Spring Cloud Config server
├── user-service/                # Auth + user management
├── problem-service/             # Problems + test cases
├── submission-service/          # Submission intake + Kafka producer
├── worker-service/              # Docker code executor + Kafka consumer
├── execution-result-service/    # Result storage + Kafka consumer
├── ai-analysis-service/         # Python FastAPI + LangChain RAG
│   ├── main.py
│   ├── services/
│   ├── prompts/
│   ├── discovery/
│   └── db/
├── frontend/                    # Angular 21 SPA
└── docker-code/                 # Temp container artifacts (worker output)
```

---

## Development

### Run Tests

```bash
# Java service tests (run from service directory)
./mvnw test

# Single test class
./mvnw test -Dtest=ClassName

# Frontend tests
cd frontend && npm test
```

### Build for Production

```bash
# Java service
./mvnw clean install -DskipTests

# Frontend
cd frontend && npm run build
```

### Kafka UI

Monitor topics and messages at [http://localhost:8090](http://localhost:8090).

### Eureka Dashboard

View registered services at [http://localhost:8761](http://localhost:8761).
