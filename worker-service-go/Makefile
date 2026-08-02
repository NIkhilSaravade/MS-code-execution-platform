.PHONY: build test lint run docker-build docker-push clean vet fmt

BINARY        := worker
MODULE        := github.com/nikhilsaravade95/code-execution-platform/worker-service
VERSION       ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
IMAGE_NAME    ?= code-execution-platform/worker-service
IMAGE_TAG     ?= $(VERSION)

# ── Build ──────────────────────────────────────────────────────────────────────
build:
	CGO_ENABLED=0 go build \
		-ldflags="-w -s -X main.version=$(VERSION)" \
		-o bin/$(BINARY) \
		./cmd/worker

# ── Testing ───────────────────────────────────────────────────────────────────
test:
	go test -race -count=1 -timeout=120s ./...

test-verbose:
	go test -race -v -count=1 -timeout=120s ./...

# Unit tests only (fast; no external dependencies).
test-unit:
	go test -race -short -count=1 -timeout=30s ./...

# ── Code quality ──────────────────────────────────────────────────────────────
fmt:
	gofmt -w ./...

vet:
	go vet ./...

lint:
	golangci-lint run ./...

# ── Local development ─────────────────────────────────────────────────────────
# Requires the docker-compose stack from the repo root to be running.
run:
	go run ./cmd/worker

run-with-env:
	KAFKA_BROKERS=localhost:9092 \
	SUBMISSION_SERVICE_URL=http://localhost:8082 \
	PROBLEM_SERVICE_URL=http://localhost:8083 \
	S3_ENDPOINT=http://localhost:9000 \
	SANDBOX_RUNTIME=runc \
	LOG_LEVEL=debug \
	go run ./cmd/worker

# ── Docker ────────────────────────────────────────────────────────────────────
docker-build:
	docker build \
		--build-arg VERSION=$(VERSION) \
		-t $(IMAGE_NAME):$(IMAGE_TAG) \
		-t $(IMAGE_NAME):latest \
		.

docker-push:
	docker push $(IMAGE_NAME):$(IMAGE_TAG)
	docker push $(IMAGE_NAME):latest

# ── Utility ───────────────────────────────────────────────────────────────────
clean:
	rm -rf bin/

deps:
	go mod tidy
	go mod download

check: fmt vet lint test
	@echo "All checks passed."
