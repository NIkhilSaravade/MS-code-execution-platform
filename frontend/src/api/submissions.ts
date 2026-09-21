// Everything this app needs to talk to submission-service's REST endpoints
// (see submission-service's SubmissionController). Kept separate from
// api/auth.ts the same way that file is kept separate from api/client.ts.

import { ApiError, API_BASE_URL, apiFetch } from './client';

// Mirrors submission-service's SubmissionResponse DTO.
export interface SubmissionCreatedResponse {
  submissionId: number;
  status: string;
}

// One test case's judged outcome (see worker-service-go's
// domain.TestCaseResult). input/expected/actual are only ever present for
// non-hidden test cases - a hidden one only ever reveals whether it passed,
// never its content.
export interface TestCaseResult {
  ordinal: number;
  passed: boolean;
  hidden: boolean;
  input?: string;
  expected?: string;
  actual?: string;
}

// Mirrors submission-service's Submission entity, as returned by
// GET /submissions/{id}. `status` starts at "PENDING", moves to "RUNNING"
// once worker-service-go picks it up, and ends at a terminal verdict string:
// "PASSED"/"FAILED"/"RE"/"CE"/"TLE"/"MLE"/"SYSTEM_ERROR" (see
// worker-service-go/internal/domain/models.go).
//
// Result detail (output/reason/testCaseResults/timing/complexity) is NOT
// here - execution-result-service is the single source of truth for that
// (see ExecutionResult/getExecutionResult below). This is lifecycle/status
// only, cheap enough to poll on its own.
export interface Submission {
  id: number;
  userId: string;
  problemId: number;
  code: string;
  language: string;
  status: string;
  // true = a real Submit (judged against hidden cases too), false = a Run
  // (visible cases only). getSubmissionsForProblem only ever returns
  // includeHidden=true rows - see submission-service's SubmissionRepository.
  includeHidden: boolean;
  submittedAt: string;
}

// Mirrors execution-result-service's ExecutionResultResponse, as returned by
// GET /api/results/{submissionId} - the full judged-result detail, fetched
// once GET /submissions/{id}'s status goes terminal.
export interface ExecutionResult {
  submissionId: number;
  status: string;
  output: string | null;
  reason: string | null;
  testCaseResults: TestCaseResult[] | null;
  wallTimeMs: number | null;
  maxMemoryKb: number | null;
  estimatedTimeComplexity: string | null;
  estimatedSpaceComplexity: string | null;
}

// AI-analysis-service's LLM-derived analysis (see ai-analysis-service's
// prompts/passed_prompt.py / failed_prompt.py) - a separate, best-effort
// enrichment on top of ExecutionResult's own worker-computed complexity
// estimate. "PENDING" until execution-result-service's analysis.trigger.v1
// event has been consumed and the LLM call has completed (or the request
// hasn't been made/cached yet).
export interface AiAnalysisPassed {
  analysisType: 'PASSED';
  timeComplexity: string;
  spaceComplexity: string;
  optimizationSuggestions: string;
  codeSmells: string;
  alternativeApproach: string;
}

export interface AiAnalysisFailed {
  analysisType: 'FAILED';
  failureReason: string;
  debuggingSuggestion: string;
  edgeCases: string[];
  hints: string;
}

// One tool the reviewer agent actually called mid-review (see
// ai-analysis-service's services/tools.py / services/mcp_client.py) -
// `args`/`result` are deliberately untyped (`unknown`): each tool has its
// own shape (run_linter's result looks nothing like
// fetch_similar_past_reviews's), and the UI below only ever needs the tool
// *name* to render a "checked with: ..." badge, plus
// fetch_similar_past_reviews's result specifically for citing which
// knowledge-base snippets were referenced - narrowed with a type guard at
// the point of use (see SolvePage.tsx's renderRagCitations) rather than
// modeled exhaustively here.
export interface ToolCall {
  tool: string;
  args: unknown;
  result: unknown;
}

// ai-analysis-service's services/critic_agent.py::CriticVerdict. `null`
// (not just absent) specifically means "this analysis was never run
// through the critic pass at all" - true for the streaming endpoint (see
// docs/ai-code-review-architecture.md's "critic only runs on the
// non-streaming path" note) and for any cache row written before this
// field existed. It is NEVER null for an analysis the critic did check -
// even an outright approval is a real `{verdict: "APPROVE", ...}` object -
// so `criticVerdict === null` is an unambiguous "not verified" signal, not
// something that could also mean "verified and fine."
export interface CriticVerdict {
  verdict: string;
  feedback: string;
}

// Shared by every non-PENDING analysis result shape below, regardless of
// whether it came from a cache hit, POST /ai/analyze, or the SSE stream's
// terminal "done" event - added across Phases 1-5 on the backend
// (ai-analysis-service's services/analysis_pipeline.py) well after this
// interface was first written, so every field here is optional: an older
// cached row (written before metadata_json existed) simply won't have
// them, same as `criticVerdict: null` above.
export interface AiAnalysisMetadata {
  toolCalls?: ToolCall[];
  criticVerdict?: CriticVerdict | null;
  revised?: boolean;
}

export type AiAnalysisResponse =
  | { status: 'PENDING' }
  | ({ status: 'READY'; analysis: AiAnalysisPassed | AiAnalysisFailed; source: 'AI' | 'CACHE' } & AiAnalysisMetadata);

// One event from POST /ai/analyze/stream's SSE body (see
// ai-analysis-service's services/analysis_service.py::analyze_stream's
// docstring for the exact event shapes this mirrors).
export type AiAnalysisStreamEvent =
  | ({ type: 'tool_call' } & ToolCall)
  | { type: 'token'; content: string }
  | {
      type: 'done';
      result: {
        analysisType: string;
        parsedAnalysis: AiAnalysisPassed | AiAnalysisFailed;
        rawResponse: string;
      } & AiAnalysisMetadata;
    }
  | { type: 'error'; message: string };

// A submission is "done" once its status is anything other than the two
// in-flight states. Both workers only ever report a status that falls into
// one bucket or the other - this function doesn't need per-worker knowledge.
const IN_FLIGHT_STATUSES = new Set(['PENDING', 'RUNNING']);
export function isTerminalStatus(status: string): boolean {
  return !IN_FLIGHT_STATUSES.has(status);
}

export function createSubmission(
  accessToken: string,
  userId: string,
  problemId: number,
  code: string,
  language: string,
  includeHidden: boolean = true,
): Promise<SubmissionCreatedResponse> {
  return apiFetch<SubmissionCreatedResponse>('/submissions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ userId, problemId, code, language, includeHidden }),
  });
}

export function getSubmission(accessToken: string, submissionId: number): Promise<Submission> {
  return apiFetch<Submission>(`/submissions/${submissionId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// All of this user's past submissions for one problem - backs the Solve
// page's "Submissions" tab.
export function getSubmissionsForProblem(
  accessToken: string,
  userId: string,
  problemId: number,
): Promise<Submission[]> {
  return apiFetch<Submission[]>(`/submissions/user/${userId}/problem/${problemId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// The set of problemIds this user has at least one PASSED submission for -
// backs the Practice list's "Solved" badge.
export function getSolvedProblemIds(accessToken: string, userId: string): Promise<number[]> {
  return apiFetch<number[]>(`/submissions/user/${userId}/solved`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Polls GET /submissions/{id} until it reaches a terminal status (or the
// attempt budget runs out). Both workers are asynchronous - Kafka consumers
// running in a separate process - so there's no way to get the result
// synchronously from the initial POST /submissions call.
export async function pollSubmissionResult(
  accessToken: string,
  submissionId: number,
  { intervalMs = 700, maxAttempts = 30 }: { intervalMs?: number; maxAttempts?: number } = {},
): Promise<Submission> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const submission = await getSubmission(accessToken, submissionId);
    if (isTerminalStatus(submission.status)) {
      return submission;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for a judging result.');
}

// The full judged-result detail (test cases, output, timing, the worker's
// own complexity estimate) - call once pollSubmissionResult resolves.
export function getExecutionResult(
  accessToken: string,
  submissionId: number,
): Promise<ExecutionResult> {
  return apiFetch<ExecutionResult>(`/api/results/${submissionId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Phase 4 (ai-analysis-service) added per-user rate limiting on both
// POST /ai/analyze and /ai/analyze/stream (429, via ApiError - see
// api/client.ts). Neither endpoint was called from this frontend before
// streamAiAnalysis below, so this is the first place that limit is
// actually reachable from the UI - callers should check this rather than
// showing the generic "failed to load" message a random 4xx would get.
export function isRateLimitError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 429;
}

// Streams POST /ai/analyze/stream's SSE body as an async generator of
// parsed events, one `yield` per `data: <json>\n\n` line the backend
// sends (see ai-analysis-service's main.py::analyze_code_stream). Not
// built on EventSource: EventSource only supports GET requests with no
// custom body/headers, and this needs to POST a JSON body with a Bearer
// token - so this reads the response body's stream directly instead.
export async function* streamAiAnalysis(
  accessToken: string,
  submissionId: number,
): AsyncGenerator<AiAnalysisStreamEvent, void, unknown> {
  const response = await fetch(`${API_BASE_URL}/ai/analyze/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ submissionId }),
  });

  if (!response.ok) {
    let message = `Streaming analysis failed with status ${response.status}`;
    try {
      const body = await response.json();
      if (typeof body?.detail === 'string' && body.detail.length > 0) {
        message = body.detail;
      }
    } catch {
      // Non-JSON error body - fall back to the generic message above.
    }
    throw new ApiError(message, response.status);
  }
  if (!response.body) {
    throw new Error('Streaming analysis response had no body.');
  }

  // SSE frames are separated by a blank line ("\n\n"); everything up to
  // the first newline within a frame is the "data: " prefix this endpoint
  // always sends (see analyze_code_stream - it never sends "event:"/"id:"
  // lines, just "data: <json>"). Chunks from the network don't necessarily
  // land on frame boundaries, so incomplete text is buffered across reads.
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? ''; // last element may be an incomplete frame - keep it buffered

      for (const frame of frames) {
        const line = frame.trim();
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice('data: '.length);
        try {
          yield JSON.parse(payload) as AiAnalysisStreamEvent;
        } catch {
          // Shouldn't happen (the backend always sends valid JSON per
          // event), but a malformed frame should never crash the whole
          // stream - skip it rather than throw.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// Polls ai-analysis-service's cache-only GET /ai/analysis/{id} - a separate,
// independent poll loop from pollSubmissionResult: the AI verdict is a
// best-effort enrichment that should never block or delay showing the
// deterministic judged result (see CLAUDE.md's "two independent layers"
// design). Unlike pollSubmissionResult, timing out here isn't an error - it
// just means the caller keeps showing a "still analyzing" state.
export async function pollAiAnalysis(
  accessToken: string,
  submissionId: number,
  { intervalMs = 1000, maxAttempts = 20 }: { intervalMs?: number; maxAttempts?: number } = {},
): Promise<AiAnalysisResponse> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await apiFetch<AiAnalysisResponse>(`/ai/analysis/${submissionId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (result.status === 'READY') {
        return result;
      }
    } catch {
      // ai-analysis-service unreachable/down - keep polling rather than
      // failing outright, same reasoning as the module-level "best-effort,
      // never blocks the judged result" design.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { status: 'PENDING' };
}
