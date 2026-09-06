# CI/CD Pipeline

## What exists today: CI (build + push), fully automated

`.github/workflows/docker-build-push.yml` (`b3f1fa4` and many fixes after)
builds every service's Docker image and pushes it to `ghcr.io` automatically:

- **Trigger**: push to `main`, a `v*.*.*` tag, any pull request against
  `main`, or manual `workflow_dispatch`.
- **Selective builds**: `dorny/paths-filter` diffs the changed paths and only
  builds images for services whose directory actually changed — not all 11
  images on every commit. `workflow_dispatch`'s `build_all` input (or pushing
  a `v*` tag) forces every image to rebuild regardless, for the first-ever
  build or after a base-image/workflow change nothing's paths-filter would
  otherwise catch.
- **Multi-arch target**: every image builds for **`linux/arm64` only** — the
  one real deployment target is the k3s VM (Ubuntu on Oracle Ampere ARM).
  `docker-compose.yml` still builds every service locally from source for
  dev, so local development on any host architecture is unaffected by this
  choice.
- **Tags**: `latest` (only on the default branch), the branch name, the
  short SHA, and semver (on a `v*.*.*` tag) — via `docker/metadata-action`.
- **Caching**: `type=gha` build cache, scoped per service (`matrix.name`) —
  this scoping detail became directly relevant to a real bug, see below.

A second, small workflow (`bcd9e71`) syncs any `release/*` branch onto a
long-lived `release` branch — the explicit reasoning in that commit is that
**Cloudflare Pages (and, its message says, "later ArgoCD") needs one stable
branch to watch for UAT**, rather than reconfiguring a downstream watcher
every time a new release-candidate branch is cut.

## What's still missing: CD (automated deploy)

**This is the one deliberately-deferred piece of the whole platform.**
Deploying a new image onto the k3s cluster today is a **manual** step:
`git pull` on the VM, `kubectl rollout restart deployment/<name> -n platform`,
and (for the sandbox pool specifically) `kubectl delete pods --all -n
sandbox-execution` to clear stale pool state. `infra/k8s/README.md` says
this explicitly: *"Deploying those images onto the k3s cluster (infra/k8s/)
is a separate, deliberately manual step for now."*

The `release` branch sync workflow's own commit message already names the
intended next step: **ArgoCD** (or a similar GitOps controller) watching
that branch and applying `infra/k8s/*.yaml` automatically whenever it
changes, instead of a human running `kubectl apply`/`rollout restart` by
hand. This is the concrete, well-scoped remaining piece if this project's CD
story needs finishing — the CI side (image build + push, image tagging,
selective builds) is already fully solved and doesn't need to change; only
the "apply this to the cluster" half is manual today.

## Real CI bugs hit and fixed (all genuinely instructive)

### 1. `paths-filter` needs `pull-requests: read` on PR events specifically
`5e5153d` — on a `push` event, `dorny/paths-filter` diffs locally against
the previous commit; on a `pull_request` event it instead asks the GitHub
API which files changed, and that call needs `pull-requests: read` on the
job's token. Only the `build` job had explicit permissions; `changes` ran
with the repo's default token permissions, which didn't include it, and
failed with `Resource not accessible by integration`.

### 2. `GITHUB_OUTPUT` chokes on multi-line JSON
`a803ee7` — the normal (non-`build_all`) code path already compacted its
`jq` output to one line, so this bug only manifested on the `build_all`
input or a `v*` tag push — exactly the path needed for the **very first**
build of every service, which is what surfaced it. `GITHUB_OUTPUT` parses
one `key=value` pair per line; the force-all branch wrote the matrix's
pretty-printed (multi-line) JSON directly, so every line after the first
was parsed as its own invalid `key=value` pair, failing the step outright.

### 3. Multi-arch cross-compilation is genuinely tricky to get right
Three separate, escalating incidents, all about producing an `arm64` binary
that actually runs on `arm64`:

- **`worker-service-go`'s Dockerfile hardcoded `GOARCH=amd64`** — harmless
  under the old `docker-compose` flow (same architecture as the build
  machine), silently wrong once the target became the arm64 k3s node
  (`b3f1fa4` fixed this by switching to buildx's `TARGETOS`/`TARGETARCH`
  build args).
- Later, the pod **crash-looped again** with `exec format error` despite
  containerd's own image metadata correctly reporting `architecture=arm64`
  — investigated by logging the resolved `GOARCH` directly into the build
  log (`bf14f61`), which proved the real bug: the `--platform=$BUILDPLATFORM`
  cross-compile pattern (build natively on the amd64 runner, cross-compile
  via `GOOS/GOARCH=$TARGETARCH` to skip QEMU for the Go toolchain) simply
  wasn't resolving `TARGETARCH` correctly in this pipeline, silently
  producing an amd64 binary inside a correctly-labeled arm64 image.
- The actual fix (`ecfcc9c`) **dropped the cross-compile trick entirely** —
  the builder stage now runs under the same QEMU-emulated arm64 as every
  other Dockerfile in the repo, so `go build` just targets whatever it's
  actually running on. Slower than a working cross-compile would have been,
  but matches the one pattern already proven reliable everywhere else in
  this pipeline. **Lesson: a "faster" build trick that silently produces
  the wrong architecture is strictly worse than a slower, uniform approach
  that's actually correct.**
- The eclipse-temurin JRE base image compounded this same class of problem
  a different way: `eclipse-temurin:17-jre-alpine` (used by all 9 Java
  services) **has no `arm64` build at all** on Docker Hub — this silently
  broke every one of those Dockerfiles the first time CI actually tried an
  arm64 build (`d04d410`). Fixed by switching to
  `eclipse-temurin:17-jre-jammy` (Ubuntu-based, confirmed multi-arch
  including `linux/arm64/v8`) — which also meant swapping Alpine's
  `addgroup`/`adduser` for Debian's `groupadd`/`useradd` in the non-root
  user setup, since busybox's syntax doesn't exist on the new base image.

### 4. A GitHub Actions runner ran out of disk mid-build
`385c3f1` — `ai-analysis-service`'s build failed with `ENOSPC` during
buildkit's "exporting to image" step. Root cause: `torch`'s default PyPI
wheel for `linux/arm64` transitively pulls in the **full CUDA toolkit**
(`nvidia-cublas`, `cudnn`, `cusolver`, `nccl`, `triton`, several GB) via
`sentence-transformers`, even though this service runs CPU-only on an
Oracle Ampere VM with no GPU at all. Fixed by installing `torch` from
PyTorch's dedicated CPU wheel index (`download.pytorch.org/whl/cpu`)
*before* the rest of `requirements.txt`, so `sentence-transformers`' torch
dependency is already satisfied by the small CPU build and pip never
resolves the GPU variant.

## Real-world build times (worth knowing if this ever feels slow)

Every image builds under QEMU-emulated arm64 on GitHub's x86 runners —
notoriously slower than a native build. Confirmed live during this
project's CPU-quota investigation: `worker-service-go`'s image build alone
took **~20 minutes** (16:27:36 → 16:47:54 UTC on one real run). This is an
inherent cost of cross-architecture emulation on shared CI infrastructure,
not something tunable from this repo's side without switching to native
ARM runners (a real option worth evaluating if build latency ever becomes a
bottleneck — see `07-RESOURCE-TUNING-AND-CAPACITY.md` for the broader
infra-cost context this project was also navigating).
