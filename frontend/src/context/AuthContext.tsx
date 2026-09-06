// AuthContext is how the WHOLE APP shares one piece of state: "is anyone
// logged in, and if so, who?" Without this, LoginPage would have no way to
// tell AppNavbar "hey, login succeeded" — they're unrelated components that
// don't otherwise pass props to each other. React Context solves exactly
// this: a value provided high up the tree (see main.tsx) that any
// descendant can read with useAuth(), no prop-drilling required.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loginUser, registerUser } from '../api/auth';
import { clearTokens, getAccessToken, refreshAccessToken, setTokens, subscribe } from '../api/tokenStore';

// How long before the access token's `exp` to proactively refresh it.
// auth-service issues 15-minute access tokens (TokenService.issueAccessToken)
// - refreshing a minute early leaves headroom for clock drift and requests
// already in flight, without refreshing so eagerly it's wasteful.
const REFRESH_BUFFER_MS = 60_000;

// JWTs are three base64url segments separated by dots: header.payload.signature.
// We only need the payload (to read the `sub` claim, which auth-service sets
// to the user's email) — no verification happens client-side, the backend
// is the only thing that needs to trust this token.
function decodeJwtPayload(
  token: string,
): { sub?: string; email?: string; exp?: number; roles?: string[] } | null {
  try {
    const payloadSegment = token.split('.')[1];
    // JWTs use base64URL (- and _ instead of + and /), so swap those back
    // before handing it to atob(), which only understands standard base64.
    const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch {
    // Malformed token — treat it the same as "no token".
    return null;
  }
}

interface AuthContextValue {
  // `null` means "definitely logged out".
  userEmail: string | null;
  // The user's id (JWT `sub` claim, a UUID) - this is what submission-service
  // expects as SubmissionRequest.userId, NOT the email.
  userId: string | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  // auth-service's TokenService puts the account's role(s) in a `roles`
  // claim (e.g. ["ADMIN"]) - every other resource server in this platform
  // already trusts that claim for authorization; this just also reads it
  // client-side to decide what to show (e.g. the "+ Add Problem" button).
  // The backend re-checks ADMIN independently on every write - this is UI
  // convenience only, never itself a security boundary.
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

// createContext needs a default value for when a component reads it
// outside of a <AuthProvider>. We never expect that to happen (main.tsx
// always wraps <App/> in the provider), so these are just harmless
// placeholders — useAuth() below guards against the missing-provider case.
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Initialize state straight from localStorage so a page refresh doesn't
  // log the user out — the lazy initializer function (`() => ...`) only
  // runs once, on the very first render, not on every re-render.
  const [accessToken, setAccessToken] = useState<string | null>(() => getAccessToken());

  // api/tokenStore.ts is the actual source of truth (localStorage + the
  // refresh logic api/client.ts shares). It changes from two different
  // places - this provider's own login/register/logout calls below, AND
  // api/client.ts silently refreshing a token behind a 401 mid-request -
  // so rather than duplicate "update React state" at every call site, this
  // provider just re-syncs whenever the store notifies, no matter who
  // triggered the change.
  useEffect(() => subscribe(() => setAccessToken(getAccessToken())), []);

  // Derive the email from the token rather than storing it separately —
  // one source of truth (the token) instead of two values that could drift
  // out of sync. useMemo avoids re-decoding on every render, only when the
  // token itself changes. `sub` is the user's UUID, not their email — the
  // email lives in its own `email` claim (see auth-service's TokenService).
  const userEmail = useMemo(() => {
    if (!accessToken) return null;
    return decodeJwtPayload(accessToken)?.email ?? null;
  }, [accessToken]);

  const userId = useMemo(() => {
    if (!accessToken) return null;
    return decodeJwtPayload(accessToken)?.sub ?? null;
  }, [accessToken]);

  const isAdmin = useMemo(() => {
    if (!accessToken) return false;
    return decodeJwtPayload(accessToken)?.roles?.includes('ADMIN') ?? false;
  }, [accessToken]);

  // Silent refresh: instead of waiting for the access token to expire and
  // treating that as a logout, proactively swap it for a new one shortly
  // before `exp`. If the tab was asleep and the token is already past that
  // point (or past `exp` entirely), refresh immediately rather than logging
  // out — the refresh token is good for 14 days, far longer than the
  // 15-minute access token, so there's usually still a valid session to
  // recover. refreshAccessToken() itself clears the session if the refresh
  // token is also gone/expired/revoked, which the subscribe() effect above
  // then turns into accessToken becoming null here.
  useEffect(() => {
    if (!accessToken) return;
    const payload = decodeJwtPayload(accessToken);
    if (!payload?.exp) return;

    let cancelled = false;
    // refreshAccessToken() already retries transient network/5xx failures a
    // few times internally (see tokenStore.ts) and only clears the session
    // on a genuine rejection from auth-service. If it still fails after
    // those retries, accessToken hasn't changed, so this effect won't
    // re-run on its own - fall back to trying again shortly, rather than
    // silently giving up until the token hard-expires.
    const RETRY_ON_FAILURE_MS = 10_000;
    function attempt() {
      refreshAccessToken().catch(() => {
        if (!cancelled) {
          retryTimer = setTimeout(attempt, RETRY_ON_FAILURE_MS);
        }
      });
    }

    const msUntilExpiry = payload.exp * 1000 - Date.now();
    let retryTimer: ReturnType<typeof setTimeout>;
    if (msUntilExpiry <= REFRESH_BUFFER_MS) {
      attempt();
      return () => {
        cancelled = true;
        clearTimeout(retryTimer);
      };
    }

    const timer = setTimeout(attempt, msUntilExpiry - REFRESH_BUFFER_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(retryTimer);
    };
  }, [accessToken]);

  async function login(email: string, password: string) {
    const tokens = await loginUser(email, password);
    setTokens(tokens);
  }

  async function register(email: string, password: string) {
    // auth-service's /auth/register returns a token pair immediately, so
    // registering also logs the user in — no separate "please log in now"
    // step needed.
    const tokens = await registerUser(email, password);
    setTokens(tokens);
  }

  function logout() {
    clearTokens();
  }

  const value: AuthContextValue = {
    userEmail,
    userId,
    accessToken,
    isAuthenticated: accessToken !== null,
    isAdmin,
    login,
    register,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// The hook every component actually uses: `const { userEmail, login } = useAuth();`
// Throwing when there's no provider turns "forgot to wrap in <AuthProvider>"
// into an immediate, obvious error instead of a confusing "null is not an
// object" crash somewhere else.
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth() must be used inside an <AuthProvider>');
  }
  return ctx;
}