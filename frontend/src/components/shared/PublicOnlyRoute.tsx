import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

// The mirror image of ProtectedRoute: wraps pages that should only be
// visible to logged-OUT visitors (the landing page, login, signup). If
// you're already signed in, there's nothing for you to do there — send
// you straight to /practice instead of showing the marketing page again.
export default function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();

  if (isAuthenticated) {
    return <Navigate to="/practice" replace />;
  }

  return <>{children}</>;
}
