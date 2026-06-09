'use strict';

/**
 * Bill_Service controllers (Task 16.1).
 *
 * Implements full CRUD for the Bill resource on top of the shared
 * ownership helper, so per-user isolation (R5) is enforced uniformly.
 *
 * Exports:
 *   - `billValidators`: a reusable express-validator chain shared by
 *     POST and PUT. It enforces presence and the
 *     name/amount/frequency/nextDueDate bounds from R16.1–R16.4 in a
 *     single place. Optional fields (`category`, `isPaid`, `autoPay`)
 *     are not validated by the chain and pass through; the model schema
 *     validates them on save where applicable.
 *   - `createBill`: POST `/bills` → 201 with the created record (R16.1).
 *   - `getBills`:   GET  `/bills` → 200 with the user's records
 *     (empty array when none, scoped to the authenticated user via
 *     R5.1, R5.4).
 *   - `getBill`:    GET  `/bills/:id` → 200 with the record, or 404
 *     when missing / not owned (R5.3, R16.7).
 *   - `updateBill`: PUT  `/bills/:id` → 200 with the updated record,
 *     or 404 when missing / not owned (R16.5, R16.7).
 *   - `deleteBill`: DELETE `/bills/:id` → 200 with a success payload,
 *     or 404 when missing / not owned (R16.6, R16.7).
 *   - `payBill`:    placeholder for task 16.2 (recurring advancement /
 *     one-time settle, R17). Returns 501 here so the route is reserved
 *     without pretending to implement R17.
 *
 * The persisted `user` is forced by `scopedCreate` / `scopedUpdate` and
 * is never assignable from the request payload (R5.2, R5.6). The
 * `autoPay` default of `false` (R16.8) is supplied by the schema, not
 * the controller, so any create that omits the field gets the right
 * value without controller-side defaulting.
 *
 * Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8
 * (and indirectly Requirements 5.1, 5.2, 5.3, 5.4, 5.6 via the
 * ownership helper).
 */

const { body, validationResult } = require('express-validator');

const Bill = require('../models/Bill');
const { BILL_FREQUENCIES } = require('../models/Bill');
const {
  scopedFind,
  scopedFindById,
  scopedCreate,
  scopedUpdate,
  scopedDelete,
} = require('../utils/ownership');

/**
 * Field bounds for bills. Mirror the model and the requirements exactly
 * so the validator and the schema agree on what "valid" means.
 *
 *   R16.1: name 1–100 chars; amount in (0, 999,999,999.99] with ≤ 2 dp.
 *   R16.1: frequency ∈ {monthly, weekly, yearly, one-time}.
 *
 * Exported so tests assert against the same constants the controller
 * uses rather than duplicating literals.
 */
const NAME_MAX = 100;
const MIN_AMOUNT = 0.01; // smallest representable positive amount at 2 dp
const MAX_AMOUNT = 999999999.99;

/**
 * Coerce a request-supplied numeric field (amount) to a finite Number
 * when possible.
 *
 * Numeric fields may arrive as JSON numbers (typical) or numeric strings
 * (form-encoded clients). Returning `null` for anything that can't be
 * cleanly interpreted as a finite number lets the validator surface a
 * single, uniform "amount is invalid" message rather than attaching
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
 * Validate a coerced amount against R16.1 / R16.4:
 *   - finite number,
 *   - strictly greater than 0,
 *   - not greater than 999,999,999.99,
 *   - at most 2 decimal places.
 *
 * Throws an `Error` (caught by express-validator) whose message
 * identifies which sub-rule was violated, matching R16.4's "validation
 * message indicating the amount is invalid" requirement. The shape
 * mirrors the transaction validator so clients see a single, predictable
 * "amount is invalid" surface across resources.
 *
 * @param {unknown} raw - The original request value.
 * @returns {true} on success (express-validator semantics)
 */
function validateAmount(raw) {
  const value = coerceNumber(raw);
  if (value === null) {
    throw new Error('amount is invalid');
  }
  if (value <= 0) {
    throw new Error('amount must be greater than 0');
  }
  if (value > MAX_AMOUNT) {
    throw new Error('amount must be at most 999,999,999.99');
  }
  // Round-trip via toFixed(2) to detect more than 2 decimal places.
  // This mirrors the model-level validator so the controller and the
  // schema agree on what "≤ 2 dp" means for floating-point inputs.
  if (Number(value.toFixed(2)) !== value) {
    throw new Error('amount must have at most 2 decimal places');
  }
  return true;
}

/**
 * Validate a `nextDueDate` value. The value must parse to a valid Date
 * — anything else is rejected as 400 (R16.1: "valid `nextDueDate`").
 *
 * Numbers, ISO strings, and Date instances all flow through the Date
 * constructor; NaN signals an unparseable input.
 *
 * @param {unknown} raw
 * @returns {true}
 */
function validateNextDueDate(raw) {
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error('nextDueDate must be a valid calendar date');
  }
  return true;
}

/**
 * Validation chain shared by POST `/bills` and PUT `/bills/:id`.
 *
 * Both endpoints take a full bill representation, so the same chain
 * works for create and update — symmetric with the investment
 * controller. Each field is checked in three stages so the first
 * reported error matches the most natural failure mode:
 *
 *   1. presence (`exists` + `isString` for strings) — R16.2 "missing
 *      field",
 *   2. emptiness check (after trimming for strings) — R16.2,
 *   3. format / range / enum — R16.1, R16.3, R16.4.
 *
 * @type {import('express').RequestHandler[]}
 */
const billValidators = [
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

  // --- amount ---
  body('amount')
    .exists({ checkNull: true })
    .withMessage('amount is required')
    .bail()
    .custom(validateAmount),

  // --- frequency ---
  body('frequency')
    .exists({ checkNull: true })
    .withMessage('frequency is required')
    .bail()
    .isString()
    .withMessage('frequency is required')
    .bail()
    .customSanitizer((v) => v.trim())
    .notEmpty()
    .withMessage('frequency is required')
    .bail()
    .isIn(BILL_FREQUENCIES)
    .withMessage(`frequency must be one of: ${BILL_FREQUENCIES.join(', ')}`),

  // --- nextDueDate ---
  body('nextDueDate')
    .exists({ checkNull: true })
    .withMessage('nextDueDate is required')
    .bail()
    .custom(validateNextDueDate),
];

/**
 * Whitelist of fields a client may set on a bill.
 *
 * `user` is intentionally excluded — ownership is forced by the shared
 * helper (R5.2, R5.6) and a client-supplied `user` is silently dropped.
 * Optional model fields are passed through so callers can supply them
 * without a controller change. `isPaid` and `autoPay` are exposed here
 * so a client can configure auto-pay on create or toggle it on update;
 * advancing `nextDueDate` based on a payment lives in task 16.2's
 * `/pay` handler, not in the generic update path.
 */
const ALLOWED_FIELDS = [
  'name',
  'amount',
  'frequency',
  'nextDueDate',
  'category',
  'isPaid',
  'autoPay',
];

/**
 * Build a clean payload from the request body that contains only the
 * whitelisted bill fields and coerces the numeric fields when they look
 * like numbers. Used by both create and update so an extra field
 * (e.g. `user`, `_id`, anything else) cannot sneak through.
 *
 * @param {Record<string, unknown>} body
 * @returns {Record<string, unknown>}
 */
function pickBillFields(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }
  const out = {};
  for (const key of ALLOWED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const value = body[key];
    if (key === 'amount') {
      const coerced = coerceNumber(value);
      out[key] = coerced === null ? value : coerced;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Translate any errors collected by `billValidators` into a uniform
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
 * `POST /bills` handler.
 *
 * Flow:
 *   1. Surface any validation error from `billValidators` as a 400
 *      response (R16.2, R16.3, R16.4).
 *   2. Whitelist fields from the body, then create the record via
 *      `scopedCreate` so the persisted `user` is the authenticated owner
 *      (R5.2). Any client-supplied `user` is dropped by both the
 *      whitelist and the ownership helper as defense-in-depth.
 *   3. Respond 201 with the created bill (R16.1). When `autoPay` is
 *      omitted the schema applies its default of `false` (R16.8).
 *
 * Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.8
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function createBill(req, res, next) {
  try {
    if (rejectIfValidationErrors(req, res)) return;

    const payload = pickBillFields(req.body);
    const created = await scopedCreate(Bill, req, payload);

    return res.status(201).json(created);
  } catch (err) {
    return next(err);
  }
}

/**
 * `GET /bills` handler.
 *
 * Returns every bill owned by the authenticated user as a JSON array,
 * empty when the user has none. Per R5.1/R5.4 the query is scoped to
 * `user: req.user._id`; records owned by a different user are excluded.
 * Sorted by `nextDueDate` ascending so soonest-due bills come first —
 * the natural display order for a bill list.
 *
 * Validates: Requirements 5.1, 5.4
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getBills(req, res, next) {
  try {
    const records = await scopedFind(Bill, req).sort({ nextDueDate: 1 });
    return res.status(200).json(records);
  } catch (err) {
    return next(err);
  }
}

/**
 * `GET /bills/:id` handler.
 *
 * Returns the bill with the given id when it is owned by the
 * authenticated user. A malformed id, a missing record, and a record
 * owned by a different user all collapse to a uniform 404 response so
 * the API does not reveal the existence of another user's record (R5.3,
 * R16.7).
 *
 * Validates: Requirements 5.3, 16.7
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getBill(req, res, next) {
  try {
    const record = await scopedFindById(Bill, req, req.params.id);
    if (!record) {
      return res.status(404).json({ message: 'Bill not found' });
    }
    return res.status(200).json(record);
  } catch (err) {
    return next(err);
  }
}

/**
 * `PUT /bills/:id` handler.
 *
 * Flow:
 *   1. Run validators first so an invalid body cannot persist anything,
 *      regardless of ownership (R16.3, R16.4).
 *   2. Apply the sanitized whitelist via `scopedUpdate`. The helper
 *      loads the record by `_id + user`, so a foreign-owner / missing /
 *      malformed id all surface as `null` and are mapped to 404 (R5.3,
 *      R16.7).
 *   3. Respond 200 with the updated bill (R16.5).
 *
 * The persisted `user` field is never overwritten — the ownership
 * helper strips `user` from the payload (R5.6).
 *
 * Validates: Requirements 5.3, 5.6, 16.3, 16.4, 16.5, 16.7
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function updateBill(req, res, next) {
  try {
    if (rejectIfValidationErrors(req, res)) return;

    const payload = pickBillFields(req.body);
    const updated = await scopedUpdate(Bill, req, req.params.id, payload);

    if (!updated) {
      return res.status(404).json({ message: 'Bill not found' });
    }
    return res.status(200).json(updated);
  } catch (err) {
    return next(err);
  }
}

/**
 * `DELETE /bills/:id` handler.
 *
 * Removes the bill when it is owned by the authenticated user, and
 * responds 200 with a success body. A malformed id, a missing record,
 * or a record owned by a different user all collapse to 404 so the API
 * does not leak the existence of another user's record (R5.3, R16.7).
 *
 * Validates: Requirements 5.3, 16.6, 16.7
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function deleteBill(req, res, next) {
  try {
    const removed = await scopedDelete(Bill, req, req.params.id);
    if (!removed) {
      return res.status(404).json({ message: 'Bill not found' });
    }
    return res.status(200).json({
      message: 'Bill deleted',
      id: String(removed._id),
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * Advance a date by exactly one calendar month, mutating the supplied
 * Date instance in place. Implemented via `setMonth(getMonth() + 1)` so
 * JavaScript's native overflow semantics handle rollovers — e.g. Jan 31
 * rolls forward to early March and Dec 15 rolls into January of the
 * next year — which matches the design's "+1 calendar month" wording
 * (R17.1) and is the conventional interpretation across the ecosystem.
 *
 * @param {Date} d
 */
function advanceMonth(d) {
  d.setMonth(d.getMonth() + 1);
}

/**
 * Advance a date by exactly seven days (R17.2), mutating in place.
 * Using `setDate(getDate() + 7)` keeps the time-of-day component intact
 * and lets the Date object handle month/year rollovers automatically.
 *
 * @param {Date} d
 */
function advanceWeek(d) {
  d.setDate(d.getDate() + 7);
}

/**
 * Advance a date by exactly one calendar year (R17.3), mutating in
 * place. `setFullYear(getFullYear() + 1)` lets JavaScript handle the
 * Feb-29 edge case the same way the rest of the runtime does (Feb 29
 * → Mar 1 in a non-leap year), keeping behavior consistent with the
 * `+1 month` and `+7 days` paths.
 *
 * @param {Date} d
 */
function advanceYear(d) {
  d.setFullYear(d.getFullYear() + 1);
}

/**
 * `PATCH /bills/:id/pay` handler — Task 16.2.
 *
 * Records a payment against the bill identified by `req.params.id` and
 * advances or settles it according to its `frequency`:
 *
 *   - `monthly`  → advance `nextDueDate` by +1 calendar month, set
 *                   `isPaid = false` so the next cycle starts unpaid.
 *   - `weekly`   → advance `nextDueDate` by +7 days, set `isPaid = false`.
 *   - `yearly`   → advance `nextDueDate` by +1 calendar year, set
 *                   `isPaid = false`.
 *   - `one-time` (unpaid) → set `isPaid = true`; `nextDueDate` is left
 *                   unchanged because a one-time obligation is settled,
 *                   not rescheduled.
 *   - `one-time` (already paid) → reject with HTTP 400; the bill is
 *                   already settled and re-paying it has no defined
 *                   semantics (R17.4 path).
 *
 * Ownership flow:
 *   - `scopedFindById` collapses missing record / malformed id /
 *     foreign-owner into `null`, which surfaces as a uniform 404
 *     response (R5.3, R17.4) — the API does not reveal whether another
 *     user happens to own the id.
 *
 * Persistence flow:
 *   - The `Date` instance from the loaded document is cloned (`new
 *     Date(...)`) before mutation so unrelated references on the
 *     in-memory document — for instance, anything that already captured
 *     `nextDueDate` — are not silently re-pointed. The cloned Date is
 *     advanced by the appropriate frequency helper and assigned back to
 *     the document, then `.save()` runs the schema validators (so an
 *     advanced date that somehow becomes invalid is still rejected).
 *
 * Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.5
 *           (and indirectly 5.1, 5.3, 5.4 via the ownership helper).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function payBill(req, res, next) {
  try {
    const bill = await scopedFindById(Bill, req, req.params.id);
    if (!bill) {
      // Missing, malformed, or owned by a different user — all collapse
      // to 404 to avoid confirming the existence of foreign records
      // (R5.3, R17.4).
      return res.status(404).json({ message: 'Bill not found' });
    }

    if (bill.frequency === 'one-time') {
      // R17.4: paying an already-paid one-time bill has no defined
      // semantics — surface a 400 with a clear message and leave the
      // record untouched.
      if (bill.isPaid === true) {
        return res.status(400).json({ message: 'Bill is already paid' });
      }
      // R17.3 path for one-time bills: settle the obligation. The next
      // due date is intentionally not advanced — a one-time bill has no
      // next cycle.
      bill.isPaid = true;
    } else {
      // Recurring bills (R17.1, R17.2, R17.3): clone the existing date,
      // advance it by the cadence appropriate to the frequency, and
      // mark the bill unpaid so the next cycle starts in the open
      // state.
      const advanced = new Date(bill.nextDueDate);
      switch (bill.frequency) {
        case 'monthly':
          advanceMonth(advanced);
          break;
        case 'weekly':
          advanceWeek(advanced);
          break;
        case 'yearly':
          advanceYear(advanced);
          break;
        default:
          // The model's enum keeps this branch unreachable, but failing
          // loudly is safer than silently no-op'ing if a future
          // frequency is added without updating the controller.
          return next(
            Object.assign(new Error(`Unsupported frequency: ${bill.frequency}`), {
              statusCode: 500,
            })
          );
      }
      bill.nextDueDate = advanced;
      bill.isPaid = false;
    }

    await bill.save();
    return res.status(200).json(bill);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  // Handlers
  createBill,
  getBills,
  getBill,
  updateBill,
  deleteBill,
  payBill,

  // Validator chain
  billValidators,

  // Constants exported for tests / re-use
  NAME_MAX,
  MIN_AMOUNT,
  MAX_AMOUNT,
  BILL_FREQUENCIES,
};
