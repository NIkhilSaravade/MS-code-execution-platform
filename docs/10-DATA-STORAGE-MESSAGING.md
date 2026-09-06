# Data, Storage & Messaging

## Postgres: database-per-service

Every Java service that persists data owns its own Postgres database — not
a shared schema. Confirmed naming convention: `submission_service` database
→ `submission` table; `execution_result_service` database →
`execution_result` table (singular table names). Production connections use
`sslmode=verify-full` against a real CA-signed cert (see
`05-SECURITY-HARDENING.md` for how that CA/cert pair gets provisioned on a
fresh VM).

`a0b7d80` fixed a real bootstrap-ordering bug: `ssl=on` was originally a
`docker-compose` command-line flag, which meant it applied to Postgres's
**init-script bootstrap server** too — before `configure-ssl.sh` had
actually copied the cert/key into place, so the server that runs first-boot
init scripts came up expecting TLS material that didn't exist yet. Fixed by
moving `ssl=on` into `postgresql.conf` instead, so it only takes effect once
the real config is loaded.

## Kafka: the messaging backbone, and its SASL_SSL/DNS headaches

Kafka is genuinely load-bearing here — every submission's judging is
dispatched via a `SubmissionCreatedEvent`, and results flow back via an
`ExecutionResultEvent`, both async over Kafka topics.

**Getting SASL_SSL working at all** (`a0b7d80`) required several
simultaneous, easy-to-miss fixes: mounting keystore/truststore credential
files exactly where Confluent's entrypoint expects them under
`/etc/kafka/secrets`, then **removing** the generated
`ssl.keystore.password`/`ssl.key.password` properties since the broker
actively rejects those alongside a plain, unencrypted PEM keystore; adding
SASL/DIGEST-MD5 JAAS config for Kafka's *internal* Zookeeper client once a
JVM-wide `login.config` existed for the broker's own listener; and dropping
an erroneous `file:` prefix from `trust-store-location` across every
Kafka-consuming Java service (Spring's PEM `Resource` loader doesn't want
it) plus adding the (Go) worker's missing `KafkaConsumerConfig`-equivalent
bean.

**The advertised-hostname vs. real DNS problem** hit **twice**, independently,
once per language runtime — worth understanding as one root cause with two
separate blast radii:

- Kafka's broker advertises itself back to clients as `kafka:9093`
  (`KAFKA_ADVERTISED_LISTENERS`, which `docker-compose` siblings on that
  network still legitimately need). `KAFKA_BROKERS` (the VM's real IP)
  works fine for the *initial* bootstrap connection, but once connected,
  every client independently resolves the broker's *advertised* hostname to
  find the actual consumer-group coordinator — and `kafka` isn't a real DNS
  name inside a Kubernetes cluster.
- **`worker-service-go`** hit this first (`20f33d8`): Run/Submit timed out
  even though the pod started fine — logs showed
  `lookup kafka on 10.43.0.10:53: no such host` repeating on every
  coordinator lookup. Fixed with `hostAliases` (a pod-local `/etc/hosts`
  entry mapping `kafka` → the VM's IP), scoped to this one pod, without
  touching the broker config every `docker-compose` sibling still depends
  on.
- The **exact same failure** then hit `submission-service`,
  `execution-result-service`, and `ai-analysis-service` (`630b86a`) —
  `submission-service`'s **producer** was timing out trying to publish
  `SubmissionCreatedEvent`, which is why Run/Submit still surfaced as "An
  unexpected error occurred" even *after* `worker-service-go` itself had
  already been fixed. Same `hostAliases` fix, applied to each.

**The lesson**: a hostname-resolution fix scoped to one consumer of a shared
resource doesn't imply every other consumer is fixed too — each service
independently resolves the same advertised hostname and needed the identical
fix applied to it separately.

## MinIO (S3-compatible object storage)

Used for two distinct kinds of content: assembled submission source code
(what `worker-service-go` actually reads to execute) and test-case
input/expected-output content. A separate session
(`session_0121koVF9UroDik7rpgjZR9J`, "MinIO local to production migration")
migrated all local dev data — **216 objects across 3 buckets** — to the
production MinIO instance, tunneled securely rather than exposed directly,
with object counts verified after the mirror completed.

## Redis: per-user rate limiting

Before `2a782e9`, **no rate limiting existed anywhere in the stack** — this
platform runs arbitrary user-submitted code, so without a limit, one account
could flood the Kafka queue and starve every other user's judging capacity,
or hammer the results-polling endpoint. Added a Redis-backed
`RequestRateLimiter` (Spring Cloud Gateway's built-in implementation,
deliberately chosen over an in-memory limiter so limits stay correct across
multiple `api-gateway` replicas if that service ever scales horizontally) on
two routes with deliberately different budgets:

- `submission-service`: **2 req/s replenish, burst 10** — judging is
  expensive (a sandbox pod spin-up per submission, plus one exec per test
  case).
- `execution-result-service`: **10 req/s replenish, burst 20** — a cheap DB
  read the frontend polls for status, looser but still capped against a
  runaway poll loop.

Keyed **per-user**, not per-IP — a `KeyResolver` bean reads the JWT subject
out of the reactive security context, so one abusive account only throttles
itself instead of sharing a limit with every legitimate user behind the same
NAT/IP. Redis itself runs password-only (no TLS, unlike Postgres/Kafka) —
a deliberate, documented risk acceptance: it holds nothing but short-lived
rate-limit counters, and no host port is published since only `api-gateway`
ever talks to it.
