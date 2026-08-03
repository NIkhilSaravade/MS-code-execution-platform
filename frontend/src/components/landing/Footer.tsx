import { Link } from 'react-router-dom';
// <Link> is react-router-dom's replacement for <a>. It changes the URL and
// swaps the page WITHOUT a full browser reload (which is what makes React
// apps feel instant). Always use <Link to="..."> instead of <a href="...">
// for navigation *within* your own app; use plain <a> only for external URLs.

import Logo from './Logo';
// Importing our own Logo component from the file next to this one.

export default function Footer() {
  return (
    <footer
      style={{
        borderTop: '1px solid rgba(255,255,255,.07)',
        padding: '34px 40px',
        display: 'flex',       // flexbox: lay children out in a row
        alignItems: 'center',  // vertically center them
        gap: 14,                // spacing between children (modern CSS, no margin hacks needed)
        flexWrap: 'wrap',       // let items wrap to a new line on small screens
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Logo size={24} boxSize={11} />
        {/* Passing props to Logo: this overrides the defaults (30/14)
            defined inside Logo.tsx, making a smaller footer logo. */}
        <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 15 }}>
          Offerpath
        </span>
      </div>

      <span style={{ fontSize: 13, color: '#6b7392' }}>© 2026 Offerpath</span>

      {/* An empty div with flex: 1 is a common flexbox trick: it grows to
          fill all remaining space, pushing the links after it to the right. */}
      <div style={{ flex: 1 }} />

      {/* Here we build an ARRAY of link objects, then use .map() to turn
          each one into JSX. This is the standard React pattern for
          rendering a list — much like a for-loop, but expressed as a
          transformation of data into UI. */}
      {[
        { label: 'Practice', href: '/practice' },
        { label: 'Companies', href: '#' },
        { label: 'Privacy', href: '#' },
      ].map((link) => (
        // React needs a `key` prop on every item produced inside .map() so
        // it can efficiently track which item is which if the list changes.
        // Using the (unique) label as the key here is fine since it never repeats.
        <Link
          key={link.label}
          to={link.href}
          className="op-footer-link"
          // className works like the plain HTML `class` attribute — the
          // actual hover-color CSS for "op-footer-link" lives in index.css,
          // since :hover pseudo-classes can't be expressed in inline style={{}}.
          style={{ fontSize: 13, color: '#8b93a8', cursor: 'pointer', textDecoration: 'none' }}
        >
          {link.label}
          {/* {link.label} inserts the JS variable's value into the JSX —
              anything in curly braces inside JSX is evaluated as JavaScript. */}
        </Link>
      ))}
    </footer>
  );
}
