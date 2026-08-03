import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppNavbar from '../components/shared/AppNavbar';
import { DIFFICULTY_COLOR, problems, type Difficulty } from '../data/problems';
// `import { ..., type Difficulty }` — the `type` keyword marks Difficulty
// as a TYPE-ONLY import. It exists purely for TypeScript's compiler and is
// erased completely from the actual JavaScript that ships to the browser
// (unlike `problems` and `DIFFICULTY_COLOR`, which are real runtime values).

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

  // ---- useMemo: "recompute this value only when its dependencies
  // change, otherwise reuse the last result." Here, `filtered` is
  // recalculated only when `search` or `difficulty` actually change —
  // not on every unrelated re-render. For a list this small it's not
  // strictly necessary for performance, but it's the idiomatic pattern
  // for "derived data computed from state + props." ----
  const filtered = useMemo(() => {
    return problems.filter((p) => {
      // .toLowerCase() on both sides makes the search case-insensitive.
      const matchesSearch = p.title.toLowerCase().includes(search.toLowerCase());
      const matchesDifficulty = difficulty === 'All' || p.difficulty === difficulty;
      return matchesSearch && matchesDifficulty;
    });
  }, [search, difficulty]); // the dependency array — recompute only when these change

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
        <h1
          style={{
            fontFamily: "'Space Grotesk',sans-serif",
            fontWeight: 700,
            fontSize: 'clamp(28px,3.6vw,42px)',
            letterSpacing: '-.02em',
            margin: '0 0 10px',
          }}
        >
          Sharpen your edge.
        </h1>
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
              gridTemplateColumns: '56px 1fr 110px 200px 90px', // fixed-width columns, one flexible (1fr) title column
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
            <span>Acceptance</span>
          </div>

          {/* Rendering the FILTERED, DERIVED list (not the raw `problems`
              import) — this is what makes typing in the search box or
              clicking a difficulty pill instantly update the table. */}
          {filtered.map((p, i) => (
            // The second .map() argument (`i`) is the index in the array.
            // Used below only to decide whether to draw a bottom border
            // (skip it on the very last row).
            <div
              key={p.slug}
              onClick={() => navigate(`/practice/${p.slug}`)}
              // Clicking anywhere on the row programmatically navigates to
              // this problem's Solve page. Template literal builds the URL,
              // e.g. "/practice/two-sum".
              className="op-problem-row"
              style={{
                display: 'grid',
                gridTemplateColumns: '56px 1fr 110px 200px 90px',
                alignItems: 'center',
                padding: '16px 20px',
                cursor: 'pointer',
                borderBottom:
                  i === filtered.length - 1 ? 'none' : '1px solid rgba(255,255,255,.05)',
                fontSize: 14.5,
              }}
            >
              <span style={{ color: '#6b7392' }}>{p.id}</span>
              <span style={{ fontWeight: 600, color: '#eef0f6' }}>{p.title}</span>
              <span style={{ color: DIFFICULTY_COLOR[p.difficulty], fontWeight: 600, fontSize: 13 }}>
                {/* Looking up a color by key from the DIFFICULTY_COLOR
                    Record we defined in data/problems.ts. */}
                {p.difficulty}
              </span>
              <span style={{ color: '#8b93a8', fontSize: 12.5 }}>{p.tags.join(', ')}</span>
              {/* .join(', ') turns ['Array','Hash Table'] into the string "Array, Hash Table" */}
              <span style={{ color: '#8b93a8', fontSize: 13 }}>{p.acceptance.toFixed(1)}%</span>
              {/* .toFixed(1) formats a number to 1 decimal place, e.g. 54.2 */}
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
