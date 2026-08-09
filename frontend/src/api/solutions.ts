// Talks to solution-service's REST endpoints (see solution-service's
// SolutionController) via api-gateway's /solutions/** route. Kept separate
// from api/submissions.ts the same way every other api/*.ts file here is
// split per backend service.

import { apiFetch } from './client';

// Mirrors solution-service's SolutionPartResponse - one expandable "Part N"
// bullet on the Solutions tab.
export interface SolutionPart {
  ordinal: number;
  title: string;
  markdown: string;
}

// Mirrors solution-service's SolutionResponse. visualizerUrl (when present)
// is a path already scoped under /solutions/** - point an <iframe> straight
// at `${API_BASE_URL}${visualizerUrl}` (see client.ts). It's deliberately
// unauthenticated on the backend (an iframe can't attach a Bearer token),
// so no Authorization header is needed for that specific request.
export interface Solution {
  problemId: number;
  visualizerUrl: string | null;
  parts: SolutionPart[];
}

// ADMIN-only (also enforced backend-side) - full-replace upsert, matching
// solution-service's SolutionService.upsertSolution: every call replaces the
// complete part list for this problemId.
export function upsertSolution(
  accessToken: string,
  problemId: number,
  parts: SolutionPart[],
): Promise<Solution> {
  return apiFetch<Solution>('/solutions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ problemId, parts }),
  });
}

// ADMIN-only. `html` is the raw page source pasted into the Add Problem
// form's textarea - wrapped into a Blob/File here so it can go through the
// same multipart endpoint a real file input would use, without requiring
// the admin to actually save it as a .html file first.
export function uploadVisualizer(
  accessToken: string,
  problemId: number,
  html: string,
): Promise<Solution> {
  const formData = new FormData();
  formData.append('file', new File([html], 'visualizer.html', { type: 'text/html' }));
  return apiFetch<Solution>(`/solutions/problem/${problemId}/visualizer`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });
}

// ADMIN-only (also enforced backend-side). No-op-safe from the caller's
// perspective - deleting a problem that never had a solution written is a
// normal case server-side (see SolutionService.deleteSolution), not an error.
export function deleteSolution(accessToken: string, problemId: number): Promise<void> {
  return apiFetch<void>(`/solutions/problem/${problemId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Returns null (rather than throwing) when this problem has no solution
// yet - solution-service 404s in that case, which is an expected, common
// state (most problems don't have one authored), not an error to surface.
export async function getSolutionForProblem(
  accessToken: string,
  problemId: number,
): Promise<Solution | null> {
  try {
    return await apiFetch<Solution>(`/solutions/problem/${problemId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    return null;
  }
}

// Mirrors solution-service's NoteResponse. The caller's own free-text notes
// for a problem - scoped server-side by the JWT subject, not by anything
// sent here, so there's no userId to pass.
export interface Note {
  content: string;
  updatedAt: string | null;
}

export function getNote(accessToken: string, problemId: number): Promise<Note> {
  return apiFetch<Note>(`/solutions/problem/${problemId}/notes`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function saveNote(accessToken: string, problemId: number, content: string): Promise<Note> {
  return apiFetch<Note>(`/solutions/problem/${problemId}/notes`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ content }),
  });
}
