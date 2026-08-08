import { useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AuthLayout from '../components/shared/AuthLayout';
import { useAuth } from '../context/AuthContext';

// Shared styling for the email/password fields — pulled into one object
// instead of repeating the same style={{...}} block on both inputs.
const inputStyle: CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 11,
  border: '1px solid rgba(255,255,255,.12)',
  background: 'rgba(255,255,255,.04)',
  color: '#eef0f6',
  fontSize: 14,
  fontFamily: 'inherit',
};

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Controlled-input state for the two fields, plus UI state for the
  // in-flight request and any error message from the backend.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    // Forms POST and reload the page by default — preventDefault() stops
    // that so we can handle the submit with our own async login() call.
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      // If the user got redirected here from a protected page (none exist
      // yet, but this future-proofs it), location.state.from sends them
      // back to where they came from instead of always to "/".
      const redirectTo = (location.state as { from?: string } | null)?.from ?? '/practice';
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="SIGN IN"
      title="Welcome back."
      subtitle="Log in to pick up where you left off."
      footer={
        <>
          Don&apos;t have an account?{' '}
          <Link to="/signup" style={{ color: '#c4b5fd', fontWeight: 600, textDecoration: 'none' }}>
            Sign up
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#cdd3e0' }}>Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="op-auth-input"
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#cdd3e0' }}>Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="op-auth-input"
            style={inputStyle}
          />
        </label>

        {/* Only rendered once an actual error exists — see the `error &&`
            conditional-render pattern used throughout this app. */}
        {error && (
          <div
            style={{
              fontSize: 13.5,
              color: '#fca5a5',
              background: 'rgba(248,113,113,.1)',
              border: '1px solid rgba(248,113,113,.25)',
              borderRadius: 10,
              padding: '10px 12px',
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="op-auth-submit"
          style={{
            marginTop: 8,
            fontSize: 15,
            fontWeight: 700,
            color: '#0a0c16',
            background: '#fff',
            border: 'none',
            borderRadius: 11,
            padding: '13px 16px',
            cursor: 'pointer',
          }}
        >
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </AuthLayout>
  );
}