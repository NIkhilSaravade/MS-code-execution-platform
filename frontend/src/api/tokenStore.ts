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

export function refreshAccessToken(): Promise<string> {
  if (refreshInFlight) return refreshInFlight;

  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    clearTokens();
    return Promise.reject(new Error('No refresh token available'));
  }

  // Plain fetch, not apiFetch: apiFetch's own 401 handling calls back into
  // refreshAccessToken(), so routing the refresh call itself through
  // apiFetch would recurse the moment a refresh token was ever rejected.
  refreshInFlight = fetch(`${API_BASE_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error('Refresh token rejected');
      }
      const tokens = (await response.json()) as AuthTokens;
      setTokens(tokens);
      return tokens.accessToken;
    })
    .catch((err) => {
      // Expired, already used, or revoked (e.g. the reuse-detection case
      // above tripped elsewhere) - there's no session left to salvage.
      clearTokens();
      throw err;
    })
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}
