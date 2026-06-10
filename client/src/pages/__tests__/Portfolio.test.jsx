import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import Portfolio from '../Portfolio';
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

describe('Portfolio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('fetches /portfolio/summary on load and renders the page + totals', async () => {
    apiClient.get.mockResolvedValueOnce({
      data: {
        items: [
          {
            _id: 'p1',
            kind: 'stock',
            name: 'Apple',
            symbol: 'AAPL',
            units: 10,
            buyPrice: 100,
            currentPrice: 150,
            invested: 1000,
            currentValue: 1500,
            returns: 500,
          },
        ],
        totalInvested: 1000,
        totalCurrentValue: 1500,
        totalReturns: 500,
        allocation: [{ kind: 'stock', value: 1500, percent: 100 }],
      },
    });

    renderWithProviders(<Portfolio />);

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/portfolio/summary');
    });

    expect(
      await screen.findByRole('heading', { name: 'Portfolio' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Apple')).toBeInTheDocument();
    expect(screen.getByText(/total value/i)).toBeInTheDocument();
    expect(screen.getByText(/total returns/i)).toBeInTheDocument();
    // The Stocks section heading is rendered for the stock item.
    expect(screen.getByRole('heading', { name: 'Stocks' })).toBeInTheDocument();
  });
});
