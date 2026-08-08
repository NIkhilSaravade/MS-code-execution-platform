import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

// Wraps a page element and only renders it if the user is logged in.
// Otherwise it bounces them to /login, remembering the page they wanted
// (location.pathname) in route state so LoginPage can send them back
// there after a successful sign-in instead of always landing on /practice.
export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
}
