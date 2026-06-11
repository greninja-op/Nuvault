import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import Transactions from '../Transactions';
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

describe('Transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('fetches /transactions and /transactions/summary on load', async () => {
    apiClient.get.mockImplementation((url) => {
      if (url === '/transactions') {
        return Promise.resolve({
          data: [
            {
              _id: 't1',
              type: 'expense',
              category: 'groceries',
              amount: 42,
              date: '2024-01-15T00:00:00.000Z',
              description: 'Weekly shop',
            },
          ],
        });
      }
      if (url === '/transactions/summary') {
        return Promise.resolve({
          data: {
            income: [],
            expense: [{ category: 'groceries', total: 42 }],
          },
        });
      }
      return Promise.resolve({ data: [] });
    });

    renderWithProviders(<Transactions />);

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(
        '/transactions',
        expect.objectContaining({ params: expect.any(Object) }),
      );
      expect(apiClient.get).toHaveBeenCalledWith(
        '/transactions/summary',
        expect.objectContaining({ params: expect.any(Object) }),
      );
    });

    // Rendered in both the desktop table and the mobile card list, so it
    // appears more than once in the DOM (CSS hides one per breakpoint).
    expect((await screen.findAllByText('Weekly shop')).length).toBeGreaterThan(0);
    // "groceries" appears in the summary card and both row variants.
    expect(screen.getAllByText('groceries').length).toBeGreaterThan(0);
  });
});
