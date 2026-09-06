// The single source of truth for the JWT pair, deliberately NOT a React
// module. api/client.ts needs to read/refresh tokens when it sees a 401, and
// client.ts is imported by api/auth.ts, which AuthContext imports - so if
// this lived in AuthContext.tsx, client.ts would have to import from a
// component file (and risk a circular import back through auth.ts).
// AuthContext subscribes to this store instead, so React state stays in
// sync no matter which side triggers a change.

const ACCESS_TOKEN_KEY = 'op_access_token';
const REFRESH_TOKEN_KEY = 'op_refresh_token';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

const listeners = new Set<() => void>();

// Lets AuthContext re-render whenever tokens change, regardless of whether
// AuthContext itself caused the change (login/register/logout) or client.ts
// did (a silent refresh behind a 401).
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  listeners.forEach((listener) => listener());
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setTokens(tokens: AuthTokens) {
  localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
  notify();
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  notify();
}

// auth-service rotates refresh tokens on every use and revokes the WHOLE
// session if a token is ever presented twice (see auth-service's
// TokenService.consumeRefreshToken - reuse is treated as theft). If two
// callers each fired their own /auth/refresh at the same moment, the loser
// would present an already-consumed token and get logged out for it. Every
// caller during a refresh shares this one in-flight request instead.
let refreshInFlight: Promise<string> | null = null;

// The platform's single node routinely has brief network hiccups (Eureka/
// DNS cache-refresh failures, a stale pod IP after a reschedule, a 5xx from
// the gateway while the mesh reconverges) that have nothing to do with
// whether the refresh token itself is still valid. Retrying a couple of
// times, with a short pause, absorbs those instead of treating every one
// as "your session is dead."
const MAX_REFRESH_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attemptRefresh(refreshToken: string, attemptsLeft: number): Promise<string> {
  let response: Response;
  try {
    // Plain fetch, not apiFetch: apiFetch's own 401 handling calls back into
    // refreshAccessToken(), so routing the refresh call itself through
    // apiFetch would recurse the moment a refresh token was ever rejected.
    response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  } catch (networkErr) {
    // fetch() itself threw - DNS resolution failure, connection refused/
    // reset, etc. The backend never got a chance to weigh in on the token,
    // so this can't be treated as rejection. Retry before giving up, and
    // even then, don't wipe the session (see the catch below).
    if (attemptsLeft > 1) {
      await delay(RETRY_DELAY_MS);
      return attemptRefresh(refreshToken, attemptsLeft - 1);
    }
    throw networkErr;
  }

  if (response.status === 401 || response.status === 403) {
    // auth-service actually looked at the token and rejected it - expired,
    // already used, or revoked (e.g. the reuse-detection case above tripped
    // elsewhere). There's no session left to salvage.
    clearTokens();
    throw new Error('Refresh token rejected');
  }

  if (!response.ok) {
    // Any other non-2xx (5xx from the gateway, a 502/504 while a downstream
    // pod's IP is stale, etc.) is an infra failure, not a verdict on the
    // token - retry the same way as a network-level failure above.
    if (attemptsLeft > 1) {
      await delay(RETRY_DELAY_MS);
      return attemptRefresh(refreshToken, attemptsLeft - 1);
    }
    throw new Error(`Refresh failed with status ${response.status}`);
  }

  const tokens = (await response.json()) as AuthTokens;
  setTokens(tokens);
  return tokens.accessToken;
}

export function refreshAccessToken(): Promise<string> {
  if (refreshInFlight) return refreshInFlight;

  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    clearTokens();
    return Promise.reject(new Error('No refresh token available'));
  }

  refreshInFlight = attemptRefresh(refreshToken, MAX_REFRESH_ATTEMPTS).finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}
