// AuthContext is how the WHOLE APP shares one piece of state: "is anyone
// logged in, and if so, who?" Without this, LoginPage would have no way to
// tell AppNavbar "hey, login succeeded" — they're unrelated components that
// don't otherwise pass props to each other. React Context solves exactly
// this: a value provided high up the tree (see main.tsx) that any
// descendant can read with useAuth(), no prop-drilling required.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loginUser, registerUser, type AuthTokens } from '../api/auth';

// localStorage keys. Using constants instead of repeating the string
// literals avoids typos causing the read and write sides to silently
// disagree.
const ACCESS_TOKEN_KEY = 'op_access_token';
const REFRESH_TOKEN_KEY = 'op_refresh_token';

// JWTs are three base64url segments separated by dots: header.payload.signature.
// We only need the payload (to read the `sub` claim, which auth-service sets
// to the user's email) — no verification happens client-side, the backend
// is the only thing that needs to trust this token.
function decodeJwtPayload(token: string): { sub?: string; email?: string; exp?: number } | null {
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
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

// createContext needs a default value for when a component reads it
// outside of a <AuthProvider>. We never expect that to happen (main.tsx
// always wraps <App/> in the provider), so these are just harmless
// placeholders — useAuth() below guards against the missing-provider case.
const AuthContext = createContext<AuthContextValue | null>(null);

function storeTokens(tokens: AuthTokens) {
  localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Initialize state straight from localStorage so a page refresh doesn't
  // log the user out — the lazy initializer function (`() => ...`) only
  // runs once, on the very first render, not on every re-render.
  const [accessToken, setAccessToken] = useState<string | null>(() =>
    localStorage.getItem(ACCESS_TOKEN_KEY),
  );

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

  // If the stored access token is already expired (e.g. the tab was left
  // open for hours), treat it as logged-out immediately instead of showing
  // a stale "logged in" state that fails on the first real API call.
  useEffect(() => {
    if (!accessToken) return;
    const payload = decodeJwtPayload(accessToken);
    const expiredMs = payload?.exp ? payload.exp * 1000 : 0;
    if (expiredMs && expiredMs < Date.now()) {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      setAccessToken(null);
    }
  }, [accessToken]);

  async function login(email: string, password: string) {
    const tokens = await loginUser(email, password);
    storeTokens(tokens);
    setAccessToken(tokens.accessToken);
  }

  async function register(email: string, password: string) {
    // auth-service's /auth/register returns a token pair immediately, so
    // registering also logs the user in — no separate "please log in now"
    // step needed.
    const tokens = await registerUser(email, password);
    storeTokens(tokens);
    setAccessToken(tokens.accessToken);
  }

  function logout() {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    setAccessToken(null);
  }

  const value: AuthContextValue = {
    userEmail,
    userId,
    accessToken,
    isAuthenticated: accessToken !== null,
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