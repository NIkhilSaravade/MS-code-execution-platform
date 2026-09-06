# Resource Tuning & Capacity Planning: the full saga

This is the single most recurring theme across the entire project's history —
running ~14 services plus a pooled sandbox execution engine on **one 4-vCPU /
24GB node** (Oracle Cloud's free-tier Ampere A1 ARM VM). Nearly every
"intermittent flakiness" bug this project hit traces back to CPU or memory
overcommit on this one box. This document is the full chronological story,
because understanding it as a sequence matters more than any single fix.

## The fundamental constraint

Kubernetes schedules pods against **requests**, not real-time usage. A pod
whose request doesn't fit in the node's remaining allocatable capacity sits
`Pending` forever, regardless of how idle the node actually is. This
platform hit that exact trap **multiple times**, at different layers, before
the pattern was fully internalized.

## Chapter 1 — the app services overcommitted the node before anything else ran

All 9 Java app-service Deployments together requested up to **1150m CPU** on
a node with only **4000m allocatable**. Combined with `worker-service-go`,
the sandbox seccomp DaemonSet, and k3s/Calico's own system pods, total
*requested* CPU hit **3900m (97%)** — confirmed live: 3 of the 9 services
(auth, problem, ai-analysis) sat `Pending` indefinitely with
`Insufficient cpu`, **even though actual node CPU usage was ~12%**. This is
the requests-vs-usage gap in its purest form. Fixed (`641170b`) by halving
requests across all 9 manifests (100m→50m, 150m→75m) while leaving *limits*
untouched — each service can still burst to its existing ceiling under real
load; only the scheduling-time reservation shrank.

`worker-service-go` hit the identical trap the first time it was ever
actually deployed (`dabc9d8`): the node was already at 3800m/4000m (95%)
requested, leaving only 200m free — not enough for its 250m request. Fixed
the same way: most of this service's real CPU work happens inside the
sandbox pods it orchestrates, not in the orchestrator process itself, so
100m was plenty for its own reservation.

## Chapter 2 — JVM heap caps, because 10 uncapped JVMs don't share a box well

None of the 9 JVMs had a heap cap (`-Xmx`) — each defaults to a fraction of
whatever memory the container/host reports, which doesn't budget sanely once
~10 JVMs, Kafka, Zookeeper, Postgres, and MinIO all share one 24GB box.
`b779afa` set `JAVA_TOOL_OPTIONS` per service, sized by actual role rather
than a flat number:

| Tier | Services | `-Xmx` | Why |
|---|---|---|---|
| Low | discovery, config*, user, execution-result | 256m | Low-traffic CRUD or largely inert |
| Medium | auth, solution | 320m | RS256 signing / gRPC / S3 streaming |
| Medium-high | problem, submission | 384m | S3 + Kafka + harness generation |
| Highest | api-gateway | 400m | WebFlux, highest request volume, most held-open connections |

*(`config-service` was later removed entirely — see `01-ARCHITECTURE-OVERVIEW.md`.)*

Total heap budget: ~2.8GB across all 9, leaving the rest of the 24GB box for
Kafka/Zookeeper/Postgres/MinIO/Redis, `ai-analysis-service`'s torch/
transformers footprint, and the sandbox pods `worker-service-go` spins up
(each independently capped via `SANDBOX_MEMORY_MB`). Verified live, not just
by reading the config: rebuilt/restarted `api-gateway`, confirmed the JVM's
own startup log line `Picked up JAVA_TOOL_OPTIONS: -Xmx400m`, and that
`/actuator/health` still returned 200 at that cap.

`ai-analysis-service` needed its own memory fix separately (`0cae07e`) — it
was getting `OOMKilled` (exit 137) a few seconds after every startup. It
loads a HuggingFace `sentence-transformers` embeddings model, and PyTorch
plus the model weights alone routinely exceed 512Mi on top of FastAPI/
uvicorn's own baseline. Since the node had ~4.2GB requested against 24GB
total at the time, there was plenty of headroom to simply raise the limit
rather than trim anything else.

## Chapter 3 — the sandbox pool itself was oversized for this node

`worker-service-go`'s **code defaults** — `SANDBOX_CPU_QUOTA=1.0` (a full
CPU per sandbox pod) and `SANDBOX_POOL_SIZE=3` (three idle pods kept warm
*per language*) — assume a node with real headroom. On this 4-vCPU VM, with
~10 platform services also holding their own CPU requests, those defaults
let only 2-3 sandbox pods schedule **at all** before the node ran out of
allocatable CPU — every language after that sat `Pending` forever, and every
submission needing it timed out after `SANDBOX_POD_STARTUP_TIMEOUT` (30s),
surfacing to users as "Timed out waiting for a judging result." `b2d41d0`
documented the fix already applied live to the ConfigMap:
`SANDBOX_CPU_QUOTA=0.3`, `SANDBOX_POOL_SIZE=2`.

## Chapter 4 — this session's crisis: adding a 6th/7th language broke the budget again

Even at `0.3`/`2`, the math didn't hold once **Go** (and, separately, C) were
being exercised as new languages: 5 languages × pool size 2 × 300m = 3000m,
on top of the platform's own ~700m requests — new-language sandbox pods
simply couldn't schedule. Diagnosed via full resource accounting across
every namespace (`kube-system`: 200m, `platform`: 700m requests / 6700m
limits, `sandbox-execution`: 3000m for 10 pods). **Fix**: drop
`SANDBOX_POOL_SIZE` to **1** — confirmed live, CPU requests dropped from
3900m/97% to 900m/22%, and Go's pod could finally schedule (surfacing the
next, deeper bug — see `13-INCIDENT-POSTMORTEMS.md`).

## Chapter 5 — Go needed CPU the platform-wide quota couldn't give it

Once Go could schedule, it still failed — not from a scheduling problem, but
from **CFS throttling stretching a real compile job past its timeout**. Live
reproduction inside a running `sandbox-go` pod showed `go build` needed
~10.17s of actual CPU time (user+sys) for a trivial, dependency-free
program; under the platform's `0.3` CPU quota, CFS throttling stretched that
into **34.68s of wall-clock time** — comfortably exceeding the compile
step's ~15s timeout, killing the process before it ever printed anything.
Full detail in `13-INCIDENT-POSTMORTEMS.md`. The fix: a **per-language CPU
quota override** (`SandboxCPUQuotaGo`, defaulting to a full core), leaving
every other language on the platform default. See `03-SANDBOX-EXECUTION-
ENGINE.md` for the mechanism.

## Chapter 6 — right-sizing every language, and clawing back the margin that cost

Bumping Go to a full CPU ate real headroom (the always-warm pool went from
~2100m to ~2800m total CPU committed, at pool size 1). Two follow-up moves,
both from later in this same session:

1. **Per-language quota tiers for every language, not just Go** — Python/
   JavaScript (pure interpretation, no compile step) dropped to `0.15`;
   Java/TypeScript (real compile steps — `javac`/`tsc` — sitting at the same
   `0.3` that broke Go) raised to `0.5` as pre-emptive insurance against the
   same failure class, without waiting for a live incident to prove it;
   C/C++ stayed at `0.3` (small native compiles are cheap enough).
2. **Trimmed oversized platform-namespace CPU *limits*** (not requests) —
   auth/gateway/submission/problem services from 750m→500m,
   ai-analysis/execution-result from 500m→400m, user/solution from
   500m→350m. This doesn't change what gets scheduled; it caps how far
   simultaneous bursts across services can stack, directly targeting the
   mechanism behind the recurring "works, then randomly doesn't" reports
   (a service missing an Eureka heartbeat or timing out a downstream call
   because CFS throttled it mid-burst). Platform-wide limits dropped from
   **6700m (167% of node capacity) to 5200m (130%)**.

## The numbers, end to end (as of this session)

| Layer | CPU committed |
|---|---|
| `kube-system` | ~200m |
| `platform` namespace requests | ~700m (unchanged throughout) |
| `platform` namespace limits | 5200m (down from 6700m) |
| `sandbox-execution`, fully warmed (6 languages × their tier + Go × 1.0) | ~2800m |
| **Total committed, fully warmed** | **~3700m / 4000m (93%)** |
| **Real slack for traffic bursts** | **~300m (7%)** |

Actual live usage measured via `kubectl top node` at the same time: **11%
CPU, 32% memory** — the physical hardware is nowhere near saturated; the
constraint is entirely in how much has been *reserved on paper*.

## Where this leaves the platform, honestly

This is a demo/small-team-scale configuration, not something to point real
concurrent traffic at without either a bigger node, a second node (ruled out
for this project — single VM only), or continuing to trim reservations
closer to real observed need. The single biggest remaining lever not yet
pulled: this node is running on Oracle's "Always Free" tier, which was
**silently cut from 4 OCPU/24GB to 2 OCPU/12GB** industry-wide in mid-2026 —
a genuine, external risk to this deployment's current capacity that exists
independent of anything in this codebase. See the session transcript around
the Oracle free-tier discussion for the cost math on paid alternatives
(Oracle PAYG top-up, Hetzner's ARM `CAX` line, or self-hosting on
already-owned Apple Silicon hardware).
