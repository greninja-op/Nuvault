'use strict';

/**
 * Investment_Service controllers (Tasks 14.1 and 14.2).
 *
 * Implements full CRUD for the Investment resource plus the live-pricing
 * + P&L summary endpoint, all on top of the shared ownership helper so
 * per-user isolation (R5) is enforced uniformly.
 *
 * Exports:
 *   - `investmentValidators`: a reusable express-validator chain shared
 *     by POST and PUT. It enforces presence and the
 *     type/name/quantity/buyPrice bounds from R13.1–R13.4 in a single
 *     place. Optional fields (`symbol`, `currentPrice`, `buyDate`,
 *     `notes`) are not validated by the chain and pass through; the
 *     model schema validates them on save where applicable.
 *   - `createInvestment`: POST `/investments` → 201 with the created
 *     record (R13.1).
 *   - `getInvestments`: GET `/investments` → 200 with the user's records
 *     (empty array when none, scoped to the authenticated user via
 *     R5.1, R5.4).
 *   - `getInvestment`: GET `/investments/:id` → 200 with the record, or
 *     404 when missing / not owned (R5.3, R13.7).
 *   - `updateInvestment`: PUT `/investments/:id` → 200 with the updated
 *     record, or 404 when missing / not owned (R13.5, R13.7).
 *   - `deleteInvestment`: DELETE `/investments/:id` → 200 with a success
 *     payload, or 404 when missing / not owned (R13.6, R13.7).
 *   - `getSummary`: GET `/investments/summary` → 200 with per-investment
 *     P&L items and aggregate totals. Live prices for `stock` / `crypto`
 *     come from Yahoo Finance with a 10s timeout; failure / timeout /
 *     missing quote falls back to the stored `currentPrice`, then to
 *     `buyPrice`. A single symbol failure does not abort the rest
 *     (R14.1–R14.6).
 *
 * The persisted `user` is forced by `scopedCreate` / `scopedUpdate` and
 * is never assignable from the request payload (R5.2, R5.6).
 *
 * Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7,
 * 14.1, 14.2, 14.3, 14.4, 14.5, 14.6 (and indirectly Requirements 5.1,
 * 5.2, 5.3, 5.4, 5.6 via the ownership helper).
 */

const { body, validationResult } = require('express-validator');

const Investment = require('../models/Investment');
const { INVESTMENT_TYPES } = require('../models/Investment');
const {
  scopedFind,
  scopedFindById,
  scopedCreate,
  scopedUpdate,
  scopedDelete,
} = require('../utils/ownership');
const { fetchPrice } = require('../utils/yahooFinance');
const { roundTo2dp } = require('../utils/currency');

/**
 * Investment types whose current price should be retrieved from the
 * Yahoo Finance API instead of the stored `currentPrice` field
 * (R14.1 / R14.2). Centralized here so both the controller and any
 * future test can compare against the same set.
 *
 * @type {ReadonlySet<string>}
 */
const LIVE_PRICED_TYPES = new Set(['stock', 'crypto']);

/**
 * Field bounds for investments. Mirror the model and the requirements
 * exactly so the validator and the schema agree on what "valid" means.
 *
 *   R13.1: name 1–100 chars; quantity and buyPrice in (0, 999,999,999.99].
 *   R13.1: type ∈ {stock, crypto, mutual_fund, fd, other}.
 *
 * Exported so tests assert against the same constants the controller
 * uses rather than duplicating literals.
 */
const NAME_MAX = 100;
const MIN_AMOUNT = 0.01; // smallest representable positive amount at 2 dp
const MAX_AMOUNT = 999999999.99;

/**
 * Coerce a request-supplied numeric field (quantity, buyPrice) to a
 * finite Number when possible.
 *
 * Numeric fields may arrive as JSON numbers (typical) or numeric strings
 * (form-encoded clients). Returning `null` for anything that can't be
 * cleanly interpreted as a finite number lets the validator surface a
 * single, uniform "<field> is invalid" message rather than attaching
 * different errors to typed-vs-string inputs.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
function coerceNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Build a strictly-positive "(0, MAX]" custom validator factory used for
 * both quantity and buyPrice. Returns a function express-validator can
 * call; on failure it throws an `Error` whose message identifies the
 * field, matching R13.4's "validation message indicating the invalid
 * field" requirement.
 *
 * @param {string} fieldLabel - "quantity" or "buyPrice".
 */
function buildPositiveAmountValidator(fieldLabel) {
  return function validatePositiveAmount(raw) {
    const value = coerceNumber(raw);
    if (value === null) {
      throw new Error(`${fieldLabel} is invalid`);
    }
    if (value <= 0) {
      throw new Error(`${fieldLabel} must be greater than 0`);
    }
    if (value > MAX_AMOUNT) {
      throw new Error(`${fieldLabel} must be at most 999,999,999.99`);
    }
    return true;
  };
}

/**
 * Validation chain shared by POST `/investments` and PUT
 * `/investments/:id`.
 *
 * Both endpoints take a full investment representation, so the same
 * chain works for create and update — symmetric with the liability
 * controller. Each field is checked in three stages so the first
 * reported error matches the most natural failure mode:
 *
 *   1. presence (`exists` + `isString` for strings) — R13.2 "missing
 *      field",
 *   2. emptiness check (after trimming for strings) — R13.2,
 *   3. format / range / enum — R13.1, R13.3, R13.4.
 *
 * @type {import('express').RequestHandler[]}
 */
const investmentValidators = [
  // --- type ---
  body('type')
    .exists({ checkNull: true })
    .withMessage('type is required')
    .bail()
    .isString()
    .withMessage('type is required')
    .bail()
    .customSanitizer((v) => v.trim())
    .notEmpty()
    .withMessage('type is required')
    .bail()
    .isIn(INVESTMENT_TYPES)
    .withMessage(`type must be one of: ${INVESTMENT_TYPES.join(', ')}`),

  // --- name ---
  body('name')
    .exists({ checkNull: true })
    .withMessage('name is required')
    .bail()
    .isString()
    .withMessage('name is required')
    .bail()
    .customSanitizer((v) => v.trim())
    .notEmpty()
    .withMessage('name is required')
    .bail()
    .isLength({ max: NAME_MAX })
    .withMessage(`name must be 1 to ${NAME_MAX} characters`),

  // --- quantity ---
  body('quantity')
    .exists({ checkNull: true })
    .withMessage('quantity is required')
    .bail()
    .custom(buildPositiveAmountValidator('quantity')),

  // --- buyPrice ---
  body('buyPrice')
    .exists({ checkNull: true })
    .withMessage('buyPrice is required')
    .bail()
    .custom(buildPositiveAmountValidator('buyPrice')),
];

/**
 * Whitelist of fields a client may set on an investment.
 *
 * `user` is intentionally excluded — ownership is forced by the shared
 * helper (R5.2, R5.6) and a client-supplied `user` is silently dropped.
 * Optional model fields are passed through so callers can supply them
 * without a controller change. `currentPrice` is included so manual
 * pricing for `mutual_fund`/`fd`/`other` types (R14.2) can be written
 * directly without waiting for the summary task.
 */
const ALLOWED_FIELDS = [
  'type',
  'symbol',
  'name',
  'quantity',
  'buyPrice',
  'currentPrice',
  'buyDate',
  'notes',
];

/**
 * Build a clean payload from the request body that contains only the
 * whitelisted investment fields and coerces the numeric fields when
 * they look like numbers. Used by both create and update so an extra
 * field (e.g. `user`, `_id`, anything else) cannot sneak through.
 *
 * @param {Record<string, unknown>} body
 * @returns {Record<string, unknown>}
 */
function pickInvestmentFields(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }
  const out = {};
  for (const key of ALLOWED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const value = body[key];
    if (key === 'quantity' || key === 'buyPrice' || key === 'currentPrice') {
      const coerced = coerceNumber(value);
      out[key] = coerced === null ? value : coerced;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Translate any errors collected by `investmentValidators` into a
 * uniform `400 { message }` response that carries only the first error's
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
 * `POST /investments` handler.
 *
 * Flow:
 *   1. Surface any validation error from `investmentValidators` as a 400
 *      response (R13.2, R13.3, R13.4).
 *   2. Whitelist fields from the body, then create the record via
 *      `scopedCreate` so the persisted `user` is the authenticated owner
 *      (R5.2). Any client-supplied `user` is dropped by both the
 *      whitelist and the ownership helper as defense-in-depth.
 *   3. Respond 201 with the created investment (R13.1).
 *
 * Validates: Requirements 13.1, 13.2, 13.3, 13.4
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function createInvestment(req, res, next) {
  try {
    if (rejectIfValidationErrors(req, res)) return;

    const payload = pickInvestmentFields(req.body);
    const created = await scopedCreate(Investment, req, payload);

    return res.status(201).json(created);
  } catch (err) {
    return next(err);
  }
}

/**
 * `GET /investments` handler.
 *
 * Returns every investment owned by the authenticated user as a JSON
 * array, empty when the user has none. Per R5.1/R5.4 the query is scoped
 * to `user: req.user._id`; records owned by a different user are
 * excluded.
 *
 * Note: live pricing and P&L computation belong to task 14.2's
 * `getSummary` endpoint (R14). This list intentionally returns the raw
 * stored investments only.
 *
 * Validates: Requirements 5.1, 5.4
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getInvestments(req, res, next) {
  try {
    const records = await scopedFind(Investment, req).sort({ _id: -1 });
    return res.status(200).json(records);
  } catch (err) {
    return next(err);
  }
}

/**
 * `GET /investments/:id` handler.
 *
 * Returns the investment with the given id when it is owned by the
 * authenticated user. A malformed id, a missing record, and a record
 * owned by a different user all collapse to a uniform 404 response so
 * the API does not reveal the existence of another user's record (R5.3,
 * R13.7).
 *
 * Validates: Requirements 5.3, 13.7
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getInvestment(req, res, next) {
  try {
    const record = await scopedFindById(Investment, req, req.params.id);
    if (!record) {
      return res.status(404).json({ message: 'Investment not found' });
    }
    return res.status(200).json(record);
  } catch (err) {
    return next(err);
  }
}

/**
 * `PUT /investments/:id` handler.
 *
 * Flow:
 *   1. Run validators first so an invalid body cannot persist anything,
 *      regardless of ownership (R13.3, R13.4).
 *   2. Apply the sanitized whitelist via `scopedUpdate`. The helper
 *      loads the record by `_id + user`, so a foreign-owner / missing /
 *      malformed id all surface as `null` and are mapped to 404 (R5.3,
 *      R13.7).
 *   3. Respond 200 with the updated investment (R13.5).
 *
 * The persisted `user` field is never overwritten — the ownership
 * helper strips `user` from the payload (R5.6).
 *
 * Validates: Requirements 5.3, 5.6, 13.3, 13.4, 13.5, 13.7
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function updateInvestment(req, res, next) {
  try {
    if (rejectIfValidationErrors(req, res)) return;

    const payload = pickInvestmentFields(req.body);
    const updated = await scopedUpdate(Investment, req, req.params.id, payload);

    if (!updated) {
      return res.status(404).json({ message: 'Investment not found' });
    }
    return res.status(200).json(updated);
  } catch (err) {
    return next(err);
  }
}

/**
 * `DELETE /investments/:id` handler.
 *
 * Removes the investment when it is owned by the authenticated user,
 * and responds 200 with a success body. A malformed id, a missing
 * record, or a record owned by a different user all collapse to 404 so
 * the API does not leak the existence of another user's record (R5.3,
 * R13.7).
 *
 * Validates: Requirements 5.3, 13.6, 13.7
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function deleteInvestment(req, res, next) {
  try {
    const removed = await scopedDelete(Investment, req, req.params.id);
    if (!removed) {
      return res.status(404).json({ message: 'Investment not found' });
    }
    return res.status(200).json({
      message: 'Investment deleted',
      id: String(removed._id),
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * Resolve the current price for a single investment.
 *
 * Selection rules (R14.1, R14.2, R14.6):
 *   1. For `stock` / `crypto` holdings WITH a non-empty `symbol`,
 *      attempt a live fetch via {@link fetchPrice}. The fetch enforces
 *      a 10-second timeout; failure / timeout / missing-quote all
 *      collapse to `{ ok: false }` so this function can fall through
 *      uniformly without aborting the rest of the summary.
 *   2. When the live fetch succeeds, return its price tagged
 *      `priceSource: 'live'`.
 *   3. Otherwise — including for non-live-priced types
 *      (`mutual_fund`, `fd`, `other`) and for live-priced types whose
 *      symbol is missing — use the stored `currentPrice` if it is a
 *      finite number, tagged `priceSource: 'stored'`.
 *   4. As a last resort, fall back to the investment's `buyPrice`,
 *      tagged `priceSource: 'fallback'`. This produces zero gain/loss
 *      for that investment rather than computing P&L against an
 *      undefined value.
 *
 * The function NEVER throws for an unavailability condition: a single
 * symbol failure must not abort the whole summary (R14.6). Any unexpected
 * exception inside `fetchPrice` is also swallowed — the helper itself is
 * already designed to resolve to `{ ok: false }` for transport errors,
 * but this defensive try/catch keeps that contract enforced even if the
 * implementation later changes.
 *
 * @param {{ type?: string, symbol?: unknown, currentPrice?: unknown, buyPrice: number }} inv
 * @returns {Promise<{ price: number, priceSource: 'live' | 'stored' | 'fallback' }>}
 */
async function resolveCurrentPrice(inv) {
  const symbol =
    typeof inv.symbol === 'string' && inv.symbol.trim() !== ''
      ? inv.symbol.trim()
      : null;
  const useLive = LIVE_PRICED_TYPES.has(inv.type) && symbol !== null;

  if (useLive) {
    let result;
    try {
      result = await fetchPrice(symbol);
    } catch (_err) {
      // Defense in depth: fetchPrice is contractually non-throwing, but
      // a single symbol failure must never abort the rest of the summary
      // (R14.6). Treat any escaped exception as unavailability.
      result = { ok: false };
    }
    if (result && result.ok === true) {
      return { price: result.price, priceSource: 'live' };
    }
    // Fall through to stored / fallback below.
  }

  if (typeof inv.currentPrice === 'number' && Number.isFinite(inv.currentPrice)) {
    return { price: inv.currentPrice, priceSource: 'stored' };
  }
  return { price: inv.buyPrice, priceSource: 'fallback' };
}

/**
 * Compute the per-investment summary record from a stored investment
 * document and a resolved current price.
 *
 * Math (R14.3, R14.4, R14.5):
 *   - invested        = quantity × buyPrice
 *   - currentValue    = quantity × currentPrice
 *   - gainLoss        = currentValue − invested
 *   - gainLossPercent = invested === 0 ? 0 : (gainLoss / invested) × 100
 *
 * The `invested === 0` guard is required by R14.4 even though the model
 * validators reject `buyPrice <= 0` and `quantity <= 0`. Keeping it here
 * preserves the contract regardless of how validation evolves.
 *
 * Every monetary field is rounded to 2 decimal places before being
 * returned so the response is consistent with the rest of the API
 * (e.g. net worth) and free of binary-floating-point noise.
 *
 * @param {import('mongoose').Document} doc
 * @param {{ price: number, priceSource: 'live' | 'stored' | 'fallback' }} priced
 * @returns {object}
 */
function buildSummaryItem(doc, priced) {
  const obj = doc.toObject({ versionKey: false });
  const quantity = Number(obj.quantity);
  const buyPrice = Number(obj.buyPrice);
  const currentPrice = priced.price;

  const invested = quantity * buyPrice;
  const currentValue = quantity * currentPrice;
  const gainLoss = currentValue - invested;
  const gainLossPercent = invested === 0 ? 0 : (gainLoss / invested) * 100;

  return {
    ...obj,
    currentPrice: roundTo2dp(currentPrice),
    invested: roundTo2dp(invested),
    currentValue: roundTo2dp(currentValue),
    gainLoss: roundTo2dp(gainLoss),
    gainLossPercent: roundTo2dp(gainLossPercent),
    priceSource: priced.priceSource,
  };
}

/**
 * `GET /investments/summary` handler.
 *
 * Loads every investment owned by the authenticated user (R5.1, R5.4),
 * resolves a current price for each in parallel, and computes
 * per-investment and aggregate profit-and-loss figures.
 *
 * The per-investment promises are produced by an `async` mapper so each
 * resolves to a fully-built summary item even when its underlying live
 * price lookup fails — failure is encoded inside the resolved value
 * (`priceSource: 'stored' | 'fallback'`) rather than as a rejection.
 * That guarantees a single symbol's outage does NOT abort the rest of
 * the summary (R14.6) and that `Promise.all` cannot reject for a price
 * problem.
 *
 * Aggregates (R14.5):
 *   - totalInvested     = Σ invested
 *   - totalCurrentValue = Σ currentValue
 *   - totalPnL          = totalCurrentValue − totalInvested
 *
 * All totals are rounded to 2 decimal places. An empty investment set
 * produces zeros and an empty `items` array with HTTP 200.
 *
 * Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.6
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getSummary(req, res, next) {
  try {
    // Per-user isolation (R5.1, R5.4) is delegated to the shared helper:
    // the persisted `user` field is compared against `req.user._id`, so
    // records owned by another user are excluded by construction.
    const docs = await scopedFind(Investment, req).sort({ _id: -1 });

    // Each promise already encodes failure as a fallback value; nothing
    // here will reject for a price-resolution problem (R14.6). Running
    // them concurrently keeps the worst-case latency at one timeout
    // window even when many symbols are looked up.
    const items = await Promise.all(
      docs.map(async (doc) => {
        const priced = await resolveCurrentPrice(doc);
        return buildSummaryItem(doc, priced);
      })
    );

    const totalInvested = roundTo2dp(
      items.reduce((sum, x) => sum + x.invested, 0)
    );
    const totalCurrentValue = roundTo2dp(
      items.reduce((sum, x) => sum + x.currentValue, 0)
    );
    const totalPnL = roundTo2dp(totalCurrentValue - totalInvested);

    return res.status(200).json({
      items,
      totalInvested,
      totalCurrentValue,
      totalPnL,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  // Handlers
  createInvestment,
  getInvestments,
  getInvestment,
  updateInvestment,
  deleteInvestment,
  getSummary,

  // Validator chain
  investmentValidators,

  // Constants exported for tests / re-use
  NAME_MAX,
  MIN_AMOUNT,
  MAX_AMOUNT,
  INVESTMENT_TYPES,
  LIVE_PRICED_TYPES,

  // Internals exported for unit tests
  resolveCurrentPrice,
  buildSummaryItem,
};
