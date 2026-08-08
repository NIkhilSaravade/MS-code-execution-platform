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
export interface Submission {
  id: number;
  userId: string;
  problemId: number;
  code: string;
  language: string;
  status: string;
  output: string | null;
  reason: string | null;
  testCaseResults: TestCaseResult[] | null;
  submittedAt: string;
}

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
): Promise<SubmissionCreatedResponse> {
  return apiFetch<SubmissionCreatedResponse>('/submissions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ userId, problemId, code, language }),
  });
}

export function getSubmission(accessToken: string, submissionId: number): Promise<Submission> {
  return apiFetch<Submission>(`/submissions/${submissionId}`, {
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
