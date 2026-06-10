import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import Budgets from '../Budgets';
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

describe('Budgets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('fetches /budgets with the current month/year and renders spent/remaining', async () => {
    apiClient.get.mockResolvedValueOnce({
      data: [
        {
          _id: 'b1',
          category: 'food',
          limit: 100,
          month: 1,
          year: 2024,
          spent: 60,
          remaining: 40,
          overBudget: false,
        },
      ],
    });

    renderWithProviders(<Budgets />);

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(
        '/budgets',
        expect.objectContaining({
          params: expect.objectContaining({
            month: expect.any(Number),
            year: expect.any(Number),
          }),
        }),
      );
    });

    expect(await screen.findByText('food')).toBeInTheDocument();
    expect(screen.getByText(/remaining/i)).toBeInTheDocument();
  });
});
