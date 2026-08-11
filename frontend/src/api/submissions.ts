// Everything this app needs to talk to submission-service's REST endpoints
// (see submission-service's SubmissionController). Kept separate from
// api/auth.ts the same way that file is kept separate from api/client.ts.

import { apiFetch } from './client';

// Mirrors submission-service's SubmissionResponse DTO.
export interface SubmissionCreatedResponse {
  submissionId: number;
  status: string;
}

// One test case's judged outcome. Field names are aligned across both
// workers (see worker-service's dto.TestCaseResult / worker-service-go's
// domain.TestCaseResult) so this shape is the same regardless of which one
// judged the submission (see THE WORKER SWITCH). input/expected/actual are
// only ever present for non-hidden test cases - a hidden one only ever
// reveals whether it passed, never its content.
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
// once a worker picks it up, and ends at a terminal verdict string - which
// terminal values are possible depends on which worker judged it (see
// THE WORKER SWITCH in submission-service's SubmissionService and
// docker-compose.yml's ACTIVE_WORKER): the Java worker reports
// "PASSED"/"FAILED", the Go worker reports "PASSED"/"FAILED"/"RE"/"CE"/
// "TLE"/"MLE"/"SYSTEM_ERROR" (see worker-service-go/internal/domain/models.go).
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
// once GET /submissions/{id}'s status goes terminal. wallTimeMs/maxMemoryKb/
// estimatedTimeComplexity/estimatedSpaceComplexity are only ever populated
// when worker-service-go (not the legacy Java worker) judged the submission.
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

export type AiAnalysisResponse =
  | { status: 'PENDING' }
  | { status: 'READY'; analysis: AiAnalysisPassed | AiAnalysisFailed; source: 'AI' | 'CACHE' };

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
