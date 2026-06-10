import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import Assets from '../Assets';
import { renderWithProviders } from '../../test-utils/renderWithProviders';

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

describe('Assets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('fetches /assets and renders the list', async () => {
    apiClient.get.mockResolvedValueOnce({
      data: [
        {
          _id: 'a1',
          name: 'Savings account',
          type: 'bank',
          value: 1500,
          currency: 'INR',
        },
      ],
    });

    renderWithProviders(<Assets />);

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/assets');
    });
    expect(await screen.findByText('Savings account')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new asset/i })).toBeInTheDocument();
  });
});
