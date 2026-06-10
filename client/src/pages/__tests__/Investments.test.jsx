import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import Investments from '../Investments';
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

describe('Investments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('fetches /investments/summary and renders the totals + items', async () => {
    apiClient.get.mockResolvedValueOnce({
      data: {
        items: [
          {
            _id: 'i1',
            name: 'Apple',
            symbol: 'AAPL',
            type: 'stock',
            quantity: 10,
            buyPrice: 150,
            currentPrice: 200,
            invested: 1500,
            currentValue: 2000,
            gainLoss: 500,
            gainLossPercent: 33.33,
            priceSource: 'live',
          },
        ],
        totalInvested: 1500,
        totalCurrentValue: 2000,
        totalPnL: 500,
      },
    });

    renderWithProviders(<Investments />);

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/investments/summary');
    });

    expect(await screen.findByText('Apple')).toBeInTheDocument();
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText(/total invested/i)).toBeInTheDocument();
  });
});
