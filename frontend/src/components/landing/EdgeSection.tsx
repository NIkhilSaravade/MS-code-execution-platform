// This component renders the "THE EDGE" section with 3 feature cards.
// It demonstrates: typing a list of objects that themselves contain JSX,
// and rendering that list with .map().

// This interface describes one feature card's data. Notice `icon: React.ReactNode`
// — ReactNode is the type for "anything React can render": JSX, a string,
// a number, null, etc. So we can store actual JSX elements (like <svg>...)
// as plain data in an array, which is a handy pattern for icon/label lists.
interface FeatureCard {
  accent: string;
  iconBg: string;
  iconBorder: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}

// This array is built OUTSIDE the component function, at module scope.
// Since none of it depends on props or state, there's no reason to
// rebuild it on every render — it's created once when the module loads.
const features: FeatureCard[] = [
  {
    accent: 'rgba(124,58,237,.08)',
    iconBg: 'rgba(124,58,237,.16)',
    iconBorder: 'rgba(167,139,250,.3)',
    // This is JSX being stored as a plain JS value (a React.ReactNode),
    // not returned from a component. It gets rendered later via {feature.icon}.
    icon: (
      <div
        style={{
          width: 18,
          height: 18,
          background: '#c4b5fd',
          clipPath: 'polygon(50% 0,61% 39%,100% 50%,61% 61%,50% 100%,39% 61%,0 50%,39% 39%)',
        }}
      />
    ),
    title: 'Solve it, or just read it',
    body: 'The AI triages every question against your level — so your hours land where they actually move the needle.',
  },
  {
    accent: 'rgba(99,102,241,.08)',
    iconBg: 'rgba(99,102,241,.16)',
    iconBorder: 'rgba(129,140,248,.3)',
    // Raw inline SVG. React lets you write SVG tags directly in JSX just
    // like HTML tags — under the hood they become real <svg> DOM nodes.
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#a5b4fc"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
    title: 'A mentor on every submit',
    body: 'Complexity, missed edge cases, the optimal diff, and what to fix next — in plain, encouraging language.',
  },
  {
    accent: 'rgba(251,191,36,.07)',
    iconBg: 'rgba(251,191,36,.14)',
    iconBorder: 'rgba(251,191,36,.28)',
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#fbbf24"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4-4" />
      </svg>
    ),
    title: 'Real interview intel',
    body: 'Questions are community-sourced from actual loops — searchable by company and how recently they were asked.',
  },
];

export default function EdgeSection() {
  return (
    <section style={{ position: 'relative', padding: '120px 40px', maxWidth: 1200, margin: '0 auto' }}>
      <div
        style={{
          fontFamily: "'JetBrains Mono',monospace",
          fontSize: 11.5,
          letterSpacing: '.16em',
          color: '#8b7fe0',
          marginBottom: 16,
        }}
      >
        THE&nbsp;EDGE
        {/* &nbsp; is an HTML entity for a non-breaking space — same as in
            plain HTML, JSX passes text content straight through. */}
      </div>
      <h2
        style={{
          fontFamily: "'Space Grotesk',sans-serif",
          fontWeight: 700,
          fontSize: 'clamp(30px,4vw,52px)', // responsive font size: min 30px, scales with viewport, caps at 52px
          lineHeight: 1.05,
          letterSpacing: '-.025em',
          margin: '0 0 14px',
          maxWidth: 720,
        }}
      >
        Preparation that thinks <span style={{ color: '#a78bfa' }}>ahead of you</span>.
        {/* Mixing plain text and a styled <span> inline — JSX handles this
            exactly like HTML would. */}
      </h2>
      <p style={{ fontSize: 18, color: '#9aa2b8', maxWidth: 560, margin: '0 0 56px', lineHeight: 1.6 }}>
        Most platforms hand you a list. Offerpath hands you a plan — and a mentor who's read every
        solution.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 20 }}>
        {/* CSS grid with 3 equal-width columns — this is what lays the
            three cards out side by side. */}
        {features.map((feature) => (
          // .map() turns each `feature` object into one card of JSX.
          // `key={feature.title}` — React requires a unique `key` on list
          // items so it can track additions/removals/reorders efficiently.
          // Titles are unique here, so they're a safe (if slightly unusual)
          // choice; an `id` field would be more typical for real data.
          <div
            key={feature.title}
            style={{
              padding: 30,
              borderRadius: 20,
              background: `linear-gradient(180deg,${feature.accent},rgba(255,255,255,.015))`,
              // Template literal (backticks) lets you interpolate JS
              // values into a string with ${...} — here, feature.accent.
              border: '1px solid rgba(255,255,255,.08)',
            }}
          >
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 13,
                background: feature.iconBg,
                border: `1px solid ${feature.iconBorder}`,
                display: 'grid',
                placeItems: 'center',
                marginBottom: 20,
              }}
            >
              {feature.icon}
              {/* Rendering the stored JSX/ReactNode from our data array. */}
            </div>
            <h3
              style={{
                fontFamily: "'Space Grotesk',sans-serif",
                fontSize: 21,
                fontWeight: 600,
                margin: '0 0 9px',
              }}
            >
              {feature.title}
            </h3>
            <p style={{ fontSize: 14.5, lineHeight: 1.65, color: '#9aa2b8', margin: 0 }}>
              {feature.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
