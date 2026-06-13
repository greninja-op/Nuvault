import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import AiChat from '../AiChat';
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

describe('AiChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('posts the message to /ai/chat and renders the reply', async () => {
    apiClient.post.mockResolvedValueOnce({ data: { reply: 'Save more, spend less.' } });

    renderWithProviders(<AiChat />);

    fireEvent.change(await screen.findByPlaceholderText(/ask the advisor/i), {
      target: { value: 'How am I doing?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/ai/chat', {
        message: 'How am I doing?',
      });
    });
    expect(await screen.findByText('Save more, spend less.')).toBeInTheDocument();
    expect(screen.getByText('How am I doing?')).toBeInTheDocument();
  });

  it('shows the error message when the AI endpoint fails', async () => {
    apiClient.post.mockRejectedValueOnce({
      response: { status: 503, data: { message: 'AI advisor is unavailable right now.' } },
    });

    renderWithProviders(<AiChat />);

    fireEvent.change(await screen.findByPlaceholderText(/ask the advisor/i), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(
      await screen.findByText(/ai advisor is unavailable/i),
    ).toBeInTheDocument();
  });
});
