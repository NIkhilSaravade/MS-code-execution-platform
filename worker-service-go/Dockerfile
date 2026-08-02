# ── Build stage ──────────────────────────────────────────────────────────────
# Use the official Go image on Alpine for a minimal build environment.
FROM golang:1.22-alpine AS builder

# Install git (needed by go mod download for private modules if any).
RUN apk add --no-cache git ca-certificates

WORKDIR /app

# Cache dependencies separately from source so a source change doesn't
# re-download all modules.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# Build a statically linked binary. CGO_ENABLED=0 ensures no libc dependency
# so the binary runs in a scratch or distroless image.
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-w -s -X main.version=${VERSION:-dev}" \
    -o /worker \
    ./cmd/worker

# ── Runtime stage ─────────────────────────────────────────────────────────────
# We need the Docker CLI installed so the worker can spawn sandbox containers.
# Using docker:cli as the base image is the right call here — it provides a
# minimal Alpine environment with the Docker CLI and no daemon overhead.
#
# The worker talks to the Docker daemon on the host via /var/run/docker.sock,
# which is mounted at runtime (not baked into the image).
FROM docker:25-cli AS runtime

# Install CA certificates (needed for HTTPS calls to S3 and upstream services).
RUN apk add --no-cache ca-certificates tzdata

# Copy the compiled binary from the build stage.
COPY --from=builder /worker /usr/local/bin/worker

# Copy the restrictive seccomp profile for sandbox containers.
# This profile allows only the syscalls required by Python, Java, and C++ runtimes.
COPY ./docker/seccomp/execution.json /etc/docker/seccomp/execution.json

# Run as a non-root user for the worker process itself.
# The worker spawns Docker containers (which run as nobody:65534) via the socket.
RUN addgroup -S worker && adduser -S worker -G worker
USER worker

# Expose no ports — the worker is a pure consumer/producer, no inbound connections.

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD pgrep worker || exit 1

ENTRYPOINT ["/usr/local/bin/worker"]
