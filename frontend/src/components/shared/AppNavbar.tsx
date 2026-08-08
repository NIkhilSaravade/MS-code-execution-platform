import { Link, useLocation } from 'react-router-dom';
// useLocation is a "hook" — a special function (always starting with `use`)
// that lets a component tap into React/router features. useLocation()
// returns an object describing the CURRENT URL, e.g. { pathname: '/practice' }.

import Logo from '../landing/Logo';
// Reaching into a sibling folder (landing/) to reuse the Logo component —
// components don't have to live in the same folder to be shared.

import { useAuth } from '../../context/AuthContext';
// useAuth() reads the shared login state set up in main.tsx's
// <AuthProvider>. This is what lets the navbar switch between
// "Sign in / Start free" and "user@email.com / Log out" everywhere.

// A plain array of nav-link data, defined OUTSIDE the component. Since it
// never changes, there's no reason to recreate it every render — putting
// it at module scope means it's created once, when the file first loads.
const NAV_LINKS = [
  { label: 'Practice', href: '/practice' },
  { label: 'Companies', href: '#' },
  { label: 'AI Mentor', href: '#' },
  { label: 'Community', href: '#' },
];

export default function AppNavbar() {
  // Calling the hook. `location` is now an object; we mainly care about
  // location.pathname, the URL path like "/practice" or "/practice/two-sum".
  const location = useLocation();
  const { isAuthenticated, userEmail, logout } = useAuth();

  function handleLogout() {
    // A hard navigation, not React Router's navigate(). Clearing auth and
    // routing away as two separate React state updates left a window
    // where the still-mounted ProtectedRoute (guarding /practice) could
    // see isAuthenticated flip to false while the URL was still
    // "/practice" and fire its own redirect-to-/login first — landing the
    // user on the login form instead of "/". Reassigning
    // window.location.href sidesteps that race completely: it clears the
    // token, then throws away the whole SPA and reloads fresh at "/",
    // where AuthProvider boots up already logged out.
    logout();
    window.location.href = '/';
  }

  return (
    <header
      style={{
        position: 'sticky', // sticks to the top of the scroll container
        top: 0,
        zIndex: 20, // stacking order — higher numbers render above lower ones
        display: 'flex',
        alignItems: 'center',
        gap: 28,
        padding: '16px 32px',
        background: 'rgba(8,10,20,.85)',
        backdropFilter: 'blur(10px)', // frosted-glass blur of whatever is behind it
        borderBottom: '1px solid rgba(255,255,255,.08)',
      }}
    >
      <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 11, textDecoration: 'none' }}>
        <Logo size={26} boxSize={12} />
        <span
          style={{
            fontFamily: "'Space Grotesk',sans-serif",
            fontWeight: 700,
            fontSize: 17,
            letterSpacing: '-.01em',
            color: '#eef0f6',
          }}
        >
          Offerpath
        </span>
      </Link>

      <nav style={{ display: 'flex', gap: 24, marginLeft: 14 }}>
        {NAV_LINKS.map((link) => {
          // This is a CONDITIONAL / DERIVED value computed fresh on every
          // render, from data we already have (no need to store it in state).
          // .startsWith checks if the current URL begins with this link's
          // path, so /practice AND /practice/two-sum both highlight "Practice".
          // `&& link.href !== '#'` stops the placeholder '#' links from
          // ever showing as "active".
          const active = location.pathname.startsWith(link.href) && link.href !== '#';
          return (
            <Link
              key={link.label}
              to={link.href}
              className="op-nav-link"
              style={{
                fontSize: 14,
                fontWeight: 500,
                textDecoration: 'none',
                // A ternary (`condition ? ifTrue : ifFalse`) is the standard
                // way to pick between two values inline in JSX/JS.
                color: active ? '#fff' : '#aab2c5',
              }}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div style={{ flex: 1 }} />

      {/* Two different right-hand-side states depending on login: signed
          out shows "Sign in" + "Start free" links into the auth pages;
          signed in shows the user's email + a "Log out" button instead. */}
      {isAuthenticated ? (
        <>
          <span style={{ fontSize: 14, color: '#cdd3e0', fontWeight: 600 }}>{userEmail}</span>
          <button
            onClick={handleLogout}
            className="op-btn-secondary"
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: '#eef0f6',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,.14)',
              padding: '9px 16px',
              borderRadius: 10,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Log out
          </button>
        </>
      ) : (
        <>
          <Link
            to="/login"
            className="op-btn-secondary"
            style={{
              textDecoration: 'none',
              fontSize: 14,
              fontWeight: 700,
              color: '#eef0f6',
              background: 'rgba(255,255,255,.05)',
              border: '1px solid rgba(255,255,255,.16)',
              padding: '9px 16px',
              borderRadius: 10,
              cursor: 'pointer',
            }}
          >
            Sign in
          </Link>
          <Link
            to="/signup"
            className="op-btn-primary"
            style={{
              textDecoration: 'none',
              fontSize: 14,
              fontWeight: 700,
              color: '#0a0c16',
              background: '#fff',
              padding: '9px 16px',
              borderRadius: 10,
              cursor: 'pointer',
            }}
          >
            Sign up
          </Link>
        </>
      )}
    </header>
  );
}
