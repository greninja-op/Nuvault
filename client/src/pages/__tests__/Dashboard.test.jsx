import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor, screen } from '@testing-library/react';
import Dashboard from '../Dashboard';
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

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('fetches /networth with the selected display currency and renders totals', async () => {
    apiClient.get.mockResolvedValueOnce({
      data: {
        assets: [{ _id: 'a1', name: 'Cash', type: 'cash', value: 100 }],
        liabilities: [{ _id: 'l1', name: 'Card', type: 'credit_card', amount: 30 }],
        totalAssets: 100,
        totalLiabilities: 30,
        netWorth: 70,
        displayCurrency: 'INR',
      },
    });

    renderWithProviders(<Dashboard />);

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/networth', {
        params: { currency: 'INR' },
      });
    });

    expect(await screen.findByText('Net worth')).toBeInTheDocument();
    expect(screen.getByText('Cash')).toBeInTheDocument();
    expect(screen.getByText('Card')).toBeInTheDocument();
  });
});
