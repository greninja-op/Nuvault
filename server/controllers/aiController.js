'use strict';

/**
 * AI_Advisor_Service controller (Gemini, rich snapshot + chat memory).
 *
 * Endpoints (mounted under /api/ai, all behind `protect`):
 *
 *   POST   /chat     — Build a rich, user-scoped financial snapshot, fold it
 *                      into the Nuvault advisor system prompt, send it to
 *                      Gemini together with the last few conversation turns,
 *                      persist both the user message and the model reply, and
 *                      return `{ reply }`.
 *   GET    /history  — Return the user's most recent conversation turns
 *                      (chronological) so the chat survives a page refresh.
 *   DELETE /history  — Permanently clear the user's conversation history.
 *
 * The financial snapshot includes: this-month income / expenses / savings /
 * savings-rate, net worth, budgets (with spend), goals (with progress), bills
 * (with days-until-due), investments (with P&L), the top spending categories,
 * and the most recent transactions — all strictly scoped to the owner.
 *
 * Gemini endpoint:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/
 *        gemini-2.5-flash:generateContent?key=<GEMINI_API_KEY>
 *
 * The API key is NEVER included in any response, error message, or log.
 */

const axios = require('axios');
const { body, validationResult } = require('express-validator');

const Asset = require('../models/Asset');
const Liability = require('../models/Liability');
const Transaction = require('../models/Transaction');
const Goal = require('../models/Goal');
const Bill = require('../models/Bill');
const Budget = require('../models/Budget');
const Investment = require('../models/Investment');
const ChatHistory = require('../models/ChatHistory');
const { scopedFind } = require('../utils/ownership');
const { roundTo2dp } = require('../utils/currency');

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_MESSAGE_LENGTH = 4000;
const RECENT_TRANSACTIONS_LIMIT = 30;
const HISTORY_FETCH_LIMIT = 20; // turns returned to the client on load
const HISTORY_CONTEXT_LIMIT = 10; // turns sent to Gemini for short-term memory
const SERVICE_UNAVAILABLE_MESSAGE = 'AI service unavailable';
const QUOTA_EXCEEDED_MESSAGE =
  'AI free-tier quota exceeded. Try again in a minute, or check your Google AI Studio plan.';
const GEMINI_API_TIMEOUT_MS = 30_000;
const GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models';

const SNAPSHOT_HEADER = 'USER FINANCIAL SNAPSHOT:';
const MS_PER_DAY = 86_400_000;

/**
 * Models tried in order. The first is both the highest-quality and
 * highest-quota free-tier option, so it almost always carries traffic.
 * Subsequent entries provide quality fallbacks for transient overloads
 * and quota-stack headroom for heavy days. All confirmed available to
 * the project's API key (probed via `models?key=...` + a live ping).
 *
 * Approximate free-tier daily quotas (RPD) per Google as of early 2026:
 *   gemini-3-flash-preview     ~1,500
 *   gemini-2.5-flash             ~250
 *   gemini-2.0-flash             ~200
 *   gemini-2.5-flash-lite      ~1,000
 *
 * Cumulative per key per day ≈ 2,950 RPD before the advisor is forced
 * into a 503 — and the multi-key rotation scales that linearly.
 *
 * Note: the `-preview` suffix flags the model as still-in-preview at
 * Google. They occasionally change/retire preview models; the rotation
 * itself protects against that — if `3-flash-preview` ever returns 404
 * we collapse to the next entry automatically.
 */
const GEMINI_MODELS = [
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.5-flash-lite',
];

// Canonical primary endpoint URL — derived from the first entry of
// {@link GEMINI_MODELS}. Re-exported as a constant for tests and for
// any future caller that needs the resolved URL without rebuilding it.
const GEMINI_ENDPOINT = `${GEMINI_BASE_URL}/${GEMINI_MODELS[0]}:generateContent`;

/** Per-attempt overload retries before falling back to the next model. */
const GEMINI_OVERLOAD_RETRIES = 2;

/** Linear backoff between overload retries (ms). */
const GEMINI_RETRY_DELAY_MS = 1000;

// ── Validation chain ─────────────────────────────────────────────────────────

const chatValidators = [
  body('message')
    .exists({ checkNull: true })
    .withMessage('message is required')
    .bail()
    .isString()
    .withMessage('message is required')
    .bail()
    .customSanitizer((v) => v.trim())
    .notEmpty()
    .withMessage('message is required')
    .bail()
    .isLength({ max: MAX_MESSAGE_LENGTH })
    .withMessage(`message must be 1 to ${MAX_MESSAGE_LENGTH} characters`),
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function rejectIfValidationErrors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const first = errors.array({ onlyFirstError: true })[0];
    res.status(400).json({ message: first.msg });
    return true;
  }
  return false;
}

/**
 * Read GEMINI_API_KEY(s). Supports either a single key or a comma-
 * separated list of keys for free-tier quota rotation:
 *
 *   GEMINI_API_KEY=key1
 *   GEMINI_API_KEY=key1,key2,key3
 *
 * Lookup order, mirroring `resolveApiKey`:
 *   1. req.app.get('config').geminiApiKey       (string, possibly comma-list)
 *   2. process.env.GEMINI_API_KEY               (string, possibly comma-list)
 *
 * Returns an array of trimmed non-empty keys, or `[]` when nothing is
 * configured (the dispatcher then short-circuits to a 503 cleanly).
 */
function resolveApiKeys(req) {
  const raw = resolveApiKey(req);
  if (!raw) return [];
  return raw
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

/**
 * Read GEMINI_API_KEY. Lookup order:
 *   1. req.app.get('config').geminiApiKey  (injected by tests)
 *   2. process.env.GEMINI_API_KEY
 * Returns null when absent; the 503 path activates automatically.
 *
 * Returns the raw value (which may be a single key or comma-list);
 * call {@link resolveApiKeys} to get a usable list.
 */
function resolveApiKey(req) {
  if (req && req.app && typeof req.app.get === 'function') {
    const cfg = req.app.get('config');
    if (cfg && typeof cfg.geminiApiKey === 'string' && cfg.geminiApiKey.trim() !== '') {
      return cfg.geminiApiKey;
    }
  }
  const fromEnv = process.env.GEMINI_API_KEY;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return fromEnv;
  }
  return null;
}

/**
 * Per-key "exhausted until" cache. When a key returns 429 we record a
 * blackout timestamp so subsequent requests don't immediately re-burn
 * a call on a known-dead key. The window is short on purpose: if the
 * key recovers (per-minute quota reset) we'll find out within a minute.
 *
 * Module-scoped Map keyed by the API key string. Tests reset it via
 * {@link _resetKeyBlackouts} between cases.
 *
 * @type {Map<string, number>}
 */
const keyBlackouts = new Map();
const KEY_BLACKOUT_MS = 60_000;

/** Test-only helper: clear the per-key blackout cache. */
function _resetKeyBlackouts() {
  keyBlackouts.clear();
}

/** True when the key has a non-expired blackout entry. */
function isKeyBlackedOut(key) {
  const until = keyBlackouts.get(key);
  if (!until) return false;
  if (Date.now() >= until) {
    keyBlackouts.delete(key);
    return false;
  }
  return true;
}

/** Record that a key is exhausted; subsequent calls skip it for a minute. */
function blackoutKey(key) {
  keyBlackouts.set(key, Date.now() + KEY_BLACKOUT_MS);
}

function sumAssetValues(assets) {
  let total = 0;
  for (const a of assets) {
    const v = a && a.value;
    if (typeof v === 'number' && Number.isFinite(v)) total += v;
  }
  return total;
}

function sumLiabilityAmounts(liabilities) {
  let total = 0;
  for (const l of liabilities) {
    const v = l && l.amount;
    if (typeof v === 'number' && Number.isFinite(v)) total += v;
  }
  return total;
}

/** First name from the authenticated user, falling back to "there". */
function firstNameOf(req) {
  const name = req && req.user && typeof req.user.name === 'string' ? req.user.name.trim() : '';
  if (!name) return 'there';
  return name.split(/\s+/)[0];
}

/** Currency code from the authenticated user, defaulting to INR. */
function currencyOf(req) {
  const c = req && req.user && req.user.currency;
  return typeof c === 'string' && c.trim() !== '' ? c.trim() : 'INR';
}

// ── Snapshot composition ───────────────────────────────────────────────────────

/**
 * Build a rich, strictly user-scoped financial snapshot for the current
 * calendar month plus standing balances (net worth, goals, bills,
 * investments). Pure data — formatting happens in buildSystemPrompt.
 */
async function buildSnapshot(req) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const curMonth = now.getMonth() + 1; // 1–12
  const curYear = now.getFullYear();

  const [
    assets,
    liabilities,
    recentTransactions,
    monthTransactions,
    goals,
    bills,
    investments,
    budgets,
  ] = await Promise.all([
    scopedFind(Asset, req).lean(),
    scopedFind(Liability, req).lean(),
    scopedFind(Transaction, req).sort({ date: -1 }).limit(RECENT_TRANSACTIONS_LIMIT).lean(),
    scopedFind(Transaction, req, { date: { $gte: monthStart, $lt: nextMonthStart } }).lean(),
    scopedFind(Goal, req).lean(),
    scopedFind(Bill, req).lean(),
    scopedFind(Investment, req).lean(),
    scopedFind(Budget, req, { month: curMonth, year: curYear }).lean(),
  ]);

  // This-month income / expenses + per-category spend.
  let income = 0;
  let expenses = 0;
  const categorySpend = {};
  for (const t of monthTransactions) {
    if (t.type === 'income') {
      income += t.amount;
    } else if (t.type === 'expense') {
      expenses += t.amount;
      categorySpend[t.category] = (categorySpend[t.category] || 0) + t.amount;
    }
  }
  income = roundTo2dp(income);
  expenses = roundTo2dp(expenses);
  const savings = roundTo2dp(income - expenses);
  const savingsRate = income > 0 ? roundTo2dp((savings / income) * 100) : 0;

  // Budgets for the current month, with computed spend.
  const budgetSummaries = budgets.map((b) => {
    const spent = roundTo2dp(categorySpend[b.category] || 0);
    const remaining = roundTo2dp(b.limit - spent);
    const pctUsed = b.limit > 0 ? roundTo2dp((spent / b.limit) * 100) : 0;
    return {
      category: b.category,
      limit: b.limit,
      spent,
      remaining,
      pctUsed,
      over: spent > b.limit,
    };
  });

  // Top 3 spending categories this month.
  const topCategories = Object.entries(categorySpend)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category, amount]) => ({ category, amount: roundTo2dp(amount) }));

  // Goals with progress and months remaining.
  const goalSummaries = goals.map((g) => {
    const pct = g.targetAmount > 0 ? Math.min(roundTo2dp((g.savedAmount / g.targetAmount) * 100), 100) : 0;
    let monthsRemaining = null;
    if (g.targetDate) {
      const td = new Date(g.targetDate);
      monthsRemaining = Math.max(
        0,
        (td.getFullYear() - now.getFullYear()) * 12 + (td.getMonth() - now.getMonth()),
      );
    }
    return {
      name: g.name,
      target: g.targetAmount,
      saved: g.savedAmount,
      pct,
      targetDate: g.targetDate || null,
      monthsRemaining,
    };
  });

  // Bills with days until due.
  const billSummaries = bills.map((b) => {
    const due = new Date(b.nextDueDate);
    const daysUntilDue = Math.ceil((due.getTime() - now.getTime()) / MS_PER_DAY);
    return {
      name: b.name,
      amount: b.amount,
      dueDate: b.nextDueDate,
      daysUntilDue,
      paid: !!b.isPaid,
    };
  });

  // Investments with P&L (live currentPrice falls back to buyPrice).
  let totalInvested = 0;
  let totalCurrent = 0;
  const holdings = investments.map((inv) => {
    const price =
      typeof inv.currentPrice === 'number' && inv.currentPrice > 0 ? inv.currentPrice : inv.buyPrice;
    const invested = roundTo2dp(inv.quantity * inv.buyPrice);
    const currentValue = roundTo2dp(inv.quantity * price);
    totalInvested += invested;
    totalCurrent += currentValue;
    return {
      name: inv.name,
      type: inv.type,
      invested,
      currentValue,
      pnl: roundTo2dp(currentValue - invested),
    };
  });
  totalInvested = roundTo2dp(totalInvested);
  totalCurrent = roundTo2dp(totalCurrent);

  const totalAssets = roundTo2dp(sumAssetValues(assets));
  const totalLiabilities = roundTo2dp(sumLiabilityAmounts(liabilities));
  const netWorth = roundTo2dp(totalAssets - totalLiabilities);

  return {
    income,
    expenses,
    savings,
    savingsRate,
    totalAssets,
    totalLiabilities,
    netWorth,
    budgets: budgetSummaries,
    topCategories,
    goals: goalSummaries,
    bills: billSummaries,
    investments: {
      totalInvested,
      totalCurrent,
      pnl: roundTo2dp(totalCurrent - totalInvested),
      holdings,
    },
    recentTransactions,
  };
}

/**
 * Decide which snapshot sections to include based on keywords in the user's
 * message — so the model only sees data relevant to the question (cheaper,
 * tighter answers). Order matters: a "summary" intent wins over everything.
 *
 * @param {string} message
 * @returns {{ full?: boolean, monthly?: boolean, netWorth?: boolean,
 *   budgets?: boolean, topCategories?: boolean, transactions?: boolean,
 *   goals?: boolean, bills?: boolean, investments?: boolean }}
 */
function detectQuestionScope(message) {
  const m = String(message || '').toLowerCase();
  const has = (...words) => words.some((w) => m.includes(w));

  if (has('summary', 'overall', 'health', 'everything')) {
    return {
      full: true,
      monthly: true,
      netWorth: true,
      budgets: true,
      topCategories: true,
      transactions: true,
      goals: true,
      bills: true,
      investments: true,
    };
  }
  if (has('spend', 'budget', 'overspend', 'category')) {
    return { budgets: true, topCategories: true, transactions: true };
  }
  if (has('goal', 'saving', 'target')) {
    return { goals: true, monthly: true };
  }
  if (has('bill', 'due', 'pay', 'subscription')) {
    return { bills: true };
  }
  if (has('invest', 'portfolio', 'stock', 'crypto', 'fund')) {
    return { investments: true };
  }
  if (has('worth', 'asset', 'liabilit', 'debt', 'loan')) {
    return { netWorth: true };
  }
  // Default: a light overview — net worth + this-month money + top spend.
  return { monthly: true, netWorth: true, topCategories: true };
}

/**
 * Render the Nuvault advisor system prompt: the behavioral rules followed by
 * a human-readable USER FINANCIAL SNAPSHOT built from real numbers. Only the
 * sections relevant to the question (per {@link detectQuestionScope}) are
 * included.
 */
function buildSystemPrompt(snapshot, req, userMessage = '') {
  const scope = detectQuestionScope(userMessage);
  const firstName = firstNameOf(req);
  const currency = currencyOf(req);
  const money = (n) =>
    `${currency} ${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

  const monthName = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const lines = [];
  lines.push(
    `You are Nuvault, ${firstName}'s personal finance assistant. You have ` +
      `${firstName}'s real financial data in the snapshot below. Answer like a ` +
      `helpful friend, not a report.`,
  );
  lines.push('');
  lines.push('STRICT RESPONSE RULES:');
  lines.push('- Maximum 60 words for any normal answer.');
  lines.push('- Plain text only. Never use markdown bold (**), headers (##), bullets, or dashes for lists.');
  lines.push('- Never start with a greeting. Never say Hi, Hello, or the user\'s name at the start. Get straight to the answer.');
  lines.push('- Use the real numbers from the snapshot. Never invent figures.');
  lines.push('- Answer only the specific question asked. Include only numbers directly relevant to it.');
  lines.push('- Never repeat the same number twice in one response.');
  lines.push('- Never say "based on your data" or "as per your records" — just answer directly.');
  lines.push('- Use the user\'s name at most once per conversation, never as a greeting.');
  lines.push('- If the snapshot lacks the data to answer, say "I don\'t have enough data on that yet".');
  lines.push(`- All amounts are in ${currency}.`);
  lines.push(
    '- For investment or other major decisions, add one line: "Not registered financial ' +
      'advice — consult an advisor." Only when genuinely relevant, not on every reply.',
  );
  lines.push('');
  lines.push('RESPONSE SHAPE (follow exactly):');
  lines.push('[Direct answer in 1-3 sentences using real numbers]');
  lines.push('→ Tip: [one specific action, max 15 words]');
  lines.push('');
  lines.push(
    'Exception: if the user explicitly asks for a full/overall summary, you may use up ' +
      'to 120 words covering income, expenses, net worth, top goal progress, and one ' +
      'recommendation — still plain text, still ending with one → Tip line.',
  );
  if (scope.investments) {
    lines.push('');
    lines.push('When asked for an investment plan or allocation:');
    lines.push('- Never recommend the user\'s existing specific holdings by name.');
    lines.push('- Give a category-level allocation (Index Funds, Mid Cap, Debt/Emergency, Goals), not specific stock/crypto names.');
    lines.push('- Show a percentage split and rupee amount for each category.');
    lines.push('- Include a multi-year projection using 12% assumed returns.');
    lines.push('- Always add: "Not registered financial advice — consult an advisor."');
  }

  lines.push('');
  lines.push(SNAPSHOT_HEADER);
  lines.push(`Name: ${firstName}`);
  lines.push(`Currency: ${currency}`);
  lines.push('');

  // This month
  if (scope.monthly) {
    lines.push(`This month (${monthName}):`);
    lines.push(`  Income: ${money(snapshot.income)}`);
    lines.push(`  Expenses: ${money(snapshot.expenses)}`);
    lines.push(`  Savings: ${money(snapshot.savings)} (savings rate ${snapshot.savingsRate}%)`);
    lines.push('');
  }

  // Net worth
  if (scope.netWorth) {
    lines.push('Net worth:');
    lines.push(`  Assets: ${money(snapshot.totalAssets)}`);
    lines.push(`  Liabilities: ${money(snapshot.totalLiabilities)}`);
    lines.push(`  Net worth: ${money(snapshot.netWorth)}`);
    lines.push('');
  }

  // Top spending categories
  if (scope.topCategories) {
    lines.push('Top spending categories this month:');
    if (snapshot.topCategories.length === 0) {
      lines.push('  (no expenses recorded this month)');
    } else {
      for (const c of snapshot.topCategories) {
        lines.push(`  ${c.category}: ${money(c.amount)}`);
      }
    }
    lines.push('');
  }

  // Budgets
  if (scope.budgets) {
    lines.push('Budgets this month:');
    if (snapshot.budgets.length === 0) {
      lines.push('  (no budgets set)');
    } else {
      for (const b of snapshot.budgets) {
        const status = b.over ? `OVER by ${money(Math.abs(b.remaining))}` : `${money(b.remaining)} left`;
        lines.push(
          `  ${b.category}: spent ${money(b.spent)} of ${money(b.limit)} ` +
            `(${b.pctUsed}% used, ${status})`,
        );
      }
    }
    lines.push('');
  }

  // Goals
  if (scope.goals) {
    lines.push('Goals:');
    if (snapshot.goals.length === 0) {
      lines.push('  (no goals set)');
    } else {
      for (const g of snapshot.goals) {
        let line = `  ${g.name}: ${money(g.saved)} of ${money(g.target)} (${g.pct}%)`;
        if (g.monthsRemaining !== null) {
          line += `, ~${g.monthsRemaining} month(s) to target date`;
        }
        lines.push(line);
      }
    }
    lines.push('');
  }

  // Bills
  if (scope.bills) {
    lines.push('Upcoming bills:');
    if (snapshot.bills.length === 0) {
      lines.push('  (no bills tracked)');
    } else {
      for (const b of snapshot.bills) {
        const when =
          b.daysUntilDue < 0
            ? `overdue by ${Math.abs(b.daysUntilDue)} day(s)`
            : `due in ${b.daysUntilDue} day(s)`;
        const paid = b.paid ? ', paid' : '';
        lines.push(`  ${b.name}: ${money(b.amount)} (${when}${paid})`);
      }
    }
    lines.push('');
  }

  // Investments
  if (scope.investments) {
    const inv = snapshot.investments;
    lines.push('Investments:');
    if (inv.holdings.length === 0) {
      lines.push('  (no investments tracked)');
    } else {
      lines.push(
        `  Total invested: ${money(inv.totalInvested)}, current value: ` +
          `${money(inv.totalCurrent)}, P&L: ${money(inv.pnl)}`,
      );
      for (const h of inv.holdings) {
        lines.push(
          `  ${h.name} (${h.type}): invested ${money(h.invested)}, ` +
            `now ${money(h.currentValue)}, P&L ${money(h.pnl)}`,
        );
      }
    }
    lines.push('');
  }

  // Recent transactions — full summary gets the lot, spend queries get 20.
  if (scope.transactions) {
    const limit = scope.full ? snapshot.recentTransactions.length : 20;
    const txns = snapshot.recentTransactions.slice(0, limit);
    lines.push(`Last ${txns.length} transactions (most recent first):`);
    if (txns.length === 0) {
      lines.push('  (no transactions recorded)');
    } else {
      for (const t of txns) {
        const d = t.date ? new Date(t.date).toISOString().slice(0, 10) : 'n/a';
        const sign = t.type === 'income' ? '+' : '-';
        lines.push(`  ${d} ${t.category}: ${sign}${money(t.amount)}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Build the Gemini `contents` array from prior turns + the new user message.
 * Gemini requires the sequence to begin with a `user` turn, so any leading
 * `model` turns are trimmed defensively.
 */
function buildContents(historyTurns, userMessage) {
  const turns = Array.isArray(historyTurns) ? historyTurns.slice(-HISTORY_CONTEXT_LIMIT) : [];
  while (turns.length > 0 && turns[0].role !== 'user') {
    turns.shift();
  }
  const contents = turns.map((t) => ({ role: t.role, parts: [{ text: t.message }] }));
  contents.push({ role: 'user', parts: [{ text: userMessage }] });
  return contents;
}

/**
 * Sleep helper for inter-retry backoff.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Call Gemini once for a specific model.
 *
 * Returns one of:
 *   { ok: true, reply }            success
 *   { ok: false, retryable: true } transient (503 overload, 429 rate-limit,
 *                                  network/timeout) — caller may retry
 *   { ok: false, retryable: false } permanent (4xx other than 429, malformed
 *                                   response, missing key) — do not retry
 *
 * On every failure path, logs the underlying Gemini error to the server
 * console (status + message) so 503s are debuggable from pm2 logs without
 * ever exposing the API key (the URL containing the key is never logged).
 */
async function callGemini(apiKey, systemPrompt, contents, model = GEMINI_MODELS[0]) {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
    // eslint-disable-next-line no-console
    console.error('[ai] Gemini call skipped: GEMINI_API_KEY missing or empty.');
    return { ok: false, retryable: false };
  }

  const endpoint = `${GEMINI_BASE_URL}/${model}:generateContent`;
  const url = `${endpoint}?key=${apiKey}`;
  const requestBody = {
    system_instruction: {
      parts: [{ text: systemPrompt }],
    },
    contents,
  };

  let response;
  try {
    response = await axios.post(url, requestBody, {
      timeout: GEMINI_API_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const status = err && err.response && err.response.status;
    const data = err && err.response && err.response.data;
    const apiMessage =
      (data && data.error && data.error.message) ||
      (typeof data === 'string' ? data : undefined);
    // eslint-disable-next-line no-console
    console.error(
      '[ai] Gemini call failed:',
      'model=', model,
      'status=', status || 'n/a',
      'code=', err && err.code,
      'message=', apiMessage || (err && err.message) || 'unknown',
      'endpoint=', endpoint,
    );
    // Classify the failure so the dispatcher knows what to do:
    //   - 503 / network / timeout  → transient overload of THIS model.
    //                                Retry same model with backoff.
    //   - 429 (rate-limit / quota) → don't retry this model in the same
    //                                window (it just deepens the hole), but
    //                                DO try the fallback model since each
    //                                model has its own quota allocation.
    //   - other 4xx                → permanent. Stop entirely.
    let kind;
    if (status === 503 || status === undefined) kind = 'transient';
    else if (status === 429) kind = 'quota';
    else kind = 'permanent';
    return { ok: false, kind, status, apiMessage };
  }

  try {
    const text = response.data.candidates[0].content.parts[0].text;
    if (typeof text === 'string' && text.trim().length > 0) {
      return { ok: true, reply: text.trim() };
    }
    // eslint-disable-next-line no-console
    console.error(
      '[ai] Gemini returned an empty/blocked candidate. finishReason=',
      response.data && response.data.candidates && response.data.candidates[0] &&
        response.data.candidates[0].finishReason,
      'promptFeedback=', JSON.stringify(response.data && response.data.promptFeedback),
    );
    return { ok: false, kind: 'permanent' };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      '[ai] Gemini response had unexpected shape:',
      err && err.message,
      'keys=', response && response.data && Object.keys(response.data),
    );
    return { ok: false, kind: 'permanent' };
  }
}

/**
 * Try every configured key × model combination:
 *
 *   for each key (skipping any in a current blackout window):
 *     for each model:
 *       - 'transient' (503 / network / timeout) → retry same model with
 *         linear backoff, then fall through to the next model.
 *       - 'quota' (429)                          → don't retry the same
 *         model in the same window, but try the next model on the same
 *         key first — each Gemini model has its own quota counter, so
 *         the fallback model may still be usable on the same key.
 *       - 'permanent' (other 4xx, malformed)     → stop entirely.
 *     if every model returned 'quota' for this key → blackout the key
 *     for {@link KEY_BLACKOUT_MS} and move to the next key.
 *
 * Returns the same shape as the single-call helper, plus the last
 * observed `kind` so the caller can surface a quota-specific message
 * when every key is rate-limited.
 */
async function callGeminiWithFallback(apiKey, systemPrompt, contents) {
  // Backwards-compatible signature: a single key string is treated as a
  // length-1 list. Callers using {@link resolveApiKeys} pass an array.
  const keys = Array.isArray(apiKey)
    ? apiKey
    : (typeof apiKey === 'string' && apiKey.trim() !== '' ? [apiKey] : []);

  if (keys.length === 0) {
    // Match callGemini's behavior — log once and bail.
    return callGemini(null, systemPrompt, contents, GEMINI_MODELS[0]);
  }

  let lastResult = { ok: false, kind: 'permanent' };
  for (const key of keys) {
    if (isKeyBlackedOut(key)) {
      // eslint-disable-next-line no-console
      console.error('[ai] Skipping blacked-out key (quota window not yet reset).');
      lastResult = { ok: false, kind: 'quota' };
      continue;
    }

    let allModelsQuota = true;

    for (const model of GEMINI_MODELS) {
      let result;
      for (let attempt = 0; attempt <= GEMINI_OVERLOAD_RETRIES; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        result = await callGemini(key, systemPrompt, contents, model);
        if (result.ok) return result;
        if (result.kind !== 'transient') break;
        if (attempt < GEMINI_OVERLOAD_RETRIES) {
          // eslint-disable-next-line no-await-in-loop
          await delay(GEMINI_RETRY_DELAY_MS * (attempt + 1));
        }
      }

      lastResult = result;

      if (result.kind === 'permanent') {
        return result; // hard error — no point trying anything else
      }
      if (result.kind !== 'quota') {
        allModelsQuota = false; // transient exhausted — fall through anyway
      }
      // Continue to the next model: maybe the fallback model has quota left.
    }

    if (allModelsQuota) {
      // Every model on this key returned 429 — the key really is out.
      blackoutKey(key);
    }
    // Try the next key.
  }
  return lastResult;
}

// ── Investment-plan / allocation chart builders ─────────────────────────────

/** Allocation chart colors (kept in sync with the frontend). */
const CHART_COLORS = ['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444'];

/** Fixed suggested split for an investment plan (percentages). */
const PLAN_ALLOCATION = [
  { name: 'Index Fund', pct: 40, sip: true },
  { name: 'Mid Cap Fund', pct: 25, sip: true },
  { name: 'Emergency Fund', pct: 20, sip: false },
  { name: 'Goal Savings', pct: 15, sip: false },
];

/** Assumed annual return used for the SIP projection (illustrative only). */
const ASSUMED_ANNUAL_RETURN = 0.12;

/** Format a number as a currency amount (₹ for INR, else "<CODE> <n>"). */
function formatAmount(currency, n) {
  const num = Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  return currency === 'INR' ? `₹${num}` : `${currency} ${num}`;
}

/**
 * Pull a monthly rupee amount out of a free-text message, e.g.
 * "₹10,000/month" → 10000, "5,000" → 5000, "5k" → 5000. Returns null when
 * no plausible amount is present.
 *
 * @param {string} message
 * @returns {number | null}
 */
function parseMonthlyAmount(message) {
  const m = String(message || '');
  const match = m.match(/(?:₹|rs\.?|inr)?\s*(\d[\d,]*)\s*(k)?/i);
  if (!match) return null;
  let n = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (match[2]) n *= 1000; // "5k"
  return n;
}

/**
 * Decide whether an investment-scope question should produce charts, and
 * which kind. Returns null for a plain text answer.
 *
 * @param {string} message
 * @param {{ investments?: boolean }} scope
 * @returns {{ kind: 'plan', monthly: number | null } | { kind: 'currentAllocation' } | null}
 */
function detectChartIntent(message, scope) {
  if (!scope || !scope.investments) return null;
  const m = String(message || '').toLowerCase();
  const amount = parseMonthlyAmount(message);
  const wantsPlan =
    /\bplan\b/.test(m) ||
    /how should i invest|where should i put|invest plan/.test(m) ||
    (amount !== null && /invest|sip|month/.test(m));

  if (wantsPlan) {
    return { kind: 'plan', monthly: amount };
  }
  if (/allocat|split|breakdown|holding/.test(m)) {
    return { kind: 'currentAllocation' };
  }
  return null;
}

/** Future value of a monthly SIP after `months`, at ASSUMED_ANNUAL_RETURN. */
function sipFutureValue(monthlyContribution, months) {
  const r = ASSUMED_ANNUAL_RETURN / 12;
  const fv = monthlyContribution * ((Math.pow(1 + r, months) - 1) / r) * (1 + r);
  return Math.round(fv);
}

/**
 * Build a deterministic investment-plan response (text + pie + line charts)
 * for a monthly amount. Uses category-level allocation only — never the
 * user's specific holdings.
 *
 * @param {number | null} monthly
 * @param {ReturnType<typeof buildSnapshot> extends Promise<infer S> ? S : any} snapshot
 * @param {string} currency
 * @returns {{ text: string, charts: object[] }}
 */
function buildInvestmentPlan(monthly, snapshot, currency) {
  const M = monthly && monthly > 0 ? monthly : 5000;

  // Use the user's first not-yet-complete goal for the "Goal Savings" label.
  const activeGoal =
    (snapshot.goals || []).find((g) => (g.pct || 0) < 100) || (snapshot.goals || [])[0];
  const fixedNames = new Set(PLAN_ALLOCATION.map((a) => a.name.toLowerCase()));
  const goalLabel =
    activeGoal && activeGoal.name && !fixedNames.has(activeGoal.name.toLowerCase())
      ? activeGoal.name
      : 'Goal Savings';

  const alloc = PLAN_ALLOCATION.map((a) => ({
    ...a,
    label: a.name === 'Goal Savings' ? goalLabel : a.name,
    amount: Math.round((M * a.pct) / 100),
  }));

  const pieData = alloc.map((a) => ({ name: a.label, value: a.pct, amount: a.amount }));

  // Project only the market-investing portion (Index + Mid Cap = 65%).
  const investingMonthly = alloc
    .filter((a) => a.sip)
    .reduce((sum, a) => sum + a.amount, 0);
  const lineData = [
    { year: 'Year 1', amount: sipFutureValue(investingMonthly, 12) },
    { year: 'Year 3', amount: sipFutureValue(investingMonthly, 36) },
    { year: 'Year 5', amount: sipFutureValue(investingMonthly, 60) },
    { year: 'Year 10', amount: sipFutureValue(investingMonthly, 120) },
  ];

  const pad = (label) => label.padEnd(22, ' ');
  const lines = [];
  lines.push(`Here is a suggested split for ${formatAmount(currency, M)}/month:`);
  for (const a of alloc) {
    lines.push(`${pad(a.label + (a.sip ? ' (SIP)' : ''))}${formatAmount(currency, a.amount)}  ${a.pct}%`);
  }
  lines.push('');
  lines.push('Projected growth (12% assumed, not guaranteed):');
  for (const p of lineData) {
    lines.push(`${p.year.padEnd(8, ' ')}→ ${formatAmount(currency, p.amount)}`);
  }
  lines.push('');
  lines.push('Not registered financial advice — consult an advisor.');
  lines.push('→ Tip: Automate these SIPs on salary day so investing happens before spending.');

  return {
    text: lines.join('\n'),
    charts: [
      { chartType: 'pie', title: 'Suggested Monthly Allocation', data: pieData },
      { chartType: 'line', title: 'Projected Growth Over 10 Years', data: lineData },
    ],
  };
}

/**
 * Build a current-holdings allocation response (text + pie). Returns null
 * when the user has no investments (caller then falls back to a text answer).
 *
 * @param {object} snapshot
 * @param {string} currency
 * @returns {{ text: string, charts: object[] } | null}
 */
function buildCurrentAllocation(snapshot, currency) {
  const holdings = (snapshot.investments && snapshot.investments.holdings) || [];
  if (holdings.length === 0) return null;

  const total = holdings.reduce((sum, h) => sum + (h.currentValue || 0), 0);
  if (total <= 0) return null;

  const pieData = holdings
    .map((h) => ({
      name: h.name,
      value: roundTo2dp((h.currentValue / total) * 100),
      amount: roundTo2dp(h.currentValue),
    }))
    .sort((a, b) => b.amount - a.amount);

  const top = pieData[0];
  const lines = [];
  lines.push(
    `Your portfolio is worth ${formatAmount(currency, total)} across ${holdings.length} holding${holdings.length === 1 ? '' : 's'}.`,
  );
  lines.push(`${top.name} is the largest at ${top.value}%.`);
  lines.push('→ Tip: Keep any single holding under 40% to stay diversified.');

  return {
    text: lines.join('\n'),
    charts: [{ chartType: 'pie', title: 'Current Portfolio Allocation', data: pieData }],
  };
}

// ── Route handlers ──────────────────────────────────────────────────────────

async function chatHandler(req, res, next) {
  try {
    if (rejectIfValidationErrors(req, res)) return;

    const userMessage = typeof req.body.message === 'string' ? req.body.message.trim() : '';

    const [snapshot, priorTurns] = await Promise.all([
      buildSnapshot(req),
      scopedFind(ChatHistory, req).sort({ timestamp: 1 }).lean(),
    ]);

    // Chart responses (investment plan / current allocation) are built
    // deterministically server-side — guaranteed-correct numbers and valid
    // charts, no Gemini dependency or quota cost.
    const scope = detectQuestionScope(userMessage);
    const chartIntent = detectChartIntent(userMessage, scope);
    if (chartIntent) {
      const currency = currencyOf(req);
      const built =
        chartIntent.kind === 'plan'
          ? buildInvestmentPlan(chartIntent.monthly, snapshot, currency)
          : buildCurrentAllocation(snapshot, currency);

      if (built) {
        await ChatHistory.create({ user: req.user._id, role: 'user', message: userMessage });
        await ChatHistory.create({ user: req.user._id, role: 'model', message: built.text });
        res.status(200).json({
          type: 'chart_response',
          reply: built.text,
          charts: built.charts,
        });
        return;
      }
      // No holdings to chart → fall through to the normal text answer.
    }

    const systemPrompt = buildSystemPrompt(snapshot, req, userMessage);
    const contents = buildContents(priorTurns, userMessage);

    const apiKeys = resolveApiKeys(req);
    const result = await callGeminiWithFallback(apiKeys, systemPrompt, contents);

    if (result && result.ok === true) {
      // Persist both turns only on success.
      await ChatHistory.create({ user: req.user._id, role: 'user', message: userMessage });
      await ChatHistory.create({ user: req.user._id, role: 'model', message: result.reply });

      res.status(200).json({ reply: result.reply });
      return;
    }

    // Quota exhaustion gets a clearer message so the user can act on it
    // (wait a minute, or upgrade) rather than seeing a generic outage.
    const isQuota = result && result.kind === 'quota';
    const err = new Error(isQuota ? QUOTA_EXCEEDED_MESSAGE : SERVICE_UNAVAILABLE_MESSAGE);
    err.statusCode = 503;
    next(err);
  } catch (err) {
    next(err);
  }
}

/** GET /history — most recent turns, returned in chronological order. */
async function getHistory(req, res, next) {
  try {
    const docs = await scopedFind(ChatHistory, req)
      .sort({ timestamp: -1 })
      .limit(HISTORY_FETCH_LIMIT)
      .lean();

    const history = docs
      .reverse()
      .map((d) => ({ role: d.role, message: d.message, timestamp: d.timestamp }));

    res.status(200).json({ history });
  } catch (err) {
    next(err);
  }
}

/** DELETE /history — permanently clear the user's conversation. */
async function clearHistory(req, res, next) {
  try {
    await ChatHistory.deleteMany({ user: req.user._id });
    res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  chat: chatHandler,
  chatValidators,
  getHistory,
  clearHistory,

  // Internals exported for tests
  buildSnapshot,
  buildSystemPrompt,
  detectQuestionScope,
  detectChartIntent,
  parseMonthlyAmount,
  buildInvestmentPlan,
  buildCurrentAllocation,
  buildContents,
  resolveApiKey,
  resolveApiKeys,
  _resetKeyBlackouts,
  sumAssetValues,
  sumLiabilityAmounts,
  callGemini,
  callGeminiWithFallback,
  firstNameOf,
  currencyOf,

  // Constants
  MAX_MESSAGE_LENGTH,
  RECENT_TRANSACTIONS_LIMIT,
  HISTORY_FETCH_LIMIT,
  HISTORY_CONTEXT_LIMIT,
  SERVICE_UNAVAILABLE_MESSAGE,
  QUOTA_EXCEEDED_MESSAGE,
  SNAPSHOT_HEADER,
  GEMINI_ENDPOINT,
  GEMINI_BASE_URL,
  GEMINI_MODELS,
  GEMINI_OVERLOAD_RETRIES,
  GEMINI_RETRY_DELAY_MS,
  KEY_BLACKOUT_MS,
};
