'use strict';

/**
 * Portfolio controllers.
 *
 * Implements full CRUD for the unified PortfolioItem resource plus a
 * computed-on-the-fly summary endpoint, all on top of the shared ownership
 * helper so per-user isolation (R5) is enforced uniformly — exactly the
 * pattern the investment controller follows.
 *
 * Exports:
 *   - `portfolioValidators`: a reusable express-validator chain shared by
 *     POST and PUT. It enforces `kind` ∈ PORTFOLIO_KINDS and `name` 1–100
 *     required; every other field is optional and passes through (the model
 *     schema validates the optional numerics on save).
 *   - `createItem`:  POST   `/portfolio`        → 201 with the created item.
 *   - `getItems`:    GET    `/portfolio`        → 200 with the user's items,
 *                    optionally filtered by `?kind=`.
 *   - `getItem`:     GET    `/portfolio/:id`    → 200, or 404 when missing /
 *                    not owned.
 *   - `updateItem`:  PUT    `/portfolio/:id`    → 200, or 404.
 *   - `deleteItem`:  DELETE `/portfolio/:id`    → 200, or 404.
 *   - `getSummary`:  GET    `/portfolio/summary`→ 200 with per-item
 *                    invested/currentValue/returns, aggregate totals, and a
 *                    per-kind allocation breakdown. Never stored (computed
 *                    on every request).
 *   - `computeItemValues`: pure helper returning `{ invested, currentValue }`
 *                    for one item, exported for unit tests.
 *
 * The persisted `user` is forced by `scopedCreate` / `scopedUpdate` and is
 * never assignable from the request payload (R5.2, R5.6).
 */

const { body, validationResult } = require('express-validator');

const PortfolioItem = require('../models/PortfolioItem');
const { PORTFOLIO_KINDS, COMPOUNDING_VALUES } = require('../models/PortfolioItem');
const {
  scopedFind,
  scopedFindById,
  scopedCreate,
  scopedUpdate,
  scopedDelete,
} = require('../utils/ownership');
const { roundTo2dp } = require('../utils/currency');

/**
 * Field bounds for portfolio items. Mirror the model and the spec exactly so
 * the validator and the schema agree on what "valid" means.
 */
const NAME_MAX = 100;
const MAX_AMOUNT = 999999999.99;

/**
 * Uniform 404 / success messages so tests assert against a single source of
 * truth rather than duplicating literals.
 */
const MESSAGES = {
  ITEM_NOT_FOUND: 'Portfolio item not found',
  ITEM_DELETED: 'Portfolio item deleted',
};

/**
 * Whitelist of fields a client may set on a portfolio item.
 *
 * `user` is intentionally excluded — ownership is forced by the shared
 * helper (R5.2, R5.6) and a client-supplied `user` is silently dropped.
 */
const ALLOWED_FIELDS = [
  'kind',
  'name',
  'principal',
  'currentBalance',
  'interestRate',
  'compounding',
  'startDate',
  'maturityDate',
  'tenureMonths',
  'units',
  'buyPrice',
  'currentPrice',
  'currentValue',
  'yearlyContribution',
  'symbol',
  'accountType',
  'notes',
];

/**
 * Numeric fields that should be coerced from numeric strings to Numbers so
 * form-encoded clients behave like JSON clients.
 *
 * @type {ReadonlySet<string>}
 */
const NUMERIC_FIELDS = new Set([
  'principal',
  'currentBalance',
  'interestRate',
  'tenureMonths',
  'units',
  'buyPrice',
  'currentPrice',
  'currentValue',
  'yearlyContribution',
]);

/**
 * Coerce a numeric value to a finite Number when possible, else return null
 * so the caller can keep the original (letting the model layer reject it).
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
 * Coerce a possibly-missing numeric value to a plain finite number,
 * defaulting to 0. Used inside {@link computeItemValues} so missing numerics
 * coerce to 0 as the spec requires.
 *
 * @param {unknown} value
 * @returns {number}
 */
function num(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Validation chain shared by POST `/portfolio` and PUT `/portfolio/:id`.
 *
 * Only `kind` and `name` are validated here (the two required fields). Every
 * other field is optional and validated by the model schema on save.
 *
 * @type {import('express').RequestHandler[]}
 */
const portfolioValidators = [
  // --- kind ---
  body('kind')
    .exists({ checkNull: true })
    .withMessage('kind is required')
    .bail()
    .isString()
    .withMessage('kind is required')
    .bail()
    .customSanitizer((v) => v.trim())
    .notEmpty()
    .withMessage('kind is required')
    .bail()
    .isIn(PORTFOLIO_KINDS)
    .withMessage(`kind must be one of: ${PORTFOLIO_KINDS.join(', ')}`),

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
];

/**
 * Build a clean payload from the request body that contains only the
 * whitelisted portfolio fields and coerces the numeric fields when they look
 * like numbers. Used by both create and update so an extra field cannot sneak
 * through.
 *
 * @param {Record<string, unknown>} body
 * @returns {Record<string, unknown>}
 */
function pickPortfolioFields(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }
  const out = {};
  for (const key of ALLOWED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const value = body[key];
    if (NUMERIC_FIELDS.has(key)) {
      const coerced = coerceNumber(value);
      out[key] = coerced === null ? value : coerced;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Translate any errors collected by `portfolioValidators` into a uniform
 * `400 { message }` response carrying only the first error's message. Returns
 * `true` when a response was sent so the caller can early-return.
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
 * Return the first strictly-positive value among the arguments (after numeric
 * coercion), or 0 when none qualify. Lets the per-kind rules express their
 * "use X, else fall back to Y, else Z" preference compactly.
 *
 * @param {...unknown} vals
 * @returns {number}
 */
function firstPositive(...vals) {
  for (const v of vals) {
    const n = num(v);
    if (n > 0) return n;
  }
  return 0;
}

/**
 * Compute the invested amount and current value for a single portfolio item.
 *
 * Pure function — takes a plain object (or Mongoose doc converted to one) and
 * returns `{ invested, currentValue }`, both rounded to 2 decimal places.
 * Missing numerics coerce to 0.
 *
 * Per-kind rules (from the spec):
 *   - stock / crypto / mutual_fund:
 *       invested     = units * buyPrice
 *       currentValue = units * currentPrice, falling back to the stored
 *                      currentValue, then to invested.
 *   - gold:
 *       invested     = units(grams) * buyPrice
 *       currentValue = units * currentPrice (same fallback chain).
 *   - fd:
 *       invested     = principal
 *       currentValue = stored currentValue (maturity) if set, else principal.
 *   - bank:
 *       invested = currentValue = currentBalance.
 *   - ppf_epf:
 *       invested     = principal
 *       currentValue = stored currentBalance, else currentValue, else
 *                      principal.
 *   - real_estate:
 *       invested     = principal (purchase value)
 *       currentValue = stored currentValue, else principal.
 *
 * @param {Record<string, unknown>} item
 * @returns {{ invested: number, currentValue: number }}
 */
function computeItemValues(item) {
  const it = item && typeof item === 'object' ? item : {};
  const kind = it.kind;

  let invested = 0;
  let currentValue = 0;

  switch (kind) {
    case 'stock':
    case 'crypto':
    case 'mutual_fund':
    case 'gold': {
      const units = num(it.units);
      invested = units * num(it.buyPrice);
      const priced = units * num(it.currentPrice);
      currentValue = priced > 0 ? priced : firstPositive(it.currentValue) || invested;
      break;
    }
    case 'fd': {
      invested = num(it.principal);
      currentValue = firstPositive(it.currentValue) || invested;
      break;
    }
    case 'bank': {
      const balance = num(it.currentBalance);
      invested = balance;
      currentValue = balance;
      break;
    }
    case 'ppf_epf': {
      invested = num(it.principal);
      currentValue = firstPositive(it.currentBalance, it.currentValue) || invested;
      break;
    }
    case 'real_estate': {
      invested = num(it.principal);
      currentValue = firstPositive(it.currentValue) || invested;
      break;
    }
    default: {
      invested = 0;
      currentValue = 0;
      break;
    }
  }

  return {
    invested: roundTo2dp(invested),
    currentValue: roundTo2dp(currentValue),
  };
}

/**
 * `POST /portfolio` handler.
 *
 * Surfaces validation errors as 400, whitelists the body, and creates the
 * record via `scopedCreate` so the persisted `user` is the authenticated
 * owner (R5.2). Responds 201 with the created item.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function createItem(req, res, next) {
  try {
    if (rejectIfValidationErrors(req, res)) return;

    const payload = pickPortfolioFields(req.body);
    const created = await scopedCreate(PortfolioItem, req, payload);

    return res.status(201).json(created);
  } catch (err) {
    return next(err);
  }
}

/**
 * `GET /portfolio` handler.
 *
 * Returns every portfolio item owned by the authenticated user, optionally
 * filtered by `?kind=`. Scoped to `user: req.user._id` (R5.1, R5.4).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getItems(req, res, next) {
  try {
    const filter = {};
    const kind = req.query && req.query.kind;
    if (typeof kind === 'string' && kind.trim() !== '') {
      filter.kind = kind.trim();
    }
    const records = await scopedFind(PortfolioItem, req, filter).sort({ _id: -1 });
    return res.status(200).json(records);
  } catch (err) {
    return next(err);
  }
}

/**
 * `GET /portfolio/:id` handler.
 *
 * Returns the item when owned by the authenticated user; a malformed id, a
 * missing record, and a foreign-owned record all collapse to a uniform 404
 * (R5.3).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getItem(req, res, next) {
  try {
    const record = await scopedFindById(PortfolioItem, req, req.params.id);
    if (!record) {
      return res.status(404).json({ message: MESSAGES.ITEM_NOT_FOUND });
    }
    return res.status(200).json(record);
  } catch (err) {
    return next(err);
  }
}

/**
 * `PUT /portfolio/:id` handler.
 *
 * Validates first so an invalid body cannot persist, then applies the
 * sanitized whitelist via `scopedUpdate`. A foreign-owner / missing /
 * malformed id all surface as 404 (R5.3). The persisted `user` is never
 * overwritten (R5.6).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function updateItem(req, res, next) {
  try {
    if (rejectIfValidationErrors(req, res)) return;

    const payload = pickPortfolioFields(req.body);
    const updated = await scopedUpdate(PortfolioItem, req, req.params.id, payload);

    if (!updated) {
      return res.status(404).json({ message: MESSAGES.ITEM_NOT_FOUND });
    }
    return res.status(200).json(updated);
  } catch (err) {
    return next(err);
  }
}

/**
 * `DELETE /portfolio/:id` handler.
 *
 * Removes the item when owned by the authenticated user; otherwise 404
 * (R5.3).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function deleteItem(req, res, next) {
  try {
    const removed = await scopedDelete(PortfolioItem, req, req.params.id);
    if (!removed) {
      return res.status(404).json({ message: MESSAGES.ITEM_NOT_FOUND });
    }
    return res.status(200).json({
      message: MESSAGES.ITEM_DELETED,
      id: String(removed._id),
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * `GET /portfolio/summary` handler.
 *
 * Loads every portfolio item owned by the authenticated user (R5.1, R5.4),
 * computes per-item invested/currentValue/returns, and aggregates totals plus
 * a per-kind allocation breakdown. Nothing is stored — the summary is
 * computed on every request.
 *
 * Response shape:
 *   {
 *     items: [ { ...item, invested, currentValue, returns } ],
 *     totalInvested, totalCurrentValue, totalReturns,
 *     allocation: [ { kind, value, percent } ]  // sorted desc by value
 *   }
 *
 * `allocation[].percent` is the kind's summed currentValue as a percentage of
 * `totalCurrentValue`, or 0 when the total is 0. All money rounded to 2
 * decimal places. An empty set produces zeros and empty arrays.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getSummary(req, res, next) {
  try {
    const docs = await scopedFind(PortfolioItem, req).sort({ _id: -1 });

    const items = docs.map((doc) => {
      const obj = doc.toObject({ versionKey: false });
      const { invested, currentValue } = computeItemValues(obj);
      return {
        ...obj,
        invested,
        currentValue,
        returns: roundTo2dp(currentValue - invested),
      };
    });

    const totalInvested = roundTo2dp(items.reduce((sum, x) => sum + x.invested, 0));
    const totalCurrentValue = roundTo2dp(items.reduce((sum, x) => sum + x.currentValue, 0));
    const totalReturns = roundTo2dp(totalCurrentValue - totalInvested);

    // Per-kind current-value sums → allocation entries.
    const byKind = new Map();
    for (const item of items) {
      const prev = byKind.get(item.kind) || 0;
      byKind.set(item.kind, prev + item.currentValue);
    }

    const allocation = Array.from(byKind.entries())
      .map(([kind, value]) => {
        const roundedValue = roundTo2dp(value);
        const percent =
          totalCurrentValue === 0 ? 0 : roundTo2dp((roundedValue / totalCurrentValue) * 100);
        return { kind, value: roundedValue, percent };
      })
      .sort((a, b) => b.value - a.value);

    return res.status(200).json({
      items,
      totalInvested,
      totalCurrentValue,
      totalReturns,
      allocation,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  // Handlers
  createItem,
  getItems,
  getItem,
  updateItem,
  deleteItem,
  getSummary,

  // Validator chain
  portfolioValidators,

  // Pure helper exported for unit tests
  computeItemValues,

  // Constants exported for tests / re-use
  NAME_MAX,
  MAX_AMOUNT,
  PORTFOLIO_KINDS,
  COMPOUNDING_VALUES,
  MESSAGES,
};
