import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import Goals from '../Goals';
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

describe('Goals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('fetches /goals and renders progress', async () => {
    apiClient.get.mockResolvedValueOnce({
      data: [
        {
          _id: 'g1',
          name: 'Emergency fund',
          targetAmount: 1000,
          savedAmount: 250,
          progress: 0.25,
        },
      ],
    });

    renderWithProviders(<Goals />);

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/goals');
    });
    expect(await screen.findByText('Emergency fund')).toBeInTheDocument();
    expect(screen.getByText(/25% saved/)).toBeInTheDocument();
  });
});
