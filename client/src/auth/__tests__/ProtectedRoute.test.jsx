import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../AuthContext';
import ProtectedRoute from '../ProtectedRoute';
import { TOKEN_STORAGE_KEY } from '../storage';

function renderApp(initialEntry) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/login" element={<div>LOGIN_PLACEHOLDER</div>} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <div>SECRET_DASHBOARD</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('redirects to /login when no token is stored', () => {
    renderApp('/');
    expect(screen.getByText('LOGIN_PLACEHOLDER')).toBeInTheDocument();
    expect(screen.queryByText('SECRET_DASHBOARD')).not.toBeInTheDocument();
  });

  it('renders the protected content when a token is stored', () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-from-storage');
    renderApp('/');
    expect(screen.getByText('SECRET_DASHBOARD')).toBeInTheDocument();
    expect(screen.queryByText('LOGIN_PLACEHOLDER')).not.toBeInTheDocument();
  });
});
