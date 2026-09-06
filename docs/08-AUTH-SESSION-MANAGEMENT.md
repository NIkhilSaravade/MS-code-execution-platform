# Authentication & Session Management

## Token model

`auth-service` issues **RS256-signed JWTs** (asymmetric key pair — see
`05-SECURITY-HARDENING.md` for how the private key is provisioned in
production) as a short-lived **access token** (15 minutes) plus a longer-lived
**refresh token** (14 days). The access token's `sub` claim is the user's
UUID (what every other service expects as `userId`, not their email), and a
separate `email` claim carries the human-readable identity; a `roles` claim
(e.g. `["ADMIN"]`) is what every resource server trusts for authorization —
the frontend also reads it client-side purely for UI convenience (showing/
hiding the "+ Add Problem" button), never as an actual security boundary;
every write is re-checked server-side regardless.

## Refresh token rotation and reuse detection

Every use of a refresh token **rotates** it — `auth-service`'s
`TokenService.consumeRefreshToken` issues a brand-new refresh token on every
`/auth/refresh` call and invalidates the old one. If the **same** (now-
consumed) refresh token is ever presented a second time, that's treated as
theft — the reuse-detection logic revokes the **whole session**, not just
that one token. This is a standard, deliberate hardening pattern (limits the
blast radius of a leaked refresh token to one use), but it has a real
consequence for the frontend: two concurrent callers racing to refresh at
the same moment would otherwise have one of them present an
already-consumed token and get wrongly logged out for it.

## Frontend token handling (`frontend/src/api/`)

- **`tokenStore.ts`** is the single source of truth for the token pair
  (`localStorage`, deliberately *not* React state) — `client.ts` needs to
  read/refresh tokens outside of any component tree, and putting this in
  `AuthContext` would force `client.ts` to import from a component file.
  `AuthContext` **subscribes** to this store instead, so React state stays
  in sync no matter which side triggers a change (an explicit `login()`
  call, or `client.ts` silently refreshing behind a 401 mid-request).
- **In-flight refresh de-duplication**: a single shared `refreshInFlight`
  promise ensures concurrent callers all await the *same* refresh call
  rather than each firing their own — directly defusing the reuse-detection
  race described above.
- **`client.ts`'s `apiFetch`** has a reactive fallback: any 401 on a request
  that *carried* a token (not a bare `/auth/login` 401, which is just wrong
  credentials) triggers exactly one silent refresh-and-retry.
- **`AuthContext.tsx`** additionally runs a **proactive** refresh timer,
  firing 60 seconds before the access token's own `exp` claim — covers
  clock drift and requests already in flight when the token expires, so
  most users never actually hit the reactive 401 path at all in normal use.

## The session-expiry bug (this session's fix)

**Symptom reported**: "submitting code 2-3 times sends me back to the sign-in
page" — happening intermittently, not on every submission.

**Root cause**: `refreshAccessToken()` treated *every* failure identically —
a genuinely expired/revoked refresh token, **and** a transient infra hiccup
(an Eureka/DNS cache-refresh failure, a stale cached pod IP producing
`NoRouteToHostException`, or a plain 5xx from the gateway while the mesh
reconverges) both called `clearTokens()` and force-logged the user out. On
this platform's single 4-vCPU node (see `07-RESOURCE-TUNING-AND-CAPACITY.md`),
those hiccups recurred roughly every 20-30 minutes — closely matching the
proactive refresh timer's own cadence, so a background refresh landing
during one of those blips wiped a perfectly valid session for no real
reason.

**The fix** (two coordinated changes):
1. `refreshAccessToken()` now only clears the session on a genuine **401 or
   403** from `auth-service` — meaning the token was actually evaluated and
   rejected. Any network-level failure (`fetch()` itself throwing) or other
   non-2xx response is retried up to 3 times with a short backoff, and the
   stored tokens are left completely untouched if every retry still fails.
2. `AuthContext`'s proactive refresh timer now **retries itself** after a
   failed-but-not-cleared refresh, instead of silently giving up until the
   token eventually hard-expires (before this, since the access token
   hadn't changed, the effect wouldn't naturally re-run on its own).

This is a good example of a bug that looked infrastructure-shaped (and
partly was — see `07-RESOURCE-TUNING-AND-CAPACITY.md` for the CPU-overcommit
side of the same story) but had a real, independent frontend defect at its
core: even a system with zero flakiness would still log a user out on any
one-off network blip under the old logic. Fixing the frontend's error
handling was strictly necessary regardless of how much the infra-side
flakiness ever gets reduced.

## Authorization model

Covered in depth in `05-SECURITY-HARDENING.md`'s "Authorization" section —
the short version: JWT validation happens independently in every resource
server (including `ai-analysis-service`, a Python service, via `PyJWT` +
`PyJWKClient` against the same RS256 public key), object-level checks (IDOR
protection) are scoped to the caller's own JWT subject rather than trusting
"any valid token can read any id," and admin provisioning is a one-time
idempotent bootstrap plus an admin-only promotion endpoint — no
self-promotion path exists anywhere in the system.
