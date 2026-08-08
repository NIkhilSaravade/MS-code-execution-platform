import { useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthLayout from '../components/shared/AuthLayout';
import { useAuth } from '../context/AuthContext';

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

export default function SignupPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // Checked client-side purely for fast feedback — auth-service itself
    // has no concept of "confirm password", it only ever sees `password`.
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setSubmitting(true);
    try {
      await register(email, password);
      // register() also logs the user in (see AuthContext), so the next
      // stop is the practice page, now as a signed-in user.
      navigate('/practice', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="CREATE ACCOUNT"
      title="Start practicing."
      subtitle="Free forever. No card required."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" style={{ color: '#c4b5fd', fontWeight: 600, textDecoration: 'none' }}>
            Sign in
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
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            className="op-auth-input"
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#cdd3e0' }}>Confirm password</span>
          <input
            type="password"
            required
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
            className="op-auth-input"
            style={inputStyle}
          />
        </label>

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
          {submitting ? 'Creating account...' : 'Create account'}
        </button>
      </form>
    </AuthLayout>
  );
}