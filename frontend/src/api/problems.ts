// Talks to problem-service's REST endpoints (see problem-service's
// ProblemController) via api-gateway's /problems/** route. Kept separate
// from api/submissions.ts / api/solutions.ts the same way every other
// api/*.ts file here is split per backend service.

import { apiFetch } from './client';

// One parameter of a problem's function signature - `type` is one of the 5
// types problem-service's harness generators currently support (see
// problem-service's harness.TypeVocabulary). No richer types (trees, custom
// classes) yet - that's a backend limitation, not something the frontend
// chooses to restrict further.
export interface FunctionParam {
  name: string;
  type: 'int' | 'int[]' | 'int[][]' | 'string' | 'bool';
}

export interface FunctionSignature {
  functionName: string;
  params: FunctionParam[];
  returnType: FunctionParam['type'];
}

// A worked example shown on the Description tab - display content only,
// distinct from the actual judged test cases below.
export interface Example {
  input: string;
  output: string;
  explanation?: string;
}

// What POST /problems needs to create a test case - `hidden` cases are
// judged on Submit but never shown to the user (see submission-service's
// includeHidden semantics).
export interface TestCaseInput {
  input: string;
  expectedOutput: string;
  hidden: boolean;
}

// Mirrors problem-service's ProblemResponse (GET /problems/getAll and
// GET /problems/{id}) - the shape both the Practice list and Solve page
// render from. functionName/params/returnType/harnessByLanguage are all
// null together when the problem has no function signature (raw stdin/
// stdout judge instead of the LeetCode-style harness system).
export interface ProblemSummary {
  id: number;
  name: string;
  description: string;
  constraints: string;
  difficulty: string;
  tags: string[];
  examples: Example[];
  functionName: string | null;
  params: FunctionParam[] | null;
  returnType: string | null;
  harnessByLanguage: Record<string, string> | null;
}

// POST /problems body (ADMIN-only, also enforced backend-side).
export interface CreateProblemRequest {
  name: string;
  description: string;
  constraints: string;
  difficulty: string;
  tags: string[];
  examples: Example[];
  testCases: TestCaseInput[];
  // Omitted entirely (not just empty) for a raw stdin/stdout judge problem.
  signature?: FunctionSignature;
}

// GET /problems/getAll returns a Spring Data Page wrapper - only `content`
// matters here, so callers get back a plain array. size=100 stands in for
// "all of them" until the Practice list needs real pagination.
export async function listProblems(accessToken: string): Promise<ProblemSummary[]> {
  const page = await apiFetch<{ content: ProblemSummary[] }>('/problems/getAll?page=0&size=100', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return page.content;
}

export function getProblem(accessToken: string, problemId: number): Promise<ProblemSummary> {
  return apiFetch<ProblemSummary>(`/problems/${problemId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// POST /problems returns the raw Problem entity (not ProblemResponse) - the
// only field the caller actually needs from it is `id`, to chain the
// follow-up solution-service calls (see AddProblemPage).
export function createProblem(
  accessToken: string,
  request: CreateProblemRequest,
): Promise<{ id: number }> {
  return apiFetch<{ id: number }>('/problems', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(request),
  });
}

// PUT /problems/{id} body is the same shape as create - a full replace, not
// a patch (see ProblemService.updateProblem).
export type UpdateProblemRequest = CreateProblemRequest;

export function updateProblem(
  accessToken: string,
  problemId: number,
  request: UpdateProblemRequest,
): Promise<ProblemSummary> {
  return apiFetch<ProblemSummary>(`/problems/${problemId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(request),
  });
}

export function deleteProblem(accessToken: string, problemId: number): Promise<void> {
  return apiFetch<void>(`/problems/${problemId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// GET /problems/{id}/testcases - includes hidden cases' expected output, so
// only ever call this from an ADMIN-gated page (the edit form), never the
// Solve page.
export function getTestCases(accessToken: string, problemId: number): Promise<TestCaseInput[]> {
  return apiFetch<TestCaseInput[]>(`/problems/${problemId}/testcases`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
