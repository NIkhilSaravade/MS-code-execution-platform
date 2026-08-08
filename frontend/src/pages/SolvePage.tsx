import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import Editor from '@monaco-editor/react';
// @monaco-editor/react wraps the Monaco Editor (the actual code-editing
// engine behind VS Code) as a React component. We just drop <Editor .../>
// into our JSX and pass it props — same idea as any component we wrote
// ourselves, just from a third-party package.
import Logo from '../components/landing/Logo';
import { DIFFICULTY_COLOR, LANGUAGES, getProblemBySlug, type Language } from '../data/problems';
import { useAuth } from '../context/AuthContext';
import { createSubmission, pollSubmissionResult, type TestCaseResult } from '../api/submissions';
// This is the busiest page in the app: it reads the URL, looks up a
// problem, manages several pieces of state (selected language, the code
// being typed, which test case is shown, run status), and — for problems
// with a real backendProblemId — actually submits code to submission-service
// and polls for a real judged verdict. Read the useState calls first to
// understand what this component is "remembering" before diving into the JSX.

// Monaco's `language` prop expects specific strings; ours happen to match
// our own Language ids exactly, but we keep this mapping explicit so it's
// obvious where the two systems connect (and easy to fix if they diverge).
const MONACO_LANGUAGE: Record<Language, string> = {
  javascript: 'javascript',
  python: 'python',
  java: 'java',
  cpp: 'cpp',
};

// A string literal union describing the three states our "Run" flow can be
// in. Using a type instead of loose strings/booleans means TypeScript will
// flag typos like 'runing' immediately.
type RunStatus = 'idle' | 'running' | 'done';

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
}

export default function SolvePage() {
  // useParams() reads the dynamic parts of the CURRENT URL, based on the
  // `:slug` placeholder we declared in App.tsx's <Route path="/practice/:slug">.
  // Visiting /practice/two-sum makes `slug` equal to "two-sum" here.
  // The `<{ slug: string }>` type argument tells TypeScript what shape to
  // expect back (react-router can't know your route params at compile time).
  const { slug } = useParams<{ slug: string }>();

  // Look the problem up from our mock data. `slug ? ... : undefined` is a
  // ternary guard: useParams technically allows slug to be undefined (if
  // this component were ever rendered outside a matching route), so we
  // only call getProblemBySlug when we actually have a string.
  const problem = slug ? getProblemBySlug(slug) : undefined;

  // ---- All the component's STATE, declared up front. Each useState call
  // is independent — React doesn't require you to bundle related state
  // into one object; several small useStates is completely normal. ----

  const [language, setLanguage] = useState<Language>('javascript');

  // The initial value here reads `problem.starterCode[language]` — but
  // only ONCE, on the component's first render. useState's argument is
  // only used for the FIRST render; after that, only setCode(...) calls
  // change this value (see handleLanguageChange below, which updates both
  // language and code together when the user switches languages).
  const [code, setCode] = useState(problem ? problem.starterCode[language] : '');

  const [activeExample, setActiveExample] = useState(0); // which "Case N" tab is selected
  const [consoleTab, setConsoleTab] = useState<'testcase' | 'result'>('testcase');
  const [runStatus, setRunStatus] = useState<RunStatus>('idle');
  const [result, setResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  // `RunResult | null` — this state starts as null (no result yet) and
  // becomes a real RunResult object once submission-service reports a
  // terminal verdict (see api/submissions.ts's pollSubmissionResult).

  const { accessToken, userId } = useAuth();

  // EARLY RETURN based on data, before the "main" render. If the slug in
  // the URL doesn't match any mock problem, `problem` is undefined, and
  // instead of rendering a broken page we render <Navigate>, a
  // react-router component that immediately redirects the browser
  // elsewhere. `replace` means it replaces the current history entry
  // rather than adding a new one (so the back button doesn't bounce back
  // to the broken URL).
  if (!problem) {
    return <Navigate to="/practice" replace />;
  }

  // A plain event-handler function defined INSIDE the component (so it
  // can close over `problem`, `setLanguage`, `setCode`). Not a hook —
  // just a regular function called from the <select>'s onChange below.
  function handleLanguageChange(next: Language) {
    setLanguage(next);
    // `problem!` — the `!` is TypeScript's "non-null assertion": we know
    // `problem` can't be null/undefined here (we already returned early
    // above if it was), but TypeScript can't always follow that logic
    // inside a nested function, so `!` tells the compiler to trust us.
    setCode(problem!.starterCode[next]);
  }

  // Calls the real backend judge: POST /submissions, then poll
  // GET /submissions/{id} until it reaches a terminal status. Both "Run"
  // and "Submit" call this the same way - submission-service's API doesn't
  // currently distinguish "check against the visible example only" from
  // "judge against everything", so both send the same real request and
  // judge against every test case (hidden ones included).
  //
  // Only works for problems with a real backendProblemId (see
  // data/problems.ts) - the button is disabled otherwise (see the JSX below).
  async function runCode() {
    if (!problem!.backendProblemId || !accessToken || !userId) return;

    setConsoleTab('result'); // auto-switch to the Result tab so the user sees feedback
    setRunStatus('running');
    setResult(null);
    setRunError(null);

    try {
      const { submissionId } = await createSubmission(
        accessToken,
        userId,
        problem!.backendProblemId,
        code,
        language,
      );
      const final = await pollSubmissionResult(accessToken, submissionId);
      setResult({
        status: final.status,
        passed: final.status === 'PASSED',
        output: final.output,
        reason: final.reason,
        testCaseResults: final.testCaseResults,
      });
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Failed to judge submission.');
    } finally {
      setRunStatus('done');
    }
  }

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
        <span style={{ fontSize: 14, fontWeight: 700, color: '#eef0f6' }}>{problem.title}</span>
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
          onClick={() => runCode()}
          // real HTML disabled attribute — browser blocks clicks while true.
          // Also disabled for problems with no backendProblemId (see
          // data/problems.ts) - there's no real test data to judge against.
          disabled={runStatus === 'running' || !problem.backendProblemId}
          title={!problem.backendProblemId ? 'This problem is browsing-only — not wired to the real judge yet.' : undefined}
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
            cursor: runStatus === 'running' || !problem.backendProblemId ? 'default' : 'pointer',
            opacity: runStatus === 'running' || !problem.backendProblemId ? 0.6 : 1,
          }}
        >
          Run
        </button>
        <button
          onClick={() => runCode()}
          disabled={runStatus === 'running' || !problem.backendProblemId}
          title={!problem.backendProblemId ? 'This problem is browsing-only — not wired to the real judge yet.' : undefined}
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
            cursor: runStatus === 'running' || !problem.backendProblemId ? 'default' : 'pointer',
            opacity: runStatus === 'running' || !problem.backendProblemId ? 0.6 : 1,
            boxShadow: '0 4px 20px rgba(124,58,237,.4)',
          }}
        >
          Submit
        </button>
      </header>

      {/* body: two side-by-side panels — description on the left, editor+console on the right */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* `minHeight: 0` here (and below) is a common flexbox fix: without
            it, flex children default to a min-height based on their
            content, which can prevent inner `overflow: auto` scrolling
            from working. */}

        {/* description panel */}
        <div
          style={{
            width: '42%',
            minWidth: 340,
            borderRight: '1px solid rgba(255,255,255,.08)',
            overflowY: 'auto', // scrolls independently from the editor side
            padding: '24px 28px 60px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <h1
              style={{
                fontFamily: "'Space Grotesk',sans-serif",
                fontWeight: 700,
                fontSize: 22,
                margin: 0,
              }}
            >
              {problem.id}. {problem.title}
            </h1>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 22, flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: DIFFICULTY_COLOR[problem.difficulty],
                // Template literal appending a hex alpha suffix ("1a" ≈ 10%
                // opacity) to the difficulty color, e.g. "#34d3991a" — a
                // quick way to derive a translucent background from a
                // solid color string without a separate color library.
                background: `${DIFFICULTY_COLOR[problem.difficulty]}1a`,
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
            {problem.constraints.map((c, i) => (
              <li key={i} style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5 }}>
                {c}
              </li>
            ))}
          </ul>
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
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              {/* Only one of these two blocks renders at a time, based on
                  `consoleTab` state — this IS the tab content switching. */}
              {consoleTab === 'testcase' && (
                <div>
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
                </div>
              )}

              {consoleTab === 'result' && (
                <div style={{ fontSize: 13.5 }}>
                  {/* Mutually-exclusive states rendered based on runStatus
                      (idle/running/done) plus a separate runError branch for
                      network/API failures (a submission that never even made
                      it to a terminal status - distinct from a submission
                      that WAS judged and simply failed). */}
                  {!problem.backendProblemId && (
                    <span style={{ color: '#6b7392' }}>
                      This problem is browsing-only — it isn&apos;t wired to the real judge yet.
                    </span>
                  )}
                  {problem.backendProblemId && runStatus === 'idle' && (
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
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          {result.testCaseResults.map((tc) => (
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
                                {tc.hidden && (
                                  <span style={{ color: '#6b7392', fontWeight: 500 }}>(hidden)</span>
                                )}
                                <div style={{ flex: 1 }} />
                                <span style={{ color: tc.passed ? '#34d399' : '#f87171' }}>
                                  {tc.passed ? 'Passed' : 'Failed'}
                                </span>
                              </div>
                              {/* Hidden test cases only ever reveal pass/fail -
                                  see api/submissions.ts's TestCaseResult comment. */}
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
