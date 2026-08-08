// Shared visual shell for LoginPage and SignupPage — same dark background,
// centered gradient-bordered card, and heading block. Pulling this out
// avoids copy-pasting the same wrapper markup/styles into both pages.

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Logo from '../landing/Logo';

interface AuthLayoutProps {
  eyebrow: string; // small uppercase label above the heading, e.g. "SIGN IN"
  title: string;
  subtitle: string;
  children: ReactNode; // the actual <form> each page supplies
  footer: ReactNode; // the "Don't have an account? Sign up" link row
}

export default function AuthLayout({ eyebrow, title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#080a14',
        color: '#eef0f6',
        fontFamily: "'Manrope',system-ui,sans-serif",
        padding: '32px 20px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Same decorative glow used on CtaSection, reused here so the auth
          pages don't feel like a totally disconnected part of the site. */}
      <div
        style={{
          position: 'absolute',
          top: '-10%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 700,
          height: 420,
          background: 'radial-gradient(circle,rgba(124,58,237,.28),transparent 65%)',
          filter: 'blur(60px)',
          pointerEvents: 'none',
        }}
      />

      <Link
        to="/"
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 11,
          textDecoration: 'none',
          marginBottom: 36,
        }}
      >
        <Logo size={30} boxSize={14} />
        <span
          style={{
            fontFamily: "'Space Grotesk',sans-serif",
            fontWeight: 700,
            fontSize: 19,
            letterSpacing: '-.01em',
            color: '#eef0f6',
          }}
        >
          Offerpath
        </span>
      </Link>

      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 420,
          borderRadius: 20,
          padding: '40px 36px',
          background: 'rgba(255,255,255,.03)',
          border: '1px solid rgba(167,139,250,.2)',
          boxShadow: '0 30px 80px rgba(0,0,0,.4)',
        }}
      >
        <div
          style={{
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 11.5,
            letterSpacing: '.16em',
            color: '#8b7fe0',
            marginBottom: 10,
          }}
        >
          {eyebrow}
        </div>
        <h1
          style={{
            fontFamily: "'Space Grotesk',sans-serif",
            fontWeight: 700,
            fontSize: 28,
            letterSpacing: '-.02em',
            margin: '0 0 8px',
          }}
        >
          {title}
        </h1>
        <p style={{ fontSize: 14.5, color: '#9aa2b8', margin: '0 0 28px', lineHeight: 1.6 }}>{subtitle}</p>

        {children}

        <div
          style={{
            marginTop: 24,
            paddingTop: 20,
            borderTop: '1px solid rgba(255,255,255,.08)',
            fontSize: 14,
            color: '#9aa2b8',
            textAlign: 'center',
          }}
        >
          {footer}
        </div>
      </div>
    </div>
  );
}