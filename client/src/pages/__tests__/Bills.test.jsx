import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import Bills from '../Bills';
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

describe('Bills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('fetches /bills and renders the list, then PATCHes /bills/:id/pay', async () => {
    apiClient.get.mockResolvedValueOnce({
      data: [
        {
          _id: 'b1',
          name: 'Internet',
          amount: 50,
          frequency: 'monthly',
          nextDueDate: '2024-02-01T00:00:00.000Z',
          isPaid: false,
          autoPay: false,
        },
      ],
    });
    apiClient.patch.mockResolvedValueOnce({ data: {} });
    apiClient.get.mockResolvedValueOnce({ data: [] });

    renderWithProviders(<Bills />);

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/bills');
    });
    expect(await screen.findByText('Internet')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Pay$/ }));

    await waitFor(() => {
      expect(apiClient.patch).toHaveBeenCalledWith('/bills/b1/pay');
    });
  });
});
