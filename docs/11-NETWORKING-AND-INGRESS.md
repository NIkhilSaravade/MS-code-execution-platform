# Networking, Ingress & Domain Setup

## The public entry point: Cloudflare Tunnel, not a NodePort or public IP

`api-gateway` is exposed to the internet via **Cloudflare Tunnel**
(`cloudflared`), not through a Kubernetes `NodePort`, a `LoadBalancer`
service, or by directly exposing the VM's IP on a firewall rule. `768258c`
runs `cloudflared` as its **own Deployment inside the `platform` namespace**
(not a `docker-compose` container on the bare VM), specifically so it
resolves and reaches `api-gateway` over the **cluster's own internal DNS**
(`api-gateway.platform.svc.cluster.local`) — no `NodePort` or host
networking needed at all. This matches how Kafka/Postgres deliberately stay
*outside* the cluster while everything that needs to reach a Kubernetes
`Service` lives *inside* it — a consistent "put things where their natural
network boundary is" design choice, not an accident.

The tunnel's auth token is stored as a Kubernetes **Secret**, never baked
into the manifest itself — the actual tunnel is created once, manually, in
the Cloudflare dashboard, with its Public Hostname pointed at
`api-gateway`'s in-cluster Service; the Deployment manifest just consumes
the resulting token.

**Why Cloudflare Tunnel specifically, and why it matters beyond convenience**:
a tunnel makes only an **outbound** connection from `cloudflared` to
Cloudflare's edge — nothing needs to be exposed inbound on the VM's network
at all. This is exactly what makes self-hosting from an arbitrary machine
(including, as discussed in this session, a home MacBook with no static IP
or port-forwarding) practical: whatever machine runs `cloudflared` "just
works" the moment it can make outbound HTTPS calls, with zero router/NAT/DNS
configuration on that machine's own network.

## Domain

The production frontend is served at **`app.nikhilsaravade.com`** (a real
custom domain, not a bare `*.pages.dev`/`*.workers.dev` subdomain) — visible
directly in the CORS-configuration commit below. The commit also anticipates
future `*.nikhilsaravade.com` subdomains for UAT environments, and keeps a
`pages.dev` fallback domain allowed alongside the custom one.

## CORS: a real, hit-in-production bug

`api-gateway`'s `SecurityConfig` originally **hardcoded**
`allowedOriginPatterns` to `http://localhost:*` — meaning the moment the real
frontend went live at `app.nikhilsaravade.com`, every single request failed
in the browser with a generic "Failed to fetch," because the CORS preflight
was rejected **before the request ever reached the service at all** (this is
a browser-enforced check; the server never even sees the actual request when
a preflight fails). Fixed (`0c64c77`) by externalizing this to a
`cors.allowed-origin-patterns` property (comma-separated) — following the
same environment-driven config pattern used everywhere else in this project
— so local dev keeps its existing `localhost` default via
`application.properties`, while the Kubernetes manifest overrides it via
`CORS_ALLOWED_ORIGIN_PATTERNS` to include the real production origins.

**Worth remembering**: a hardcoded CORS allowlist is exactly the kind of bug
that's invisible in every environment except the one it actually breaks —
local dev and any same-origin testing never exercise it.

## NetworkPolicy enforcement: Calico, not Flannel

Covered in full in `02-KUBERNETES-MIGRATION.md` — k3s's default CNI
(Flannel) silently ignores `NetworkPolicy` objects entirely, so the
sandbox's default-deny policy would do nothing on a stock install. This
cluster runs Calico instead specifically so the security boundary is real,
confirmed live via a blocked DNS lookup from inside a sandbox pod during
this session's Go debugging (see `13-INCIDENT-POSTMORTEMS.md`).

## Service-to-service discovery quirks: IP vs. hostname, twice

Two separate services hit the identical class of bug — a client library
defaulting to registering/advertising a **pod hostname** that isn't
resolvable cluster-wide, instead of an IP:

- **Java services** avoid this by setting
  `EUREKA_INSTANCE_PREFER_IP_ADDRESS=true` from the start.
- **`ai-analysis-service` (Python)** didn't have an equivalent set
  initially, and hit it for real (`8bb9007`): `api-gateway` consistently
  500'd on `/ai/analysis/{id}` with
  `UnknownHostException: Failed to resolve 'ai-analysis-service-<old-pod>'`
  — every restart left `api-gateway`'s client-side load balancer trying to
  DNS-resolve the **previous** pod's raw Kubernetes hostname. Root cause:
  `py_eureka_client.init_async()` takes `instance_ip` and `instance_host` as
  *separate* parameters; only `instance_ip` was set, so `instance_host`
  (which becomes the registered Eureka `hostName` field — what other
  services' load balancers actually build request URLs from) silently
  defaulted to `socket.gethostname()`, i.e. the pod's own hostname. Fixed by
  setting `instance_host` to the same resolved IP as `instance_ip` — the
  Python client's direct equivalent of the Java flag.

This is the same underlying lesson as the Kafka advertised-hostname bug in
`10-DATA-STORAGE-MESSAGING.md`: **a fix already applied to one client
library does not carry over to a different client library for the same
protocol** — each language's client independently needs the equivalent
"advertise a real, resolvable address" configuration applied to it.
