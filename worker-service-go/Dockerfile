# ── Build stage ──────────────────────────────────────────────────────────────
# --platform=$BUILDPLATFORM pins this stage to the *build host's* native arch
# (set automatically by buildx) so cross-compiling for a different target
# arch - e.g. the arm64 deploy VM, built from an amd64 GitHub Actions runner -
# doesn't need QEMU emulation for the Go toolchain itself: `go build` already
# cross-compiles natively via GOOS/GOARCH. TARGETOS/TARGETARCH are populated
# by buildx to match whatever --platform the overall image build was invoked
# with; the previous hardcoded GOARCH=amd64 here silently produced an amd64
# binary even when asked to build for linux/arm64, which fails to run at all
# on an arm64 node.
FROM --platform=$BUILDPLATFORM golang:1.22-alpine AS builder

# Install git (needed by go mod download for private modules if any).
RUN apk add --no-cache git ca-certificates

WORKDIR /app

# Cache dependencies separately from source so a source change doesn't
# re-download all modules.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

ARG TARGETOS=linux
ARG TARGETARCH=amd64

# Build a statically linked binary. CGO_ENABLED=0 ensures no libc dependency
# so the binary runs in a scratch or distroless image. The echo isn't just
# noise - a prior build produced a real arm64-labeled image whose binary was
# actually amd64 (GHA's type=gha cache reused a stale layer from before this
# file's TARGETARCH fix, under the same cache scope, without erroring or
# warning anywhere), so logging what this build actually resolved to makes
# that class of bug visible in the Actions log instead of only surfacing as
# "exec format error" at runtime on the node.
RUN echo "Building worker for GOOS=$TARGETOS GOARCH=$TARGETARCH" && \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build \
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
