import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

/**
 * Wrapper that redirects to `/login` when no token is present.
 *
 * Per Requirement 21.6, the redirect happens within 2 seconds without
 * issuing the protected request. `<Navigate>` performs the redirect
 * synchronously on render, well within that bound.
 *
 * The previous location is forwarded via router state so the login view
 * can return the user to where they came from after authenticating.
 */
export default function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}
