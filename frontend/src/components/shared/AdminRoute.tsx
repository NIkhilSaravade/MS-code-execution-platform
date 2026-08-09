import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

// Same idea as ProtectedRoute, but for ADMIN-only pages (e.g. /practice/new)
// - meant to be nested INSIDE a ProtectedRoute, so a logged-out visitor hits
// the login redirect first, and only a logged-in non-admin gets bounced
// here, back to /practice. Purely a UI convenience: every admin-only
// backend call is independently re-checked server-side (see
// AuthContext.isAdmin's comment) - this just avoids showing the form at all
// to someone who could never submit it.
export default function AdminRoute({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return <Navigate to="/practice" replace />;
  }

  return <>{children}</>;
}
