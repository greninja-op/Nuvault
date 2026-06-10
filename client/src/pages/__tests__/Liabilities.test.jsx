import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import Liabilities from '../Liabilities';
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

describe('Liabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('fetches /liabilities and renders the empty state', async () => {
    apiClient.get.mockResolvedValueOnce({ data: [] });

    renderWithProviders(<Liabilities />);

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/liabilities');
    });
    expect(await screen.findByText(/no liabilities yet/i)).toBeInTheDocument();
  });
});
