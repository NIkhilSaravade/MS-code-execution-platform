// This file has NO React/JSX in it at all — it's plain TypeScript data and
// types. It used to also hold a hand-written mock problems array; that's
// gone now (see api/problems.ts) - every problem comes from problem-service
// over HTTP. What's left is just the small set of UI-only constants/types
// that never had a backend equivalent to begin with (language dropdown
// labels, difficulty colors).

// A "union type": Difficulty can ONLY ever be one of these three exact
// strings. If you try to assign difficulty = 'Impossible' anywhere,
// TypeScript will refuse to compile. This is called a "string literal union".
export type Difficulty = 'Easy' | 'Medium' | 'Hard';

// Another string literal union, this time for programming languages.
export type Language = 'javascript' | 'typescript' | 'python' | 'java' | 'cpp' | 'c' | 'go';

// A plain array of objects describing the dropdown options for language
// selection. The type annotation `: { id: Language; label: string }[]`
// is an "inline" object type — same idea as an interface, just not given
// its own name since it's only used here.
// Labels include the version that actually judges a submission - i.e. the
// Go worker's version (worker-service-go is the default ACTIVE_WORKER; the
// legacy Java worker runs older versions for some languages - see
// CLAUDE.md's "Multi-language judging" section). C/C++ show the compiled
// LANGUAGE STANDARD (-std=c++17/-std=c11, pinned explicitly in both
// workers' compile commands), not the compiler version, since that's what
// programmers actually care about and matches how LeetCode itself labels
// these two.
export const LANGUAGES: { id: Language; label: string }[] = [
  { id: 'javascript', label: 'JavaScript (Node 20)' },
  { id: 'typescript', label: 'TypeScript 7.0' },
  { id: 'python', label: 'Python 3.12' },
  { id: 'java', label: 'Java 21' },
  { id: 'cpp', label: 'C++17' },
  { id: 'c', label: 'C11' },
  { id: 'go', label: 'Go 1.22' },
];

// A small color-lookup table keyed by Difficulty. Because of
// `Record<Difficulty, string>`, TypeScript FORCES this object to have
// exactly the keys Easy/Medium/Hard (no more, no less) — add a new
// Difficulty value above and this object won't compile until you add its
// color too. Used by PracticePage and SolvePage to color-code badges.
export const DIFFICULTY_COLOR: Record<Difficulty, string> = {
  Easy: '#34d399',
  Medium: '#fbbf24',
  Hard: '#f87171',
};
