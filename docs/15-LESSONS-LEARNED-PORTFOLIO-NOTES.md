# Lessons Learned & Portfolio Talking Points

This document exists for one specific purpose: turning everything in
`docs/01` through `docs/14` into material you can actually use — on a
resume, a portfolio site, a LinkedIn post, or in an interview.

## The numbers, stated plainly

- **10 Java Spring Boot microservices + 1 Go worker + 1 Python AI service +
  1 React frontend** — a real, independently-deployed microservices
  architecture (not a monolith split into folders), evolved deliberately
  from an initial modular-monolith phase.
- **7 languages judged end-to-end**: Java, C++, C, Python, JavaScript,
  TypeScript, Go — each with its own harness-generation strategy matched to
  that language's actual type system and idioms (see `04-LANGUAGE-SUPPORT-
  AND-HARNESS.md`).
- **140 commits** of real, iterative engineering — not a single large
  "initial commit," but a genuine history of features, fixes, and hardening
  passes, each with a specific, documented reason.
- **Zero-trust sandbox execution**: untrusted, arbitrary user code runs
  under a default-deny `NetworkPolicy`, non-root, read-only root filesystem,
  all Linux capabilities dropped, and a custom seccomp profile — on real
  Kubernetes infrastructure, migrated deliberately away from a
  Docker-outside-of-Docker design specifically because of its
  container-escape risk.
- Runs entirely on a **single 4-vCPU / 24GB ARM node** — forcing genuine,
  non-trivial resource-engineering work (per-language CPU quotas, CFS
  throttling analysis, JVM heap budgeting) that a well-resourced cluster
  would never have surfaced at all.

## The single best interview story this project has

**The Go CPU-throttling investigation** (`13-INCIDENT-POSTMORTEMS.md`,
Postmortem 5) is genuinely excellent material — it has everything a
technical interviewer wants to hear:
- A symptom that looked like one thing (a network/proxy issue) and had a
  plausible, partially-correct fix that turned out to be a **false
  positive** caused by build-cache reuse.
- A live measurement (`time go build`, comparing `user+sys` CPU time to
  real wall-clock time) that proved the *actual* mechanism: Linux CFS
  bandwidth throttling stretching CPU-bound work across far more wall-clock
  time than the process's CPU budget should allow.
- A fix that required understanding the difference between Kubernetes
  `requests` (scheduling-time reservations) and `limits` (enforced ceilings,
  implemented via cgroup CFS quotas) — and applying a **per-language**
  override rather than a blunt global change, to avoid re-triggering the
  exact resource-overcommit crisis the project had *already* solved once.

**How to tell it in 60 seconds**: *"Go submissions kept failing with an
empty compile error. I traced it through three separate root causes before
finding the real one: a disk-exhaustion bug, a missing directory, and
finally — the actual cause — CPU throttling. The sandbox pods were capped
at 0.3 CPU cores for cost reasons, but Go's compiler genuinely needs about
ten seconds of real CPU time even for a trivial program. Under that quota,
Linux's CFS scheduler throttled it so hard that a 10-second job took 34
seconds of wall-clock time — longer than our compile timeout. I confirmed
this by timing the build inside a live pod and comparing CPU time to
wall-clock time, then gave Go's language pool its own CPU tier instead of
raising the limit for every language, which would have blown the whole
node's resource budget again."*

## Other strong, specific talking points

- **The requests-vs-limits-vs-actual-usage distinction**, hit repeatedly
  and independently across the project's life (`07-RESOURCE-TUNING-AND-
  CAPACITY.md`) — a genuinely subtle Kubernetes concept most junior
  candidates get wrong, demonstrated here through several real, resolved
  incidents rather than textbook knowledge.
- **Diagnosing a "random" bug to its actual root cause instead of treating
  it as unfixable flakiness** — the session-expiry bug (`08-AUTH-SESSION-
  MANAGEMENT.md`) looked like intermittent infra noise but had a real,
  fixable frontend defect at its core (treating a network hiccup the same
  as a genuinely invalid token). Good example of not accepting "it's just
  flaky" as an explanation.
- **Silent-failure classes, found three separate times**: OpenTelemetry
  spans silently not exporting (`09-OBSERVABILITY.md`), a JVM startup
  failure printing to the wrong stream (`05-SECURITY-HARDENING.md`), and Go
  build failures doing the same (`13-INCIDENT-POSTMORTEMS.md`) — a
  demonstrable pattern-recognition skill: once you've seen "the error text
  went to the wrong stream" once, you know to check for it again.
- **A real external-dependency break, not a code bug**: the Groq model
  deprecation (`12-AI-ANALYSIS-SERVICE.md`) — diagnosed by querying the
  provider's actual live API rather than trusting its published
  documentation, which was stale.
- **Multi-architecture Docker builds are genuinely hard** — three separate,
  escalating incidents (`06-CI-CD-PIPELINE.md`) getting ARM64 cross-
  compilation right, including recognizing when a "faster" cross-compile
  trick was silently producing the wrong architecture and choosing
  correctness over speed.
- **Security as continuous practice, not a one-time pass** — the IDOR fix,
  the non-root container rollout (verified against a real running
  container, not just a successful build), the seccomp `getcpu` incident,
  and the JWT/TLS secret provisioning story all show security work
  revisited and re-audited over the project's life, not done once and
  forgotten.

## What to actually put on a portfolio page

1. **Architecture diagram** — pull directly from `01-ARCHITECTURE-OVERVIEW.md`.
2. **Screenshots**: the Practice board, the code editor/submission flow, a
   PASSED result with the AI analysis panel.
3. **A "5 hardest bugs I fixed" section**, sourced directly from
   `13-INCIDENT-POSTMORTEMS.md` — write each as symptom → investigation →
   root cause → fix, 3-4 sentences each. This is the highest-signal content
   on the whole page.
4. **Concrete numbers**: 7 languages, 12 services, 140 commits, the
   security-control table from `05-SECURITY-HARDENING.md`.
5. **A short demo video/GIF** rather than a live link — always available,
   controls the narrative, never embarrassingly down when a recruiter
   clicks it.
6. **The GitHub repo link**, with this `docs/` folder visible — a
   well-documented `docs/` folder is itself a strong signal to anyone who
   actually opens the repo, independent of anything on the portfolio page.

## What would genuinely make this stronger going forward

Stated honestly, not to undersell the project but because "what would you
improve" is a real interview question this project can answer specifically:

- **CD is still manual** (`06-CI-CD-PIPELINE.md`) — the natural next step,
  already scoped in the codebase's own commit history (a `release` branch
  exists specifically anticipating an ArgoCD-style GitOps controller).
- **Single point of failure**: one node, no redundancy, no second
  availability zone — a deliberate, documented trade-off for a free-tier
  demo deployment, not an oversight, but worth naming as such rather than
  implying this is production-grade at scale.
- **Per-problem resource tiers don't exist yet** — every sandbox pod in a
  language's pool is sized uniformly, even though a problem's own
  `MemoryLimitMB`/`CPUQuota` could in principle differ meaningfully
  (flagged directly in `sandbox.go`'s own code comments as a known,
  deliberate simplification).
