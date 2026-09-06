# Sandbox Execution Engine (`worker-service-go`) Deep Dive

This is the single most complex, most fought-over piece of the platform. It's
worth understanding in full because nearly every hard bug this project hit
lived here.

## Core data structures

```go
type langDescriptor struct {
    Image          string     // sandbox image for this language
    CompileCmd     []string   // nil for interpreted languages
    ExecCmd        []string   // how to run the compiled/interpreted program
    SourceFilename string
    Env            []string   // extra KEY=VALUE env vars for this language's pod
    CPUQuota       float64    // per-language CPU override; 0 = use platform default
}
```

One `langDescriptor` exists per supported language (Python, Java, C++, C,
JavaScript, TypeScript, Go), built once at startup by `buildLangDescriptors`.

```go
type pool struct {
    sandbox *Sandbox
    lang    domain.Language
    desc    *langDescriptor
    ch      chan string   // channel of ready, warm pod names
    size    int
}
```

One `pool` per language, created **lazily** on that language's first-ever
submission after the process starts (not eagerly for all 7 languages at
boot) — a background goroutine (`replenish`) keeps its channel topped up to
`size` (from `SANDBOX_POOL_SIZE`) for as long as the process lives.

```go
type Session struct {
    sandbox *Sandbox
    lang    domain.Language
    desc    *langDescriptor
    podName string
    CompileError  bool
    CompileOutput []byte
}
```

One `Session` per submission — the object callers actually interact with:
`NewSession` → optional `RunTestCase` per test case → `Close` (deletes the pod).

## The submission lifecycle, step by step

1. **`NewSession`** is called with the language, source code, wall-clock
   timeout, memory limit, and CPU quota for this submission.
2. It calls `getOrCreatePool` for the language (creating the pool + starting
   its replenish goroutine on first use), then `pool.checkout(ctx)`.
3. **`checkout`** pulls a name off the pool's channel. Before handing it back,
   it verifies the pod is still `Running` via a live `Get` call — a pod that
   died after being queued (evicted, OOM-killed, or removed out of band, e.g.
   a manual `kubectl delete pods --all -n sandbox-execution`) gets discarded
   and checkout keeps trying instead of returning a dead name. If the channel
   is empty for longer than `SandboxPoolCheckoutTimeout`, it falls back to
   creating a fresh pod on demand for this one submission (eating the ~1-3s
   Pod-start latency rather than blocking indefinitely).
4. The source file is written into `/sandbox/<filename>` via `writeFileToPod`
   — which pipes the content as stdin to `cat > <path>` executed inside the
   pod over the `pods/exec` subresource (there's no direct "copy file in"
   primitive; this is the same trick `kubectl cp` uses internally, without
   the tar layer since it's always exactly one file to a known path).
5. If a pod turns out to have died in the narrow window between step 3's
   health check and this write, `NewSession` retries **once** against a
   guaranteed-fresh, on-demand pod rather than failing the whole submission.
6. If `desc.CompileCmd` is set, it's executed with a timeout of
   `max(WallTimeout * 3, minCompileTimeout=15s)`. Both stdout and stderr are
   captured into a combined, size-capped buffer (`cappedBuffer`) — captured
   *together* because some toolchain failures print to stdout instead of
   stderr (see the Go `GOCACHE` postmortem in `13-INCIDENT-POSTMORTEMS.md`),
   and a stderr-only capture would silently produce an undiagnosable,
   empty-reason `CE`.
7. A nonzero exit code or a timeout during compile sets `CompileError = true`
   and stores the combined output — the caller (`executor.go`) then marks
   every test case `CE` without ever calling `RunTestCase`.
8. Otherwise, `RunTestCase` execs `ExecCmd` once per test case against the
   **same already-running pod**, applying the request's wall-clock timeout
   per case, sampling peak memory via the cgroup-polling exec described in
   `02-KUBERNETES-MIGRATION.md`.
9. `Session.Close()` deletes the pod unconditionally — pods are single-use
   per submission, never returned to the pool.

## Per-language CPU quota tiers (the hard-won part)

Every sandbox pod's CPU `requests == limits` (Guaranteed QoS). For most of
the project's life this was one global knob, `SANDBOX_CPU_QUOTA`. That
turned out to be wrong: different languages have wildly different real CPU
needs to *compile* (interpreted languages need almost none; Go's toolchain
needs several real CPU-seconds even for a trivial file). See
`07-RESOURCE-TUNING-AND-CAPACITY.md` for the full story of how this was
discovered and fixed — the short version is `langDescriptor.CPUQuota`
lets each language override the platform default:

| Language | CPU quota | Why |
|---|---|---|
| Go | `1.0` (full core) | Toolchain needs ~10s of real CPU even for a one-file program; under a low quota, CFS throttling stretched that into 30+ seconds of wall-clock time and blew the compile timeout |
| Java, TypeScript | `0.5` | Real compile step (`javac`/`tsc`) - same risk class as Go, given a safety margin as insurance |
| Python, JavaScript | `0.15` | Pure interpretation, no compile step at all |
| C, C++ | `0.3` (platform default) | Small native compiles are cheap enough that no override was needed |

## `GOTMPDIR`/`GOCACHE`/`GOPROXY`/`GOSUMDB` — Go needed more than just a CPU fix

Go's `langDescriptor` env carries several deliberately-set variables, each
fixing a distinct, separately-discovered bug (all documented in full in
`13-INCIDENT-POSTMORTEMS.md`):

```go
Env: []string{
    "GOCACHE=/sandbox/.gocache",   // NOT /tmp - see the tmpfs-exhaustion postmortem
    "GOTMPDIR=/sandbox/.gotmp",    // must be mkdir'd first - Go stats it, never creates it
    "HOME=/sandbox",
    "GOMAXPROCS=1",
    "GOFLAGS=-p=1",
    "GOPROXY=off",                 // sandbox has zero network egress by design
    "GOSUMDB=off",
}
CompileCmd: []string{"sh", "-c",
    "mkdir -p /sandbox/.gocache /sandbox/.gotmp && go build -o /sandbox/solution /sandbox/solution.go"},
```

## What's still a known simplification

Pooled pods are all sized uniformly per language by `cfg.SandboxCPUQuota`
(or its per-language override) and `cfg.SandboxMemoryMB` — a problem's own,
possibly-lower per-problem `MemoryLimitMB`/`CPUQuota` isn't yet used to
provision a differently-shaped pod. A future iteration would bucket the pool
by a small set of resource tiers if per-problem limits ever need to diverge
meaningfully from the platform default. This is flagged directly in the code
(`sandbox.go`'s `Session` doc comment) rather than silently left unexplained.
