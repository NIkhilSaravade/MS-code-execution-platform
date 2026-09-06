# The Docker → Kubernetes Migration

## Why the old design had to go

The original code-execution sandbox ran on **Docker-outside-of-Docker**:
`worker-service-go` (or its Java predecessor) held a mount to the host's
`docker.sock` and launched sibling containers to run untrusted user code.

This is a well-known container-escape risk class: anything with access to
`docker.sock` effectively has root on the host, because it can ask the Docker
daemon to do arbitrary things (mount the host filesystem into a new
container, launch a privileged container, etc.). For a platform whose entire
job is *running arbitrary untrusted code submitted by strangers on the
internet*, this was an unacceptable amount of blast radius, and it also
doesn't translate to a Kubernetes Pod anyway — there's no `docker.sock`
inside a k3s Pod by default, and reintroducing one to keep the old design
would have made the k3s migration pointless.

The fix (commit `ebfa451`): rip out Docker-outside-of-Docker entirely and
replace it with **pooled, hardened Kubernetes Pods**, one pool per language.

## The new design: pooled sandbox Pods

`worker-service-go` (see `03-SANDBOX-EXECUTION-ENGINE.md` for the full internals)
now:
1. Keeps a small number of pre-warmed, idle Pods per language sitting ready
   (`SANDBOX_POOL_SIZE` per language — tuned down hard over the project's life,
   see `07-RESOURCE-TUNING-AND-CAPACITY.md`).
2. Checks one out for the lifetime of exactly one submission.
3. Execs into it via the Kubernetes `pods/exec` subresource — first to write
   the assembled source file in, then to compile (if needed), then once per
   test case to run it.
4. Deletes the Pod when the submission finishes. Pods are never reused across
   submissions, only within one submission's compile+run lifecycle.

This is a deliberate change from the old "one container per test case"
model: launching a fresh container per test case was fast enough under Docker,
but a Kubernetes Pod launch (schedule + kubelet + CNI setup) is far slower
than `docker run`, so compiling once and executing many times against the
same already-running Pod is what makes the latency tolerable.

## Security controls carried over (and how they map to Kubernetes)

Every control from the old Docker design has a direct Kubernetes equivalent,
documented explicitly in `podspec.go`'s header comment so nobody removes one
without understanding why it's there:

| Docker mechanism | Kubernetes equivalent |
|---|---|
| `--network none` | No direct per-Pod field exists. Enforced instead via a namespace-wide **default-deny `NetworkPolicy`** (`infra/k8s/01-networkpolicy.yaml`) with empty `podSelector: {}` and no ingress/egress rules at all — denies everything, both directions, for every pod in `sandbox-execution`. |
| `--pids-limit` | Not a per-Pod field in Kubernetes — only exposed as a **node-wide** kubelet flag (`--pod-max-pids`). Documented in `infra/k8s/README.md` rather than configured per-sandbox. |
| Non-root user (old entrypoint.sh chown) | `SecurityContext.RunAsUser: 65534` ("nobody"), `RunAsNonRoot: true`, plus `FSGroup: 65534` so kubelet chowns the `emptyDir` mounts' group automatically — replaces the manual chown the old entrypoint script did. |
| Read-only container filesystem | `ReadOnlyRootFilesystem: true` |
| Dropped Linux capabilities | `Capabilities.Drop: ["ALL"]` |
| seccomp profile | `SeccompProfile` — defaults to `RuntimeDefault`, with an optional `Localhost` profile path for a custom, tighter profile (see the `sandbox-seccomp-provisioner` DaemonSet and `05-SECURITY-HARDENING.md`) |
| `--tmpfs /tmp:size=64m,noexec,nosuid` | A `tmp` volume: `emptyDir{Medium: Memory, SizeLimit: 64Mi}` — memory-backed, tiny, mirrors the old flags exactly |
| Old shared-volume compile→run handoff | Not needed anymore — compile and every test-case exec are separate `exec` calls into the **same already-running container**, so they already share a filesystem (the `scratch` `emptyDir` mounted at `/sandbox`) without any cross-container volume plumbing |
| `docker stats` for peak memory | Not available per-Pod. Replaced by execing a tight polling loop into the same container that reads cgroup v2's `/sys/fs/cgroup/memory.current` directly and streams samples back over the exec stdout — one long-lived exec session per test case rather than one process-spawn per sample. |

## CPU isolation (and its own follow-up story)

CPU is enforced via the container's `Resources.Requests`/`Limits` set equal to
each other (a "Guaranteed" QoS pod) — this is what the whole
`SANDBOX_CPU_QUOTA*` tuning saga in `07-RESOURCE-TUNING-AND-CAPACITY.md` is
about. Getting this number right (and eventually, right *per language*) was
one of the hardest and most recurring problems across this project's life.

## What broke during real validation (and is worth knowing about)

The migration commit's message calls out two concrete findings from testing
against a **real** k3s+Calico cluster (not just a manifest that looks correct
on paper):

1. **Node-wide `pod-max-pids=64` broke Calico's own `calico-node` agent** —
   the CNI's own control-plane component needed more than the tight PID limit
   meant for sandbox pods. Calico needs **2048+** PIDs to function; the
   sandbox-appropriate PID ceiling can't just be applied node-wide.
2. **Cold sandbox image pulls can exceed the pod-startup timeout** on a
   submission's very first run for a given language — the first person to
   submit Go (say) pays the image-pull cost inline, which can blow past
   `SANDBOX_POD_STARTUP_TIMEOUT` (30s default) and surface to the user as
   "Timed out waiting for a judging result."

Both are documented in `infra/k8s/README.md` as prerequisites/gotchas for
anyone standing this cluster up fresh.

## The Flannel → Calico swap this all depends on

k3s ships with **Flannel** as its default CNI, and Flannel **does not enforce
`NetworkPolicy` objects at all** — the default-deny policy above would
silently do nothing on a stock k3s install, giving a false sense of security
(the manifest exists and looks correct, but nothing is actually blocked).
This cluster was bootstrapped with Flannel disabled and Calico installed
instead specifically to make the security model real, not just documented.
This was validated directly this session too: a live `wget` from inside a
sandbox pod failed with `bad address` (DNS resolution blocked), proving the
policy is actually enforced, not just present — see `13-INCIDENT-POSTMORTEMS.md`.

## Removing the old worker entirely

Once `worker-service-go` was proven out, the legacy Java `worker-service`
(the Docker-outside-of-Docker implementation) was fully deleted, not just
disabled behind a flag — including its OAuth client/secret, its Kafka
ACLs (`submission-topic`, `worker-group`), and every stale comment/README
reference to it (`ebd12c2`, `9805295`, `3798270`, `bef303f`, `8660f4d`,
`b0bdac3`, `68eaea`). This is worth calling out as good practice: once a
migration is validated, remove the old path completely rather than leaving
two implementations to drift out of sync.
