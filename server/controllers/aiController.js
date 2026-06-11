'use strict';

/**
 * AI_Advisor_Service controller (Task 17.1 — updated to Gemini 1.5 Flash).
 *
 * Implements the `POST /api/ai/chat` endpoint:
 *
 *   1. Validate the incoming `message` (1–4000 chars, non-whitespace only,
 *      after trimming) — R18.4, R18.5.
 *   2. Assemble a strictly user-scoped financial snapshot:
 *        assets, liabilities, 50 most recent transactions (date desc),
 *        goals, bills, and a computed net worth (stored-currency sums,
 *        no ExchangeRate dependency) — R18.1, R18.2, R18.7.
 *   3. Send the snapshot as a Gemini `system_instruction` together with
 *      the user's message (≤ 30s timeout) — R18.3.
 *   4. Respond `200 { reply }` on success.
 *   5. On Gemini failure / timeout / bad response, route a generic 503
 *      through the uniform error handler. The API key is NEVER included
 *      in any response, error message, or log — R18.6.
 *   6. The conversation is never persisted — R18.7.
 *
 * Gemini endpoint:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/
 *        gemini-1.5-flash:generateContent?key=<GEMINI_API_KEY>
 *
 * Request body shape:
 *   {
 *     system_instruction: { parts: [{ text: <systemPrompt> }] },
 *     contents: [
 *       ...chatHistory,
 *       { role: 'user', parts: [{ text: <message> }] }
 *     ]
 *   }
 *
 * Reply is read from:
 *   response.data.candidates[0].content.parts[0].text
 */

const axios = require('axios');
const { body, validationResult } = require('express-validator');

const Asset = require('../models/Asset');
const Liability = require('../models/Liability');
const Transaction = require('../models/Transaction');
const Goal = require('../models/Goal');
const Bill = require('../models/Bill');
const { scopedFind } = require('../utils/ownership');
const { roundTo2dp } = require('../utils/currency');

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_MESSAGE_LENGTH = 4000;
const RECENT_TRANSACTIONS_LIMIT = 50;
const SERVICE_UNAVAILABLE_MESSAGE = 'AI service unavailable';
const GEMINI_API_TIMEOUT_MS = 30_000;
const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const SNAPSHOT_PREAMBLE =
  "User's financial snapshot (read-only). Do not invent data outside this snapshot:";

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

async function buildSnapshot(req) {
  const [assets, liabilities, recentTransactions, goals, bills] = await Promise.all([
    scopedFind(Asset, req).lean(),
    scopedFind(Liability, req).lean(),
    scopedFind(Transaction, req).sort({ date: -1 }).limit(RECENT_TRANSACTIONS_LIMIT).lean(),
    scopedFind(Goal, req).lean(),
    scopedFind(Bill, req).lean(),
  ]);

  const netWorth = roundTo2dp(sumAssetValues(assets) - sumLiabilityAmounts(liabilities));

  return { assets, liabilities, recentTransactions, goals, bills, netWorth };
}

/**
 * Call Gemini 1.5 Flash and return { ok: true, reply } or { ok: false }.
 * Never throws for an "unavailable" condition; never echoes the API key.
 */
async function callGemini(apiKey, systemPrompt, userMessage) {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
    return { ok: false };
  }

  const url = `${GEMINI_ENDPOINT}?key=${apiKey}`;
  const body = {
    system_instruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      { role: 'user', parts: [{ text: userMessage }] },
    ],
  };

  let response;
  try {
    response = await axios.post(url, body, {
      timeout: GEMINI_API_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (_err) {
    // Network error, timeout, non-2xx — all collapse to unavailable.
    return { ok: false };
  }

  try {
    const text = response.data.candidates[0].content.parts[0].text;
    if (typeof text === 'string' && text.trim().length > 0) {
      return { ok: true, reply: text.trim() };
    }
    return { ok: false };
  } catch (_err) {
    return { ok: false };
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

async function chatHandler(req, res, next) {
  try {
    if (rejectIfValidationErrors(req, res)) return;

    const userMessage =
      typeof req.body.message === 'string' ? req.body.message.trim() : '';

    const snapshot = await buildSnapshot(req);
    const systemPrompt = `${SNAPSHOT_PREAMBLE}\n${JSON.stringify(snapshot)}`;

    const apiKey = resolveApiKey(req);
    const result = await callGemini(apiKey, systemPrompt, userMessage);

    if (result && result.ok === true) {
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

module.exports = {
  chat: chatHandler,
  chatValidators,

  // Internals exported for tests
  buildSnapshot,
  resolveApiKey,
  sumAssetValues,
  sumLiabilityAmounts,
  callGemini,

  // Constants
  MAX_MESSAGE_LENGTH,
  RECENT_TRANSACTIONS_LIMIT,
  SERVICE_UNAVAILABLE_MESSAGE,
  SNAPSHOT_PREAMBLE,
  GEMINI_ENDPOINT,
};
