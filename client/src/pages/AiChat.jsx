import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Send, Sparkles, Trash2 } from 'lucide-react';
import apiClient from '../api/client';
import { extractError, formatCurrency } from '../lib/format';
import { sanitizeInput } from '../utils/sanitize';
import AiAdvisorSkeleton from '../components/skeletons/AiAdvisorSkeleton';
import ChatCharts from '../components/ChatCharts';
import Badge from '../components/ui/Badge';

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

/**
 * Readable name of the primary Gemini model. The backend rotates through
 * `gemini-3-flash-preview` (primary) → 2.5-flash → 2.0-flash → 2.5-flash-lite
 * for quota headroom; this badge reflects the primary, highest-quality model
 * that carries virtually all traffic. Display-only — no behavioural impact.
 */
const AI_MODEL = 'Gemini 3 Flash';

/**
 * Build the six starter prompts. Each is data-aware when the relevant field
 * of the `/api/summary` aggregate is present, and falls back to a sensible
 * static prompt when `summary` is null (not yet loaded / fetch failed) or the
 * field is 0/null. ₹ amounts use the app's shared INR formatter.
 */
function buildPrompts(summary) {
  const s = summary || {};
  const inr = (n) => formatCurrency(n, 'INR').replace(/\.00$/, '');

  return [
    s.investmentTotal > 0
      ? `How is my ${inr(s.investmentTotal)} portfolio performing?`
      : 'How should I start investing my savings?',
    s.billsDueSoonCount > 0
      ? `I have ${s.billsDueSoonCount} bill${s.billsDueSoonCount === 1 ? '' : 's'} due this week — which to pay first?`
      : 'How can I better manage my monthly bills?',
    s.firstGoalName
      ? `Am I on track for my ${s.firstGoalName} goal?`
      : 'How do I set a realistic savings goal?',
    s.liabilityTotal > 0
      ? `How should I pay down my ${inr(s.liabilityTotal)} debt?`
      : "What's the best way to stay debt-free?",
    s.hasAssets
      ? 'Am I diversifying my assets well enough?'
      : 'What assets should I prioritize building first?',
    'Give me an overall summary of my finances',
  ];
}

/**
 * Human-readable labels for each snapshot section the backend can include.
 * Keys mirror the flags returned by the server's `detectQuestionScope`.
 */
const SCOPE_LABELS = {
  monthly: 'Income & Expenses',
  netWorth: 'Net Worth',
  budgets: 'Budgets',
  topCategories: 'Spending',
  transactions: 'Transactions',
  goals: 'Goals',
  bills: 'Bills',
  investments: 'Investments',
};

/**
 * Mirror of the server's `detectQuestionScope` (aiController.js). The backend
 * scopes the financial snapshot to the question's keywords, so the data
 * categories used for a reply are deterministic from the user's message —
 * which the client already has. This lets us tag each answer with its sources
 * without any new API call or server change. Kept in sync with the server;
 * if the backend scoping changes, update this too.
 */
function deriveDataSources(message) {
  if (!message) return [];
  const m = String(message).toLowerCase();
  const has = (...words) => words.some((w) => m.includes(w));

  let keys;
  if (has('summary', 'overall', 'health', 'everything')) {
    keys = ['monthly', 'netWorth', 'budgets', 'topCategories', 'transactions', 'goals', 'bills', 'investments'];
  } else if (has('spend', 'budget', 'overspend', 'category')) {
    keys = ['budgets', 'topCategories', 'transactions'];
  } else if (has('goal', 'saving', 'target')) {
    keys = ['goals', 'monthly'];
  } else if (has('bill', 'due', 'pay', 'subscription')) {
    keys = ['bills'];
  } else if (has('invest', 'portfolio', 'stock', 'crypto', 'fund')) {
    keys = ['investments'];
  } else if (has('worth', 'asset', 'liabilit', 'debt', 'loan')) {
    keys = ['netWorth'];
  } else {
    keys = ['monthly', 'netWorth', 'topCategories'];
  }
  return keys.map((k) => SCOPE_LABELS[k]).filter(Boolean);
}

/** The nearest preceding user message for an assistant entry at `idx`. */
function precedingUserMessage(historyArr, idx) {
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (historyArr[i].role === 'user') return historyArr[i].content;
  }
  return null;
}

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
  const [summaryData, setSummaryData] = useState(null);
  const scrollRef = useRef(null);

  const quickPrompts = useMemo(() => buildPrompts(summaryData), [summaryData]);

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

  // Fetch the lightweight financial summary for data-aware starter prompts.
  // Independent of the history load — fails silently, leaving static prompts.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await apiClient.get('/summary');
        if (active && data && typeof data === 'object') setSummaryData(data);
      } catch {
        /* silent — prompts stay on their static fallbacks */
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
    const trimmed = sanitizeInput(text.trim());
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
      setHistory((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data?.reply ?? '',
          charts: Array.isArray(data?.charts) ? data.charts : null,
        },
      ]);
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
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        maxWidth: 900,
        margin: '0 auto',
      }}
      className="ai-advisor-shell"
    >
      {/* Header — visually distinct band above the chat */}
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          flexShrink: 0,
          paddingBottom: 16,
          borderBottom: '1px solid var(--border)',
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <span
            style={{
              width: 40,
              height: 40,
              borderRadius: 'var(--radius-lg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
              color: 'var(--accent)',
              flexShrink: 0,
            }}
          >
            <Sparkles size={20} strokeWidth={1.75} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
                AI Advisor
              </h1>
              <Badge variant="default">{AI_MODEL}</Badge>
            </div>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 2 }}>
              Ask anything about your finances
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleClear}
          disabled={clearing || submitting || history.length === 0}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            flexShrink: 0,
            height: 38,
            padding: '0 14px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
            background: 'var(--bg-surface)',
            color: 'var(--text-secondary)',
            fontFamily: 'Poppins, system-ui, sans-serif',
            fontSize: 13,
            fontWeight: 500,
            cursor: clearing || submitting || history.length === 0 ? 'not-allowed' : 'pointer',
            opacity: clearing || submitting || history.length === 0 ? 0.4 : 1,
            transition: 'all 150ms var(--ease)',
          }}
        >
          <Trash2 size={15} strokeWidth={1.75} />
          {clearing ? 'Clearing…' : 'Clear chat'}
        </button>
      </header>

      {/* Quick prompts — single horizontally scrollable row */}
      <div
        className="no-scrollbar"
        style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, flexShrink: 0, marginBottom: 12 }}
      >
        {quickPrompts.map((prompt) => (
          <PromptChip key={prompt} disabled={submitting} onClick={() => send(prompt)}>
            {prompt}
          </PromptChip>
        ))}
      </div>

      {/* Message area — fills the remaining height and scrolls */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          background: 'var(--bg-base)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: 16,
        }}
      >
        {history.length === 0 ? (
          <div
            style={{
              height: '100%',
              minHeight: 200,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: '40px 20px',
            }}
          >
            <Sparkles size={48} strokeWidth={1.5} color="var(--text-muted)" />
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginTop: 12 }}>
              Your finances, explained
            </div>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 6, maxWidth: 360 }}>
              Tap a prompt above or type your own question to get personalised advice based on your real Nuvault data.
            </div>
          </div>
        ) : (
          <ul style={{ display: 'flex', flexDirection: 'column', gap: 12, listStyle: 'none', margin: 0, padding: 0 }}>
            {history.map((entry, idx) => {
              const hasCharts = Array.isArray(entry.charts) && entry.charts.length > 0;
              const isUser = entry.role === 'user';
              const isAssistant = !isUser && !entry.isError;
              const sources = isAssistant ? deriveDataSources(precedingUserMessage(history, idx)) : [];
              return (
                <li
                  key={idx}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}
                >
                  <div
                    style={{
                      maxWidth: hasCharts ? '95%' : '85%',
                      width: hasCharts ? '100%' : undefined,
                      borderRadius: 'var(--radius-lg)',
                      padding: '10px 14px',
                      fontSize: 14,
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      ...(isUser
                        ? { background: 'var(--accent)', color: '#fff' }
                        : entry.isError
                          ? {
                              background: 'var(--red-muted)',
                              color: 'var(--red)',
                              border: '1px solid color-mix(in srgb, var(--red) 30%, transparent)',
                            }
                          : {
                              background: 'var(--bg-surface)',
                              color: 'var(--text-primary)',
                              border: '1px solid var(--border)',
                              boxShadow: 'var(--shadow-sm)',
                            }),
                    }}
                  >
                    {entry.content}
                    {hasCharts && <ChatCharts charts={entry.charts} />}
                    {isAssistant && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                        <CopyButton text={entry.content} />
                      </div>
                    )}
                  </div>
                  {isAssistant && sources.length > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5, paddingLeft: 4 }}>
                      Based on: {sources.join(' · ')}
                    </div>
                  )}
                </li>
              );
            })}
            {submitting && (
              <li style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '12px 14px',
                    boxShadow: 'var(--shadow-sm)',
                  }}
                >
                  <span className="ai-dot animate-bounce [animation-delay:-0.3s]" />
                  <span className="ai-dot animate-bounce [animation-delay:-0.15s]" />
                  <span className="ai-dot animate-bounce" />
                </div>
              </li>
            )}
          </ul>
        )}
      </div>

      {error && (
        <p
          role="alert"
          style={{
            flexShrink: 0,
            marginTop: 8,
            background: 'var(--red-muted)',
            color: 'var(--red)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 12px',
            fontSize: 13,
          }}
        >
          {error}
        </p>
      )}

      {/* Input row — pinned at the bottom of the column */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, flexShrink: 0, marginTop: 12 }}>
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ask the advisor a question…"
          maxLength={4000}
          style={{
            flex: 1,
            height: 48,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-full)',
            padding: '0 20px',
            fontFamily: 'Poppins, system-ui, sans-serif',
            fontSize: 14,
            color: 'var(--text-primary)',
            outline: 'none',
            boxShadow: 'var(--shadow-sm)',
          }}
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={submitting || message.trim().length === 0}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            height: 48,
            padding: '0 22px',
            borderRadius: 'var(--radius-full)',
            border: 'none',
            background: 'var(--accent)',
            color: '#fff',
            fontFamily: 'Poppins, system-ui, sans-serif',
            fontSize: 14,
            fontWeight: 600,
            cursor: submitting || message.trim().length === 0 ? 'not-allowed' : 'pointer',
            opacity: submitting || message.trim().length === 0 ? 0.5 : 1,
            transition: 'opacity 150ms var(--ease)',
          }}
        >
          <Send size={16} strokeWidth={2} />
          Send
        </button>
      </form>
    </section>
  );
}

/** Indigo-violet outline starter-prompt chip that fills on hover. */
function PromptChip({ children, onClick, disabled }) {
  const [hover, setHover] = useState(false);
  const filled = hover && !disabled;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        flexShrink: 0,
        whiteSpace: 'nowrap',
        height: 36,
        padding: '0 16px',
        borderRadius: 'var(--radius-full)',
        border: '1px solid var(--accent)',
        background: filled ? 'var(--accent)' : 'transparent',
        color: filled ? '#fff' : 'var(--accent)',
        fontFamily: 'Poppins, system-ui, sans-serif',
        fontSize: 13,
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 150ms var(--ease)',
      }}
    >
      {children}
    </button>
  );
}

/**
 * Copy-to-clipboard button for AI replies. Copies the raw reply text exactly
 * as stored (the model is instructed to emit plain text, so what's copied is
 * the verbatim source — markdown syntax, if any, is preserved). Charts live in
 * a separate `entry.charts` array and are never part of the text, so they're
 * naturally excluded. Shows a Check icon for 1.5s on success.
 */
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const [hover, setHover] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text ?? '');
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — silently no-op */
    }
  }

  return (
    <button
      type="button"
      aria-label={copied ? 'Copied' : 'Copy message'}
      onClick={handleCopy}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        borderRadius: 'var(--radius-md)',
        border: 'none',
        cursor: 'pointer',
        background: hover ? 'var(--bg-hover)' : 'transparent',
        color: copied ? 'var(--green)' : 'var(--text-muted)',
        transition: 'all 150ms var(--ease)',
      }}
    >
      {copied ? <Check size={15} strokeWidth={2} /> : <Copy size={15} strokeWidth={1.75} />}
    </button>
  );
}
