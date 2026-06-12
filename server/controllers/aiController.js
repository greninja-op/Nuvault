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
const GEMINI_API_TIMEOUT_MS = 30_000;
const GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models';
// Kept for backwards compatibility with existing tests; resolves the
// canonical endpoint URL for the primary model.
const GEMINI_ENDPOINT = `${GEMINI_BASE_URL}/${'gemini-2.5-flash'}:generateContent`;

const SNAPSHOT_HEADER = 'USER FINANCIAL SNAPSHOT:';
const MS_PER_DAY = 86_400_000;

/**
 * Models tried in order. The first is the preferred (richest) model.
 * Subsequent entries act as fallbacks when the primary returns 503
 * ("model overloaded") even after retries — a common condition on the
 * Gemini free tier. Both 2.5-flash and 2.0-flash are confirmed available
 * to the project's API key (see `models?key=...` listing).
 */
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];

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
 * Read GEMINI_API_KEY. Lookup order:
 *   1. req.app.get('config').geminiApiKey  (injected by tests)
 *   2. process.env.GEMINI_API_KEY
 * Returns null when absent; the 503 path activates automatically.
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
 * Render the Nuvault advisor system prompt: the behavioral rules followed by
 * a human-readable USER FINANCIAL SNAPSHOT built from real numbers.
 */
function buildSystemPrompt(snapshot, req) {
  const firstName = firstNameOf(req);
  const currency = currencyOf(req);
  const money = (n) =>
    `${currency} ${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

  const monthName = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const lines = [];
  lines.push(
    `You are Nuvault, a personal AI financial advisor for ${firstName}. ` +
      `You have direct access to ${firstName}'s real financial data, shown in the ` +
      `snapshot below.`,
  );
  lines.push('');
  lines.push('Follow these rules in every reply:');
  lines.push(`- Always use the real numbers from the snapshot. Never invent or guess figures.`);
  lines.push(`- Address the user by their first name (${firstName}).`);
  lines.push(
    `- Keep replies under 150 words unless the user explicitly asks for a full summary.`,
  );
  lines.push(`- End every reply with one specific, actionable tip.`);
  lines.push(`- Never recommend specific stocks, mutual funds, or crypto coins to buy or sell.`);
  lines.push(
    `- For major financial decisions, tell the user to consult a qualified financial advisor.`,
  );
  lines.push(
    `- If the snapshot does not contain the data needed to answer, say ` +
      `"I don't have enough data on that yet" rather than guessing.`,
  );
  lines.push(`- All amounts are in ${currency}.`);
  lines.push('');
  lines.push(SNAPSHOT_HEADER);
  lines.push(`Name: ${firstName}`);
  lines.push(`Currency: ${currency}`);
  lines.push('');

  // This month
  lines.push(`This month (${monthName}):`);
  lines.push(`  Income: ${money(snapshot.income)}`);
  lines.push(`  Expenses: ${money(snapshot.expenses)}`);
  lines.push(`  Savings: ${money(snapshot.savings)} (savings rate ${snapshot.savingsRate}%)`);
  lines.push('');

  // Net worth
  lines.push('Net worth:');
  lines.push(`  Assets: ${money(snapshot.totalAssets)}`);
  lines.push(`  Liabilities: ${money(snapshot.totalLiabilities)}`);
  lines.push(`  Net worth: ${money(snapshot.netWorth)}`);
  lines.push('');

  // Top spending categories
  lines.push('Top spending categories this month:');
  if (snapshot.topCategories.length === 0) {
    lines.push('  (no expenses recorded this month)');
  } else {
    for (const c of snapshot.topCategories) {
      lines.push(`  - ${c.category}: ${money(c.amount)}`);
    }
  }
  lines.push('');

  // Budgets
  lines.push('Budgets this month:');
  if (snapshot.budgets.length === 0) {
    lines.push('  (no budgets set)');
  } else {
    for (const b of snapshot.budgets) {
      const status = b.over ? `OVER by ${money(Math.abs(b.remaining))}` : `${money(b.remaining)} left`;
      lines.push(
        `  - ${b.category}: spent ${money(b.spent)} of ${money(b.limit)} ` +
          `(${b.pctUsed}% used, ${status})`,
      );
    }
  }
  lines.push('');

  // Goals
  lines.push('Goals:');
  if (snapshot.goals.length === 0) {
    lines.push('  (no goals set)');
  } else {
    for (const g of snapshot.goals) {
      let line = `  - ${g.name}: ${money(g.saved)} of ${money(g.target)} (${g.pct}%)`;
      if (g.monthsRemaining !== null) {
        line += `, ~${g.monthsRemaining} month(s) to target date`;
      }
      lines.push(line);
    }
  }
  lines.push('');

  // Bills
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
      lines.push(`  - ${b.name}: ${money(b.amount)} (${when}${paid})`);
    }
  }
  lines.push('');

  // Investments
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
        `  - ${h.name} (${h.type}): invested ${money(h.invested)}, ` +
          `now ${money(h.currentValue)}, P&L ${money(h.pnl)}`,
      );
    }
  }
  lines.push('');

  // Recent transactions
  lines.push(`Last ${snapshot.recentTransactions.length} transactions (most recent first):`);
  if (snapshot.recentTransactions.length === 0) {
    lines.push('  (no transactions recorded)');
  } else {
    for (const t of snapshot.recentTransactions) {
      const d = t.date ? new Date(t.date).toISOString().slice(0, 10) : 'n/a';
      const sign = t.type === 'income' ? '+' : '-';
      lines.push(`  - ${d} ${t.category}: ${sign}${money(t.amount)}`);
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
    // 503 (overloaded), 429 (rate-limit), network/timeouts → retryable.
    const retryable =
      status === 503 ||
      status === 429 ||
      status === undefined; // network error / timeout
    return { ok: false, retryable };
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
    return { ok: false, retryable: false };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      '[ai] Gemini response had unexpected shape:',
      err && err.message,
      'keys=', response && response.data && Object.keys(response.data),
    );
    return { ok: false, retryable: false };
  }
}

/**
 * Try every configured model in order, with a small linear-backoff retry
 * on transient 503/429/network errors per model. This hides the Gemini
 * free-tier's frequent "model is overloaded" 503s from end users — the
 * primary model usually clears within 1-2s, and if it doesn't, the
 * lighter fallback model takes over.
 *
 * Returns { ok, reply } in the same shape as the single-call helper so
 * the rest of the controller stays unchanged.
 */
async function callGeminiWithFallback(apiKey, systemPrompt, contents) {
  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt <= GEMINI_OVERLOAD_RETRIES; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      const result = await callGemini(apiKey, systemPrompt, contents, model);
      if (result.ok) return result;
      if (!result.retryable) return result; // permanent — don't try fallback
      if (attempt < GEMINI_OVERLOAD_RETRIES) {
        // eslint-disable-next-line no-await-in-loop
        await delay(GEMINI_RETRY_DELAY_MS * (attempt + 1));
      }
    }
    // Primary exhausted retries → fall through to next model.
  }
  return { ok: false };
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

    const systemPrompt = buildSystemPrompt(snapshot, req);
    const contents = buildContents(priorTurns, userMessage);

    const apiKey = resolveApiKey(req);
    const result = await callGeminiWithFallback(apiKey, systemPrompt, contents);

    if (result && result.ok === true) {
      // Persist both turns only on success.
      await ChatHistory.create({ user: req.user._id, role: 'user', message: userMessage });
      await ChatHistory.create({ user: req.user._id, role: 'model', message: result.reply });

      res.status(200).json({ reply: result.reply });
      return;
    }

    const err = new Error(SERVICE_UNAVAILABLE_MESSAGE);
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
  buildContents,
  resolveApiKey,
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
  SNAPSHOT_HEADER,
  GEMINI_ENDPOINT,
  GEMINI_BASE_URL,
  GEMINI_MODELS,
  GEMINI_OVERLOAD_RETRIES,
  GEMINI_RETRY_DELAY_MS,
};
