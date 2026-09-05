# ── Build stage ──────────────────────────────────────────────────────────────
# Deliberately NOT pinned to --platform=$BUILDPLATFORM. That cross-compile
# trick (build natively on the amd64 runner via GOOS/GOARCH=$TARGETARCH,
# skipping QEMU for the Go toolchain) is the standard documented pattern, but
# in this workflow TARGETARCH resolved to "amd64" inside this stage even
# though the image was requested as linux/arm64 (confirmed by logging it -
# see git history) - producing an image correctly labeled arm64 whose binary
# was actually amd64, which fails outright with "exec format error" on the
# real arm64 node. Building this stage under the same QEMU-emulated arm64
# as every other Dockerfile in this repo (no cross-compile args at all -
# `go build` just targets whatever it's actually running on) is slower but
# matches the one pattern already proven to work reliably here.
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
RUN CGO_ENABLED=0 go build \
    -ldflags="-w -s -X main.version=${VERSION:-dev}" \
    -o /worker \
    ./cmd/worker

# ── Runtime stage ─────────────────────────────────────────────────────────────
# No Docker CLI, no docker.sock, no su-exec/root-then-drop-privileges dance -
# this worker no longer shells out to a Docker daemon at all. It talks to the
# Kubernetes API (via its own mounted ServiceAccount token, in-cluster) to
# create/exec/delete pooled sandbox Pods instead - see internal/sandbox.
# distroless gives us CA certs (needed for TLS to S3/Kafka/the Kubernetes API
# server) and a non-root default user with no shell, no package manager, and
# no docker.sock permission games left to configure.
FROM gcr.io/distroless/static-debian12:nonroot AS runtime

# Copy the compiled binary from the build stage.
COPY --from=builder /worker /usr/local/bin/worker

# Only inbound surface: the Kubernetes health endpoint (see
# cmd/worker/main.go's /healthz, /readyz) - the worker itself is still a
# pure Kafka consumer/producer plus Kubernetes API client, with no other
# inbound connections.
EXPOSE 8091

# distroless has no shell, so HEALTHCHECK's CMD (which needs one) doesn't
# apply here - Kubernetes' own livenessProbe/readinessProbe (see
# infra/k8s/worker-deployment.yaml) hit /healthz and /readyz directly instead.

USER nonroot:nonroot
ENTRYPOINT ["/usr/local/bin/worker"]
