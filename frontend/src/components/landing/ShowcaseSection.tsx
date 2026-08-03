// This file defines THREE components: two small helper components
// (CheckItem, SubmissionCard) and the main exported ShowcaseSection that
// uses them. It's completely normal — and encouraged — to have multiple
// components in one file when the smaller ones are only ever used by the
// big one, instead of splitting every little piece into its own file.

const checklistItems = [
  'Time & space complexity, verified against optimal',
  'Edge cases you missed, in interview language',
  'A personalized next step, every single time',
];

// A tiny component that just takes one prop. Notice the props type is
// written INLINE here (`{ label }: { label: string }`) instead of a named
// `interface`, since it's a one-off — this is destructuring the incoming
// props object directly in the function's parameter list, pulling out
// just the `label` field.
function CheckItem({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: 7,
          background: '#15a34a',
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0, // stops this circle from being squeezed by flexbox if space is tight
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fff"
          strokeWidth="3.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 6L9 17l-5-5" />
          {/* A checkmark drawn as a two-segment path */}
        </svg>
      </div>
      <span style={{ fontSize: 15, color: '#c7cdda' }}>{label}</span>
    </div>
  );
}

// Another self-contained helper component — the tilted "Accepted" card
// mockup. It takes NO props; all its content is hardcoded, since it's only
// ever used once, purely for visual effect on the landing page.
function SubmissionCard() {
  return (
    <div style={{ perspective: 1400 }}>
      {/* `perspective` on the parent + `rotateX/rotateY` on the child is
          how you get a believable 3D tilt effect in pure CSS. */}
      <div
        style={{
          transform: 'rotateY(-13deg) rotateX(7deg)',
          transformStyle: 'preserve-3d',
          borderRadius: 20,
          background: 'linear-gradient(180deg,#13161e,#0e1118)',
          border: '1px solid rgba(255,255,255,.1)',
          boxShadow: '0 40px 90px rgba(0,0,0,.6),0 0 0 1px rgba(124,58,237,.12)',
          padding: 24,
          animation: 'floatY 6s ease-in-out infinite', // gentle up/down bobbing, looped forever
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 20 }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              background: 'rgba(21,163,74,.16)',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#34d399"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <div>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 20, fontWeight: 700, color: '#34d399' }}>
              Accepted
            </div>
            <div style={{ fontSize: 12.5, color: '#7a8298' }}>Two Sum · 58/58 cases · Python</div>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                fontFamily: "'Space Grotesk',sans-serif",
                fontSize: 26,
                fontWeight: 700,
                color: '#c4b5fd',
                lineHeight: 1,
              }}
            >
              92
            </div>
            <div style={{ fontSize: 10, color: '#7a8298' }}>SCORE</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          {/* Here each array item is itself a small [label, value] PAIR
              (a 2-element array), so `.map(([label, value]) => ...)` uses
              ARRAY DESTRUCTURING right in the callback's parameter — it's
              equivalent to writing `.map((pair) => { const [label, value] = pair; ... })`. */}
          {[
            ['TIME', 'O(n)'],
            ['SPACE', 'O(n)'],
            ['RUNTIME', '52ms'],
          ].map(([label, value]) => (
            <div key={label} style={{ flex: 1, background: '#1a1e28', borderRadius: 11, padding: 12 }}>
              <div style={{ fontSize: 10.5, color: '#7a8298', fontWeight: 600, marginBottom: 2 }}>
                {label}
              </div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 19, fontWeight: 600, color: '#eef0f6' }}>
                {value}
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            display: 'flex',
            gap: 12,
            padding: 15,
            borderRadius: 13,
            background: 'rgba(124,58,237,.1)',
            border: '1px solid rgba(167,139,250,.22)',
          }}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 9,
              background: '#7c3aed',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: 14,
                height: 14,
                background: '#fff',
                clipPath: 'polygon(50% 0,61% 39%,100% 50%,61% 61%,50% 100%,39% 61%,0 50%,39% 39%)',
              }}
            />
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.55, color: '#cdd3e0' }}>
            {/* <b> is a plain HTML bold tag — works exactly the same in JSX. */}
            <b style={{ color: '#d6caff' }}>Your mentor:</b> You reached for a hash map instantly —
            exactly the instinct interviewers reward. Try <b style={{ color: '#fff' }}>LRU Cache</b>{' '}
            next to push the pattern further.
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ShowcaseSection() {
  return (
    <section style={{ position: 'relative', padding: '80px 40px 130px', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          top: '20%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 680,
          height: 480,
          background: 'radial-gradient(circle,rgba(124,58,237,.22),transparent 65%)',
          filter: 'blur(40px)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'relative',
          maxWidth: 1100,
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr', // two equal columns: text on the left, card on the right
          gap: 64,
          alignItems: 'center',
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: 11.5,
              letterSpacing: '.16em',
              color: '#8b7fe0',
              marginBottom: 16,
            }}
          >
            AFTER&nbsp;YOU&nbsp;SUBMIT
          </div>
          <h2
            style={{
              fontFamily: "'Space Grotesk',sans-serif",
              fontWeight: 700,
              fontSize: 'clamp(28px,3.4vw,46px)',
              lineHeight: 1.08,
              letterSpacing: '-.025em',
              margin: '0 0 18px',
            }}
          >
            Not a green checkmark.
            <br />A coach in your corner.
          </h2>
          <p style={{ fontSize: 17, lineHeight: 1.65, color: '#9aa2b8', margin: '0 0 28px' }}>
            The moment your code passes, the AI breaks down <span style={{ color: '#e8eaf2' }}>why</span> it
            works, where it'd crack in a follow-up, and the exact next problem to build on the skill
            you just used.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Rendering our `checklistItems` string array through the
                CheckItem component we defined above — each string becomes
                one row. Passing data down as a `label` prop. */}
            {checklistItems.map((item) => (
              <CheckItem key={item} label={item} />
            ))}
          </div>
        </div>
        <SubmissionCard />
      </div>
    </section>
  );
}
