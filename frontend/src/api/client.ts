// This file is a small "API client" — a reusable helper for talking to our
// backend (the api-gateway). It's not React-specific at all; it's plain
// TypeScript that any component can import and call.

// import.meta.env is Vite's way of exposing environment variables to
// browser code. VITE_API_BASE_URL would come from a .env file (must be
// prefixed with VITE_ or Vite won't expose it, for security).
// The `??` is the "nullish coalescing" operator: use the left side unless
// it's null/undefined, in which case fall back to the right side.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080';

// TypeScript generics: `<T>` is a placeholder type. When you CALL this
// function you tell it what T is, e.g. apiFetch<Problem[]>('/problems'),
// and TypeScript then knows the returned Promise resolves to Problem[].
// `path: string` and `init?: RequestInit` are typed parameters — the `?`
// means init is optional. RequestInit is a built-in browser type describing
// fetch() options (method, headers, body, etc.).
// `Promise<T>` as the return type means "this is an async function that
// eventually produces a value of type T."
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // fetch() is the browser's built-in function for making HTTP requests.
  // `await` pauses this function until the network call finishes, without
  // blocking the rest of the app (that's what makes it "async").
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    // The `...init` spread copies any options the caller passed in
    // (method, body, etc.), then we add/override headers below.
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
      // `init?.headers` uses "optional chaining" — if init is undefined,
      // this whole expression is undefined instead of throwing an error.
    },
  });

  // fetch() does NOT throw an error for HTTP error statuses like 404 or
  // 500 — you have to check response.ok yourself and throw manually.
  if (!response.ok) {
    // The Java services (auth-service included) report errors as RFC 7807
    // "Problem Details" JSON, e.g. { "detail": "Email already registered" }.
    // Try to pull that human-readable message out so forms can show it
    // instead of a generic "failed with status 409".
    let message = `Request to ${path} failed with status ${response.status}`;
    try {
      const body = await response.json();
      if (typeof body?.detail === 'string' && body.detail.length > 0) {
        message = body.detail;
      }
    } catch {
      // Response body wasn't JSON (or was empty) — fall back to the
      // generic message above instead of letting this parse error escape.
    }
    throw new Error(message);
  }

  // response.json() parses the response body as JSON and returns a Promise.
  // `as Promise<T>` is a TypeScript "type assertion" — we're telling the
  // compiler to trust that the JSON shape matches T (TS can't verify this
  // at runtime on its own).
  return response.json() as Promise<T>;
}

// NOTE: nothing in the app calls this yet — it's here for when we wire the
// frontend up to the real backend services (submission-service, etc.).
