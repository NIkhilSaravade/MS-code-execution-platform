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
#
# Needs a CLI new enough to understand `--mount ...,volume-subpath=...`
# (used in sandbox.go to mount a sub-directory of the shared worker-scratch
# volume into each sandbox container) - docker:25-cli's bundled CLI predates
# that flag's client-side parser support and rejects it before ever
# contacting the daemon, regardless of how new the daemon itself is.
FROM docker:27-cli AS runtime

# Install CA certificates (needed for HTTPS calls to S3 and upstream services)
# and su-exec (lets the entrypoint drop from root to the worker user after
# fixing up the scratch volume's ownership - see docker/entrypoint.sh).
RUN apk add --no-cache ca-certificates tzdata su-exec

# Copy the compiled binary from the build stage.
COPY --from=builder /worker /usr/local/bin/worker

# Copy the restrictive seccomp profile for sandbox containers.
# This profile allows only the syscalls required by Python, Java, and C++ runtimes.
COPY ./docker/seccomp/execution.json /etc/docker/seccomp/execution.json

COPY ./docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# The worker process itself runs as a non-root user (entrypoint.sh drops
# privileges via su-exec after chown'ing the scratch volume as root - a
# fresh named volume is always created owned by root:root). The sandbox
# containers the worker spawns run as nobody:65534, same as before.
RUN addgroup -S worker && adduser -S worker -G worker

# Expose no ports — the worker is a pure consumer/producer, no inbound connections.

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD pgrep worker || exit 1

ENTRYPOINT ["/entrypoint.sh"]
