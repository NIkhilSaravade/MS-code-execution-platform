# Platform on Kubernetes (k3s)

Manifests for the Docker-Compose → Kubernetes migration. `00`-`04` cover
worker-service-go's sandbox execution mechanism specifically (see the design
discussion in the project history for that reasoning); `05`-`14` cover the
other 9 services (discovery, auth, user, api-gateway, problem, submission,
solution, execution-result, ai-analysis). This file covers the operational
steps for both.

**Scope of this pass: PROD only** (the `platform` namespace). UAT
(`platform-uat`) is a deliberate follow-up, not done here - see "Known
simplifications" at the bottom.

**Design decision: Kafka/Postgres/MinIO/Redis stay OUTSIDE Kubernetes.** They
keep running via `docker-compose` on this same VM (reusing the existing
hardened setup - TLS certs, Kafka ACLs, DB init scripts - rather than
re-running them as Kubernetes StatefulSets). Only the 10 application services
(9 Java/Python services here, plus worker-service-go) move into Kubernetes.
They reach the docker-compose infra over the VM's own network - see the
`infra-endpoints` ConfigMap (`05-configmap-infra-endpoints.yaml`).

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
and `worker-service-go-secrets` Secret that aren't included here. It also
needs the `kafka-ca-cert` ConfigMap (same one the other services use) already
present. Create them from the VM, reusing whatever's already in `.env`:

```bash
set -a; source .env; set +a

kubectl create configmap worker-service-go-config -n platform \
  --from-literal=KAFKA_BROKERS=10.0.0.14:9093 \
  --from-literal=EUREKA_SERVER_URL=http://discovery-service:8761/eureka \
  --from-literal=S3_ENDPOINT=http://10.0.0.14:9000 \
  --from-literal=S3_BUCKET_ARTIFACTS=platform-artifacts \
  --from-literal=S3_BUCKET_TEST_CASES=platform-test-cases \
  --from-literal=OTEL_EXPORTER_OTLP_ENDPOINT=http://10.0.0.14:4318 \
  --from-literal=KAFKA_SASL_USERNAME=worker \
  --from-literal=KAFKA_TLS_CA_CERT_PATH=/certs/ca.crt

kubectl create secret generic worker-service-go-secrets -n platform \
  --from-literal=KAFKA_SASL_PASSWORD="$KAFKA_WORKER_PASSWORD" \
  --from-literal=S3_ACCESS_KEY="$MINIO_ROOT_USER" \
  --from-literal=S3_SECRET_KEY="$MINIO_ROOT_PASSWORD"
```

(Swap `10.0.0.14` for the VM's actual private IP if it ever changes - same
value already used throughout `05-configmap-infra-endpoints.yaml`.)

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

## Deploying the other 9 services (05-14)

Before applying these, the docker-compose infra needs two port changes to be
reachable from Kubernetes pods (both already made in `docker-compose.yml`,
just restart the affected containers on the VM to pick them up):
```bash
docker compose up -d redis otel-collector
```
Redis and the OTel Collector didn't publish any port to the host before
(only ever reached by other docker-compose containers on the internal
network) - api-gateway and ai-analysis-service, now Kubernetes pods, need to
reach them over the VM's own network like everything else in
`infra-endpoints`.

### 1. CA cert ConfigMaps

Same pattern as the seccomp profile - generated/maintained artifacts, not
duplicated into a manifest:
```bash
kubectl create configmap postgres-ca-cert -n platform \
  --from-file=postgres-ca.crt=../postgres/certs/ca.crt
kubectl create configmap kafka-ca-cert -n platform \
  --from-file=ca.crt=../kafka/certs/ca.crt
```

### 2. Secrets

Every value below is the SAME password already sitting in your `.env` file
for local docker-compose - copy them over, don't generate new ones (unless
you're rotating, which you should do at some point before this is a public
site - see `.env.example`'s own "rotate before any real deployment" notes).

```bash
kubectl create secret generic auth-service-secrets -n platform \
  --from-literal=DB_APP_PASSWORD='<AUTH_SERVICE_DB_APP_PASSWORD>' \
  --from-literal=DB_OWNER_PASSWORD='<AUTH_SERVICE_DB_OWNER_PASSWORD>'

# auth-service's JWT signing key never lives in git or the Docker image -
# it's loaded from this Secret at runtime (see JwtKeyConfig.java). Point
# --from-file at wherever your actual jwt-private.pem is; it must match
# the public key already committed at
# auth-service/src/main/resources/keys/jwt-public.pem.
kubectl create secret generic auth-service-jwt-key -n platform \
  --from-file=jwt-private.pem=/path/to/your/jwt-private.pem

kubectl create secret generic user-service-secrets -n platform \
  --from-literal=DB_APP_PASSWORD='<USER_SERVICE_DB_APP_PASSWORD>' \
  --from-literal=DB_OWNER_PASSWORD='<USER_SERVICE_DB_OWNER_PASSWORD>' \
  --from-literal=ADMIN_EMAIL='<ADMIN_EMAIL>' \
  --from-literal=ADMIN_PASSWORD='<ADMIN_PASSWORD>'

kubectl create secret generic api-gateway-secrets -n platform \
  --from-literal=REDIS_PASSWORD='<REDIS_PASSWORD>'

kubectl create secret generic problem-service-secrets -n platform \
  --from-literal=DB_APP_PASSWORD='<PROBLEM_SERVICE_DB_APP_PASSWORD>' \
  --from-literal=DB_OWNER_PASSWORD='<PROBLEM_SERVICE_DB_OWNER_PASSWORD>'

kubectl create secret generic submission-service-secrets -n platform \
  --from-literal=DB_APP_PASSWORD='<SUBMISSION_SERVICE_DB_APP_PASSWORD>' \
  --from-literal=DB_OWNER_PASSWORD='<SUBMISSION_SERVICE_DB_OWNER_PASSWORD>' \
  --from-literal=KAFKA_PASSWORD='<KAFKA_SUBMISSION_SERVICE_PASSWORD>' \
  --from-literal=CLIENT_SECRET='<SUBMISSION_SERVICE_CLIENT_SECRET>'

kubectl create secret generic solution-service-secrets -n platform \
  --from-literal=DB_APP_PASSWORD='<SOLUTION_SERVICE_DB_APP_PASSWORD>' \
  --from-literal=DB_OWNER_PASSWORD='<SOLUTION_SERVICE_DB_OWNER_PASSWORD>'

kubectl create secret generic execution-result-service-secrets -n platform \
  --from-literal=DB_APP_PASSWORD='<EXECUTION_RESULT_SERVICE_DB_APP_PASSWORD>' \
  --from-literal=DB_OWNER_PASSWORD='<EXECUTION_RESULT_SERVICE_DB_OWNER_PASSWORD>' \
  --from-literal=KAFKA_PASSWORD='<KAFKA_EXECUTION_RESULT_SERVICE_PASSWORD>'

# ai-analysis-service has no separate app DB role (see
# infra/postgres/init-multiple-databases.sh's note) - DATABASE_URL embeds
# the owner password AND the host directly (Kubernetes doesn't expand
# ConfigMap values inside a Secret's own value), matching the .env format:
kubectl create secret generic ai-analysis-service-secrets -n platform \
  --from-literal=DATABASE_URL='postgresql://ai_analysis_owner:<AI_ANALYSIS_DB_OWNER_PASSWORD>@10.0.0.14:5432/ai_analysis_db?sslmode=verify-full&sslrootcert=/certs/postgres-ca.crt' \
  --from-literal=GROQ_API_KEY='<GROQ_API_KEY>' \
  --from-literal=KAFKA_PASSWORD='<KAFKA_AI_ANALYSIS_SERVICE_PASSWORD>' \
  --from-literal=CLIENT_SECRET='<AI_ANALYSIS_SERVICE_CLIENT_SECRET>'

# Shared across problem/submission/solution-service - same MinIO root
# credentials already used in docker-compose (not per-service roles yet).
kubectl create secret generic minio-credentials -n platform \
  --from-literal=ACCESS_KEY='<MINIO_ROOT_USER>' \
  --from-literal=SECRET_KEY='<MINIO_ROOT_PASSWORD>'
```

### 3. Apply

```bash
kubectl apply -f 05-configmap-infra-endpoints.yaml
kubectl apply -f 06-discovery-service.yaml
kubectl apply -f 07-auth-service.yaml
kubectl apply -f 08-user-service.yaml
kubectl apply -f 09-api-gateway.yaml
kubectl apply -f 10-problem-service.yaml
kubectl apply -f 11-submission-service.yaml
kubectl apply -f 12-solution-service.yaml
kubectl apply -f 13-execution-result-service.yaml
kubectl apply -f 14-ai-analysis-service.yaml
```
Apply `06` first and wait for it to be Ready (`kubectl rollout status
deployment/discovery-service -n platform`) - every other service registers
with it on startup and logs noisy (though not fatal) connection errors until
it's up.

### Exposing api-gateway

Via a Cloudflare Tunnel, run as its own Deployment (`15-cloudflared.yaml`)
inside the `platform` namespace rather than as a docker-compose container -
running it in-cluster lets it resolve `api-gateway` over the cluster's own
DNS with no NodePort or host networking needed.

1. In the Cloudflare Zero Trust dashboard (Networks -> Tunnels), create a
   tunnel and copy its token (shown in the install command for any OS/Docker
   - only the token value after `--token`/`service install` is needed, the
   command itself is never run).
2. Under that tunnel's Public Hostname settings, add:
   `api.nikhilsaravade.com` -> HTTP ->
   `api-gateway.platform.svc.cluster.local:8080`.
3. Create the Secret and apply the manifest:
   ```bash
   kubectl create secret generic cloudflared-token -n platform \
     --from-literal=token='<TUNNEL_TOKEN>'
   kubectl apply -f 15-cloudflared.yaml
   ```
4. Confirm it connected: `kubectl logs -n platform deployment/cloudflared`
   should show `Registered tunnel connection`, and the tunnel should show
   `HEALTHY` in the dashboard.

## Known simplifications in this first pass (flagged, not hidden)

- **UAT (`platform-uat`) not deployed yet.** Everything above targets
  `platform` (Prod) only. UAT needs the same 10 manifests duplicated with
  `namespace: platform-uat`, database names suffixed `_uat` (or a separate
  schema), and separate Kafka client identities/consumer groups - sharing
  the SAME docker-compose Postgres/Kafka/MinIO/Redis instances as Prod
  (see the design decision above) but logically separated. Not yet worth a
  full Kustomize base/overlay refactor at 10 services; revisit if hand-
  duplicating these files becomes painful.
- **Image tags track `:latest`.** Fine for a single-developer project
  learning the deploy loop; pin to `:sha-<shortsha>` or `:vX.Y.Z` tags once
  ArgoCD/promotion-by-tag is set up (see the release/UAT/Prod promotion
  design discussed separately).
- **No resource-tier tuning yet.** CPU/memory requests and limits here are
  reasonable starting points sized off each service's existing
  `JAVA_TOOL_OPTIONS -Xmx` value, not measured under real load.

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
