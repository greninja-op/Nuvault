import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import Register from '../Register';
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

describe('Register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('submits to /auth/register and stores the returned token', async () => {
    apiClient.post.mockResolvedValueOnce({
      data: {
        token: 'jwt-new',
        user: { id: 'u1', name: 'Ada', email: 'ada@example.com' },
      },
    });

    renderWithProviders(<Register />, { route: '/register' });

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'ada@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'secret123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/auth/register', {
        name: 'Ada',
        email: 'ada@example.com',
        password: 'secret123',
      });
    });

    await waitFor(() => {
      expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('jwt-new');
    });
  });
});
