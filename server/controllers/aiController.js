'use strict';

/**
 * AI_Advisor_Service controller (Task 17.1).
 *
 * Implements the `POST /api/ai/chat` endpoint described in the design's
 * "AI_Advisor_Service" section and Requirement 18:
 *
 *   1. Validate the incoming `message` (1–4000 chars, non-whitespace
 *      only, after trimming) — R18.4, R18.5.
 *   2. Assemble a strictly user-scoped financial snapshot composed of:
 *        - the user's assets,
 *        - the user's liabilities,
 *        - the 50 most recent transactions in `date` desc order,
 *        - the user's goals,
 *        - the user's bills,
 *        - a computed snapshot net worth (assets minus liabilities,
 *          summed in their stored currency without conversion),
 *      all loaded concurrently through the shared ownership helper so
 *      per-user isolation (R5) is enforced uniformly — R18.1, R18.2,
 *      R18.7.
 *   3. Send that snapshot as Claude's `system` context together with
 *      the user's `message` (≤ 30s timeout) — R18.3.
 *   4. Respond `200 { reply }` on success — R18.3.
 *   5. On Claude failure / timeout / missing-content, route a generic
 *      503 error through the uniform error handler. The Anthropic API
 *      key is NEVER included in the response, the error message, or
 *      any log surface — R18.6.
 *   6. The conversation is never persisted: there is no Mongoose
 *      `create` or `save` for the message or the reply, and no
 *      collection is touched outside the read-only snapshot
 *      assembly — R18.7.
 *
 * Why the snapshot net worth is computed in stored currency without
 * conversion:
 *   - The full Net_Worth_Service (R8) converts cross-currency amounts
 *     via the ExchangeRate API. Importing that dependency here would
 *     make every AI chat request depend on a second external service
 *     whose failure has no relationship to the AI advisor.
 *   - Requirement 18.2 only specifies that a "snapshot" be assembled
 *     and that net worth be included; it does not impose the multi-
 *     currency conversion contract from R8.6.
 *   - Keeping the snapshot simple — one number, one currency per
 *     record — avoids partial / inconsistent figures when the rate
 *     service is degraded, and keeps R18.6's "never expose the key"
 *     contract trivially upholdable (no extra third-party path).
 *
 * Validates: Requirements 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7
 *           (and indirectly 5.1, 5.4 via the ownership helper).
 */

const { body, validationResult } = require('express-validator');

const Asset = require('../models/Asset');
const Liability = require('../models/Liability');
const Transaction = require('../models/Transaction');
const Goal = require('../models/Goal');
const Bill = require('../models/Bill');
const { scopedFind } = require('../utils/ownership');
const { chat } = require('../utils/claude');
const { roundTo2dp } = require('../utils/currency');

/**
 * Inclusive maximum length of a chat message (R18.4). Exported so tests
 * assert against the same constant the controller uses rather than
 * duplicating the literal.
 *
 * @type {number}
 */
const MAX_MESSAGE_LENGTH = 4000;

/**
 * Maximum number of recent transactions to include in the snapshot
 * (R18.2). Sorted by `date` desc so the AI sees the freshest cash-flow
 * activity first.
 *
 * @type {number}
 */
const RECENT_TRANSACTIONS_LIMIT = 50;

/**
 * Generic error message returned to the client when Claude is
 * unavailable. Deliberately opaque — R18.6 forbids exposing the API
 * key, and a vaguer message also protects against information leakage
 * about which third-party service is down.
 *
 * @type {string}
 */
const SERVICE_UNAVAILABLE_MESSAGE = 'AI service unavailable';

/**
 * Preamble prepended to the JSON-stringified snapshot before it is sent
 * to Claude as the `system` context. Tells the model to treat the
 * snapshot as ground truth and forbids it from inventing data outside
 * what the user has actually recorded — keeping advice grounded in the
 * user's real financial state (R18.2 spirit).
 *
 * @type {string}
 */
const SNAPSHOT_PREAMBLE =
  "User's financial snapshot (read-only). Do not invent data outside this snapshot:";

/**
 * Translate any errors collected by `chatValidators` into a uniform
 * `400 { message }` response that carries only the first error's
 * message. Returns `true` when a response was sent so the caller can
 * early-return.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {boolean}
 */
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
 * Validation chain for `POST /api/ai/chat`.
 *
 * Enforces R18.4 (length 1–4000) and R18.5 (non-whitespace-only) in a
 * single express-validator chain shared by the route. Each stage
 * `.bail()`s so the first reported error matches the most natural
 * failure mode:
 *
 *   1. presence (`exists` + `isString`) — "message is required",
 *   2. emptiness check after trimming — also "message is required",
 *      which covers the whitespace-only case (R18.5),
 *   3. length cap — "message must be 1 to 4000 characters" (R18.4).
 *
 * The trimming sanitizer is applied before the emptiness check so
 * `"   "` collapses to `""` and surfaces as "required" rather than as
 * a length violation. The trimmed value also flows into the controller
 * (and into the Claude payload) so the model never sees leading or
 * trailing whitespace.
 *
 * @type {import('express').RequestHandler[]}
 */
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

/**
 * Resolve the Anthropic API key for the current request.
 *
 * Lookup order:
 *   1. `req.app.get('config').claudeApiKey` — when the bootstrap has
 *      stashed the loaded config on the Express app (the recommended
 *      injection point for tests).
 *   2. `process.env.CLAUDE_API_KEY` — the established direct-read
 *      pattern used by `utils/currency.js` for ExchangeRate. Reading
 *      from env directly is preferred over calling `loadConfig()` at
 *      request time because `loadConfig()` halts the process on any
 *      missing required secret (R22.2 startup behavior) — appropriate
 *      at boot, but inappropriate inside a request handler where the
 *      correct response is a clean 503, not process termination.
 *
 * Returns `null` when no key is configured. The controller passes
 * `null` straight through to {@link chat}, which then collapses to
 * `{ ok: false }` and the 503 path runs as designed.
 *
 * @param {import('express').Request} req
 * @returns {string | null}
 */
function resolveApiKey(req) {
  if (req && req.app && typeof req.app.get === 'function') {
    const cfg = req.app.get('config');
    if (
      cfg &&
      typeof cfg.claudeApiKey === 'string' &&
      cfg.claudeApiKey.trim() !== ''
    ) {
      return cfg.claudeApiKey;
    }
  }
  const fromEnv = process.env.CLAUDE_API_KEY;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return fromEnv;
  }
  return null;
}

/**
 * Sum the `value` field of every asset record without currency
 * conversion. Non-numeric / missing values are skipped so a corrupted
 * legacy record cannot pollute the total with `NaN`.
 *
 * @param {Array<{ value?: unknown }>} assets
 * @returns {number}
 */
function sumAssetValues(assets) {
  let total = 0;
  for (const a of assets) {
    const v = a && a.value;
    if (typeof v === 'number' && Number.isFinite(v)) {
      total += v;
    }
  }
  return total;
}

/**
 * Sum the `amount` field of every liability record without currency
 * conversion. Non-numeric / missing amounts are skipped for the same
 * defensive reason as {@link sumAssetValues}.
 *
 * @param {Array<{ amount?: unknown }>} liabilities
 * @returns {number}
 */
function sumLiabilityAmounts(liabilities) {
  let total = 0;
  for (const l of liabilities) {
    const v = l && l.amount;
    if (typeof v === 'number' && Number.isFinite(v)) {
      total += v;
    }
  }
  return total;
}

/**
 * Assemble the user-scoped snapshot Claude receives as system context.
 *
 * Loads every collection concurrently — a single round-trip to Mongo
 * worth of latency rather than five sequential reads — and uses
 * `.lean()` so each result is a plain JS object. This makes
 * `JSON.stringify(snapshot)` trivially produce a clean payload (no
 * Mongoose document machinery, no `__v`, no `_id` getter overhead) and
 * makes the snapshot safe to log / inspect during debugging.
 *
 * Per-user isolation (R5.1, R5.4, R18.7) is delegated entirely to the
 * shared ownership helper: every query carries `user: req.user._id`,
 * so records owned by another user can never reach the snapshot.
 *
 * @param {import('express').Request} req
 * @returns {Promise<{
 *   assets: object[],
 *   liabilities: object[],
 *   recentTransactions: object[],
 *   goals: object[],
 *   bills: object[],
 *   netWorth: number,
 * }>}
 */
async function buildSnapshot(req) {
  const [assets, liabilities, recentTransactions, goals, bills] = await Promise.all([
    scopedFind(Asset, req).lean(),
    scopedFind(Liability, req).lean(),
    scopedFind(Transaction, req)
      .sort({ date: -1 })
      .limit(RECENT_TRANSACTIONS_LIMIT)
      .lean(),
    scopedFind(Goal, req).lean(),
    scopedFind(Bill, req).lean(),
  ]);

  // Snapshot net worth: stored-currency sums, no conversion. See the
  // module-level comment for why this deliberately diverges from R8's
  // multi-currency Net_Worth_Service.
  const totalAssets = sumAssetValues(assets);
  const totalLiabilities = sumLiabilityAmounts(liabilities);
  const netWorth = roundTo2dp(totalAssets - totalLiabilities);

  return {
    assets,
    liabilities,
    recentTransactions,
    goals,
    bills,
    netWorth,
  };
}

/**
 * `POST /api/ai/chat` handler.
 *
 * Flow (matches the module-level contract):
 *   1. Surface validation errors as 400 (R18.4, R18.5). The Claude API
 *      is intentionally NOT called when validation fails — gating the
 *      call on validation is part of Property 26.
 *   2. Build the user-scoped snapshot via {@link buildSnapshot}
 *      (R18.1, R18.2, R18.7).
 *   3. Resolve the Anthropic API key from app config or env. A missing
 *      key collapses to a 503 via the same path as a Claude failure,
 *      so a misconfigured server doesn't 500.
 *   4. Call Claude with the JSON-stringified snapshot as `system`
 *      context and the trimmed user message as the user turn (R18.3).
 *   5. On `{ ok: true, reply }` respond `200 { reply }` (R18.3).
 *   6. On `{ ok: false }` raise a generic 503 through the uniform
 *      error handler so the response body is `{ message: "AI service
 *      unavailable" }` and never includes the API key (R18.6).
 *   7. Nothing is persisted — there are no `create` / `save` calls
 *      anywhere in this handler (R18.7).
 *
 * Validates: Requirements 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function chatHandler(req, res, next) {
  try {
    if (rejectIfValidationErrors(req, res)) return;

    // express-validator's `customSanitizer((v) => v.trim())` already
    // wrote the trimmed value back into req.body.message — but be
    // defensive in case a future refactor strips that sanitizer.
    const userMessage =
      typeof req.body.message === 'string' ? req.body.message.trim() : '';

    const snapshot = await buildSnapshot(req);
    const systemContext = `${SNAPSHOT_PREAMBLE}\n${JSON.stringify(snapshot)}`;

    const apiKey = resolveApiKey(req);

    const result = await chat({
      apiKey,
      systemContext,
      userMessage,
      timeoutMs: 30_000,
    });

    if (result && result.ok === true) {
      // Conversation is never persisted (R18.7) — we simply forward the
      // reply and discard everything else.
      res.status(200).json({ reply: result.reply });
      return;
    }

    // Generic error funnels through the uniform error handler so the
    // response body is `{ message: "AI service unavailable" }`. The
    // error message is constructed locally here from a constant, so
    // there is no path by which the API key could leak into it
    // (R18.6).
    const err = new Error(SERVICE_UNAVAILABLE_MESSAGE);
    err.statusCode = 503;
    next(err);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  // Handler
  chat: chatHandler,

  // Validator chain
  chatValidators,

  // Internals exported for unit tests / advanced callers
  buildSnapshot,
  resolveApiKey,
  sumAssetValues,
  sumLiabilityAmounts,

  // Constants exported for tests / re-use
  MAX_MESSAGE_LENGTH,
  RECENT_TRANSACTIONS_LIMIT,
  SERVICE_UNAVAILABLE_MESSAGE,
  SNAPSHOT_PREAMBLE,
};
