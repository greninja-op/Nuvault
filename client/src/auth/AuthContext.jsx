import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { clearToken, readToken, writeToken } from './storage';

/**
 * AuthContext exposes the current Nuvault session to the React tree.
 *
 * Shape: { user, token, isAuthenticated, login(token, user?), logout() }
 *
 * - On mount the provider hydrates the token from local storage so the
 *   session survives page reloads (Requirement 21.1).
 * - `login(token)` writes the token under the single designated key,
 *   replacing any prior token (Requirement 21.1, 21.5).
 * - `logout()` clears the token from local storage (Requirement 21.4).
 * - The provider also listens for the global `nuvault:session-expired`
 *   event dispatched by the Axios interceptor on a `401` response so
 *   React state stays in sync with local storage (Requirement 21.3).
 */

const AuthContext = createContext(null);

export const SESSION_EXPIRED_EVENT = 'nuvault:session-expired';

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => readToken());
  const [user, setUser] = useState(null);

  // Hydrate from storage on mount in case the initial render happened on a
  // server (where `readToken` returned null) or storage was populated late.
  useEffect(() => {
    const stored = readToken();
    if (stored && stored !== token) {
      setToken(stored);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback((nextToken, nextUser = null) => {
    writeToken(nextToken);
    setToken(nextToken || null);
    setUser(nextUser);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setToken(null);
    setUser(null);
  }, []);

  // Keep React state in sync when the Axios interceptor clears the session.
  useEffect(() => {
    function handleSessionExpired() {
      setToken(null);
      setUser(null);
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    };
  }, []);

  // Cross-tab sync: if local storage changes elsewhere, mirror it here.
  useEffect(() => {
    function handleStorage(event) {
      if (event.key && event.key !== 'nuvault.token') return;
      const stored = readToken();
      setToken(stored);
      if (!stored) setUser(null);
    }
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const value = useMemo(
    () => ({
      user,
      token,
      isAuthenticated: Boolean(token),
      login,
      logout,
    }),
    [user, token, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

export default AuthContext;
