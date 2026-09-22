import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import Editor from '@monaco-editor/react';
// @monaco-editor/react wraps the Monaco Editor (the actual code-editing
// engine behind VS Code) as a React component. We just drop <Editor .../>
// into our JSX and pass it props — same idea as any component we wrote
// ourselves, just from a third-party package.
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm'; // adds table support - the plain CommonMark react-markdown ships with doesn't parse markdown tables
import Logo from '../components/landing/Logo';
import { DIFFICULTY_COLOR, LANGUAGES, type Difficulty, type Language } from '../data/problems';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../api/client';
import { getProblem, type FunctionSignature, type ProblemSummary } from '../api/problems';
import { generateStarterCode } from '../utils/starterCode';
import {
  createSubmission,
  getExecutionResult,
  getSubmissionsForProblem,
  isRateLimitError,
  pollAiAnalysis,
  pollSubmissionResult,
  streamAiAnalysis,
  type AiAnalysisResponse,
  type Submission,
  type TestCaseResult,
  type ToolCall,
} from '../api/submissions';
import { getSolutionForProblem, getNote, saveNote, type Solution as SolutionData } from '../api/solutions';
import {
  requestHint,
  revealSolution,
  getHintSession,
  explainProblem,
  type HintSessionState,
  type ExplainResponse,
} from '../api/aiHints';
// This is the busiest page in the app: it reads the URL, fetches the real
// problem from problem-service, manages several pieces of state (selected
// language, the code being typed, which test case is shown, run status),
// and submits code to submission-service, polling for a real judged
// verdict. Read the useState calls first to understand what this component
// is "remembering" before diving into the JSX.

// Monaco's `language` prop expects specific strings; ours happen to match
// our own Language ids exactly, but we keep this mapping explicit so it's
// obvious where the two systems connect (and easy to fix if they diverge).
const MONACO_LANGUAGE: Record<Language, string> = {
  javascript: 'javascript',
  typescript: 'typescript',
  python: 'python',
  java: 'java',
  cpp: 'cpp',
  // monaco-editor ships no separate "c" language contribution - only "cpp"
  // covers the whole C/C++ family, so C source reuses its highlighting.
  c: 'cpp',
  go: 'go',
};

// A string literal union describing the three states our "Run" flow can be
// in. Using a type instead of loose strings/booleans means TypeScript will
// flag typos like 'runing' immediately.
type RunStatus = 'idle' | 'running' | 'done';

// Remembers the user's last deliberately-chosen language (via the dropdown,
// see handleLanguageChange) across problems/reloads, until they change it
// again - shared across every problem rather than per-problem, so picking
// Python once means every problem opens in Python from then on.
const LANGUAGE_STORAGE_KEY = 'op-preferred-language';
const VALID_LANGUAGE_IDS = new Set(LANGUAGES.map((l) => l.id));

function getStoredLanguage(): Language {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored && VALID_LANGUAGE_IDS.has(stored as Language)) {
      return stored as Language;
    }
  } catch {
    // localStorage unavailable (private browsing, disabled storage, etc.) -
    // fall through to the default rather than crashing the page over a
    // convenience feature.
  }
  return 'javascript';
}

// Turns backend sophistication (Phases 1/2/5 of the ai-analysis-service
// agentic upgrade - see docs/ai-agent-build-log.md) into something a user
// can actually see, rather than a review that looks identical whether it
// came from one blind LLM call or a tool-calling, RAG-backed, critic-
// verified agent. Deliberately small/inline pill-style badges rather than
// a wall of debug text - the sophistication is in what happened, not in
// how much space this takes up.

const BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 11,
  fontFamily: "'JetBrains Mono',monospace",
  marginRight: 6,
  marginBottom: 6,
};

// fetch_similar_past_reviews' real result shape is
// {"results": [{"source": str, "title": str, "text": str}]} - see
// ai-analysis-service's services/tools.py. Narrowed here with a runtime
// check (not just a type assertion) since this is untrusted-shape JSON
// crossing a network boundary, not something TypeScript actually verified.
interface RagCitation {
  source: string;
  title: string;
  text: string;
}

function extractRagCitations(toolCalls: ToolCall[]): RagCitation[] {
  const call = toolCalls.find((tc) => tc.tool === 'fetch_similar_past_reviews');
  if (!call) return [];
  const result = call.result as { results?: unknown[] } | undefined;
  if (!Array.isArray(result?.results)) return [];
  return result.results.filter((r): r is RagCitation => {
    const candidate = r as Partial<RagCitation>;
    return typeof candidate?.source === 'string' && typeof candidate?.title === 'string';
  });
}

// Badges for every OTHER tool called (fetch_similar_past_reviews gets its
// own "Referenced" citation chips instead - see renderTrustSignals).
function renderToolCallBadges(toolCalls: ToolCall[]) {
  const otherTools = Array.from(
    new Set(toolCalls.filter((tc) => tc.tool !== 'fetch_similar_past_reviews').map((tc) => tc.tool)),
  );
  if (otherTools.length === 0) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <span style={{ ...BADGE_STYLE, background: '#1c2436', color: '#8fb8ff', marginRight: 4 }}>
        checked with:
      </span>
      {otherTools.map((tool) => (
        <span key={tool} style={{ ...BADGE_STYLE, background: '#1c2436', color: '#8fb8ff' }}>
          {tool}
        </span>
      ))}
    </div>
  );
}

// The trust-signal header shown above a READY review's detail: which tools
// actually fed into it, whether a second AI pass (the critic - see
// ai-analysis-service's services/critic_agent.py) verified or revised it,
// and which knowledge-base snippets were cited (RAG - see
// services/hybrid_search.py/reranker.py). `criticVerdict === null`
// unambiguously means "never critic-checked" (true for every review that
// came from the streaming endpoint - Phase 5 only wired the critic into
// the non-streaming path, see docs/ai-code-review-architecture.md) - it is
// NEVER null for a review the critic did check, even a plain approval.
function renderTrustSignals(analysis: Extract<AiAnalysisResponse, { status: 'READY' }>) {
  const toolCalls = analysis.toolCalls ?? [];
  const citations = extractRagCitations(toolCalls);
  const criticVerdict = analysis.criticVerdict;

  return (
    <div style={{ marginBottom: 12 }}>
      {renderToolCallBadges(toolCalls)}
      <div style={{ marginBottom: citations.length > 0 ? 8 : 0 }}>
        {criticVerdict == null ? (
          <span style={{ ...BADGE_STYLE, background: '#332a1a', color: '#e0b463' }}>
            ⓘ not yet verified by a second AI pass
          </span>
        ) : analysis.revised ? (
          <span style={{ ...BADGE_STYLE, background: '#173322', color: '#7ee0a0' }}>
            ✓ verified — a second AI pass requested and applied a revision
          </span>
        ) : (
          <span style={{ ...BADGE_STYLE, background: '#173322', color: '#7ee0a0' }}>
            ✓ verified by a second AI pass
          </span>
        )}
      </div>
      {citations.length > 0 && (
        <div>
          <span style={{ color: '#6b7392', fontSize: 11.5 }}>Referenced: </span>
          {citations.map((c, i) => (
            <span
              key={`${c.source}-${i}`}
              title={c.text.slice(0, 240)}
              style={{ ...BADGE_STYLE, background: '#241c33', color: '#c9a9ff', cursor: 'help' }}
            >
              {c.source} — {c.title}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// The shape of a real result, once the submission reaches a terminal status.
// `status` is whatever string the active worker reported (see THE WORKER
// SWITCH in submission-service) - not narrowed to a fixed union, since the
// two workers use different vocabularies (Java: PASSED/FAILED, Go:
// PASSED/FAILED/RE/CE/TLE/MLE/SYSTEM_ERROR).
interface RunResult {
  status: string;
  passed: boolean;
  output: string | null;
  reason: string | null;
  // Per-test-case breakdown, when the worker reported one (older submissions
  // judged before this existed, or a submission that failed before reaching
  // any test case - e.g. CE - won't have one).
  testCaseResults: TestCaseResult[] | null;
  wallTimeMs: number | null;
  maxMemoryKb: number | null;
  estimatedTimeComplexity: string | null;
  estimatedSpaceComplexity: string | null;
}

// Pulls a problem's function signature out of its (nullable, all-or-nothing)
// functionName/params/returnType fields - null when the problem has none
// (raw stdin/stdout judge instead of the LeetCode-style harness system).
function getSignature(problem: ProblemSummary): FunctionSignature | null {
  if (!problem.functionName || !problem.params || !problem.returnType) {
    return null;
  }
  return {
    functionName: problem.functionName,
    params: problem.params,
    returnType: problem.returnType as FunctionSignature['returnType'],
  };
}

export default function SolvePage() {
  // useParams() reads the dynamic parts of the CURRENT URL, based on the
  // `:id` placeholder we declared in App.tsx's <Route path="/practice/:id">.
  // Visiting /practice/14 makes `id` equal to "14" here (always a string -
  // URL segments have no concept of "number").
  const { id: idParam } = useParams<{ id: string }>();
  const problemId = idParam ? Number(idParam) : undefined;

  // ---- All the component's STATE, declared up front. Each useState call
  // is independent — React doesn't require you to bundle related state
  // into one object; several small useStates is completely normal. ----

  // The real problem, fetched from problem-service - null means either
  // "still loading" or "doesn't exist"; `problemLoaded` disambiguates the
  // two (see the early-return guards below) so a slow fetch doesn't get
  // mistaken for a 404 and bounce the user back to /practice.
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [problemLoaded, setProblemLoaded] = useState(false);

  const [language, setLanguage] = useState<Language>(getStoredLanguage);
  const [code, setCode] = useState('');

  const [activeExample, setActiveExample] = useState(0); // which "Case N" tab is selected
  const [consoleTab, setConsoleTab] = useState<'testcase' | 'result' | 'complexity' | 'ai-analysis'>('testcase');
  const [runStatus, setRunStatus] = useState<RunStatus>('idle');
  const [result, setResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  // The AI-analysis-service verdict - deliberately a SEPARATE state from
  // `result`, fetched independently and slower (see runCode below): a slow
  // or unreachable ai-analysis-service must never delay or block showing
  // the deterministic judged result above.
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysisResponse | null>(null);
  // Live state for POST /ai/analyze/stream's SSE body (see api/submissions.ts's
  // streamAiAnalysis) - only populated while a *fresh* Run/Submit's review is
  // actively streaming in. A re-opened past submission (loadSubmission)
  // never streams; it just reads whatever's already cached, so these three
  // stay at their idle defaults in that path.
  const [aiStreamPhase, setAiStreamPhase] = useState<'idle' | 'streaming' | 'error'>('idle');
  const [aiStreamPreview, setAiStreamPreview] = useState('');
  const [aiStreamError, setAiStreamError] = useState<string | null>(null);
  const [aiToolCalls, setAiToolCalls] = useState<ToolCall[]>([]);
  // Which top-level panel is showing on the left, alongside Description and
  // Solutions - mirrors LeetCode's own layout, where Submissions lives next
  // to the problem statement rather than buried in the bottom console.
  const [leftTab, setLeftTab] = useState<'description' | 'solutions' | 'submissions' | 'hints' | 'explain'>('description');
  // This user's past Submits (not Runs - see getSubmissionsForProblem) for
  // this problem - fetched once on mount, re-fetched whenever a new Submit
  // reaches a terminal status so the list stays current without a manual
  // refresh.
  const [pastSubmissions, setPastSubmissions] = useState<Submission[]>([]);
  // Which past submission's code + test case breakdown is expanded open in
  // the Submissions tab - null means "showing the list, nothing expanded".
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<number | null>(null);
  // This problem's written solution (12 parts + visualizer), fetched from
  // solution-service - null means either "still loading" or "none written
  // yet"; `solutionLoaded` disambiguates the two so the Solutions tab
  // doesn't flash "not written yet" before the fetch finishes.
  const [solution, setSolution] = useState<SolutionData | null>(null);
  const [solutionLoaded, setSolutionLoaded] = useState(false);
  // The user's own notes for this problem (Solutions tab, after the parts
  // list) - `noteContent` is the live textarea value, `noteSavedContent` is
  // what's actually persisted, so we can tell whether there are unsaved
  // changes without a separate boolean to keep in sync.
  const [noteContent, setNoteContent] = useState('');
  const [noteSavedContent, setNoteSavedContent] = useState('');
  const [noteLoaded, setNoteLoaded] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);

  // ---- AI hint system (Phase A/D) state ----
  // null distinguishes "not fetched yet" from "fetched, level 0/no history"
  // - same disambiguation pattern `solution`/`solutionLoaded` above use.
  const [hintSession, setHintSession] = useState<HintSessionState | null>(null);
  const [hintSessionLoaded, setHintSessionLoaded] = useState(false);
  const [hintStuckDescription, setHintStuckDescription] = useState('');
  const [hintLoading, setHintLoading] = useState(false);
  const [hintError, setHintError] = useState<string | null>(null);
  // Level 4 is a structurally separate flow, not the next click of "Get a
  // hint": revealConfirming gates a distinct confirmation UI (see
  // handleRevealClick/handleConfirmReveal below) so a user can never reach
  // the full solution with one accidental click.
  const [revealConfirming, setRevealConfirming] = useState(false);
  const [revealLoading, setRevealLoading] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [revealedSolution, setRevealedSolution] = useState<string | null>(null);

  // ---- AI post-solve explain (Phase B/D) state ----
  const [explainResult, setExplainResult] = useState<ExplainResponse | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  // The most recent Run/Submit's id and whether it judged hidden cases too
  // (a real Submit, not a Run) - lets the Result tab's "Explain this
  // solution" banner (only shown for a PASSED Submit) hand handleExplain
  // the exact submissionId it means, rather than relying on
  // latestPassedSubmissionId()'s read of pastSubmissions, which a
  // just-finished Submit may not have landed in yet (see handleExplain's
  // docstring on the race this avoids).
  const [lastSubmissionId, setLastSubmissionId] = useState<number | null>(null);
  const [lastIncludeHidden, setLastIncludeHidden] = useState(false);
  // `RunResult | null` — this state starts as null (no result yet) and
  // becomes a real RunResult object once submission-service reports a
  // terminal verdict (see api/submissions.ts's pollSubmissionResult).

  const { accessToken, userId } = useAuth();

  // AuthContext silently rotates accessToken every ~14 minutes (proactive
  // refresh) and also reactively on any 401 mid-request - a token value by
  // itself is not a meaningful "something the user did" signal. Every fetch
  // effect below needs the CURRENT token to make its request, but must NOT
  // re-run (and re-fetch - clobbering an in-progress note edit, resetting
  // the submissions list, etc.) just because the token rotated. Reading
  // through a ref decouples "what token to send" from "when to re-fetch".
  const accessTokenRef = useRef(accessToken);
  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  useEffect(() => {
    const token = accessTokenRef.current;
    if (!problemId || !token) {
      setProblem(null);
      setProblemLoaded(true);
      return;
    }
    setProblemLoaded(false);
    getProblem(token, problemId)
      .then((p) => {
        setProblem(p);
        setProblemLoaded(true);
      })
      .catch(() => {
        setProblem(null);
        setProblemLoaded(true);
      });
  }, [problemId]);

  // Sets the starter code once the problem itself loads (or changes) - NOT
  // on every language switch, since handleLanguageChange below already
  // handles that case itself (and this running too would stomp it right
  // back to the DEFAULT language's stub every time).
  useEffect(() => {
    if (!problem) return;
    setCode(generateStarterCode(getSignature(problem), language));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem]);

  // Fetches this user's past submissions for this problem. Declared as a
  // plain function (not useCallback) since it's only ever called from the
  // effect below or after a fresh submission - both fine to redefine every
  // render. Reads the token from accessTokenRef (see above) rather than the
  // accessToken closure variable, so this can be called from a
  // token-independent effect below without going stale.
  async function refreshPastSubmissions() {
    const token = accessTokenRef.current;
    if (!problemId || !token || !userId) return;
    try {
      const submissions = await getSubmissionsForProblem(token, userId, problemId);
      // Most recent first.
      setPastSubmissions(
        [...submissions].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
      );
    } catch {
      // Best-effort - a failed fetch just leaves the tab empty.
    }
  }

  useEffect(() => {
    refreshPastSubmissions();
    // Deliberately NOT depending on accessToken - a background token
    // rotation shouldn't re-fetch this list (harmless here since it's
    // read-only, but pointless network traffic all the same). userId is
    // stable across a rotation (same session, same subject claim), so it's
    // safe to keep as a real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problemId, userId]);

  useEffect(() => {
    const token = accessTokenRef.current;
    if (!problemId || !token) {
      setSolution(null);
      setSolutionLoaded(true);
      return;
    }
    setSolutionLoaded(false);
    getSolutionForProblem(token, problemId).then((s) => {
      setSolution(s);
      setSolutionLoaded(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problemId]);

  useEffect(() => {
    const token = accessTokenRef.current;
    if (!problemId || !token) {
      setNoteContent('');
      setNoteSavedContent('');
      setNoteLoaded(true);
      return;
    }
    setNoteLoaded(false);
    getNote(token, problemId).then((n) => {
      setNoteContent(n.content);
      setNoteSavedContent(n.content);
      setNoteLoaded(true);
    });
    // Deliberately NOT depending on accessToken (see accessTokenRef above) -
    // this must only re-fetch when the user switches problems, never when
    // the token merely rotates, or an in-progress edit gets silently wiped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problemId]);

  // EARLY RETURNS based on data, before the "main" render. While the fetch
  // is still in flight we show a plain loading state rather than either
  // rendering with a null problem or prematurely redirecting away. Only
  // once the fetch has actually settled AND come back empty do we treat it
  // as "not found" and bounce to /practice.
  if (!problemLoaded) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0c16',
          color: '#6b7392',
          fontFamily: "'Manrope',system-ui,sans-serif",
        }}
      >
        Loading…
      </div>
    );
  }
  if (!problem) {
    return <Navigate to="/practice" replace />;
  }

  // A plain event-handler function defined INSIDE the component (so it
  // can close over `problem`, `setLanguage`, `setCode`). Not a hook —
  // just a regular function called from the <select>'s onChange below.
  function handleLanguageChange(next: Language) {
    setLanguage(next);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      // Best-effort persistence (see getStoredLanguage) - a storage failure
      // shouldn't block switching languages for the current session.
    }
    // `problem!` — the `!` is TypeScript's "non-null assertion": we know
    // `problem` can't be null/undefined here (we already returned early
    // above if it was), but TypeScript can't always follow that logic
    // inside a nested function, so `!` tells the compiler to trust us.
    setCode(generateStarterCode(getSignature(problem!), next));
  }

  async function handleSaveNote() {
    if (!problemId || !accessToken) return;
    setNoteSaving(true);
    try {
      const saved = await saveNote(accessToken, problemId, noteContent);
      setNoteSavedContent(saved.content);
    } finally {
      setNoteSaving(false);
    }
  }

  // Fetches (or re-fetches) this problem's hint session state - called when
  // the Hints tab is first opened and again after every hint/reveal so the
  // level/history shown always reflects what's actually persisted, not just
  // this call's own return value.
  async function loadHintSession() {
    if (!problemId || !accessToken) return;
    try {
      const session = await getHintSession(accessToken, problemId);
      setHintSession(session);
    } finally {
      setHintSessionLoaded(true);
    }
  }

  async function handleGetHint() {
    if (!problemId || !accessToken) return;
    setHintLoading(true);
    setHintError(null);
    try {
      await requestHint(accessToken, problemId, code, hintStuckDescription);
      setHintStuckDescription('');
      await loadHintSession(); // re-fetch rather than hand-append, so the persisted level is the source of truth
    } catch (err) {
      setHintError(err instanceof Error ? err.message : 'Failed to get a hint.');
    } finally {
      setHintLoading(false);
    }
  }

  // Step 1 of 2 - opens the confirmation UI, does NOT call the backend yet.
  function handleRevealClick() {
    setRevealError(null);
    setRevealConfirming(true);
  }

  // Step 2 of 2 - the actual, deliberate confirmation. Only this function
  // calls POST /ai/hint/reveal-solution.
  async function handleConfirmReveal() {
    if (!problemId || !accessToken) return;
    setRevealLoading(true);
    setRevealError(null);
    try {
      const result = await revealSolution(accessToken, problemId, code, hintStuckDescription);
      setRevealedSolution(result.solution);
      setRevealConfirming(false);
      await loadHintSession();
    } catch (err) {
      setRevealError(err instanceof Error ? err.message : 'Failed to reveal the solution.');
    } finally {
      setRevealLoading(false);
    }
  }

  // Most recently submitted PASSED submission for this problem, if any -
  // used as the default submissionId for POST /ai/explain's "submission
  // mode" (walk through the user's own working code). Falls back to
  // undefined (explain's "generic" mode) when there isn't one, e.g. the
  // user gave up and wants to see the intended approach instead.
  function latestPassedSubmissionId(): number | undefined {
    const passed = pastSubmissions.filter((s) => s.status === 'PASSED');
    if (passed.length === 0) return undefined;
    return passed.reduce((latest, s) => (s.submittedAt > latest.submittedAt ? s : latest)).id;
  }

  // `submissionIdOverride` lets a caller (the Result tab's "Explain this
  // solution" banner - see runCode below) hand over the submission that
  // was JUST judged, instead of relying on latestPassedSubmissionId()'s
  // read of `pastSubmissions` - that list is refreshed by a fire-and-forget
  // refreshPastSubmissions() call in runCode, so reading it here right
  // after a fresh Submit could race a click that happens before that
  // refresh resolves. The Explain tab's own "Explain my solution" button
  // (no override) still falls back to latestPassedSubmissionId() as before.
  async function handleExplain(submissionIdOverride?: number) {
    if (!problemId || !accessToken) return;
    setExplainLoading(true);
    setExplainError(null);
    try {
      const result = await explainProblem(accessToken, problemId, submissionIdOverride ?? latestPassedSubmissionId());
      setExplainResult(result);
    } catch (err) {
      setExplainError(err instanceof Error ? err.message : 'Failed to load the explanation.');
    } finally {
      setExplainLoading(false);
    }
  }

  // Loads a past submission's code straight into the real editor (same one
  // used for writing new code) instead of showing a separate read-only
  // copy, and shows its already-judged verdict in the console's Result tab
  // - so clicking a submission looks and feels exactly like just having run
  // it yourself.
  async function loadSubmission(sub: Submission) {
    setSelectedSubmissionId(sub.id);
    setLanguage(sub.language as Language);
    setCode(sub.code);
    setConsoleTab('result');
    setRunStatus('running'); // detail fetch is async now - see getExecutionResult
    setResult(null);
    setAiAnalysis(null);
    setAiStreamPhase('idle');
    setAiStreamPreview('');
    setAiStreamError(null);
    setAiToolCalls([]);
    setRunError(null);

    if (!accessToken) return;
    try {
      const detail = await getExecutionResult(accessToken, sub.id);
      setResult({
        status: detail.status,
        passed: detail.status === 'PASSED',
        output: detail.output,
        reason: detail.reason,
        testCaseResults: detail.testCaseResults,
        wallTimeMs: detail.wallTimeMs,
        maxMemoryKb: detail.maxMemoryKb,
        estimatedTimeComplexity: detail.estimatedTimeComplexity,
        estimatedSpaceComplexity: detail.estimatedSpaceComplexity,
      });
      pollAiAnalysis(accessToken, sub.id).then(setAiAnalysis);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Failed to load submission result.');
    } finally {
      setRunStatus('done');
    }
  }

  // Triggers a FRESH AI review via the real-time SSE endpoint
  // (POST /ai/analyze/stream - see api/submissions.ts's streamAiAnalysis)
  // instead of silently polling for the Kafka-auto-triggered one, so the
  // user sees the review's raw JSON build up token-by-token rather than
  // waiting on a blind poll loop, then a fully-formed result.
  //
  // Caveat surfaced in the UI (see the ai-analysis tab's render below, not
  // here): the critic/verifier pass (Phase 5) only runs on the
  // non-streaming path, so `event.result.criticVerdict` here is always
  // `null` - this specific review has not been double-checked by the
  // critic agent, only generated. That's an accurate reflection of the
  // backend's current behavior, not a bug in this function.
  async function runAiAnalysisStream(submissionId: number) {
    if (!accessToken) return;

    setAiAnalysis(null);
    setAiStreamPreview('');
    setAiToolCalls([]);
    setAiStreamError(null);
    setAiStreamPhase('streaming');

    try {
      for await (const event of streamAiAnalysis(accessToken, submissionId)) {
        if (event.type === 'tool_call') {
          setAiToolCalls((prev) => [...prev, event]);
        } else if (event.type === 'token') {
          setAiStreamPreview((prev) => prev + event.content);
        } else if (event.type === 'done') {
          setAiAnalysis({
            status: 'READY',
            analysis: event.result.parsedAnalysis,
            source: 'AI',
            toolCalls: event.result.toolCalls,
            criticVerdict: event.result.criticVerdict,
            revised: event.result.revised,
          });
          setAiStreamPhase('idle');
        } else if (event.type === 'error') {
          setAiStreamError(event.message);
          setAiStreamPhase('error');
        }
      }
    } catch (err) {
      setAiStreamError(
        isRateLimitError(err)
          ? 'Too many AI review requests right now - try again in a moment.'
          : err instanceof Error
            ? err.message
            : 'Failed to stream the AI review.',
      );
      setAiStreamPhase('error');
    }
  }

  // Calls the real backend judge: POST /submissions, then poll
  // GET /submissions/{id} until it reaches a terminal status. "Run" only
  // judges the visible/sample test cases; "Submit" judges everything,
  // hidden cases included - matching LeetCode's "Run Code" vs "Submit".
  async function runCode(includeHidden: boolean) {
    if (!problemId || !accessToken || !userId) return;

    setConsoleTab('result'); // auto-switch to the Result tab so the user sees feedback
    setRunStatus('running');
    setResult(null);
    setAiAnalysis(null);
    setAiStreamPhase('idle');
    setAiStreamPreview('');
    setAiStreamError(null);
    setAiToolCalls([]);
    setRunError(null);
    setSelectedSubmissionId(null); // this run is fresh code, not a re-loaded past submission
    setLastSubmissionId(null);
    // Explain reflects the PREVIOUS Submit's result, if any, until this
    // one finishes - clearing it now would just flash the "no explanation
    // yet" state for every Run, which is noise for the (much more common)
    // "Run" case that isn't Explain-eligible anyway.

    try {
      const { submissionId } = await createSubmission(
        accessToken,
        userId,
        problemId,
        code,
        language,
        includeHidden,
      );
      await pollSubmissionResult(accessToken, submissionId); // waits for terminal status only
      const detail = await getExecutionResult(accessToken, submissionId);
      setResult({
        status: detail.status,
        passed: detail.status === 'PASSED',
        output: detail.output,
        reason: detail.reason,
        testCaseResults: detail.testCaseResults,
        wallTimeMs: detail.wallTimeMs,
        maxMemoryKb: detail.maxMemoryKb,
        estimatedTimeComplexity: detail.estimatedTimeComplexity,
        estimatedSpaceComplexity: detail.estimatedSpaceComplexity,
      });
      setLastSubmissionId(submissionId);
      setLastIncludeHidden(includeHidden);
      refreshPastSubmissions(); // pick up the submission that just finished

      // Independent, non-blocking stream of the AI review - see
      // runAiAnalysisStream's own comment for why this must never delay
      // the result above (same "two independent layers" reasoning
      // pollAiAnalysis used to rely on, just streamed instead of polled).
      void runAiAnalysisStream(submissionId);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Failed to judge submission.');
    } finally {
      setRunStatus('done');
    }
  }

  // Shared per-test-case breakdown markup - used both by the Result tab
  // (this run's outcome) and the Submissions tab's expanded detail view
  // (a past submission's outcome). Kept as one function so the two stay
  // visually identical instead of drifting apart.
  function renderTestCaseResults(results: TestCaseResult[]) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {results.map((tc) => (
          <div
            key={tc.ordinal}
            style={{
              border: '1px solid rgba(255,255,255,.08)',
              borderRadius: 10,
              padding: '12px 14px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: tc.hidden ? 0 : 10,
                fontSize: 12.5,
                fontWeight: 700,
              }}
            >
              <span>Case {tc.ordinal + 1}</span>
              {tc.hidden && <span style={{ color: '#6b7392', fontWeight: 500 }}>(hidden)</span>}
              <div style={{ flex: 1 }} />
              <span style={{ color: tc.passed ? '#34d399' : '#f87171' }}>
                {tc.passed ? 'Passed' : 'Failed'}
              </span>
            </div>
            {/* Hidden test cases only ever reveal pass/fail - see
                api/submissions.ts's TestCaseResult comment. */}
            {!tc.hidden && (
              <div
                style={{
                  fontFamily: "'JetBrains Mono',monospace",
                  fontSize: 12.5,
                  lineHeight: 1.7,
                  color: '#b3bacb',
                }}
              >
                <div style={{ color: '#6b7392', marginBottom: 2 }}>Input</div>
                <div style={{ marginBottom: 8 }}>{tc.input}</div>
                <div style={{ color: '#6b7392', marginBottom: 2 }}>Expected</div>
                <div style={{ marginBottom: 8 }}>{tc.expected}</div>
                <div style={{ color: '#6b7392', marginBottom: 2 }}>Actual</div>
                <div>{tc.actual}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  // Constraints come back as a single free-text block (problem-service's
  // `constraints` is one TEXT field, not a list) - split into lines here so
  // it still renders as a bulleted list, same as before.
  const constraintLines = problem.constraints.split('\n').map((c) => c.trim()).filter(Boolean);

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column', // stack header on top, body below
        background: '#0a0c16',
        color: '#eef0f6',
        fontFamily: "'Manrope',system-ui,sans-serif",
      }}
    >
      {/* top bar */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          padding: '10px 20px',
          borderBottom: '1px solid rgba(255,255,255,.08)',
          background: '#0a0c16',
          flexShrink: 0, // don't let flexbox shrink the header when space is tight
        }}
      >
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none' }}>
          <Logo size={22} boxSize={10} />
        </Link>
        <Link
          to="/practice"
          style={{ fontSize: 13, color: '#9aa2b8', textDecoration: 'none', fontWeight: 600 }}
        >
          ← Practice
        </Link>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#eef0f6' }}>{problem.name}</span>
        <div style={{ flex: 1 }} />

        {/* Another CONTROLLED form element, this time a <select>. Same
            pattern as PracticePage's <input>: value is driven by state,
            onChange pushes changes back into state (via our handler). */}
        <select
          value={language}
          onChange={(e) => handleLanguageChange(e.target.value as Language)}
          // `e.target.value` from a <select> is always typed as `string`
          // by TypeScript's DOM types (it can't know it'll only ever be
          // one of our four language ids) — `as Language` asserts that
          // narrower type, since we control the <option> values below.
          style={{
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 12.5,
            fontWeight: 600,
            color: '#c4b5fd',
            background: 'rgba(124,58,237,.12)',
            border: '1px solid rgba(167,139,250,.3)',
            borderRadius: 9,
            padding: '8px 12px',
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id} style={{ background: '#14162a' }}>
              {l.label}
            </option>
          ))}
        </select>

        <button
          onClick={() => runCode(false)}
          // real HTML disabled attribute — browser blocks clicks while true.
          disabled={runStatus === 'running'}
          className="op-run-btn"
          style={{
            fontFamily: 'inherit',
            fontSize: 13.5,
            fontWeight: 700,
            color: '#e8eaf2',
            background: 'rgba(255,255,255,.06)',
            border: '1px solid rgba(255,255,255,.14)',
            padding: '9px 18px',
            borderRadius: 10,
            cursor: runStatus === 'running' ? 'default' : 'pointer',
            opacity: runStatus === 'running' ? 0.6 : 1,
          }}
        >
          Run
        </button>
        <button
          onClick={() => runCode(true)}
          disabled={runStatus === 'running'}
          className="op-run-btn"
          style={{
            fontFamily: 'inherit',
            fontSize: 13.5,
            fontWeight: 700,
            color: '#fff',
            background: 'linear-gradient(135deg,#7c3aed,#6366f1)',
            border: 'none',
            padding: '9px 20px',
            borderRadius: 10,
            cursor: runStatus === 'running' ? 'default' : 'pointer',
            opacity: runStatus === 'running' ? 0.6 : 1,
            boxShadow: '0 4px 20px rgba(124,58,237,.4)',
          }}
        >
          Submit
        </button>
      </header>

      {/* body: shared Description/Solutions/Submissions tab bar up top, then
          one of two layouts below it - the normal description+editor split
          for Description/Submissions, or a full-width two-column split
          (parts left, visualizer right) for Solutions, since squeezing the
          visualizer into the narrow 42% description column would cramp it. */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div
          style={{
            display: 'flex',
            gap: 20,
            padding: '14px 20px',
            borderBottom: '1px solid rgba(255,255,255,.08)',
            flexShrink: 0,
          }}
        >
          {(
            [
              { id: 'description', label: 'Description' },
              { id: 'solutions', label: 'Solutions' },
              { id: 'submissions', label: `Submissions${pastSubmissions.length > 0 ? ` (${pastSubmissions.length})` : ''}` },
              { id: 'hints', label: 'Hints' },
              { id: 'explain', label: 'Explain' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setLeftTab(t.id);
                if (t.id === 'hints' && !hintSessionLoaded) {
                  void loadHintSession();
                }
              }}
              className="op-tab"
              style={{
                fontFamily: 'inherit',
                fontSize: 13,
                fontWeight: 700,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                color: leftTab === t.id ? '#eef0f6' : '#6b7392',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {leftTab === 'solutions' ? (
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {/* left half: the solution write-up, rendered as one continuous
                document (no per-section collapsing), plus a Notes section
                below it. */}
            <div
              style={{
                width: '50%',
                minWidth: 320,
                borderRight: '1px solid rgba(255,255,255,.08)',
                overflowY: 'auto',
                padding: '24px 28px 60px',
              }}
            >
              {!solutionLoaded ? (
                <span style={{ color: '#6b7392', fontSize: 14 }}>Loading…</span>
              ) : !solution ? (
                <span style={{ color: '#6b7392', fontSize: 14 }}>
                  Solutions aren&apos;t written yet for this problem.
                </span>
              ) : (
                // All parts concatenated into one continuous document - old
                // data with multiple titled parts (e.g. content written
                // before this became a single free-form write-up) still
                // reads fine, just flowing straight through with no
                // collapsing and no per-part chrome.
                <div className="op-solution-md">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {solution.parts.map((part) => part.markdown).join('\n\n')}
                  </ReactMarkdown>
                </div>
              )}

              {/* Notes - the user's own free-text scratchpad for this
                  problem, independent of whether a written solution exists.
                  Explicit Save button (not auto-save) so we're not firing a
                  network request on every keystroke. */}
              <div
                style={{
                  marginTop: 20,
                  border: '1px solid rgba(255,255,255,.08)',
                  borderRadius: 10,
                  padding: '14px 16px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: '#eef0f6' }}>Notes</span>
                  <div style={{ flex: 1 }} />
                  {noteContent !== noteSavedContent && (
                    <span style={{ fontSize: 11.5, color: '#6b7392' }}>Unsaved changes</span>
                  )}
                  <button
                    onClick={handleSaveNote}
                    disabled={noteSaving || noteContent === noteSavedContent}
                    style={{
                      fontFamily: 'inherit',
                      fontSize: 12,
                      fontWeight: 700,
                      padding: '6px 14px',
                      borderRadius: 8,
                      border: '1px solid rgba(167,139,250,.4)',
                      background: 'rgba(124,58,237,.14)',
                      color: '#c4b5fd',
                      cursor: noteSaving || noteContent === noteSavedContent ? 'default' : 'pointer',
                      opacity: noteSaving || noteContent === noteSavedContent ? 0.5 : 1,
                    }}
                  >
                    {noteSaving ? 'Saving…' : 'Save'}
                  </button>
                </div>
                <textarea
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  disabled={!noteLoaded}
                  placeholder="Jot down anything you want to remember about this problem…"
                  style={{
                    width: '100%',
                    minHeight: 140,
                    resize: 'vertical',
                    background: 'rgba(255,255,255,.04)',
                    border: '1px solid rgba(255,255,255,.08)',
                    borderRadius: 8,
                    padding: '10px 12px',
                    color: '#cdd3e0',
                    fontFamily: 'inherit',
                    fontSize: 13.5,
                    lineHeight: 1.6,
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            {/* right half: the step-through visualizer */}
            <div style={{ width: '50%', display: 'flex', flexDirection: 'column' }}>
              {solution?.visualizerUrl ? (
                // Sandboxed iframe pointed at solution-service's public
                // visualizer endpoint (see api/solutions.ts) - the
                // visualizer is a fully self-contained page with its own
                // inline CSS/JS, so it's served as-is rather than
                // reimplemented in React. allow-scripts is needed for its
                // own JS to run; no allow-same-origin, so it can't reach
                // into this page's DOM/localStorage even though it's
                // same-origin by URL.
                <iframe
                  src={`${API_BASE_URL}${solution.visualizerUrl}`}
                  title={`${problem.name} visualizer`}
                  sandbox="allow-scripts"
                  style={{ width: '100%', height: '100%', border: 'none' }}
                />
              ) : (
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#6b7392',
                    fontSize: 14,
                  }}
                >
                  No visualizer for this problem yet.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {/* `minHeight: 0` here (and below) is a common flexbox fix:
                without it, flex children default to a min-height based on
                their content, which can prevent inner `overflow: auto`
                scrolling from working. */}

            {/* left panel: Description / Submissions content */}
            <div
              style={{
                width: '42%',
                minWidth: 340,
                borderRight: '1px solid rgba(255,255,255,.08)',
                overflowY: 'auto',
                padding: '24px 28px 60px',
              }}
            >
              {leftTab === 'description' && (
                <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <h1
              style={{
                fontFamily: "'Space Grotesk',sans-serif",
                fontWeight: 700,
                fontSize: 22,
                margin: 0,
              }}
            >
              {problem.id}. {problem.name}
            </h1>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 22, flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: DIFFICULTY_COLOR[problem.difficulty as Difficulty] ?? '#9aa2b8',
                // Template literal appending a hex alpha suffix ("1a" ≈ 10%
                // opacity) to the difficulty color, e.g. "#34d3991a" — a
                // quick way to derive a translucent background from a
                // solid color string without a separate color library.
                background: `${DIFFICULTY_COLOR[problem.difficulty as Difficulty] ?? '#9aa2b8'}1a`,
                padding: '5px 11px',
                borderRadius: 999,
              }}
            >
              {problem.difficulty}
            </span>
            {problem.tags.map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#9aa2b8',
                  background: 'rgba(255,255,255,.05)',
                  padding: '5px 11px',
                  borderRadius: 999,
                }}
              >
                {tag}
              </span>
            ))}
          </div>

          <p style={{ fontSize: 14.5, lineHeight: 1.75, color: '#cdd3e0', whiteSpace: 'pre-line', margin: '0 0 26px' }}>
            {/* `whiteSpace: 'pre-line'` makes the browser respect the
                `\n` newline characters inside problem.description as real
                line breaks — by default HTML/CSS collapses all whitespace,
                including newlines, into single spaces. */}
            {problem.description}
          </p>

          {problem.examples.map((ex, i) => (
            // Using the array INDEX as the `key` here (instead of a unique
            // id) is acceptable because this list is static — it's never
            // reordered, filtered, or has items inserted/removed at
            // runtime. If it could change dynamically, index keys can
            // cause subtle rendering bugs and a stable id would be safer.
            <div key={i} style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#eef0f6', marginBottom: 8 }}>
                Example {i + 1}
              </div>
              <div
                style={{
                  fontFamily: "'JetBrains Mono',monospace",
                  fontSize: 12.5,
                  lineHeight: 1.7,
                  background: 'rgba(255,255,255,.04)',
                  border: '1px solid rgba(255,255,255,.07)',
                  borderRadius: 10,
                  padding: '14px 16px',
                  color: '#b3bacb',
                }}
              >
                <div>
                  <span style={{ color: '#6b7392' }}>Input: </span>
                  {ex.input}
                </div>
                <div>
                  <span style={{ color: '#6b7392' }}>Output: </span>
                  {ex.output}
                </div>
                {/* `ex.explanation` is an OPTIONAL field on the Example
                    type. `{ex.explanation && (...)}` only renders the div
                    if explanation is a non-empty string (a falsy value
                    like undefined skips rendering entirely). */}
                {ex.explanation && (
                  <div>
                    <span style={{ color: '#6b7392' }}>Explanation: </span>
                    {ex.explanation}
                  </div>
                )}
              </div>
            </div>
          ))}

          <div style={{ fontSize: 13, fontWeight: 700, color: '#eef0f6', marginBottom: 8 }}>Constraints</div>
          <ul style={{ margin: 0, paddingLeft: 20, color: '#9aa2b8', fontSize: 13, lineHeight: 1.9 }}>
            {constraintLines.map((c, i) => (
              <li key={i} style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5 }}>
                {c}
              </li>
            ))}
          </ul>
                </>
              )}

              {leftTab === 'submissions' && (
            <div style={{ fontSize: 13.5 }}>
              {pastSubmissions.length === 0 ? (
                <span style={{ color: '#6b7392' }}>
                  No submissions yet - click Submit above to judge your solution against every test case.
                </span>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {pastSubmissions.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => loadSubmission(s)}
                      // Highlight whichever submission's code is currently
                      // loaded into the editor (see loadSubmission below).
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        border: '1px solid',
                        borderColor:
                          selectedSubmissionId === s.id ? 'rgba(167,139,250,.5)' : 'rgba(255,255,255,.08)',
                        background: selectedSubmissionId === s.id ? 'rgba(124,58,237,.1)' : 'none',
                        borderRadius: 10,
                        padding: '10px 14px',
                        fontSize: 12.5,
                        fontFamily: 'inherit',
                        cursor: 'pointer',
                        width: '100%',
                        textAlign: 'left',
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 700,
                          color: s.status === 'PASSED' ? '#34d399' : '#f87171',
                          minWidth: 100,
                        }}
                      >
                        {s.status}
                      </span>
                      <span style={{ color: '#9aa2b8', fontFamily: "'JetBrains Mono',monospace" }}>
                        {s.language}
                      </span>
                      <div style={{ flex: 1 }} />
                      <span style={{ color: '#6b7392' }}>
                        {new Date(s.submittedAt).toLocaleString()}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
              )}

              {leftTab === 'hints' && (
                <div style={{ fontSize: 13.5 }}>
                  {!hintSessionLoaded ? (
                    <span style={{ color: '#6b7392' }}>Loading…</span>
                  ) : (
                    <>
                      {(hintSession?.history.length ?? 0) === 0 && (
                        <span style={{ color: '#6b7392' }}>
                          Stuck? Get a graduated hint below - it starts with a conceptual nudge and only
                          escalates one level at a time, never straight to the answer.
                        </span>
                      )}

                      {/* Past hints for this problem, in the order they were
                          given - each level's response stays visible so the
                          user can scroll back through the escalation instead
                          of only ever seeing the latest one. */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
                        {hintSession?.history.map((h, i) => (
                          <div
                            key={i}
                            style={{
                              border: '1px solid rgba(255,255,255,.08)',
                              borderRadius: 10,
                              padding: '10px 14px',
                              background: h.isSolutionReveal ? 'rgba(248,113,113,.06)' : 'none',
                            }}
                          >
                            <div style={{ fontSize: 11.5, fontWeight: 700, color: h.isSolutionReveal ? '#f87171' : '#a78bfa', marginBottom: 6 }}>
                              {h.isSolutionReveal ? 'FULL SOLUTION' : `LEVEL ${h.level} HINT`}
                            </div>
                            <div className="op-solution-md">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{h.response}</ReactMarkdown>
                            </div>
                          </div>
                        ))}
                      </div>

                      <textarea
                        value={hintStuckDescription}
                        onChange={(e) => setHintStuckDescription(e.target.value)}
                        placeholder="Optional: what are you stuck on? (not required)"
                        style={{
                          width: '100%',
                          minHeight: 60,
                          resize: 'vertical',
                          background: 'rgba(255,255,255,.04)',
                          border: '1px solid rgba(255,255,255,.08)',
                          borderRadius: 8,
                          padding: '10px 12px',
                          color: '#cdd3e0',
                          fontFamily: 'inherit',
                          fontSize: 13,
                          outline: 'none',
                          marginBottom: 10,
                        }}
                      />

                      {hintError && (
                        <div style={{ color: '#f87171', fontSize: 12.5, marginBottom: 10 }}>{hintError}</div>
                      )}

                      <div style={{ display: 'flex', gap: 10 }}>
                        <button
                          onClick={handleGetHint}
                          disabled={hintLoading || (hintSession?.currentLevel ?? 0) >= 3}
                          style={{
                            fontFamily: 'inherit',
                            fontSize: 12.5,
                            fontWeight: 700,
                            padding: '8px 16px',
                            borderRadius: 8,
                            border: '1px solid rgba(167,139,250,.4)',
                            background: 'rgba(124,58,237,.14)',
                            color: '#c4b5fd',
                            cursor: hintLoading ? 'default' : 'pointer',
                            opacity: hintLoading ? 0.6 : 1,
                          }}
                        >
                          {hintLoading
                            ? 'Thinking…'
                            : (hintSession?.currentLevel ?? 0) >= 3
                              ? 'All hints given'
                              : `Get hint (level ${(hintSession?.currentLevel ?? 0) + 1})`}
                        </button>

                        {/* Level 4 - a separate action, never one accidental
                            click of "Get hint" away. First click here only
                            opens the confirmation box below; the actual
                            reveal call happens in handleConfirmReveal. */}
                        {!revealConfirming ? (
                          <button
                            onClick={handleRevealClick}
                            style={{
                              fontFamily: 'inherit',
                              fontSize: 12.5,
                              fontWeight: 700,
                              padding: '8px 16px',
                              borderRadius: 8,
                              border: '1px solid rgba(248,113,113,.35)',
                              background: 'none',
                              color: '#f87171',
                              cursor: 'pointer',
                            }}
                          >
                            Just show me the solution
                          </button>
                        ) : null}
                      </div>

                      {revealConfirming && (
                        <div
                          style={{
                            marginTop: 12,
                            border: '1px solid rgba(248,113,113,.35)',
                            background: 'rgba(248,113,113,.06)',
                            borderRadius: 10,
                            padding: '12px 14px',
                          }}
                        >
                          <div style={{ color: '#f87171', fontSize: 12.5, marginBottom: 10 }}>
                            This skips the hints and shows the full solution, including working code. Are
                            you sure?
                          </div>
                          {revealError && (
                            <div style={{ color: '#f87171', fontSize: 12, marginBottom: 8 }}>{revealError}</div>
                          )}
                          <div style={{ display: 'flex', gap: 10 }}>
                            <button
                              onClick={handleConfirmReveal}
                              disabled={revealLoading}
                              style={{
                                fontFamily: 'inherit',
                                fontSize: 12.5,
                                fontWeight: 700,
                                padding: '7px 14px',
                                borderRadius: 8,
                                border: 'none',
                                background: '#f87171',
                                color: '#1a0a0a',
                                cursor: revealLoading ? 'default' : 'pointer',
                                opacity: revealLoading ? 0.6 : 1,
                              }}
                            >
                              {revealLoading ? 'Loading…' : 'Yes, show the solution'}
                            </button>
                            <button
                              onClick={() => setRevealConfirming(false)}
                              disabled={revealLoading}
                              style={{
                                fontFamily: 'inherit',
                                fontSize: 12.5,
                                fontWeight: 700,
                                padding: '7px 14px',
                                borderRadius: 8,
                                border: '1px solid rgba(255,255,255,.14)',
                                background: 'none',
                                color: '#9aa2b8',
                                cursor: 'pointer',
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {revealedSolution && (
                        <div
                          style={{
                            marginTop: 16,
                            border: '1px solid rgba(248,113,113,.25)',
                            borderRadius: 10,
                            padding: '12px 14px',
                          }}
                        >
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#f87171', marginBottom: 6 }}>
                            FULL SOLUTION
                          </div>
                          <div className="op-solution-md">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{revealedSolution}</ReactMarkdown>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {leftTab === 'explain' && (
                <div style={{ fontSize: 13.5 }}>
                  {!explainResult && !explainLoading && (
                    <div style={{ marginBottom: 14 }}>
                      <span style={{ color: '#6b7392' }}>
                        {latestPassedSubmissionId() !== undefined
                          ? 'Get a step-by-step walkthrough of why your accepted solution works.'
                          : "You haven't passed this problem yet - this will explain the intended approach " +
                            'from scratch instead of walking through your own code.'}
                      </span>
                    </div>
                  )}

                  {explainError && (
                    <div style={{ color: '#f87171', fontSize: 12.5, marginBottom: 10 }}>{explainError}</div>
                  )}

                  {!explainResult && (
                    <button
                      onClick={() => void handleExplain()}
                      disabled={explainLoading}
                      style={{
                        fontFamily: 'inherit',
                        fontSize: 12.5,
                        fontWeight: 700,
                        padding: '8px 16px',
                        borderRadius: 8,
                        border: '1px solid rgba(167,139,250,.4)',
                        background: 'rgba(124,58,237,.14)',
                        color: '#c4b5fd',
                        cursor: explainLoading ? 'default' : 'pointer',
                        opacity: explainLoading ? 0.6 : 1,
                      }}
                    >
                      {explainLoading
                        ? 'Writing walkthrough…'
                        : latestPassedSubmissionId() !== undefined
                          ? 'Explain my solution'
                          : 'Explain the approach'}
                    </button>
                  )}

                  {explainResult && (
                    <div className="op-solution-md">
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#6b7392', marginBottom: 10 }}>
                        {explainResult.mode === 'submission' ? 'WALKTHROUGH OF YOUR SOLUTION' : 'GENERAL APPROACH'}
                        {explainResult.source === 'CACHE' ? ' · cached' : ''}
                      </div>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{explainResult.explanation}</ReactMarkdown>
                    </div>
                  )}
                </div>
              )}
            </div>

        {/* editor + console */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ flex: 1, minHeight: 0 }}>
            {/* The Monaco editor component. Notable props:
                - value={code}: like our earlier controlled <input>, the
                  editor's text is driven by React state.
                - onChange: Monaco calls this with the NEW full text on
                  every keystroke; we push it into state (value ?? '' —
                  Monaco can technically call back with undefined, so we
                  fall back to an empty string).
                - options={{...}}: Monaco-specific settings (font,
                  minimap, etc.), unrelated to React itself. */}
            <Editor
              height="100%"
              language={MONACO_LANGUAGE[language]}
              theme="vs-dark"
              value={code}
              onChange={(value) => setCode(value ?? '')}
              options={{
                fontSize: 14,
                fontFamily: "'JetBrains Mono',monospace",
                minimap: { enabled: false },
                padding: { top: 16 },
                scrollBeyondLastLine: false,
                automaticLayout: true, // re-measure itself when its container resizes
              }}
            />
          </div>

          {/* console panel: a small tabbed area under the editor, similar
              in spirit to LeetCode's testcase/result console. */}
          <div
            style={{
              height: 240,
              flexShrink: 0,
              borderTop: '1px solid rgba(255,255,255,.08)',
              display: 'flex',
              flexDirection: 'column',
              background: '#0a0c16',
            }}
          >
            <div
              style={{
                display: 'flex',
                gap: 20,
                padding: '10px 20px',
                borderBottom: '1px solid rgba(255,255,255,.06)',
              }}
            >
              {/* Two plain <button>s acting as tab switchers — clicking
                  either just updates the `consoleTab` state, and the JSX
                  below reads that state to decide what to show. This
                  "state decides which JSX block renders" pattern is how
                  you build tabs, modals, accordions, etc. in React — there's
                  no special "Tab" component required. */}
              <button
                onClick={() => setConsoleTab('testcase')}
                className="op-tab"
                style={{
                  fontFamily: 'inherit',
                  fontSize: 13,
                  fontWeight: 700,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  color: consoleTab === 'testcase' ? '#eef0f6' : '#6b7392',
                }}
              >
                Testcase
              </button>
              <button
                onClick={() => setConsoleTab('result')}
                className="op-tab"
                style={{
                  fontFamily: 'inherit',
                  fontSize: 13,
                  fontWeight: 700,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  color: consoleTab === 'result' ? '#eef0f6' : '#6b7392',
                }}
              >
                Result
              </button>
              <button
                onClick={() => setConsoleTab('complexity')}
                className="op-tab"
                style={{
                  fontFamily: 'inherit',
                  fontSize: 13,
                  fontWeight: 700,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  color: consoleTab === 'complexity' ? '#eef0f6' : '#6b7392',
                }}
              >
                Complexity
              </button>
              <button
                onClick={() => setConsoleTab('ai-analysis')}
                className="op-tab"
                style={{
                  fontFamily: 'inherit',
                  fontSize: 13,
                  fontWeight: 700,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  color: consoleTab === 'ai-analysis' ? '#eef0f6' : '#6b7392',
                }}
              >
                AI Analysis
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              {/* One of these blocks renders at a time, based on
                  `consoleTab` state — this IS the tab content switching. */}
              {consoleTab === 'testcase' && (
                <div>
                  {problem.examples.length === 0 ? (
                    <span style={{ color: '#6b7392' }}>No examples for this problem.</span>
                  ) : (
                    <>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                    {/* `problem.examples.map((_, i) => ...)` — the `_` is a
                        naming convention meaning "I need the index, but I'm
                        deliberately ignoring this first parameter (the
                        actual example object)". */}
                    {problem.examples.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setActiveExample(i)}
                        style={{
                          fontFamily: "'JetBrains Mono',monospace",
                          fontSize: 12,
                          fontWeight: 600,
                          padding: '6px 12px',
                          borderRadius: 8,
                          border: '1px solid',
                          cursor: 'pointer',
                          borderColor: activeExample === i ? 'rgba(167,139,250,.5)' : 'rgba(255,255,255,.1)',
                          background: activeExample === i ? 'rgba(124,58,237,.15)' : 'transparent',
                          color: activeExample === i ? '#c4b5fd' : '#9aa2b8',
                        }}
                      >
                        Case {i + 1}
                      </button>
                    ))}
                  </div>
                  <div
                    style={{
                      fontFamily: "'JetBrains Mono',monospace",
                      fontSize: 12.5,
                      lineHeight: 1.8,
                      color: '#b3bacb',
                    }}
                  >
                    <div style={{ color: '#6b7392', marginBottom: 4 }}>Input</div>
                    {/* Indexing into the examples array with the
                        `activeExample` state — this is what makes clicking
                        "Case 2" swap the displayed input/output. */}
                    <div style={{ marginBottom: 12 }}>{problem.examples[activeExample].input}</div>
                    <div style={{ color: '#6b7392', marginBottom: 4 }}>Expected Output</div>
                    <div>{problem.examples[activeExample].output}</div>
                  </div>
                    </>
                  )}
                </div>
              )}

              {consoleTab === 'result' && (
                <div style={{ fontSize: 13.5 }}>
                  {/* Mutually-exclusive states rendered based on runStatus
                      (idle/running/done) plus a separate runError branch for
                      network/API failures (a submission that never even made
                      it to a terminal status - distinct from a submission
                      that WAS judged and simply failed). */}
                  {runStatus === 'idle' && (
                    <span style={{ color: '#6b7392' }}>Run your code to see results here.</span>
                  )}
                  {runStatus === 'running' && (
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono',monospace",
                        color: '#9aa2b8',
                      }}
                    >
                      Judging against test cases…
                    </span>
                  )}
                  {runStatus === 'done' && runError && (
                    <span style={{ color: '#f87171' }}>{runError}</span>
                  )}
                  {/* `runStatus === 'done' && result && (...)` — TWO
                      conditions chained with &&. Even though runStatus and
                      result are set together in runCode(), TypeScript
                      doesn't know that, so checking `result` too (not just
                      runStatus) proves to the compiler that `result` isn't
                      null inside this block, letting us safely read
                      result.passed etc. below without an error. */}
                  {runStatus === 'done' && result && (
                    <div>
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 8,
                          fontFamily: "'Space Grotesk',sans-serif",
                          fontWeight: 700,
                          fontSize: 16,
                          color: result.passed ? '#34d399' : '#f87171',
                          marginBottom: 14,
                        }}
                      >
                        {/* result.status is the raw verdict string from
                            whichever worker judged it (see THE WORKER SWITCH) -
                            shown as-is rather than remapped to a fixed set of
                            labels, since the two workers use different
                            vocabularies (PASSED/FAILED vs PASSED/RE/CE/etc). */}
                        {result.status}
                        {result.testCaseResults && (
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#6b7392' }}>
                            {result.testCaseResults.filter((tc) => tc.passed).length}/
                            {result.testCaseResults.length} test cases passed
                          </span>
                        )}
                      </div>

                      {/* Only for a real, judged Submit (includeHidden) that
                          PASSED - a Run that merely passed the visible cases
                          isn't an accepted solution, and pastSubmissions
                          (what latestPassedSubmissionId/the Explain tab read)
                          never includes Runs anyway - see api/submissions.ts. */}
                      {result.passed && lastIncludeHidden && lastSubmissionId !== null && (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            border: '1px solid rgba(124,58,237,.3)',
                            background: 'rgba(124,58,237,.08)',
                            borderRadius: 10,
                            padding: '10px 14px',
                            marginBottom: 16,
                          }}
                        >
                          <span style={{ fontSize: 13, color: '#c4b5fd' }}>
                            Solved! Want to understand why it works?
                          </span>
                          <div style={{ flex: 1 }} />
                          <button
                            onClick={() => {
                              setLeftTab('explain');
                              void handleExplain(lastSubmissionId);
                            }}
                            disabled={explainLoading}
                            style={{
                              fontFamily: 'inherit',
                              fontSize: 12,
                              fontWeight: 700,
                              padding: '6px 14px',
                              borderRadius: 8,
                              border: '1px solid rgba(167,139,250,.4)',
                              background: 'rgba(124,58,237,.14)',
                              color: '#c4b5fd',
                              cursor: explainLoading ? 'default' : 'pointer',
                              opacity: explainLoading ? 0.6 : 1,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {explainLoading ? 'Loading…' : 'Explain this solution'}
                          </button>
                        </div>
                      )}

                      {result.reason && (
                        <div
                          style={{
                            fontFamily: "'JetBrains Mono',monospace",
                            fontSize: 12.5,
                            lineHeight: 1.8,
                            color: '#b3bacb',
                            marginBottom: 16,
                          }}
                        >
                          <div style={{ color: '#6b7392', marginBottom: 4 }}>Reason</div>
                          <div>{result.reason}</div>
                        </div>
                      )}

                      {/* Per-test-case breakdown, when the worker reported
                          one. Falls back to the single flat `output` value
                          for older/incomplete results (e.g. a CE verdict,
                          which never reaches any test case). */}
                      {result.testCaseResults ? (
                        renderTestCaseResults(result.testCaseResults)
                      ) : (
                        <div
                          style={{
                            fontFamily: "'JetBrains Mono',monospace",
                            fontSize: 12.5,
                            lineHeight: 1.8,
                            color: '#b3bacb',
                          }}
                        >
                          <div style={{ color: '#6b7392', marginBottom: 4 }}>Output</div>
                          <div>{result.output ?? '(no output)'}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {consoleTab === 'complexity' && (
                <div style={{ fontSize: 13.5 }}>
                  {/* worker-service-go's OWN empirical estimate (log-log
                      regression of wall-time/memory vs. input size across
                      this submission's test cases) - deterministic, no LLM,
                      always available once judged. Distinct from the
                      separate AI Analysis tab's LLM-derived guess. */}
                  {!result ? (
                    <span style={{ color: '#6b7392' }}>
                      Run or Submit your code to see runtime/complexity here.
                    </span>
                  ) : (
                    <div
                      style={{
                        fontFamily: "'JetBrains Mono',monospace",
                        fontSize: 12.5,
                        lineHeight: 1.8,
                        color: '#b3bacb',
                      }}
                    >
                      <div style={{ color: '#6b7392' }}>Runtime</div>
                      <div style={{ marginBottom: 12 }}>
                        {result.wallTimeMs != null ? `${result.wallTimeMs} ms` : '—'}
                      </div>
                      <div style={{ color: '#6b7392' }}>Memory</div>
                      <div style={{ marginBottom: 12 }}>
                        {result.maxMemoryKb != null && result.maxMemoryKb > 0
                          ? `${(result.maxMemoryKb / 1024).toFixed(1)} MB`
                          : '—'}
                      </div>
                      <div style={{ color: '#6b7392' }}>Time complexity (estimated)</div>
                      <div style={{ marginBottom: 12 }}>{result.estimatedTimeComplexity ?? '—'}</div>
                      <div style={{ color: '#6b7392' }}>Space complexity (estimated)</div>
                      <div>{result.estimatedSpaceComplexity ?? '—'}</div>
                    </div>
                  )}
                </div>
              )}

              {consoleTab === 'ai-analysis' && (
                <div style={{ fontSize: 13.5 }}>
                  {/* AI-analysis-service's LLM-derived verdict - independent
                      of, and slower than, the deterministic Result tab (see
                      aiAnalysis state's comment). Gated on `result` (a judged
                      submission exists) rather than runStatus, since the
                      stream/poll for this only starts once the deterministic
                      result is in. */}
                  {!result ? (
                    <span style={{ color: '#6b7392' }}>
                      Run or Submit your code to see the AI's analysis here.
                    </span>
                  ) : aiStreamPhase === 'streaming' ? (
                    <div>
                      {renderToolCallBadges(aiToolCalls)}
                      <div
                        style={{
                          fontFamily: "'JetBrains Mono',monospace",
                          fontSize: 12,
                          lineHeight: 1.6,
                          color: '#9aa2b8',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          maxHeight: 260,
                          overflowY: 'auto',
                        }}
                      >
                        {aiStreamPreview || 'Generating review…'}
                        <span style={{ opacity: 0.6 }}>▌</span>
                      </div>
                    </div>
                  ) : aiStreamPhase === 'error' ? (
                    <span style={{ color: '#e5717a' }}>{aiStreamError}</span>
                  ) : !aiAnalysis || aiAnalysis.status === 'PENDING' ? (
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono',monospace",
                        color: '#9aa2b8',
                      }}
                    >
                      Still analyzing… (this never blocks the Result tab)
                    </span>
                  ) : (
                    <div>
                      {renderTrustSignals(aiAnalysis)}
                      {aiAnalysis.analysis.analysisType === 'PASSED' ? (
                        <div
                          style={{
                            fontFamily: "'JetBrains Mono',monospace",
                            fontSize: 12.5,
                            lineHeight: 1.8,
                            color: '#b3bacb',
                          }}
                        >
                          <div style={{ color: '#6b7392' }}>Time complexity</div>
                          <div style={{ marginBottom: 12 }}>{aiAnalysis.analysis.timeComplexity}</div>
                          <div style={{ color: '#6b7392' }}>Space complexity</div>
                          <div style={{ marginBottom: 12 }}>{aiAnalysis.analysis.spaceComplexity}</div>
                          <div style={{ color: '#6b7392' }}>Optimization suggestions</div>
                          <div style={{ marginBottom: 12 }}>{aiAnalysis.analysis.optimizationSuggestions}</div>
                          <div style={{ color: '#6b7392' }}>Code smells</div>
                          <div style={{ marginBottom: 12 }}>{aiAnalysis.analysis.codeSmells}</div>
                          <div style={{ color: '#6b7392' }}>Alternative approach</div>
                          <div>{aiAnalysis.analysis.alternativeApproach}</div>
                        </div>
                      ) : (
                        <div
                          style={{
                            fontFamily: "'JetBrains Mono',monospace",
                            fontSize: 12.5,
                            lineHeight: 1.8,
                            color: '#b3bacb',
                          }}
                        >
                          <div style={{ color: '#6b7392' }}>Likely cause</div>
                          <div style={{ marginBottom: 12 }}>{aiAnalysis.analysis.failureReason}</div>
                          <div style={{ color: '#6b7392' }}>Debugging suggestion</div>
                          <div style={{ marginBottom: 12 }}>{aiAnalysis.analysis.debuggingSuggestion}</div>
                          <div style={{ color: '#6b7392' }}>Edge cases to check</div>
                          <div style={{ marginBottom: 12 }}>
                            {aiAnalysis.analysis.edgeCases?.length
                              ? aiAnalysis.analysis.edgeCases.join(', ')
                              : '—'}
                          </div>
                          <div style={{ color: '#6b7392' }}>Hints</div>
                          <div>{aiAnalysis.analysis.hints}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
          </div>
        )}
      </div>
    </div>
  );
}
