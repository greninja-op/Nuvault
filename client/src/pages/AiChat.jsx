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
 */
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
  }, [history]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    const trimmed = message.trim();
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

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">AI advisor</h1>
        <p className="text-sm text-slate-600">
          Ask for advice based on your current financial snapshot. Conversations
          are not stored.
        </p>
      </header>

      <div
        ref={scrollRef}
        className="h-[55vh] overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      >
        {history.length === 0 ? (
          <p className="text-sm text-slate-500">
            Try: "How is my net worth trending?" or "Where can I save money?"
          </p>
        ) : (
          <ul className="space-y-3">
            {history.map((entry, idx) => (
              <li
                key={idx}
                className={
                  entry.role === 'user'
                    ? 'flex justify-end'
                    : 'flex justify-start'
                }
              >
                <div
                  className={[
                    'max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
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
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ask the advisor a question…"
          maxLength={4000}
          className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <button
          type="submit"
          disabled={submitting || message.trim().length === 0}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:bg-indigo-400"
        >
          Send
        </button>
      </form>
    </section>
  );
}
