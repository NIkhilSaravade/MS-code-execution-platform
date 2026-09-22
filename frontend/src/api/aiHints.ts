// ai-analysis-service's Phase A/B endpoints - graduated hints, the level-4
// solution reveal, and the post-solve explain walkthrough (see that
// service's main.py). Kept separate from api/submissions.ts (which already
// owns POST /ai/analyze[/stream]): hints/explain are a genuinely different
// feature area (help mid-solve / teach after solving), not a variant of the
// post-submission code review that file's AI-analysis types model.

import { apiFetch } from './client';

// Mirrors ai-analysis-service's services/hint_service.py::request_hint's
// return shape.
export interface HintResponse {
  level: number;
  hint: string;
  usedProblemMetadata: boolean;
  guardrailFlagged: boolean;
}

// Mirrors services/hint_service.py::reveal_solution's return shape.
export interface RevealSolutionResponse {
  level: number;
  solution: string;
}

export interface HintHistoryEntry {
  level: number;
  isSolutionReveal: boolean;
  response: string;
  createdAt: string;
}

// GET /ai/hint/{problemId}/session's return shape - lets the UI restore
// hint state after a page refresh instead of only ever seeing it as the
// return value of a POST /ai/hint call.
export interface HintSessionState {
  currentLevel: number;
  history: HintHistoryEntry[];
}

// Mirrors services/explanation_service.py::explain's return shape.
export interface ExplainResponse {
  explanation: string;
  mode: 'submission' | 'generic';
  source: 'AI' | 'CACHE';
}

// Escalates the caller's hint session by exactly one level (server-decided
// - see hint_service.py's docstring on why there's no "give me level 3"
// request shape). code/stuckDescription are both optional context, not
// required for a hint to be generated.
export function requestHint(
  accessToken: string,
  problemId: number,
  code: string,
  stuckDescription: string,
): Promise<HintResponse> {
  return apiFetch<HintResponse>('/ai/hint', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ problemId, code, stuckDescription }),
  });
}

// Level 4 - a structurally separate call from requestHint, not reachable by
// calling it repeatedly. `confirm: true` here corresponds to the UI's own
// separate, deliberate confirmation step (see SolvePage.tsx's
// revealConfirming state) - this function always sends confirm=true because
// by the time this is called, that confirmation has already happened in
// the UI; the backend still independently re-checks it (400 without it).
export function revealSolution(
  accessToken: string,
  problemId: number,
  code: string,
  stuckDescription: string,
): Promise<RevealSolutionResponse> {
  return apiFetch<RevealSolutionResponse>('/ai/hint/reveal-solution', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ problemId, code, stuckDescription, confirm: true }),
  });
}

export function getHintSession(accessToken: string, problemId: number): Promise<HintSessionState> {
  return apiFetch<HintSessionState>(`/ai/hint/${problemId}/session`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// submissionId is optional - omitted (or pointing at a non-PASSED
// submission) falls back to a generic, code-free walkthrough of the
// intended approach server-side (see main.py::explain_endpoint); the
// caller doesn't need to pre-check the submission's status itself.
export function explainProblem(
  accessToken: string,
  problemId: number,
  submissionId?: number,
): Promise<ExplainResponse> {
  return apiFetch<ExplainResponse>('/ai/explain', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ problemId, submissionId }),
  });
}
