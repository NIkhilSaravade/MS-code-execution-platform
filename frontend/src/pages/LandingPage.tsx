import Hero from '../components/landing/Hero';
import EdgeSection from '../components/landing/EdgeSection';
import ShowcaseSection from '../components/landing/ShowcaseSection';
import CtaSection from '../components/landing/CtaSection';
import Footer from '../components/landing/Footer';
// This page imports five smaller components and stacks them in order.
// This is "composition" — the core React pattern of building big UIs out
// of small, focused pieces instead of one giant file. Each of these lives
// in components/landing/ and is documented in its own file.

export default function LandingPage() {
  return (
    // A single wrapping <div> sets page-wide styles (background color,
    // font, text color) that all the child sections inherit or sit on top
    // of. Every component must return exactly ONE root element — you
    // can't return <Hero/> and <Footer/> side-by-side without a wrapper
    // (or React's special <>...</> "Fragment" if you don't want an extra div).
    <div
      style={{
        fontFamily: "'Manrope',system-ui,sans-serif",
        background: '#080a14',
        color: '#eef0f6',
        overflowX: 'hidden', // prevents horizontal scrollbars from animations
      }}
    >
      <Hero />
      <EdgeSection />
      <ShowcaseSection />
      <CtaSection />
      <Footer />
      {/* Notice: no props are passed to any of these. They're fully
          "self-contained" components — all their content is hardcoded
          inside them rather than passed in from here. */}
    </div>
  );
}
