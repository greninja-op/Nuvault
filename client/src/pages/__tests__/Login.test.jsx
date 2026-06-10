import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import Login from '../Login';
import { renderWithProviders } from '../../test-utils/renderWithProviders';
import { TOKEN_STORAGE_KEY } from '../../auth/storage';

vi.mock('../../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  },
}));

import apiClient from '../../api/client';

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('submits credentials to /auth/login and stores the token', async () => {
    apiClient.post.mockResolvedValueOnce({
      data: {
        token: 'jwt-from-server',
        user: { id: 'u1', name: 'Ada', email: 'ada@example.com' },
      },
    });

    renderWithProviders(<Login />, { route: '/login' });

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'ada@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'secret123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/auth/login', {
        email: 'ada@example.com',
        password: 'secret123',
      });
    });

    await waitFor(() => {
      expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('jwt-from-server');
    });
  });

  it('shows the API error when login fails', async () => {
    apiClient.post.mockRejectedValueOnce({
      response: { status: 401, data: { message: 'Invalid credentials' } },
    });

    renderWithProviders(<Login />, { route: '/login' });

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'a@b.co' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'badpass' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Invalid credentials')).toBeInTheDocument();
  });
});
