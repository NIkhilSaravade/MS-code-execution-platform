# Security Hardening

This project treats security as a real, continuously-audited concern, not a
checkbox — the history shows repeated passes going back and closing gaps
found by actually testing against a real deployment, not just code review.

## Sandbox isolation (untrusted user code)

Covered in full in `02-KUBERNETES-MIGRATION.md`. Summary: no Docker-outside-
of-Docker, default-deny `NetworkPolicy` (enforced via Calico, not k3s's
default Flannel which silently ignores `NetworkPolicy` objects entirely),
non-root (`UID 65534`), read-only root filesystem, all Linux capabilities
dropped, seccomp (see below), a 64Mi memory-backed noexec `/tmp`.

### The `getcpu` seccomp incident

Every Java submission was failing `CE` with **empty compile output** — the
JVM itself was never starting: `getcpu(2) system call not supported by
kernel`. This is misleading text: seccomp's `SCMP_ACT_ERRNO` returns that
exact wording for *any denied syscall*, not an actual kernel limitation.
The sandbox's strict default-deny seccomp allowlist
(`worker-service-go/docker/seccomp/execution.json`, provisioned cluster-wide
by the `sandbox-seccomp-provisioner` DaemonSet) already permitted
`sched_getaffinity` but was missing `getcpu` — a harmless, read-only syscall
(returns the calling thread's current CPU/NUMA node) this particular JVM
build calls during startup. Diagnosed by manually exec'ing into a live
`sandbox-java` pod and reproducing it directly, ruling out
`-XX:-UseContainerSupport`, `MALLOC_ARENA_MAX=1`, and gVisor (these pods run
under plain `runc`) as explanations before finding the actual denied
syscall. Fixed by adding `getcpu` to the allowlist (`1413666`).

This incident also surfaced a **second, more important gap**: HotSpot's
VM-init failure text goes to **stdout**, not stderr, so the compile step's
then-stderr-only capture recorded nothing even though the JVM printed a
very clear message. This is the exact same class of bug that later bit Go's
disk-exhaustion failure (see `13-INCIDENT-POSTMORTEMS.md`) — flagged at the
time as a real gap but not fixed until it recurred, worth remembering as a
lesson: a flagged-but-deferred gap tends to actually come back.

## Authorization ("the authz guide rollout")

A deliberate, cross-service pass (`a34fae6`) closing real authorization
gaps, not just adding auth in general:

- **`ai-analysis-service`**: real RS256 JWT verification via `PyJWT` +
  `PyJWKClient` on `/ai/analyze`, replacing what had been "the header just
  has to be non-empty" — i.e. a Python service that trusted any bearer token
  shape without actually validating a signature.
- **`problem-service`**: `POST /problems` restricted to `ADMIN`; the rest of
  `/problems/**` to `USER`/`ADMIN`; `@EnableMethodSecurity` +
  `@PreAuthorize` on the service layer as an *independent second layer*
  behind the controller-level check (defense in depth: a controller-level
  bypass wouldn't be enough on its own to write data).
- **`submission-service`**: an **IDOR fix** — `GET /submissions/{id}` and
  `GET /submissions/user/{userId}` are now scoped to the caller's own JWT
  subject at the query level, not just checked "is this a valid token."
  Before this, any authenticated user could plausibly read another user's
  submission by guessing/incrementing an id. An explicit
  `AccessDeniedException` handler was added so the existing catch-all
  handler didn't turn every legitimate 403 into a misleading 500.
- **`user-service`**: `AdminBootstrap` seeds exactly one `ADMIN` account on
  startup (idempotent, env-configurable — doesn't create duplicates on
  restart), and `PATCH /users/{email}/role` (ADMIN-only) is the only way to
  promote further admins — no way to self-promote.

Two more role-scoping passes followed later: revoking `problem-service`'s
overly broad `ROLE_SERVICE` grant on `GET /problems/**` (`69ded3d`),
requiring `ADMIN` specifically for `GET /problems/{id}/testcases`
(`ee59927`) since hidden test cases shouldn't be readable by a normal user
even authenticated, and a regression fix restoring `SERVICE`-role access to
`GET /problems/{id}` once another service legitimately needed it back
(`8a31e22`) — a reminder that tightening authorization is iterative and can
overshoot, requiring a quick, deliberate walk-back rather than reverting the
whole pass.

## Container hardening (non-root, read-only, minimal build context)

All 9 Java services were originally running **as root** in production with
nothing in the runtime stage that actually required it — the kind of gap
that turns any future dependency CVE or deserialization bug into a
root shell instead of a contained one. Fixed (`100268d`) by adding a
dedicated non-root `app` user to each identical Dockerfile, `COPY`ing the
jar in already owned by that user, and switching to it before `ENTRYPOINT`.
**Verified against a real container, not just a successful build** —
`docker exec api-gateway id` confirmed `uid=100(app)`, and
`/actuator/health` still returned 200 with liveness/readiness groups intact
under the new user.

The same commit added a `.dockerignore` to every service (`target/`,
`.mvn/`, `mvnw`, `.idea/`, `HELP.md`, `.env*`) — none existed anywhere
before, meaning every single build was sending its entire service directory
as Docker build context, including leftover build artifacts and any local
`.env` files that happened to be sitting in the directory.

`ai-analysis-service` and `worker-service-go` got the equivalent multi-stage,
non-root, `.dockerignore`'d treatment separately (`9c30a3a`, `b8e5dd5`).

## Secrets: keys and certs never belong in the image or the repo

Two separate, very similar incidents, both root-caused the same way:

1. **`auth-service`'s JWT private key** (`b76a726`) — the public key was
   committed (correctly, it's public) and baked into the image via
   classpath resource loading. The **private** key was correctly
   `.gitignore`'d and thus never in any image at all — `auth-service`
   crash-looped in production the moment it needed to actually *sign* a
   token: `class path resource [keys/jwt-private.pem] cannot be opened`.
   Fixed by switching `JwtKeyConfig` from a hardcoded `ClassPathResource` to
   Spring's `DefaultResourceLoader`, which resolves a bare path against the
   classpath exactly as before (zero change for local/dev) but also honors
   an explicit `file:` prefix — letting production mount the real private
   key from a Kubernetes `Secret` instead, matching the pattern every other
   per-service secret in this project already used.
2. **Postgres/Kafka TLS certs** (`0d086d1`) — both containers crash-looped
   on the fresh prod VM because their private keys (`server.key`,
   `broker-keystore.pem`) were, correctly, never committed either — Docker
   had silently created an **empty directory** where the bind-mounted file
   was expected. Since the CAs' own private keys were equally gitignored
   (correctly) and thus also missing, there was no way to re-sign matching
   certs against the existing committed CA — a **fresh CA had to be
   generated on whatever machine actually runs the stack**.
   `infra/generate-dev-certs.sh` does this (Postgres CA + server cert,
   Kafka CA + broker cert bundled into the PEM keystore format Confluent's
   image expects), with the SAN list including the VM's private IP so
   `sslmode=verify-full` and Kafka's hostname verification succeed when
   Kubernetes pods connect via IP instead of a docker-compose container
   hostname. A follow-up (`a410a9b`) loosened generated cert/key
   permissions from `600` to `644` once it turned out the stricter mode
   blocked a legitimate read path.

**The pattern worth remembering**: correctly gitignoring secrets means they
correctly don't survive a move to a new machine — that's not a bug in the
gitignore, it's the gitignore doing its job. The actual fix each time was
building a repeatable, scripted way to (re)provision secrets on a fresh
environment, not "just commit the file this once."

## Frontend dependency hygiene

`524e416` — a high-severity `nanoid` DoS vulnerability fixed via
`npm audit fix` once flagged, not left for "later."
