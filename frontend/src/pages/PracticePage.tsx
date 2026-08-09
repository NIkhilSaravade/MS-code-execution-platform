import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AppNavbar from '../components/shared/AppNavbar';
import { DIFFICULTY_COLOR, type Difficulty } from '../data/problems';
import { useAuth } from '../context/AuthContext';
import { getSolvedProblemIds } from '../api/submissions';
import { listProblems, deleteProblem, type ProblemSummary } from '../api/problems';
import { deleteSolution } from '../api/solutions';
// `import { ..., type Difficulty }` — the `type` keyword marks Difficulty
// as a TYPE-ONLY import. It exists purely for TypeScript's compiler and is
// erased completely from the actual JavaScript that ships to the browser
// (unlike `DIFFICULTY_COLOR`, which is a real runtime value).

// This is the FIRST file in the project with real interactive state —
// search text and a selected difficulty filter both live in this
// component and change the page every time the user types or clicks.

// `Array<Difficulty | 'All'>` = an array whose elements are either one of
// the three Difficulty strings, or the extra literal 'All'. Read `Array<T>`
// the same as `T[]` — they're two equivalent ways to write "array of T".
const DIFFICULTIES: Array<Difficulty | 'All'> = ['All', 'Easy', 'Medium', 'Hard'];

export default function PracticePage() {
  // useNavigate() is a hook that gives you a function to change the URL
  // programmatically (as opposed to <Link>, which changes it when clicked).
  // We use it below so clicking a table ROW (not just a link) can navigate.
  const navigate = useNavigate();

  // ---- useState: React's core hook for "this component remembers a
  // value, and re-renders itself whenever that value changes." ----
  // useState('') returns a PAIR: [currentValue, functionToUpdateIt].
  // Calling setSearch(...) does two things: 1) updates the stored value,
  // 2) tells React "re-run this component function to reflect the change."
  const [search, setSearch] = useState('');

  // useState<Difficulty | 'All'>('All') — the <...> here is an explicit
  // type argument. TypeScript could usually infer the type from the
  // default value 'All', but 'All' alone would infer as the type 'All'\
  // literal rather than the broader union we actually want, so we spell it
  // out to allow setDifficulty('Easy') etc. later.
  const [difficulty, setDifficulty] = useState<Difficulty | 'All'>('All');

  const { accessToken, userId, isAdmin } = useAuth();
  const [solvedIds, setSolvedIds] = useState<Set<number>>(new Set());
  const [problems, setProblems] = useState<ProblemSummary[]>([]);

  // Delete uses an inline two-step confirm (click Delete once -> it becomes
  // "Confirm?" for a few seconds -> click again to actually delete) rather
  // than a native window.confirm(), matching this app's convention of never
  // using native browser dialogs. confirmingDeleteId tracks which row (if
  // any) is currently in that "Confirm?" state.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const confirmTimeoutRef = useRef<number | null>(null);

  // AuthContext silently rotates accessToken every ~14 minutes (proactive
  // refresh) and reactively on any 401 - reading through a ref keeps this
  // page from re-fetching (and flashing the list/solved badges) every time
  // that happens, since a token rotation isn't "something changed that
  // matters here." See SolvePage.tsx's identical pattern for the fuller
  // writeup.
  const accessTokenRef = useRef(accessToken);
  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  useEffect(() => {
    const token = accessTokenRef.current;
    if (!token) return;
    listProblems(token)
      .then(setProblems)
      .catch(() => {
        // Best-effort - a failed fetch just leaves the list empty.
      });
  }, []);

  useEffect(() => {
    const token = accessTokenRef.current;
    if (!token || !userId) return;
    getSolvedProblemIds(token, userId)
      .then((ids) => setSolvedIds(new Set(ids)))
      .catch(() => {
        // Best-effort - a failed fetch just means no rows show as solved.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ---- useMemo: "recompute this value only when its dependencies
  // change, otherwise reuse the last result." Here, `filtered` is
  // recalculated only when `search`, `difficulty`, or the fetched
  // `problems` list actually change. ----
  const filtered = useMemo(() => {
    return problems.filter((p) => {
      // .toLowerCase() on both sides makes the search case-insensitive.
      const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase());
      const matchesDifficulty = difficulty === 'All' || p.difficulty === difficulty;
      return matchesSearch && matchesDifficulty;
    });
  }, [problems, search, difficulty]); // the dependency array — recompute only when these change

  function startDeleteConfirm(problemId: number) {
    setDeleteError(null);
    setConfirmingDeleteId(problemId);
    if (confirmTimeoutRef.current) window.clearTimeout(confirmTimeoutRef.current);
    // Auto-cancel the "Confirm?" state after a few seconds so a stray click
    // days later doesn't delete something.
    confirmTimeoutRef.current = window.setTimeout(() => setConfirmingDeleteId(null), 4000);
  }

  function cancelDeleteConfirm() {
    if (confirmTimeoutRef.current) window.clearTimeout(confirmTimeoutRef.current);
    setConfirmingDeleteId(null);
  }

  async function confirmDelete(problemId: number) {
    if (confirmTimeoutRef.current) window.clearTimeout(confirmTimeoutRef.current);
    setConfirmingDeleteId(null);
    if (!accessToken) return;

    try {
      await deleteProblem(accessToken, problemId);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete problem.');
      return;
    }
    try {
      // Best-effort - the problem itself is already gone from the list
      // either way; an orphaned solution row failing to clean up shouldn't
      // block that.
      await deleteSolution(accessToken, problemId);
    } catch {
      // ignore
    }
    setProblems((prev) => prev.filter((p) => p.id !== problemId));
    setSolvedIds((prev) => {
      const next = new Set(prev);
      next.delete(problemId);
      return next;
    });
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#080a14',
        color: '#eef0f6',
        fontFamily: "'Manrope',system-ui,sans-serif",
      }}
    >
      <AppNavbar />

      <main style={{ maxWidth: 1080, margin: '0 auto', padding: '48px 32px 100px' }}>
        <div
          style={{
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 11.5,
            letterSpacing: '.16em',
            color: '#8b7fe0',
            marginBottom: 12,
          }}
        >
          PRACTICE
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 10 }}>
          <h1
            style={{
              fontFamily: "'Space Grotesk',sans-serif",
              fontWeight: 700,
              fontSize: 'clamp(28px,3.6vw,42px)',
              letterSpacing: '-.02em',
              margin: 0,
            }}
          >
            Sharpen your edge.
          </h1>
          <div style={{ flex: 1 }} />
          {/* Admin-only - see AuthContext.isAdmin's comment: this is a UI
              convenience, POST /problems independently re-checks ADMIN
              server-side regardless of whether this button is shown. */}
          {isAdmin && (
            <Link
              to="/practice/new"
              className="op-btn-primary"
              style={{
                flexShrink: 0,
                textDecoration: 'none',
                fontSize: 13.5,
                fontWeight: 700,
                color: '#0a0c16',
                background: '#fff',
                padding: '10px 16px',
                borderRadius: 10,
              }}
            >
              + Add Problem
            </Link>
          )}
        </div>
        <p style={{ fontSize: 16, color: '#9aa2b8', margin: '0 0 36px', maxWidth: 600, lineHeight: 1.6 }}>
          {problems.length} questions sourced from real interview loops. Pick one and jump straight into the
          editor.
        </p>

        <div style={{ display: 'flex', gap: 12, marginBottom: 22, flexWrap: 'wrap' }}>
          {/* A "CONTROLLED INPUT" — the input's displayed text is driven
              entirely by React state (`value={search}`), not by the
              browser's own internal input state. `onChange` fires on every
              keystroke; `e.target.value` is the new text; we push it into
              state with setSearch, which re-renders with the new value.
              This round-trip (state -> value -> onChange -> state) is the
              standard React pattern for form inputs. */}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search problems..."
            style={{
              flex: '1 1 240px',
              padding: '11px 16px',
              borderRadius: 11,
              border: '1px solid rgba(255,255,255,.12)',
              background: 'rgba(255,255,255,.04)',
              color: '#eef0f6',
              fontSize: 14,
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            {DIFFICULTIES.map((d) => (
              <button
                key={d}
                // `onClick={() => setDifficulty(d)}` — note the arrow
                // function wrapper. We can't write `onClick={setDifficulty(d)}`
                // because that would CALL setDifficulty immediately during
                // render instead of waiting for a click; wrapping it in
                // `() => ...` defers the call until the click actually happens.
                onClick={() => setDifficulty(d)}
                style={{
                  fontFamily: 'inherit',
                  fontSize: 13.5,
                  fontWeight: 600,
                  padding: '10px 16px',
                  borderRadius: 10,
                  border: '1px solid',
                  cursor: 'pointer',
                  // Styling based on whether THIS button is the active
                  // filter — comparing the loop variable `d` to the
                  // current `difficulty` state value.
                  borderColor: difficulty === d ? 'rgba(167,139,250,.5)' : 'rgba(255,255,255,.12)',
                  background: difficulty === d ? 'rgba(124,58,237,.18)' : 'rgba(255,255,255,.03)',
                  color: difficulty === d ? '#c4b5fd' : '#9aa2b8',
                }}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <div
          style={{
            borderRadius: 16,
            border: '1px solid rgba(255,255,255,.08)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'grid',
              // fixed-width columns, one flexible (1fr) title column - the
              // last column widens for admins to fit Edit/Delete alongside
              // Solve.
              gridTemplateColumns: isAdmin ? '56px 1fr 110px 220px 220px' : '56px 1fr 110px 220px 90px',
              padding: '12px 20px',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '.04em',
              color: '#6b7392',
              textTransform: 'uppercase',
              borderBottom: '1px solid rgba(255,255,255,.06)',
            }}
          >
            <span>#</span>
            <span>Title</span>
            <span>Difficulty</span>
            <span>Tags</span>
            <span>Status</span>
          </div>

          {deleteError && (
            <div
              style={{
                padding: '12px 20px',
                fontSize: 13,
                color: '#fca5a5',
                background: 'rgba(248,113,113,.08)',
                borderBottom: '1px solid rgba(255,255,255,.06)',
              }}
            >
              {deleteError}
            </div>
          )}

          {/* Rendering the FILTERED, DERIVED list (not the raw `problems`
              state) — this is what makes typing in the search box or
              clicking a difficulty pill instantly update the table. */}
          {filtered.map((p, i) => (
            // The second .map() argument (`i`) is the index in the array.
            // Used below only to decide whether to draw a bottom border
            // (skip it on the very last row).
            <div
              key={p.id}
              // Only the Solve button (below) navigates to the editor now -
              // the row itself is inert, so clicking the title/tags/etc.
              // does nothing.
              className="op-problem-row"
              style={{
                display: 'grid',
                gridTemplateColumns: isAdmin ? '56px 1fr 110px 220px 220px' : '56px 1fr 110px 220px 90px',
                alignItems: 'center',
                padding: '16px 20px',
                borderBottom:
                  i === filtered.length - 1 ? 'none' : '1px solid rgba(255,255,255,.05)',
                fontSize: 14.5,
              }}
            >
              <span style={{ color: '#6b7392' }}>{p.id}</span>
              <span style={{ fontWeight: 600, color: '#eef0f6' }}>{p.name}</span>
              <span
                style={{
                  color: DIFFICULTY_COLOR[p.difficulty as Difficulty] ?? '#9aa2b8',
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                {/* Looking up a color by key from the DIFFICULTY_COLOR
                    Record we defined in data/problems.ts - `as Difficulty`
                    plus a fallback color since the backend's difficulty is
                    just a plain string, not the same literal-union type. */}
                {p.difficulty}
              </span>
              <span style={{ color: '#8b93a8', fontSize: 12.5 }}>{p.tags.join(', ')}</span>
              {/* .join(', ') turns ['Array','Hash Table'] into the string "Array, Hash Table" */}
              {(() => {
                const solved = solvedIds.has(p.id);
                const confirming = confirmingDeleteId === p.id;
                return (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifySelf: 'start' }}>
                    <button
                      onClick={() => navigate(`/practice/${p.id}`)}
                      className="op-solve-btn"
                      style={{
                        fontFamily: 'inherit',
                        fontSize: 12,
                        fontWeight: 700,
                        padding: '7px 14px',
                        borderRadius: 8,
                        border: '1px solid',
                        cursor: 'pointer',
                        borderColor: solved ? 'rgba(52,211,153,.4)' : 'rgba(167,139,250,.4)',
                        background: solved ? 'rgba(52,211,153,.12)' : 'rgba(124,58,237,.14)',
                        color: solved ? '#34d399' : '#c4b5fd',
                      }}
                    >
                      {solved ? '✓ Solved' : 'Solve'}
                    </button>
                    {/* Admin-only - POST/PUT/DELETE /problems independently
                        re-check ADMIN server-side regardless of whether
                        these buttons are shown, same convention as the
                        "+ Add Problem" button above. */}
                    {isAdmin && !confirming && (
                      <>
                        <button
                          onClick={() => navigate(`/practice/${p.id}/edit`)}
                          style={{
                            fontFamily: 'inherit',
                            fontSize: 12,
                            fontWeight: 700,
                            padding: '7px 12px',
                            borderRadius: 8,
                            border: '1px solid rgba(255,255,255,.14)',
                            background: 'rgba(255,255,255,.04)',
                            color: '#cdd3e0',
                            cursor: 'pointer',
                          }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => startDeleteConfirm(p.id)}
                          style={{
                            fontFamily: 'inherit',
                            fontSize: 12,
                            fontWeight: 700,
                            padding: '7px 12px',
                            borderRadius: 8,
                            border: '1px solid rgba(248,113,113,.3)',
                            background: 'rgba(248,113,113,.08)',
                            color: '#fca5a5',
                            cursor: 'pointer',
                          }}
                        >
                          Delete
                        </button>
                      </>
                    )}
                    {isAdmin && confirming && (
                      <>
                        <button
                          onClick={() => confirmDelete(p.id)}
                          style={{
                            fontFamily: 'inherit',
                            fontSize: 12,
                            fontWeight: 700,
                            padding: '7px 12px',
                            borderRadius: 8,
                            border: '1px solid rgba(248,113,113,.5)',
                            background: 'rgba(248,113,113,.22)',
                            color: '#fca5a5',
                            cursor: 'pointer',
                          }}
                        >
                          Confirm?
                        </button>
                        <button
                          onClick={cancelDeleteConfirm}
                          style={{
                            fontFamily: 'inherit',
                            fontSize: 12,
                            fontWeight: 600,
                            padding: '7px 10px',
                            borderRadius: 8,
                            border: '1px solid rgba(255,255,255,.12)',
                            background: 'transparent',
                            color: '#9aa2b8',
                            cursor: 'pointer',
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                );
              })()}
            </div>
          ))}

          {/* `{condition && <jsx/>}` is the standard React way to
              conditionally render something: if `filtered.length === 0`
              is false, `false && ...` evaluates to `false`, and React
              simply renders nothing for a `false`/null/undefined child. */}
          {filtered.length === 0 && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#6b7392', fontSize: 14 }}>
              No problems match your filters.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
