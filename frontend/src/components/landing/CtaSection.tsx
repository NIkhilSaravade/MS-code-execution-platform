import { Link } from 'react-router-dom';
// This is a purely static/presentational component — no props, no state,
// no hooks. It's a good example of how much of a real UI is just "return
// some styled JSX," with nothing dynamic going on.

export default function CtaSection() {
  return (
    <section style={{ position: 'relative', padding: '0 40px 110px' }}>
      <div
        style={{
          position: 'relative',
          overflow: 'hidden', // clips the glow div below to this rounded box
          maxWidth: 1000,
          margin: '0 auto', // centers a block element horizontally
          borderRadius: 28,
          padding: '72px 48px',
          textAlign: 'center',
          background: 'linear-gradient(135deg,rgba(124,58,237,.22),rgba(99,102,241,.12))',
          border: '1px solid rgba(167,139,250,.25)',
        }}
      >
        {/* A purely decorative glow blob. `position: absolute` + a
            transform is a common CSS trick to center something regardless
            of its own size. `pointerEvents: 'none'` means clicks pass
            through it to whatever's underneath. */}
        <div
          style={{
            position: 'absolute',
            top: '-40%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 600,
            height: 400,
            background: 'radial-gradient(circle,rgba(167,139,250,.3),transparent 60%)',
            filter: 'blur(50px)',
            pointerEvents: 'none',
          }}
        />
        <h2
          style={{
            position: 'relative', // needed so this sits ABOVE the glow div (stacking context)
            fontFamily: "'Space Grotesk',sans-serif",
            fontWeight: 700,
            fontSize: 'clamp(30px,4.4vw,54px)',
            lineHeight: 1.05,
            letterSpacing: '-.025em',
            margin: '0 0 16px',
          }}
        >
          Your next offer starts
          <br />
          {/* <br /> is a self-closing tag — in JSX (unlike HTML) EVERY tag
              must be closed, either with a matching </tag> or a trailing /> */}
          with one problem.
        </h2>
        <p style={{ position: 'relative', fontSize: 18, color: '#c2c8d8', margin: '0 0 32px' }}>
          Free to start. No card. Your AI coach is waiting.
        </p>
        <Link
          to="/practice"
          // Clicking this <Link> changes the URL to /practice, which
          // App.tsx's <Routes> then matches to render <PracticePage />.
          className="op-cta-btn"
          style={{
            position: 'relative',
            textDecoration: 'none',
            display: 'inline-flex', // like flex, but doesn't force full-width
            alignItems: 'center',
            gap: 10,
            fontSize: 16,
            fontWeight: 700,
            color: '#0a0c16',
            background: '#fff',
            padding: '16px 30px',
            borderRadius: 14,
            boxShadow: '0 10px 50px rgba(255,255,255,.2)',
            cursor: 'pointer',
          }}
        >
          Start practicing — free
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor" // "currentColor" makes the SVG stroke match the text color above
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
            {/* This path draws a simple right-pointing arrow using SVG
                path commands (M = move to, l = line to, etc.) */}
          </svg>
        </Link>
      </div>
    </section>
  );
}
