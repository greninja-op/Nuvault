'use strict';

/**
 * Transaction_Service controller (Tasks 11.1 + 11.2).
 *
 * Implements the Transaction CRUD surface backed by the shared ownership
 * helper, plus the validation chains driven by `express-validator`. Task
 * 11.2 extends the list and summary surface with optional month/year
 * filtering (R10.1–R10.3) and a category-grouped income/expense summary
 * (R10.4–R10.5).
 *
 * Responsibilities:
 *   - `createTransaction`  → POST /api/transactions
 *   - `getTransactions`    → GET  /api/transactions
 *                                  (optional ?month=&year= filter, sorted
 *                                   by date desc; default returns all)
 *   - `getTransaction`     → GET  /api/transactions/:id
 *   - `updateTransaction`  → PUT  /api/transactions/:id
 *   - `deleteTransaction`  → DELETE /api/transactions/:id
 *   - `getSummary`         → GET  /api/transactions/summary
 *                                  (income/expense totals grouped by
 *                                   category; same optional ?month=&year=
 *                                   filter; empty scope → 200 with empty
 *                                   `{ income: [], expense: [] }`)
 *
 * Validation contract (express-validator):
 *   - `type`     ∈ {income, expense}                                  (R9.3)
 *   - `category` 1–100 chars (after trim)                              (R9.1)
 *   - `amount`   > 0, ≤ 999,999,999.99, ≤ 2 decimal places             (R9.4)
 *   - `date`     optional; when provided must parse to a valid Date    (R9.5)
 *   - `description`/`tags` are optional pass-through fields
 *   - `?month`   optional integer 1–12                                 (R10.2)
 *   - `?year`    optional integer 1970–9999                            (R10.2)
 *   - month/year MUST be supplied together (both-or-neither, R10.3)
 *
 * On the create path every required field's absence is a 400 with a
 * field-identifying message (R9.2). On the update path every field is
 * optional but is still validated against the same rules when present
 * (R9.3, R9.4) — the chain uses `.optional()` so omitted fields skip
 * validation entirely and the controller applies a partial update.
 *
 * Per-user isolation is enforced exclusively through the shared
 * ownership helper. Cross-user reads, updates, and deletes resolve to
 * `null` and are mapped to a 404 (R5.3, R9.8). The `user` field is
 * never assignable from the client payload (R5.2, R5.6) — the helper
 * strips it on every create/update call.
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8,
 *            10.1, 10.2, 10.3, 10.4, 10.5.
 */

const { body, query, validationResult } = require('express-validator');

const Transaction = require('../models/Transaction');
const { TRANSACTION_TYPES } = require('../models/Transaction');
const {
  scopedFind,
  scopedFindById,
  scopedCreate,
  scopedUpdate,
  scopedDelete,
} = require('../utils/ownership');

/**
 * Maximum allowable monetary amount per Requirement 9.1 / 9.4. Mirrors
 * the model bound and is exported so tests can assert against the same
 * constant the controller uses.
 *
 * @type {number}
 */
const MAX_AMOUNT = 999999999.99;

/**
 * Maximum length of the `category` field per Requirement 9.1.
 *
 * @type {number}
 */
const MAX_CATEGORY_LEN = 100;

/**
 * Lower bound of the year filter accepted by `list` / `summary`. Mirrors
 * the range stated by Requirement 10.2 ("year in the range 1970 to
 * 9999"); the controller and the validator chain agree on this constant
 * so a single source of truth governs both the rejection path and the
 * date-range construction.
 *
 * @type {number}
 */
const MIN_FILTER_YEAR = 1970;

/**
 * Upper bound of the year filter (Requirement 10.2). Note this is
 * deliberately wider than the budget year bound (1970–2100) — see
 * R10.2 vs R11.3; they are different requirements and must not be
 * conflated.
 *
 * @type {number}
 */
const MAX_FILTER_YEAR = 9999;

/**
 * Coerce a request-supplied amount to a finite Number when possible.
 *
 * `body('amount')` may arrive as a JSON number (typical) or a numeric
 * string (e.g. form-encoded clients). Returning `null` for anything that
 * can't be cleanly interpreted as a finite number lets the validator
 * surface a single, uniform "amount is invalid" message rather than
 * attaching wildly different errors to typed-vs-string inputs.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
function coerceAmount(value) {
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
 * Validate a coerced amount against the R9.4 contract:
 *   - finite number,
 *   - strictly greater than 0,
 *   - not greater than 999,999,999.99,
 *   - at most 2 decimal places.
 *
 * Throws an `Error` (caught by express-validator) with a message that
 * identifies which sub-rule was violated. The wording is consistent with
 * the validation messages used by the model and the auth controller so
 * clients see a single, predictable "amount is invalid" surface.
 *
 * @param {unknown} raw - The original request value.
 * @returns {true} on success (express-validator semantics)
 */
function validateAmount(raw) {
  const value = coerceAmount(raw);
  if (value === null) {
    throw new Error('amount is invalid');
  }
  if (value <= 0) {
    throw new Error('amount must be greater than 0');
  }
  if (value > MAX_AMOUNT) {
    throw new Error('amount must be at most 999,999,999.99');
  }
  // Round-trip via toFixed(2) to detect more than 2 decimal places. This
  // mirrors the model-level validator so the controller and the schema
  // agree on what "≤ 2 dp" means for floating-point inputs.
  if (Number(value.toFixed(2)) !== value) {
    throw new Error('amount must have at most 2 decimal places');
  }
  return true;
}

/**
 * Validate an optional `date` value. When present, the value must parse
 * to a valid Date — anything else is rejected as `400`. Omitting the
 * field is fine; the schema default applies the creation time (R9.5).
 *
 * @param {unknown} raw
 * @returns {true}
 */
function validateDate(raw) {
  // ISO date strings, epoch numbers, and Date instances all flow through
  // the Date constructor. NaN signals an unparsable input.
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error('date is invalid');
  }
  return true;
}

/**
 * Validation chain for `POST /api/transactions`.
 *
 * Order mirrors the auth controller: presence checks first (so empty /
 * missing fields produce a 400 with a field-identifying message per
 * R9.2), then type/range/format checks (R9.3, R9.4). `bail()` after each
 * presence check prevents follow-on validators from running against
 * `undefined`.
 *
 * @type {import('express').RequestHandler[]}
 */
const createTransactionValidators = [
  // --- type ---
  body('type')
    .exists({ checkNull: true })
    .withMessage('type is required')
    .bail()
    .isIn(TRANSACTION_TYPES)
    .withMessage(`type must be one of: ${TRANSACTION_TYPES.join(', ')}`),

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
    .isLength({ max: MAX_CATEGORY_LEN })
    .withMessage(`category must be 1 to ${MAX_CATEGORY_LEN} characters`),

  // --- amount ---
  body('amount')
    .exists({ checkNull: true })
    .withMessage('amount is required')
    .bail()
    .custom(validateAmount),

  // --- date (optional) ---
  body('date').optional().custom(validateDate),

  // --- description / tags (optional, untyped pass-through) ---
  body('description').optional().isString().withMessage('description must be a string'),
  body('tags').optional().isArray().withMessage('tags must be an array of strings'),
];

/**
 * Validation chain for `PUT /api/transactions/:id`.
 *
 * Every field is optional on update — the controller applies a partial
 * patch via the ownership helper — but when a field is supplied it is
 * validated against the exact same rules as the create path (R9.3,
 * R9.4). Omitted fields skip validation thanks to `.optional()`.
 *
 * @type {import('express').RequestHandler[]}
 */
const updateTransactionValidators = [
  body('type')
    .optional()
    .isIn(TRANSACTION_TYPES)
    .withMessage(`type must be one of: ${TRANSACTION_TYPES.join(', ')}`),

  body('category')
    .optional()
    .isString()
    .withMessage('category must be a string')
    .bail()
    .customSanitizer((v) => v.trim())
    .isLength({ min: 1, max: MAX_CATEGORY_LEN })
    .withMessage(`category must be 1 to ${MAX_CATEGORY_LEN} characters`),

  body('amount').optional().custom(validateAmount),

  body('date').optional().custom(validateDate),

  body('description').optional().isString().withMessage('description must be a string'),
  body('tags').optional().isArray().withMessage('tags must be an array of strings'),
];

/**
 * Validation chain for `GET /api/transactions` and
 * `GET /api/transactions/summary`.
 *
 * Both endpoints accept an optional `month`/`year` filter that must be
 * supplied as a both-or-neither pair (R10.3). When supplied, `month`
 * must be a 1–12 integer and `year` must fall within {@link MIN_FILTER_YEAR}
 * and {@link MAX_FILTER_YEAR} (R10.2). Out-of-range values, non-integer
 * inputs, and "only one of month/year" all surface as a uniform 400.
 *
 * `optional({ values: 'falsy' })` treats `undefined`, `null`, and empty
 * strings as "not supplied" — matching how the both-or-neither check
 * inspects the raw query — so a request with `?month=&year=` is treated
 * the same as no filter, not as "only one supplied".
 *
 * The `.toInt()` sanitizer at the end of each chain converts the
 * validated string into a finite Number that the handler can hand
 * directly to `Date.UTC` without re-parsing.
 *
 * @type {import('express').RequestHandler[]}
 */
const listFilterValidators = [
  // Both-or-neither check (R10.3). Runs against the *raw* query so it
  // catches the asymmetry before sanitization rewrites the values, and
  // independently of the per-field optional rules below.
  query('month').custom((_value, { req }) => {
    const m = req.query ? req.query.month : undefined;
    const y = req.query ? req.query.year : undefined;
    const hasMonth = m !== undefined && m !== null && m !== '';
    const hasYear = y !== undefined && y !== null && y !== '';
    if (hasMonth !== hasYear) {
      throw new Error('month and year must be supplied together');
    }
    return true;
  }),

  query('month')
    .optional({ values: 'falsy' })
    .isInt({ min: 1, max: 12 })
    .withMessage('month must be an integer between 1 and 12')
    .toInt(),

  query('year')
    .optional({ values: 'falsy' })
    .isInt({ min: MIN_FILTER_YEAR, max: MAX_FILTER_YEAR })
    .withMessage(`year must be an integer between ${MIN_FILTER_YEAR} and ${MAX_FILTER_YEAR}`)
    .toInt(),
];

/**
 * Bundle of validator chains for the routes layer to mount. Exported as
 * an object so the router can index it by HTTP method intent and so
 * future tasks can extend it without a breaking import shape change.
 */
const transactionValidators = {
  create: createTransactionValidators,
  update: updateTransactionValidators,
  list: listFilterValidators,
};

/**
 * Translate any errors collected by an express-validator chain into a
 * uniform `400 { message }` response that carries only the first error's
 * message (consistent with the auth controller). When no errors are
 * present the function returns `null` and the caller proceeds.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {import('express').Response | null}
 */
function rejectIfValidationFailed(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  const first = errors.array({ onlyFirstError: true })[0];
  return res.status(400).json({ message: first.msg });
}

/**
 * `POST /api/transactions` — create a transaction owned by the
 * authenticated user.
 *
 * Flow:
 *   1. Translate validator errors to 400 with a field-identifying
 *      message (R9.2, R9.3, R9.4).
 *   2. Hand the sanitized payload to `scopedCreate`, which discards any
 *      `user` field on the request body and persists the record with
 *      `user: req.user._id` (R5.2). When `date` is omitted the schema
 *      default applies the creation time (R9.5).
 *   3. Respond `201` with the created transaction (R9.1).
 *
 * Any unexpected error (including Mongoose `ValidationError` for cases
 * the express-validator chain didn't catch) propagates to the uniform
 * error handler via `next(err)`.
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function createTransaction(req, res, next) {
  try {
    const validationResponse = rejectIfValidationFailed(req, res);
    if (validationResponse) return validationResponse;

    // The amount may have arrived as a string (form-encoded clients);
    // coerce to a number so the persisted value is uniformly numeric.
    const payload = { ...req.body };
    if (payload.amount !== undefined) {
      const coerced = coerceAmount(payload.amount);
      if (coerced !== null) payload.amount = coerced;
    }

    const created = await scopedCreate(Transaction, req, payload);
    return res.status(201).json(created);
  } catch (err) {
    return next(err);
  }
}

/**
 * `GET /api/transactions` — list transactions owned by the authenticated
 * user, sorted by date descending.
 *
 * Filtering (Task 11.2):
 *   - With no `month`/`year` query parameters: return every transaction
 *     owned by the authenticated user, sorted by date descending
 *     (R10.1).
 *   - With both `month` and `year` supplied: return only the user's
 *     transactions whose `date` falls within the requested calendar
 *     month, computed in UTC (R10.2). The filter uses an inclusive-start
 *     / exclusive-next-month-start range so a transaction stored
 *     exactly at `2024-01-31T23:59:59.999Z` is included when
 *     `month=1&year=2024` and excluded when `month=2&year=2024`.
 *   - With only one of `month`/`year`, or with values out of the
 *     accepted range, the request is rejected by the validator chain
 *     with a uniform 400 (R10.3).
 *
 * The empty-result path returns `200` with `[]` so callers can iterate
 * without special-casing missing data (R10.5 by way of the list
 * surface; the explicit summary contract is enforced in `getSummary`).
 *
 * Per-user isolation flows through the shared ownership helper, so a
 * transaction owned by a different user is never returned from this
 * endpoint (R5.1, R5.4).
 *
 * Validates: Requirements 10.1, 10.2, 10.3 (with the matching
 * validator chain), and the descending-by-date ordering used by the
 * design's route map.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getTransactions(req, res, next) {
  try {
    const validationResponse = rejectIfValidationFailed(req, res);
    if (validationResponse) return validationResponse;

    const dateFilter = buildMonthDateFilter(req.query);
    const filter = dateFilter ? { date: dateFilter } : {};

    const transactions = await scopedFind(Transaction, req, filter).sort({ date: -1 });
    return res.status(200).json(transactions);
  } catch (err) {
    return next(err);
  }
}

/**
 * `GET /api/transactions/:id` — fetch a single transaction owned by the
 * authenticated user.
 *
 * The shared helper returns `null` when:
 *   - the id is malformed (otherwise Mongoose would throw a CastError),
 *   - no record with that id exists, or
 *   - a record exists but is owned by a different user (R5.3).
 * All three cases collapse into a uniform 404 so the API never confirms
 * the existence of another user's record (R9.8).
 *
 * Validates: Requirements 9.8 (and R5.3 via the helper).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getTransaction(req, res, next) {
  try {
    const transaction = await scopedFindById(Transaction, req, req.params.id);
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }
    return res.status(200).json(transaction);
  } catch (err) {
    return next(err);
  }
}

/**
 * `PUT /api/transactions/:id` — update a transaction owned by the
 * authenticated user.
 *
 * The update is a partial patch: every field is optional but is
 * validated against the same rules as create when supplied. The shared
 * helper enforces ownership: a request targeting another user's
 * transaction (or a missing id) resolves to `null` and is mapped to 404
 * (R9.8) without touching the underlying record. The persisted `user`
 * field is never reassigned from the payload (R5.6).
 *
 * Validates: Requirements 9.3, 9.4, 9.6, 9.8
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function updateTransaction(req, res, next) {
  try {
    const validationResponse = rejectIfValidationFailed(req, res);
    if (validationResponse) return validationResponse;

    const payload = { ...req.body };
    if (payload.amount !== undefined) {
      const coerced = coerceAmount(payload.amount);
      if (coerced !== null) payload.amount = coerced;
    }

    const updated = await scopedUpdate(Transaction, req, req.params.id, payload);
    if (!updated) {
      return res.status(404).json({ message: 'Transaction not found' });
    }
    return res.status(200).json(updated);
  } catch (err) {
    return next(err);
  }
}

/**
 * `DELETE /api/transactions/:id` — delete a transaction owned by the
 * authenticated user.
 *
 * Mirrors the get/update isolation contract: cross-user / missing /
 * malformed-id deletes resolve to `null` from the helper and are mapped
 * to a 404 with the underlying record left untouched (R9.8).
 *
 * Validates: Requirements 9.7, 9.8
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function deleteTransaction(req, res, next) {
  try {
    const deleted = await scopedDelete(Transaction, req, req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: 'Transaction not found' });
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    return next(err);
  }
}

/**
 * Build a `{ $gte, $lt }` Mongo filter spanning the requested calendar
 * month, or `null` when no month/year filter was supplied.
 *
 * The validator chain has already converted `month` and `year` to
 * integers via `.toInt()`, but the function tolerates string inputs as
 * well so callers using a sanitized-but-still-stringified `req.query`
 * snapshot (e.g. tests bypassing the chain) get the same result.
 *
 * The date range is constructed in UTC and uses an inclusive-start /
 * exclusive-next-month-start interval. This is the standard Mongo
 * "month bucket" idiom: it keeps DST and timezone considerations out
 * of the comparison and includes records stored at the very last
 * millisecond of the month without a fragile `999ms` fudge.
 *
 * Returns `null` when either parameter is missing, so the caller can
 * `if (!dateFilter)` to skip the date clause entirely.
 *
 * @param {{ month?: unknown, year?: unknown } | undefined} q
 * @returns {{ $gte: Date, $lt: Date } | null}
 */
function buildMonthDateFilter(q) {
  if (!q) return null;
  const monthRaw = q.month;
  const yearRaw = q.year;
  if (
    monthRaw === undefined || monthRaw === null || monthRaw === '' ||
    yearRaw === undefined || yearRaw === null || yearRaw === ''
  ) {
    return null;
  }
  const month = Number(monthRaw);
  const year = Number(yearRaw);
  if (!Number.isFinite(month) || !Number.isFinite(year)) return null;

  // Date.UTC's month parameter rolls over from 11 to the next year for
  // us, which is exactly what we want for the December → January
  // boundary. e.g. Date.UTC(2024, 12, 1) === Date.UTC(2025, 0, 1).
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { $gte: start, $lt: end };
}

/**
 * `GET /api/transactions/summary` — income and expense totals grouped
 * by category for the authenticated user (R10.4).
 *
 * Behavior:
 *   - With no `month`/`year` filter, summarizes every transaction owned
 *     by the user.
 *   - With both `month` and `year` (validated by the same list filter
 *     chain), summarizes only the transactions whose date falls within
 *     that calendar month — the same range used by the list endpoint.
 *   - When the requested scope contains no transactions, responds with
 *     `200` and the empty shape `{ income: [], expense: [] }` instead
 *     of an error (R10.5).
 *   - The grouping itself is performed by a single Mongo aggregation
 *     pipeline so totals are computed server-side without streaming
 *     every record back into Node memory.
 *
 * Response shape:
 *   ```
 *   {
 *     "income":  [{ "category": "salary",    "total": 5000 }, ...],
 *     "expense": [{ "category": "groceries", "total":  234 }, ...]
 *   }
 *   ```
 *   Each array is sorted alphabetically by category so consecutive
 *   responses for the same data are deterministic — useful for both
 *   tests and clients that diff renders.
 *
 * Per-user isolation: the `$match` stage scopes by `req.user._id` so
 * no other user's transactions can ever contribute to the totals
 * (R5.1, R5.4). The `user` field is sourced exclusively from
 * `req.user`; the request payload is irrelevant for this endpoint.
 *
 * Validates: Requirements 10.4, 10.5 (and 10.2, 10.3 via the shared
 * `listFilterValidators` chain).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getSummary(req, res, next) {
  try {
    const validationResponse = rejectIfValidationFailed(req, res);
    if (validationResponse) return validationResponse;

    const match = { user: req.user._id };
    const dateFilter = buildMonthDateFilter(req.query);
    if (dateFilter) {
      match.date = dateFilter;
    }

    // Group by (type, category) and sum the amount. A single pipeline
    // returns both income and expense rows; we pivot them into the
    // response shape in JS to keep the aggregation simple and to make
    // the empty-scope branch (R10.5) trivially expressible.
    const grouped = await Transaction.aggregate([
      { $match: match },
      {
        $group: {
          _id: { type: '$type', category: '$category' },
          total: { $sum: '$amount' },
        },
      },
    ]);

    /** @type {{ income: Array<{ category: string, total: number }>, expense: Array<{ category: string, total: number }> }} */
    const result = { income: [], expense: [] };

    for (const row of grouped) {
      const { type, category } = row._id || {};
      // Defensive: only types in {income, expense} can ever be persisted
      // (the schema enum + create/update validators forbid anything
      // else), but skipping unknown types keeps the response shape
      // honest if the data ever drifts.
      if (type === 'income' || type === 'expense') {
        result[type].push({ category, total: row.total });
      }
    }

    // Stable, alphabetical ordering per type. Aggregation output order
    // is otherwise unspecified.
    result.income.sort((a, b) => a.category.localeCompare(b.category));
    result.expense.sort((a, b) => a.category.localeCompare(b.category));

    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  // Handlers
  createTransaction,
  getTransactions,
  getTransaction,
  updateTransaction,
  deleteTransaction,
  getSummary,

  // Validator chains (bundled and individually exported for flexibility)
  transactionValidators,
  createTransactionValidators,
  updateTransactionValidators,
  listFilterValidators,

  // Constants exported for tests / re-use
  MAX_AMOUNT,
  MAX_CATEGORY_LEN,
  MIN_FILTER_YEAR,
  MAX_FILTER_YEAR,
};
