# Deployment & Operations Runbook

Practical, copy-pasteable operational knowledge accumulated across this
project's life. This is the "how do I actually operate this thing" document.

## Standard deploy cycle (manual — see `06-CI-CD-PIPELINE.md` for the CD gap)

1. Merge the PR into `main`. GitHub Actions builds and pushes the changed
   service(s)' image(s) to `ghcr.io` automatically (~15-20 minutes for a Go
   or Java image under QEMU-emulated arm64 — this is inherent to
   cross-architecture emulation on shared CI runners, not something to
   optimize away from this repo's side alone).
2. On the VM:
   ```
   git pull origin main
   kubectl rollout restart deployment/<service> -n platform
   kubectl rollout status deployment/<service> -n platform   # blocks until actually rolled out
   ```
   `rollout status` matters — don't assume a restart succeeded just because
   the restart command returned; wait for "successfully rolled out."
3. **If the change touched `worker-service-go`'s sandbox pool config or
   language descriptors**, also clear stale pool state:
   ```
   kubectl delete pods --all -n sandbox-execution
   ```
   This is necessary because the sandbox pool is **in-process memory** —
   restarting `worker-service-go` resets its pool tracking, but any
   still-running sandbox pods from before the restart are untouched by that
   restart and may carry stale env vars/config from before the change.
4. **If the change touched platform-namespace resource limits** (not just
   one service's code), restart **every affected Deployment**, not just
   `worker-service-go` — a resource-limit change only takes effect on a
   pod's next creation, not by editing the manifest alone.
5. Sandbox pools are created **lazily**, one language at a time, on that
   language's first submission after a restart — `sandbox-execution`
   showing zero pods immediately after a restart is expected, not a bug.
   The first submission for each language pays a one-time on-demand pod
   creation cost (a few seconds slower).

## Common namespace/flag mistakes (already hit, worth avoiding)

- `kubectl rollout restart deployment/X` **without `-n platform`** silently
  targets the wrong (default) namespace and fails with
  `deployments.apps "X" not found` — easy to misread as "the deployment
  doesn't exist" rather than "wrong namespace."
- Never assume a merged PR's commits are live without confirming via
  `git log` on the actual branch — see Postmortem 4 in
  `13-INCIDENT-POSTMORTEMS.md` for a real instance of this exact mistake.

## Health-check commands (this project's actual triage sequence)

```
kubectl top node                                    # is the node itself under CPU/mem pressure right now?
kubectl get pods -A -o wide                          # any CrashLoopBackOff, Pending, high restart counts?
kubectl top pods -n platform --sort-by=cpu           # who's actually using CPU right now?
kubectl get events -A --sort-by='.lastTimestamp' | tail -30   # recent cluster-level events
```

Per-service Actuator health (all 9 Java services + ai-analysis-service +
worker-service-go expose this):
```
kubectl exec -n platform deploy/<service> -- curl -s localhost:<port>/actuator/health
```

Eureka's own view of the mesh (the single most useful check given how much
of this project's flakiness traced back to service-discovery issues):
```
kubectl exec -n platform deploy/discovery-service -- curl -s localhost:8761/eureka/apps | grep -E "app name|status"
```

## Database inspection (direct psql, when the frontend/API layer isn't enough)

Database-per-service naming (see `10-DATA-STORAGE-MESSAGING.md`):
```
docker exec -it postgres psql -U postgres -d submission_service -c \
  "SELECT id, language, status, submitted_at FROM submission ORDER BY id DESC LIMIT 5;"

docker exec -it postgres psql -U postgres -d execution_result_service -c \
  "SELECT submission_id, status, output, reason FROM execution_result WHERE submission_id = <id>;"
```
Note: for a `CE` verdict, the compiler's diagnostic text lives in the
**`output`** column, not `reason` — `reason` is only ever populated for
infrastructure-level `SYSTEM_ERROR`s (see `executor.go`'s `Handle`, which
hardcodes `reason=""` on every normal judged-result path).

## Live sandbox-pod reproduction (the technique that solved every hard bug)

Find a warm pod for a language, exec in, and run the exact production
command with the exact production env vars — this is how every postmortem
in `13-INCIDENT-POSTMORTEMS.md` was actually root-caused, not guessed at:

```
kubectl get pods -n sandbox-execution -l sandbox.platform/language=<lang>
kubectl exec -it <pod-name> -n sandbox-execution -- sh
```
Once inside, check what env vars are actually present (don't assume a
deploy took effect — verify):
```
echo GOPROXY=$GOPROXY GOSUMDB=$GOSUMDB GOTMPDIR=$GOTMPDIR
```
Time a real build to see whether it's failing fast, succeeding fast, or
succeeding-but-too-slow (the CPU-throttling signature — see Postmortem 5):
```
time go build -o /sandbox/solution /sandbox/solution.go
```

## Verifying a CI build actually finished before redeploying

Don't guess based on elapsed time — a QEMU-emulated arm64 build genuinely
takes ~15-20 minutes, and redeploying before it's actually pushed just
re-pulls the old image. Check the workflow run directly (GitHub Actions UI,
or the GitHub API/MCP tooling) for `conclusion: success` on the specific
service's build job before assuming `:latest` in `ghcr.io` is current.

## Capacity ceiling this cluster actually has

See `07-RESOURCE-TUNING-AND-CAPACITY.md` for the full numbers. Rule of
thumb as of this document: ~3-4 concurrent code executions across all
languages combined, ~10-15 concurrent lightweight (browsing/login) users,
before contention starts producing the intermittent-failure symptoms this
whole runbook exists to triage. This is a demo/small-team-scale
configuration on a single 4-vCPU node, not a production-traffic-ready one.

## A note on the underlying VM's own risk

The production VM runs on Oracle Cloud's free-tier Ampere A1 allocation.
That free tier was cut industry-wide in 2026 (4 OCPU/24GB → 2 OCPU/12GB),
and this deployment may be running on a trial or grandfathered allocation
that isn't guaranteed to persist — worth checking the Oracle Cloud console's
billing/account status periodically rather than assuming the VM's current
specs are permanent.
