import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AuthProvider, SESSION_EXPIRED_EVENT, useAuth } from '../AuthContext';
import { TOKEN_STORAGE_KEY } from '../storage';

function Probe() {
  const { token, isAuthenticated } = useAuth();
  return (
    <div>
      <span data-testid="token">{token ?? 'NONE'}</span>
      <span data-testid="auth">{isAuthenticated ? 'YES' : 'NO'}</span>
    </div>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('hydrates the token from local storage on mount', () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-from-storage');

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByTestId('token').textContent).toBe('jwt-from-storage');
    expect(screen.getByTestId('auth').textContent).toBe('YES');
  });

  it('reports unauthenticated when no token is stored', () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByTestId('token').textContent).toBe('NONE');
    expect(screen.getByTestId('auth').textContent).toBe('NO');
  });

  it('clears React state when the session-expired event fires', () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-from-storage');

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByTestId('auth').textContent).toBe('YES');

    act(() => {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    });

    expect(screen.getByTestId('token').textContent).toBe('NONE');
    expect(screen.getByTestId('auth').textContent).toBe('NO');
  });
});
