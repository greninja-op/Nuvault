import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { extractError } from '../lib/format';
import AiAdvisorSkeleton from '../components/skeletons/AiAdvisorSkeleton';

/**
 * AI advisor chat. Posts to `POST /ai/chat`, which replies using a rich
 * snapshot of the user's real finances. The backend persists every turn, so
 * the conversation is restored on load (`GET /ai/history`) and can be wiped
 * with `DELETE /ai/history`.
 *
 * Backend stores roles in Gemini's vocabulary ('user' / 'model'); the UI
 * renders 'user' on the right and everything else (model replies, errors) on
 * the left.
 *
 * Mobile layout: full-height flex column — the message area is
 * `flex-1 overflow-y-auto` and the input row is pinned at the bottom.
 * Quick-prompt chips scroll horizontally in a single no-wrap row.
 */

/** Data-driven starter prompts shown above the input. */
const QUICK_PROMPTS = [
  'How am I doing this month?',
  'Where am I overspending?',
  'Am I on track for my goals?',
  'What bills are due soon?',
  'How is my portfolio doing?',
  'What should I do with extra money?',
];

/** Normalise a backend turn ('user' | 'model') into a render entry. */
function toEntry(turn) {
  return {
    role: turn.role === 'user' ? 'user' : 'assistant',
    content: turn.message ?? '',
  };
}

export default function AiChat() {
  const [history, setHistory] = useState([]);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const scrollRef = useRef(null);

  // Restore the saved conversation on mount.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await apiClient.get('/ai/history');
        if (active && Array.isArray(data?.history)) {
          setHistory(data.history.map(toEntry));
        }
      } catch {
        // A failed restore is non-fatal — start with an empty chat.
      } finally {
        if (active) setInitialLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

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

  async function handleClear() {
    if (clearing || submitting || history.length === 0) return;
    setClearing(true);
    setError(null);
    try {
      await apiClient.delete('/ai/history');
      setHistory([]);
    } catch (err) {
      setError(extractError(err, 'Could not clear the conversation.'));
    } finally {
      setClearing(false);
    }
  }

  if (initialLoading) return <AiAdvisorSkeleton />;

  return (
    <section className="flex h-[calc(100dvh-11rem)] flex-col md:h-[70vh]">
      <header className="flex shrink-0 items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">AI advisor</h1>
          <p className="text-sm text-slate-600">
            Personalised advice based on your real Nuvault finances.
          </p>
        </div>
        <button
          type="button"
          onClick={handleClear}
          disabled={clearing || submitting || history.length === 0}
          className="flex min-h-[40px] shrink-0 items-center rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          {clearing ? 'Clearing…' : 'Clear chat'}
        </button>
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
                <div className="flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-3">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" />
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
