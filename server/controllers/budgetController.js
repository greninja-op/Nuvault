'use strict';

/**
 * Budget_Service controllers (Tasks 12.1 + 12.2).
 *
 * Implements full CRUD for the Budget resource on top of the shared
 * ownership helper, so per-user isolation (R5) is enforced uniformly.
 *
 * Exports:
 *   - `budgetValidators`: a reusable express-validator chain shared by
 *     POST and PUT. It enforces presence and the
 *     category/limit/month/year bounds from R11.1–R11.4 in a single
 *     place.
 *   - `createBudget`: POST `/budgets` → 201 with the created record
 *     (R11.1). Maps the underlying duplicate-key error from the
 *     `(user, category, month, year)` unique index to a 409 response
 *     (R11.5).
 *   - `getBudgets`: GET `/budgets` → 200 with the user's budgets for
 *     a single month/year. Optional `month` (1–12) and `year`
 *     (1970–2100) query params override the default; when both are
 *     omitted the server clock supplies the current month and year
 *     (R12.1, R12.2). For each returned budget the handler also
 *     computes `spent` from the user's matching expense transactions
 *     within the inclusive month range (R12.3) and decorates the
 *     response with `spent`, `remaining = limit − spent`, and
 *     `overBudget = spent > limit` (R12.4–R12.5). Spending is always
 *     derived per request and never persisted (R12.6).
 *   - `getBudget`: GET `/budgets/:id` → 200 with the record, or 404
 *     when missing / not owned (R5.3, R11.8).
 *   - `updateBudget`: PUT `/budgets/:id` → 200 with the updated record,
 *     or 404 when missing / not owned (R11.6, R11.8); 409 if the
 *     update would collide with another budget for the same
 *     `(category, month, year)` (R11.5 applied to updates via R11.6's
 *     "subject to the same validation rules").
 *   - `deleteBudget`: DELETE `/budgets/:id` → 200 with a success
 *     payload, or 404 when missing / not owned (R11.7, R11.8).
 *
 * The persisted `user` is forced by `scopedCreate` / `scopedUpdate` and
 * is never assignable from the request payload (R5.2, R5.6).
 *
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7,
 * 11.8, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6 (and indirectly
 * Requirements 5.1, 5.2, 5.3, 5.4, 5.6 via the ownership helper).
 */

const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');

const Budget = require('../models/Budget');
const Transaction = require('../models/Transaction');
const {
  scopedFind,
  scopedFindById,
  scopedCreate,
  scopedUpdate,
  scopedDelete,
} = require('../utils/ownership');

/**
 * Field bounds for budgets. Mirror the model and the requirements
 * exactly so the validator and the schema agree on what "valid" means.
 *
 *   R11.1: category 1–100 chars; limit in (0, 999,999,999.99];
 *          month 1–12; year 1970–2100.
 *
 * Exported so tests assert against the same constants the controller
 * uses rather than duplicating literals.
 */
const CATEGORY_MAX = 100;
const MIN_LIMIT = 0.01; // smallest representable positive amount at 2 dp
const MAX_LIMIT = 999999999.99;
const MIN_MONTH = 1;
const MAX_MONTH = 12;
const MIN_YEAR = 1970;
const MAX_YEAR = 2100;

/**
 * MongoDB duplicate-key error code. Surfaced when an insert/update
 * collides with a unique index — for budgets, the
 * `(user, category, month, year)` compound unique index defined on
 * the schema.
 *
 * @type {number}
 */
const DUPLICATE_KEY_CODE = 11000;

/**
 * Coerce a request-supplied numeric field (limit, month, year) to a
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
 * Validate the `limit` field per R11.4: finite number, strictly greater
 * than 0, and not above 999,999,999.99. Throws an `Error` (caught by
 * express-validator) with a message that consistently identifies the
 * field as "limit is invalid" or pinpoints the violated sub-rule.
 *
 * @param {unknown} raw
 * @returns {true}
 */
function validateLimit(raw) {
  const value = coerceNumber(raw);
  if (value === null) {
    throw new Error('limit is invalid');
  }
  if (value <= 0) {
    throw new Error('limit must be greater than 0');
  }
  if (value > MAX_LIMIT) {
    throw new Error('limit must be at most 999,999,999.99');
  }
  return true;
}

/**
 * Build a custom validator for an integer-bounded field (month, year).
 *
 * Returns a function express-validator can call; on failure it throws
 * an `Error` whose message identifies the field and the violated rule,
 * matching R11.3's "validation message indicating the invalid field".
 *
 * @param {string} fieldLabel - e.g. "month" or "year".
 * @param {number} min
 * @param {number} max
 */
function buildIntegerRangeValidator(fieldLabel, min, max) {
  return function validateIntegerRange(raw) {
    const value = coerceNumber(raw);
    if (value === null || !Number.isInteger(value)) {
      throw new Error(`${fieldLabel} is invalid`);
    }
    if (value < min || value > max) {
      throw new Error(`${fieldLabel} must be between ${min} and ${max}`);
    }
    return true;
  };
}

/**
 * Validation chain shared by POST `/budgets` and PUT `/budgets/:id`.
 *
 * Both endpoints take a full budget representation, so the same chain
 * works for create and update — symmetric with the investment and
 * liability controllers. Each field is checked in stages so the first
 * reported error matches the most natural failure mode:
 *
 *   1. presence (`exists` + `isString` for strings) — R11.2 "missing
 *      field",
 *   2. emptiness check (after trimming for strings) — R11.2,
 *   3. format / range — R11.1, R11.3, R11.4.
 *
 * @type {import('express').RequestHandler[]}
 */
const budgetValidators = [
  // --- category ---
  body('category')
    .exists({ checkNull: true })
    .withMessage('category is required')
    .bail()
    .isString()
    .withMessage('category is required')
    .bail()
    .customSanitizer((v) => v.trim())
    .notEmpty()
    .withMessage('category is required')
    .bail()
    .isLength({ max: CATEGORY_MAX })
    .withMessage(`category must be 1 to ${CATEGORY_MAX} characters`),

  // --- limit ---
  body('limit')
    .exists({ checkNull: true })
    .withMessage('limit is required')
    .bail()
    .custom(validateLimit),

  // --- month ---
  body('month')
    .exists({ checkNull: true })
    .withMessage('month is required')
    .bail()
    .custom(buildIntegerRangeValidator('month', MIN_MONTH, MAX_MONTH)),

  // --- year ---
  body('year')
    .exists({ checkNull: true })
    .withMessage('year is required')
    .bail()
    .custom(buildIntegerRangeValidator('year', MIN_YEAR, MAX_YEAR)),
];

/**
 * Whitelist of fields a client may set on a budget.
 *
 * `user` is intentionally excluded — ownership is forced by the shared
 * helper (R5.2, R5.6) and a client-supplied `user` is silently dropped.
 */
const ALLOWED_FIELDS = ['category', 'limit', 'month', 'year'];

/**
 * Build a clean payload from the request body that contains only the
 * whitelisted budget fields and coerces the numeric fields when they
 * look like numbers. Used by both create and update so an extra field
 * (e.g. `user`, `_id`, anything else) cannot sneak through.
 *
 * @param {Record<string, unknown>} body
 * @returns {Record<string, unknown>}
 */
function pickBudgetFields(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }
  const out = {};
  for (const key of ALLOWED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const value = body[key];
    if (key === 'limit' || key === 'month' || key === 'year') {
      const coerced = coerceNumber(value);
      out[key] = coerced === null ? value : coerced;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Translate any errors collected by `budgetValidators` into a uniform
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
 * Detect a MongoDB duplicate-key error (E11000). Surfaced when an
 * insert/update collides with the `(user, category, month, year)`
 * compound unique index on the Budget collection (R11.5).
 *
 * Mongoose forwards the underlying driver error verbatim, so the
 * `code` field is the most reliable discriminator across mongoose /
 * driver versions.
 *
 * @param {*} err
 * @returns {boolean}
 */
function isDuplicateKeyError(err) {
  return Boolean(err) && err.code === DUPLICATE_KEY_CODE;
}

/**
 * Resolve the target `(month, year)` for `GET /budgets` from the
 * request query string.
 *
 * Contract (R12.1, R12.2, R10.3-style symmetry):
 *   - Both `month` and `year` omitted → return the current server-clock
 *     month and year (R12.1). The server's local timezone is used so
 *     "current month" matches the calendar the user actually sees.
 *   - Both supplied → coerce, integer-check, and range-check (month
 *     1–12 per R11.3; year 1970–2100). The first violated rule produces
 *     a single human-readable error string the caller surfaces as 400.
 *   - Exactly one supplied → reject with a "both-or-neither" error.
 *     The symmetry mirrors the transaction list filter (R10.3) and
 *     prevents ambiguous half-specified periods.
 *
 * Returns an object with either `{ month, year }` (success) or
 * `{ error }` (failure). The caller decides the HTTP shape; this
 * function stays pure so it can be unit-tested without an Express
 * request.
 *
 * @param {Record<string, unknown> | undefined} query
 * @returns {{ month: number, year: number } | { error: string }}
 */
function resolveListPeriod(query) {
  const monthRaw = query ? query.month : undefined;
  const yearRaw = query ? query.year : undefined;
  const monthSupplied = monthRaw !== undefined && monthRaw !== '';
  const yearSupplied = yearRaw !== undefined && yearRaw !== '';

  if (monthSupplied !== yearSupplied) {
    return {
      error: 'month and year must both be provided or both be omitted',
    };
  }

  if (!monthSupplied && !yearSupplied) {
    const now = new Date();
    return { month: now.getMonth() + 1, year: now.getFullYear() };
  }

  const month = coerceNumber(monthRaw);
  if (
    month === null ||
    !Number.isInteger(month) ||
    month < MIN_MONTH ||
    month > MAX_MONTH
  ) {
    return { error: `month must be between ${MIN_MONTH} and ${MAX_MONTH}` };
  }

  const year = coerceNumber(yearRaw);
  if (
    year === null ||
    !Number.isInteger(year) ||
    year < MIN_YEAR ||
    year > MAX_YEAR
  ) {
    return { error: `year must be between ${MIN_YEAR} and ${MAX_YEAR}` };
  }

  return { month, year };
}

/**
 * Build the inclusive month range used by the spending aggregation.
 *
 * The range is expressed as `[start, end)` where `start` is the first
 * day of the supplied month at 00:00 local time and `end` is the first
 * day of the following month at 00:00 local time (December rolls into
 * January of the next year). Combined with `$gte` / `$lt` predicates
 * this gives the inclusive R12.3 semantics: the last day of the month
 * up to and including 23:59:59.999 is matched, but anything stamped at
 * the next month's first instant is not.
 *
 * Local time is intentional — the server clock determines the
 * "current month/year" default in `resolveListPeriod`, and using the
 * same clock for boundary computation keeps the two ends of the spec
 * consistent.
 *
 * @param {number} month - 1-indexed calendar month
 * @param {number} year
 * @returns {{ start: Date, end: Date }}
 */
function buildMonthRange(month, year) {
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const end = new Date(nextYear, nextMonth - 1, 1, 0, 0, 0, 0);
  return { start, end };
}

/**
 * Round a monetary amount to 2 decimal places.
 *
 * `$sum` of double-typed amounts can drift by sub-cent floating-point
 * error even when every contributing transaction was stored at exactly
 * 2 dp. Rounding the aggregated total (and the derived `remaining`)
 * stops that drift from leaking into the response.
 *
 * @param {number} n
 * @returns {number}
 */
function roundCurrency(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Sum the authenticated user's matching expense transactions, grouped
 * by category, for the given month/year.
 *
 * Implementation notes:
 *   - The aggregation runs in a single round-trip and the `$match`
 *     stage scopes by `user`, `type='expense'`, `category ∈ budgets`,
 *     and the inclusive month range. Categories with no matching
 *     transactions are simply absent from the result and the caller
 *     defaults their spent to 0 (R12.5).
 *   - `req.user._id` is already a `Mongoose ObjectId` in production
 *     (the auth middleware does `User.findById(...)`), but `aggregate`
 *     does not auto-cast `$match` against the schema. We coerce
 *     defensively so the helper also works with hand-built tests that
 *     pass a string id.
 *
 * @param {unknown} userId
 * @param {string[]} categories
 * @param {number} month
 * @param {number} year
 * @returns {Promise<Map<string, number>>} category → rounded total
 */
async function computeSpentByCategory(userId, categories, month, year) {
  if (categories.length === 0) {
    return new Map();
  }

  const userObjectId =
    userId instanceof mongoose.Types.ObjectId
      ? userId
      : new mongoose.Types.ObjectId(String(userId));

  const { start, end } = buildMonthRange(month, year);

  const rows = await Transaction.aggregate([
    {
      $match: {
        user: userObjectId,
        type: 'expense',
        category: { $in: categories },
        date: { $gte: start, $lt: end },
      },
    },
    {
      $group: {
        _id: '$category',
        total: { $sum: '$amount' },
      },
    },
  ]);

  const spentByCategory = new Map();
  for (const row of rows) {
    spentByCategory.set(row._id, roundCurrency(row.total));
  }
  return spentByCategory;
}

/**
 * Produce the JSON-shape budget response for one budget, augmented
 * with the derived spending fields.
 *
 * The persisted Mongoose document is never mutated — `toObject()` gives
 * us a plain JS copy and the derived fields are spread on top. This is
 * what enforces R12.6 in practice: there is no code path here that
 * writes `spent` / `remaining` / `overBudget` back to the database.
 *
 * @param {import('mongoose').Document & { category: string, limit: number }} budget
 * @param {Map<string, number>} spentByCategory
 * @returns {object}
 */
function decorateBudgetWithSpending(budget, spentByCategory) {
  const limit = budget.limit;
  const spent = spentByCategory.get(budget.category) ?? 0;
  const remaining = roundCurrency(limit - spent);
  const overBudget = spent > limit;

  const obj = budget.toObject({ virtuals: false });
  return { ...obj, spent, remaining, overBudget };
}

/**
 * `POST /budgets` handler.
 *
 * Flow:
 *   1. Surface any validation error from `budgetValidators` as a 400
 *      response (R11.2, R11.3, R11.4).
 *   2. Whitelist fields from the body, then create the record via
 *      `scopedCreate` so the persisted `user` is the authenticated owner
 *      (R5.2). Any client-supplied `user` is dropped by both the
 *      whitelist and the ownership helper as defense-in-depth.
 *   3. If the unique index on `(user, category, month, year)` rejects
 *      the insert, translate that to a 409 with a clear message
 *      (R11.5).
 *   4. Respond 201 with the created budget (R11.1).
 *
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function createBudget(req, res, next) {
  try {
    if (rejectIfValidationErrors(req, res)) return;

    const payload = pickBudgetFields(req.body);

    let created;
    try {
      created = await scopedCreate(Budget, req, payload);
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        return res.status(409).json({
          message:
            'A budget for that category and period already exists.',
        });
      }
      throw err;
    }

    return res.status(201).json(created);
  } catch (err) {
    return next(err);
  }
}

/**
 * `GET /budgets` handler — list with computed spending (Task 12.2).
 *
 * Flow:
 *   1. Resolve the target month/year from the query string. When both
 *      `month` and `year` are omitted, the server clock supplies the
 *      current month/year (R12.1). When both are supplied they are
 *      range-checked against R11's bounds (month 1–12, year 1970–2100)
 *      and surfaced as a 400 with a field-identifying message on
 *      failure. Supplying only one of the pair is a 400 ("both or
 *      neither"), matching the symmetry of the transaction list filter
 *      (R10.3).
 *   2. Load the user's budgets for the resolved period via the shared
 *      ownership helper, scoped to `user: req.user._id` (R5.1, R5.4).
 *   3. Compute `spent` per budget from the authenticated user's
 *      *expense* transactions whose category matches the budget and
 *      whose date falls within the inclusive month range
 *      `[first day 00:00, first day of next month 00:00)` (R12.3). The
 *      computation runs as a single grouped aggregation so any number
 *      of budgets in the response is one round-trip to the database.
 *   4. Decorate each budget with `spent`, `remaining = limit − spent`,
 *      and `overBudget = spent > limit` (R12.4). The persisted document
 *      is never modified — the derived fields exist only on the JSON
 *      response (R12.6).
 *
 * An empty result set is returned as `200 []` (no special-casing
 * required by R12.5; an absent budget simply has nothing to report).
 *
 * Validates: Requirements 5.1, 5.4, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getBudgets(req, res, next) {
  try {
    const period = resolveListPeriod(req.query);
    if (period.error) {
      return res.status(400).json({ message: period.error });
    }
    const { month, year } = period;

    // Scope the budget query to the authenticated user *and* the
    // resolved period. Sorting by category keeps the response stable so
    // tests and clients can rely on a deterministic order.
    const budgets = await scopedFind(Budget, req, { month, year }).sort({
      category: 1,
    });

    if (budgets.length === 0) {
      return res.status(200).json([]);
    }

    const spentByCategory = await computeSpentByCategory(
      req.user._id,
      budgets.map((b) => b.category),
      month,
      year,
    );

    const enriched = budgets.map((budget) =>
      decorateBudgetWithSpending(budget, spentByCategory),
    );
    return res.status(200).json(enriched);
  } catch (err) {
    return next(err);
  }
}

/**
 * `GET /budgets/:id` handler.
 *
 * Returns the budget with the given id when it is owned by the
 * authenticated user. A malformed id, a missing record, and a record
 * owned by a different user all collapse to a uniform 404 response so
 * the API does not reveal the existence of another user's record (R5.3,
 * R11.8).
 *
 * Validates: Requirements 5.3, 11.8
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getBudget(req, res, next) {
  try {
    const record = await scopedFindById(Budget, req, req.params.id);
    if (!record) {
      return res.status(404).json({ message: 'Budget not found' });
    }
    return res.status(200).json(record);
  } catch (err) {
    return next(err);
  }
}

/**
 * `PUT /budgets/:id` handler.
 *
 * Flow:
 *   1. Run validators first so an invalid body cannot persist anything,
 *      regardless of ownership (R11.3, R11.4).
 *   2. Apply the sanitized whitelist via `scopedUpdate`. The helper
 *      loads the record by `_id + user`, so a foreign-owner / missing /
 *      malformed id all surface as `null` and are mapped to 404 (R5.3,
 *      R11.8).
 *   3. If the update would collide with the `(user, category, month,
 *      year)` unique index, translate to 409 (R11.5 carried through
 *      R11.6's "subject to the same validation rules").
 *   4. Respond 200 with the updated budget (R11.6).
 *
 * The persisted `user` field is never overwritten — the ownership
 * helper strips `user` from the payload (R5.6).
 *
 * Validates: Requirements 5.3, 5.6, 11.3, 11.4, 11.5, 11.6, 11.8
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function updateBudget(req, res, next) {
  try {
    if (rejectIfValidationErrors(req, res)) return;

    const payload = pickBudgetFields(req.body);

    let updated;
    try {
      updated = await scopedUpdate(Budget, req, req.params.id, payload);
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        return res.status(409).json({
          message:
            'A budget for that category and period already exists.',
        });
      }
      throw err;
    }

    if (!updated) {
      return res.status(404).json({ message: 'Budget not found' });
    }
    return res.status(200).json(updated);
  } catch (err) {
    return next(err);
  }
}

/**
 * `DELETE /budgets/:id` handler.
 *
 * Removes the budget when it is owned by the authenticated user, and
 * responds 200 with a success body. A malformed id, a missing record,
 * or a record owned by a different user all collapse to 404 so the API
 * does not leak the existence of another user's record (R5.3, R11.8).
 *
 * Validates: Requirements 5.3, 11.7, 11.8
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function deleteBudget(req, res, next) {
  try {
    const removed = await scopedDelete(Budget, req, req.params.id);
    if (!removed) {
      return res.status(404).json({ message: 'Budget not found' });
    }
    return res.status(200).json({
      message: 'Budget deleted',
      id: String(removed._id),
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  // Handlers
  createBudget,
  getBudgets,
  getBudget,
  updateBudget,
  deleteBudget,

  // Validator chain
  budgetValidators,

  // Constants exported for tests / re-use
  CATEGORY_MAX,
  MIN_LIMIT,
  MAX_LIMIT,
  MIN_MONTH,
  MAX_MONTH,
  MIN_YEAR,
  MAX_YEAR,
  DUPLICATE_KEY_CODE,
};
