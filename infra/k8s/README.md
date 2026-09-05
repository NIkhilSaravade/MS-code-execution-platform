# worker-service-go on Kubernetes (k3s)

Manifests for the Docker-Compose → Kubernetes migration of worker-service-go's
sandbox execution mechanism. See the design discussion in the project history
for the full reasoning; this file only covers the operational steps.

## Apply order

```bash
kubectl apply -f 00-namespace.yaml

# Calico itself (see prerequisite 1 below) - install the operator, then
# point its Installation CR at your cluster's actual pod CIDR. k3s's
# default is 10.42.0.0/16 (what calico-custom-resources.yaml here assumes -
# check your own cluster's --cluster-cidr if you set one):
kubectl apply --server-side -f https://raw.githubusercontent.com/projectcalico/calico/v3.28.0/manifests/tigera-operator.yaml
kubectl apply -f calico-custom-resources.yaml
kubectl wait --for=condition=Ready node --all --timeout=180s

kubectl apply -f 01-networkpolicy.yaml
kubectl apply -f 02-worker-rbac.yaml

# Seccomp profile must exist as a ConfigMap before the DaemonSet that
# installs it onto every node:
kubectl create configmap sandbox-seccomp-profile -n platform \
  --from-file=execution.json=../../worker-service-go/docker/seccomp/execution.json
kubectl apply -f 03-seccomp-provisioner.yaml

# Wait for the DaemonSet's init container to finish on every node before
# scheduling any sandbox pod that references the localhost profile - a race
# here just shows up as sandbox pods stuck Pending/ContainerCreating.
kubectl rollout status daemonset/sandbox-seccomp-provisioner -n platform

kubectl apply -f 04-worker-deployment.yaml
```

Pre-pull the sandbox language images onto every node before real traffic
arrives - confirmed on a real cluster that a cold first pull of a large
image (`gcc:14` is ~500MB) can exceed `SANDBOX_POD_STARTUP_TIMEOUT`'s
default 30s, which fails that submission with "checkout sandbox pod:
context deadline exceeded" even though nothing is actually broken:
```bash
for img in python:3.12-slim eclipse-temurin:21-jdk-alpine gcc:14 node:20-slim golang:1.22-alpine; do
  ctr -n k8s.io images pull docker.io/library/$img
done
# node-typescript is now built and pushed to ghcr.io by
# .github/workflows/docker-build-push.yml (see "Container registry access"
# below for the pull secret this needs) - pull it like any other image
# instead of the old local `docker build` + `docker save | ctr import` dance:
ctr -n k8s.io images pull --hosts-dir /etc/containerd/certs.d \
  ghcr.io/nikhilsaravade/ms-code-execution-platform/node-typescript-sandbox:latest
```
`LANG_IMAGE_TYPESCRIPT` (`worker-service-go`'s `internal/config/config.go`)
needs to point at this new ghcr.io tag instead of the old local
`platform/node-typescript:20` tag.

### Container registry access

Every image referenced above (`worker-service-go` itself in
`04-worker-deployment.yaml`, and `node-typescript-sandbox`) is built and
pushed to `ghcr.io` by `.github/workflows/docker-build-push.yml` on every
push to `main` that touches that service's directory. `ghcr.io` packages
default to private, so both `containerd` (for the sandbox image pre-pull
above) and the cluster (for `worker-service-go`'s own Deployment) need
credentials to pull them:

```bash
# A classic PAT with read:packages scope, or a fine-grained token scoped to
# this repo's packages - not the GITHUB_TOKEN the workflow itself uses,
# that's only valid for the duration of that workflow run.
kubectl create secret docker-registry ghcr-pull-secret \
  -n platform \
  --docker-server=ghcr.io \
  --docker-username=<your-github-username> \
  --docker-password=<PAT with read:packages> \
  --docker-email=<your-email>
```
`04-worker-deployment.yaml` already references this secret via
`imagePullSecrets`. For `containerd`'s own pulls (the sandbox image
pre-pull step), configure the same credentials in
`/etc/containerd/certs.d/ghcr.io/hosts.toml` (k3s's registry-auth config
path) on every node - or simplest for a single-node dev cluster, make the
`node-typescript-sandbox` package public in its GitHub package settings and
skip registry auth for that one pull entirely.

Alternatively, skip ghcr.io for the sandbox image entirely and keep
building+importing it locally exactly as before (`docker build` +
`docker save | ctr import`) - the workflow only replaces the old manual
step if you want it to.

### Validated

This has been run end-to-end against a real (single-node, WSL2) k3s cluster
with Calico installed: pod pool checkout, source-file write over exec,
compile-once/run-N-times against the same pod, stdin attach, the seccomp
Localhost profile, and - most importantly - that the default-deny
NetworkPolicy actually blocks egress from inside a sandbox pod (not just
"applied," actually enforced). See `worker-service-go/cmd/sandboxcheck` for
the throwaway tool used to check this; rerun it after any change to the
pool/exec/security-context code before trusting it again.

`04-worker-deployment.yaml` references a `worker-service-go-config` ConfigMap
and `worker-service-go-secrets` Secret that aren't included here (Kafka
brokers/credentials, S3 endpoint/keys, OTLP endpoint, etc. - same values as
the service's existing `.env`/docker-compose environment) - create those the
same way you would for any other service's move to this cluster.

## Prerequisites this depends on - do these BEFORE applying the above

1. **CNI swap: Flannel → Calico.** k3s's default CNI (Flannel) does not
   enforce `NetworkPolicy` objects at all - `01-networkpolicy.yaml` would
   silently do nothing without this. Install k3s with Flannel disabled and
   install Calico's own manifests instead:
   ```bash
   curl -sfL https://get.k3s.io | sh -s - server \
     --flannel-backend=none --disable-network-policy=false
   # then install Calico per its own installation docs for your k3s version
   ```
   This is a cluster-bootstrap decision, not something scoped to just this
   service - it affects every other workload you migrate onto this cluster.

2. **`--pod-max-pids` kubelet setting.** There is no per-Pod pids-limit field
   in the Kubernetes API (the old Docker design's `--pids-limit 64` has no
   direct per-pod equivalent) - it's a node-wide kubelet setting, applied to
   *every* pod on the node, sandbox or not.

   ⚠️ **`pod-max-pids=64` is CONFIRMED too low, not just theoretically risky.**
   Validated on a real single-node k3s cluster: with this set, `calico-node`
   (Calico's own per-node agent, running Felix/BIRD/confd) crashed
   repeatedly with `runsv confd: warning: unable to fork, sleeping: temporary
   failure` and never became Ready - it needs meaningfully more than 64
   pids for its own process tree. Raising it to 2048 fixed it immediately
   with no other changes. Use 2048 (or higher) as the real starting point,
   not 64 - the value has to cover the neediest *infra* pod on the node,
   not just what's "enough" for a sandboxed submission:
   ```bash
   curl -sfL https://get.k3s.io | sh -s - server \
     --kubelet-arg=pod-max-pids=2048 ...(your other flags)
   ```
   Practical consequence: this node-wide ceiling is a much weaker fork-bomb
   backstop for sandboxed code than the old per-container `--pids-limit 64`
   was (2048 vs 64) - it still catches a true fork bomb, just less tightly.
   The CPU quota and memory limit on each sandbox pod are what actually
   bound the damage now, more than pids-limit does.

3. **gVisor is deliberately NOT configured here.** The design's recommendation
   is to ship on plain `runc` first (matching what `docker-compose.yml`
   already runs in production) and only add a `RuntimeClass` for `runsc`
   later, after benchmarking gVisor's actual platform mode (`ptrace` vs
   `kvm`) on the real OCI ARM node - nested virtualization for the fast `kvm`
   platform is unlikely to be exposed on that shape. `SandboxRuntimeClassName`
   in worker-service-go's config is the knob for turning this on later
   (`SANDBOX_RUNTIME_CLASS=gvisor`); it stays empty (= node default) for now.

## Known simplifications in this first pass (flagged, not hidden)

- **One resource tier per language, not per-problem.** Pooled sandbox pods
  are all sized to `SANDBOX_MEMORY_MB`/`SANDBOX_CPU_QUOTA` (the platform
  defaults) - a problem's own, possibly-lower `MemoryLimitMB`/`CPUQuota`
  isn't yet used to size a differently-shaped pod (pods can't be resized
  after creation, and the request doesn't wait to learn the problem's limits
  before checking one out of the pool). If per-problem limits need to
  diverge meaningfully from the default, the pool needs bucketing by a small
  set of resource tiers - not implemented yet.
- **Isolation is scoped per-submission, not per-test-case.** All of one
  submission's test cases exec sequentially into the same pod (compile once,
  run N times) rather than each getting a fresh pod - see the design
  discussion for the reasoning. A resource leak in test case 3 can affect
  test case 4's measurements within the same submission; it cannot affect
  another submission or another user.
