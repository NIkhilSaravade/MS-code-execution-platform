import { Link } from 'react-router-dom';
import ParticleNetwork from './ParticleNetwork';
import Logo from './Logo';
// This is the big full-screen intro section at the top of the landing
// page: animated particle background + nav bar + headline + CTA buttons.
// It's long, but structurally it's just deeply nested <div>s — read it
// section by section (nav / headline / bottom bar), not top to bottom.

export default function Hero() {
  return (
    <section style={{ position: 'relative', height: '100vh', minHeight: 680, overflow: 'hidden' }}>
      {/* `height: '100vh'` = 100% of the browser viewport height, so this
          section always fills the first screen the user sees. */}

      <ParticleNetwork nodeCount={140} autoRotate />
      {/* Rendering a custom component and passing it two props:
          nodeCount={140} (a number) and `autoRotate` (shorthand for
          autoRotate={true} — writing a prop name with no value defaults it
          to true). See ParticleNetwork.tsx for what these control. */}

      {/* cinematic vignette + grading — two purely decorative overlay divs
          that darken the edges of the particle canvas for a "cinematic"
          look. `inset: 0` is shorthand for top/right/bottom/left all 0,
          i.e. "stretch to fill the parent". */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none', // clicks pass through to whatever's beneath
          background:
            'radial-gradient(120% 90% at 70% 35%,transparent 30%,rgba(8,10,20,.55) 70%,rgba(6,7,15,.92) 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'linear-gradient(180deg,rgba(8,10,20,.7) 0%,transparent 22%,transparent 60%,rgba(6,7,15,.85) 100%)',
        }}
      />

      {/* nav — the header bar overlaid on top of the particle background */}
      <header
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 28,
          padding: '26px 40px',
          // `animation: 'fadeIn 1s ease both'` references a @keyframes
          // block named "fadeIn" defined in src/index.css. This is plain
          // CSS animation syntax — React doesn't need to know about it.
          animation: 'fadeIn 1s ease both',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <Logo />
          {/* No props passed — Logo.tsx's defaults (size=30, boxSize=14) apply. */}
          <span
            style={{
              fontFamily: "'Space Grotesk',sans-serif",
              fontWeight: 700,
              fontSize: 19,
              letterSpacing: '-.01em',
            }}
          >
            Offerpath
          </span>
        </div>
        <nav style={{ display: 'flex', gap: 26, marginLeft: 14 }}>
          {/* Same "array of link objects -> .map() -> <Link>" pattern as
              Footer.tsx and AppNavbar.tsx. Defined inline here (instead of
              a shared constant) since this nav only appears once. */}
          {[
            { label: 'Practice', href: '/practice' },
            { label: 'Companies', href: '#' },
            { label: 'AI Mentor', href: '#' },
            { label: 'Community', href: '#' },
          ].map((link) => (
            <Link
              key={link.label}
              to={link.href}
              className="op-nav-link"
              style={{ fontSize: 14, cursor: 'pointer', fontWeight: 500, textDecoration: 'none' }}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 14, color: '#cdd3e0', cursor: 'pointer', fontWeight: 600 }}>
          Sign in
        </span>
        <Link
          to="/practice"
          className="op-btn-primary"
          style={{
            textDecoration: 'none',
            fontSize: 14,
            fontWeight: 700,
            color: '#0a0c16',
            background: '#fff',
            padding: '10px 18px',
            borderRadius: 10,
            cursor: 'pointer',
          }}
        >
          Start free
        </Link>
      </header>

      {/* headline — the big centered "Find your path to the offer." text */}
      <div
        style={{
          position: 'absolute',
          zIndex: 9,
          left: 0,
          right: 0,
          top: '50%',
          transform: 'translateY(-50%)', // classic CSS trick to vertically center absolutely-positioned content
          padding: '0 40px',
          pointerEvents: 'none',
        }}
      >
        <div style={{ maxWidth: 780, pointerEvents: 'auto' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 9,
              padding: '7px 14px',
              borderRadius: 999, // a very large radius = fully rounded "pill" shape
              background: 'rgba(167,139,250,.1)',
              border: '1px solid rgba(167,139,250,.32)',
              backdropFilter: 'blur(8px)',
              marginBottom: 26,
              // Animation with a DELAY: 'name duration timing-function delay fill-mode'
              // shorthand order can vary; here it's `.8s cubic-bezier(...) both`
              // — `both` keeps the animation's start/end styles applied
              // before/after it plays, avoiding a flash of unstyled content.
              animation: 'riseIn .8s cubic-bezier(.2,.7,.2,1) both',
            }}
          >
            <div
              style={{
                width: 13,
                height: 13,
                background: '#c4b5fd',
                clipPath:
                  'polygon(50% 0,61% 39%,100% 50%,61% 61%,50% 100%,39% 61%,0 50%,39% 39%)',
              }}
            />
            <span
              style={{
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 11.5,
                fontWeight: 600,
                letterSpacing: '.14em',
                color: '#d6caff',
              }}
            >
              AI&nbsp;INTERVIEW&nbsp;COACH
            </span>
          </div>
          <h1
            style={{
              fontFamily: "'Space Grotesk',sans-serif",
              fontWeight: 700,
              fontSize: 'clamp(42px,6.6vw,92px)',
              lineHeight: 1.01,
              letterSpacing: '-.03em',
              margin: '0 0 24px',
            }}
          >
            {/* Each line has its OWN animation with a slightly increasing
                delay (.05s, .16s, .28s, .4s below) — this is what creates
                the staggered "rising in one after another" effect. */}
            <span style={{ display: 'block', animation: 'riseIn .9s .05s cubic-bezier(.2,.7,.2,1) both' }}>
              Find your path
            </span>
            <span
              style={{
                display: 'block',
                background: 'linear-gradient(100deg,#a78bfa 0%,#818cf8 35%,#fbbf24 100%)',
                // These three properties together clip the gradient
                // background to the shape of the TEXT itself, making the
                // text appear filled with a gradient instead of a flat color.
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundSize: '200% auto',
                // Two animations at once, comma-separated: one for the
                // rise-in effect, one that continuously shifts the
                // gradient position ("shimmer") forever (`infinite`).
                animation:
                  'riseIn .9s .16s cubic-bezier(.2,.7,.2,1) both, shimmer 6s linear infinite',
              }}
            >
              to the offer.
            </span>
          </h1>
          <p
            style={{
              fontSize: 'clamp(16px,1.5vw,19px)',
              lineHeight: 1.6,
              color: '#b3bacb',
              maxWidth: 560,
              margin: '0 0 36px',
              animation: 'riseIn .9s .28s cubic-bezier(.2,.7,.2,1) both',
            }}
          >
            {/* `{' '}` is a common JSX trick: JSX collapses whitespace
                around line breaks, so writing an explicit space-in-braces
                forces a real space to appear between "to " and the <span>. */}
            Real questions sourced from real interviews. An AI mentor that maps exactly what to{' '}
            <span style={{ color: '#e8eaf2', fontWeight: 600 }}>solve</span>, what to just{' '}
            <span style={{ color: '#e8eaf2', fontWeight: 600 }}>read</span>, and why — then
            dissects every submission line by line.
          </p>
          <div
            style={{
              display: 'flex',
              gap: 14,
              alignItems: 'center',
              flexWrap: 'wrap',
              animation: 'riseIn .9s .4s cubic-bezier(.2,.7,.2,1) both',
            }}
          >
            <Link
              to="/practice"
              className="op-btn-primary"
              style={{
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 9,
                fontSize: 15.5,
                fontWeight: 700,
                color: '#fff',
                background: 'linear-gradient(135deg,#7c3aed,#6366f1)',
                padding: '15px 26px',
                borderRadius: 13,
                boxShadow: '0 8px 40px rgba(124,58,237,.5)',
                cursor: 'pointer',
              }}
            >
              Start practicing — free
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </Link>
            {/* This second button is a plain <button>, not a <Link> —
                because "Watch the 60-sec tour" doesn't navigate anywhere
                yet, it's just decorative/unimplemented for now. */}
            <button
              className="op-btn-secondary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                fontFamily: 'inherit', // buttons don't inherit fonts by default in browsers — this opts back in
                fontSize: 15.5,
                fontWeight: 600,
                color: '#e8eaf2',
                background: 'rgba(255,255,255,.05)',
                border: '1px solid rgba(255,255,255,.16)',
                padding: '15px 22px',
                borderRadius: 13,
                cursor: 'pointer',
                backdropFilter: 'blur(8px)',
              }}
            >
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,.12)',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                  {/* A filled triangle path = a "play" icon */}
                </svg>
              </span>
              Watch the 60-sec tour
            </button>
          </div>
        </div>
      </div>

      {/* bottom sourcing line + scroll cue */}
      <div
        style={{
          position: 'absolute',
          bottom: 30,
          left: 40,
          right: 40,
          zIndex: 9,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between', // pushes the two children to opposite edges
          animation: 'fadeIn 1.2s .6s both',
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: 11,
              letterSpacing: '.12em',
              color: '#6b7392',
              marginBottom: 9,
            }}
          >
            SOURCED FROM INTERVIEWS AT
          </div>
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
            {/* Simplest possible .map() example: an array of plain
                strings, each turned into a <span>. The string itself
                doubles as the `key` since company names are unique here. */}
            {['Google', 'Amazon', 'Meta', 'Stripe', 'Netflix'].map((company) => (
              <span
                key={company}
                style={{
                  fontFamily: "'Space Grotesk',sans-serif",
                  fontWeight: 600,
                  fontSize: 15,
                  color: '#9aa2b8',
                }}
              >
                {company}
              </span>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: 10.5,
              letterSpacing: '.14em',
              color: '#6b7392',
            }}
          >
            SCROLL
          </span>
          <div
            style={{
              width: 22,
              height: 36,
              borderRadius: 12,
              border: '1.5px solid rgba(255,255,255,.22)',
              display: 'flex',
              justifyContent: 'center',
              paddingTop: 7,
            }}
          >
            <div
              style={{
                width: 3.5,
                height: 7,
                borderRadius: 2,
                background: '#a78bfa',
                // `infinite` loops the animation forever — this is the
                // little dot that bounces down inside the scroll pill.
                animation: 'scrollDot 1.6s ease-in-out infinite',
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
