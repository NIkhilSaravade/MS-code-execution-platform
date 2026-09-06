# AI Analysis Service: the RAG/LLM pipeline evolution

## What it does

After a submission is judged, `ai-analysis-service` (Python/FastAPI) runs an
LLM-based analysis pass over the user's code — complexity commentary, style
feedback, and (for failed submissions) debugging suggestions — using a
Retrieval-Augmented Generation pipeline so the model has relevant context
beyond just the raw code.

## Tech stack evolution (each swap driven by a real, named reason)

The service didn't arrive at its current stack in one shot — the git history
shows a sequence of deliberate swaps:

1. **`bb26d80`** — initial version: LangChain RAG pipeline, hardcoded
   `ChatGroq`.
2. **`c7e44bb`** — swapped the hardcoded `ChatGroq` client for **`litellm`**,
   a unified LLM-calling abstraction — decouples the code from any one
   provider's SDK, which turned out to matter a lot (see the Groq incident
   below: swapping to different Groq **models** at runtime was trivial
   because of this, and swapping providers entirely would be too).
3. **`951ca50`** — replaced local **ChromaDB** with **pgvector-backed RAG**
   — moves vector storage into the same Postgres infrastructure the rest of
   the platform already runs and operates, rather than a separate
   special-purpose vector database with its own persistence/backup story.
4. **`6e335a5`** — `structlog` JSON logging + OpenTelemetry tracing (see
   `09-OBSERVABILITY.md` for the tracing bugs this surfaced).
5. **`4f32bb0`** — circuit breakers around calls to `submission-service`/
   `problem-service` — this service depends on both being up; a circuit
   breaker stops it from hammering a struggling dependency and makes the
   failure mode graceful instead of a cascading timeout pile-up.
6. **`8acae33`** — LLM cost/usage tracking — meaningful once real API spend
   is involved, not free to skip.
7. **`977059d`** — retry/DLQ topology + Kafka consumer idempotency (see
   below).
8. **`c2f87bc`** / **`c91e2ba`** — strict output validation and
   content-addressed caching, landed as two separate, independently
   reviewable commits after an earlier combined attempt was reverted (see
   below).
9. **`c1a864c`** — folded verdict status into the cache key (see below) —
   this session's fix, actually landed just before this documentation
   effort's own session, as part of the same ongoing hardening arc.

## The Groq model deprecation incident (an external break, caught by real testing)

`c6e293d`: **both** of the service's configured default models
(`groq/llama-3.1-8b-instant`, `groq/llama-3.1-70b-versatile`) turned out to
be dead against the real API key — the 70b model outright decommissioned by
Groq, the 8b model returning "does not exist or you do not have access to
it" for this specific account, **despite Groq's own public docs still
listing it as current**. The entire AI-analysis feature — both the
auto-trigger and the manual `POST /ai/analyze` — had been completely
non-functional: every attempt exhausted both retry tiers and landed silently
in the DLQ, with `GET /ai/analysis/{id}` stuck at `PENDING` forever and
**no error ever surfaced to the user**.

The commit message is explicit about the nature of this bug: *"Not caused by
anything on this branch - this is an external break (Groq deprecated/
restricted models out from under a hardcoded default) that real end-to-end
testing caught and code review never would have."* Diagnosed by querying
`GET https://api.groq.com/openai/v1/models` against the **actual** API key
to get this account's real available model list (materially different from
Groq's public catalog), then verifying replacement models
(`groq/openai/gpt-oss-20b` primary, `groq/openai/gpt-oss-120b` fallback)
with real completion calls through `litellm` before shipping them.

**Lesson**: a third-party LLM provider silently changing model availability
is a class of failure that only end-to-end testing against the real,
live provider catches — no amount of local code review or unit testing
would have surfaced it, because the code was never wrong.

## Caching: a revert, and why it happened

`5d4a37b` originally shipped **two distinct features in one commit**:
content-addressed caching (keyed by `sha256(problem_id + normalized_code)`,
so identical code across different submissions/users shares one LLM call
instead of each paying for its own) **and** strict LLM output validation
(rejecting a response that doesn't match the expected `PassedAnalysis`/
`FailedAnalysis` schema instead of silently caching an `"ERROR"`
placeholder). This combined commit was **reverted** (`0698edf`) and later
re-landed as **two separate, smaller commits** — `c2f87bc` (validation
alone) and `c91e2ba` (caching alone, introducing the `AnalysisCache` table
plus a `SubmissionAnalysisMap` pointer table carrying `user_id` for the
ownership check).

**Why this matters as a practice, not just a historical detail**: splitting
a reverted combined change into independently reviewable, independently
revertable pieces is exactly the right response when a combined commit needs
undoing — it means a future problem with just one of the two features
doesn't force reverting both again.

## The cache-key correctness bug this later surfaced

Once caching existed, a genuine correctness bug followed: the cache key was
`sha256(problem_id + normalized_code)` with **no verdict in the key**.
Resubmitting the *exact same code* after it starts passing (e.g. after an
unrelated platform bug — like the ones in `13-INCIDENT-POSTMORTEMS.md` — got
fixed) hashed to the **same** cache key as an earlier `CE`/`FAILED` run of
that identical code, so `run_analysis()` served back the **old
FAILED-shaped analysis** (`failureReason`/`debuggingSuggestion`/
`edgeCases`/`hints`) instead of ever calling the LLM again for the new
`PASSED` verdict — producing a confident-sounding but completely wrong
compile-error narrative for code that had actually just passed. Fixed
(`c1a864c`) by folding `status` into the hashed key, so a `FAILED`-verdict
analysis and a `PASSED`-verdict analysis for identical code can never shadow
each other again.

## Reliability: retry/DLQ topology and idempotency

`977059d` switched `analysis.trigger.v1` consumption to **manual offset
commits** (only advanced after a message is fully handled — the default
auto-commit behavior risks losing a message if the process crashes
mid-handling) and added a **two-tier delayed retry topology**
(`analysis.trigger.v1.retry-1`/`-2`, 30s/5min "not before" delay via message
headers) plus a dead-letter queue for messages that keep failing after both
retries. A new `ProcessedEvent` idempotency table guards against **Kafka
redelivery causing duplicate work** — a message can be redelivered (at-least-
once delivery semantics) without the analysis actually running twice.
