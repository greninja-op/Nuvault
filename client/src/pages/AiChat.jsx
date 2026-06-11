import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { extractError } from '../lib/format';

/**
 * AI advisor chat. Posts the message to `POST /ai/chat` and renders a
 * conversation in memory only — the backend never persists chat history
 * (see design.md, Requirement 18.7).
 *
 * On a 503 response (Claude unavailable) the API surfaces a generic
 * error which `extractError` will pick up as the "reply".
 *
 * Mobile layout: the section is a full-height flex column — the message
 * area is `flex-1 overflow-y-auto` and the input row sits pinned at the
 * bottom. Quick-prompt chips scroll horizontally in a single no-wrap row.
 */

/** Tappable starter prompts shown above the input. */
const QUICK_PROMPTS = [
  'How is my net worth trending?',
  'Where can I save money?',
  'Am I saving enough each month?',
  'How are my investments doing?',
  'Which budgets am I overspending?',
  'Suggest ways to clear my liabilities.',
];

export default function AiChat() {
  const [history, setHistory] = useState([]);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history, submitting]);

  async function send(text) {
    if (submitting) return;
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > 4000) {
      setError('Message must be between 1 and 4000 characters.');
      return;
    }
    setError(null);
    setHistory((prev) => [...prev, { role: 'user', content: trimmed }]);
    setMessage('');
    setSubmitting(true);
    try {
      const { data } = await apiClient.post('/ai/chat', { message: trimmed });
      setHistory((prev) => [...prev, { role: 'assistant', content: data?.reply ?? '' }]);
    } catch (err) {
      const reason = extractError(err, 'AI advisor is unavailable right now.');
      setHistory((prev) => [
        ...prev,
        { role: 'assistant', content: reason, isError: true },
      ]);
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    send(message);
  }

  return (
    <section className="flex h-[calc(100dvh-11rem)] flex-col md:h-[70vh]">
      <header className="shrink-0">
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">AI advisor</h1>
        <p className="text-sm text-slate-600">
          Ask for advice based on your current financial snapshot. Conversations
          are not stored.
        </p>
      </header>

      {/* Quick prompts — single horizontally scrollable row */}
      <div className="mt-3 flex shrink-0 gap-2 overflow-x-auto pb-1">
        {QUICK_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => send(prompt)}
            disabled={submitting}
            className="flex min-h-[40px] shrink-0 items-center whitespace-nowrap rounded-full border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Message area — fills the remaining height and scrolls */}
      <div
        ref={scrollRef}
        className="mt-3 flex-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      >
        {history.length === 0 ? (
          <p className="text-sm text-slate-500">
            Tap a prompt above or type your own question to get started.
          </p>
        ) : (
          <ul className="space-y-3">
            {history.map((entry, idx) => (
              <li
                key={idx}
                className={
                  entry.role === 'user' ? 'flex justify-end' : 'flex justify-start'
                }
              >
                <div
                  className={[
                    'max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words',
                    entry.role === 'user'
                      ? 'bg-indigo-600 text-white'
                      : entry.isError
                        ? 'bg-red-50 text-red-700'
                        : 'bg-slate-100 text-slate-900',
                  ].join(' ')}
                >
                  {entry.content}
                </div>
              </li>
            ))}
            {submitting && (
              <li className="flex justify-start">
                <div className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-500">
                  Thinking…
                </div>
              </li>
            )}
          </ul>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 shrink-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Input row — pinned at the bottom of the column */}
      <form onSubmit={handleSubmit} className="mt-3 flex shrink-0 gap-2">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ask the advisor a question…"
          maxLength={4000}
          className="min-h-[44px] flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <button
          type="submit"
          disabled={submitting || message.trim().length === 0}
          className="flex min-h-[44px] items-center justify-center rounded-md bg-indigo-600 px-5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:bg-indigo-400"
        >
          Send
        </button>
      </form>
    </section>
  );
}
