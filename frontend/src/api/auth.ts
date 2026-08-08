// A small, focused API module: everything this app needs to talk to
// auth-service's REST endpoints (see auth-service's AuthController).
// Kept separate from api/client.ts so callers can import just
// `{ registerUser, loginUser }` without needing to know about fetch details.

import { apiFetch } from './client';

// Mirrors auth-service's AuthResponse DTO (accessToken + refreshToken, both
// JWTs). Field names must match exactly since apiFetch just JSON-parses
// whatever the backend sends back.
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

// POST /auth/register — creates a new user account and, like login,
// immediately returns a token pair (auth-service logs you in on signup).
export function registerUser(email: string, password: string): Promise<AuthTokens> {
  return apiFetch<AuthTokens>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

// POST /auth/login — verifies credentials and returns a fresh token pair.
export function loginUser(email: string, password: string): Promise<AuthTokens> {
  return apiFetch<AuthTokens>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

// POST /auth/refresh — exchanges a still-valid refresh token for a new
// access/refresh pair. Not wired into the UI yet, but AuthContext will use
// this later to keep a session alive past the 15-minute access token TTL.
export function refreshTokens(refreshToken: string): Promise<AuthTokens> {
  return apiFetch<AuthTokens>('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
}