'use strict';

/**
 * Liability_Service controllers (Task 9.1).
 *
 * Implements full CRUD for the Liability resource on top of the shared
 * ownership helper, so per-user isolation (R5) is enforced uniformly.
 *
 * Exports:
 *   - `liabilityValidators`: a reusable express-validator chain shared by
 *     POST and PUT. It enforces presence and the type/amount/name bounds
 *     from R7.1–R7.4 in a single place. Optional fields (`interestRate`,
 *     `dueDate`, `notes`) are not validated by the chain and pass through;
 *     the model schema validates them on save.
 *   - `createLiability`: POST `/liabilities` → 201 with the created record.
 *   - `getLiabilities`: GET `/liabilities` → 200 with the user's records
 *     (empty array when none).
 *   - `getLiability`: GET `/liabilities/:id` → 200 with the record, or 404
 *     when missing / not owned (R5.3, R7.7).
 *   - `updateLiability`: PUT `/liabilities/:id` → 200 with the updated
 *     record, or 404 when missing / not owned (R7.5, R7.7).
 *   - `deleteLiability`: DELETE `/liabilities/:id` → 200 with a success
 *     payload, or 404 when missing / not owned (R7.6, R7.7).
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
 * (and indirectly Requirements 5.1, 5.2, 5.3, 5.4, 5.6 via the ownership
 * helper).
 */

const { body, validationResult } = require('express-validator');

const Liability = require('../models/Liability');
const {
  scopedFind,
  scopedFindById,
  scopedCreate,
  scopedUpdate,
  scopedDelete,
} = require('../utils/ownership');

/**
 * Field bounds for liabilities.
 *
 * The constants are exported alongside the controllers so tests assert
 * against the exact same numbers the validators use.
 *
 * R7.1: name 1-100 chars; amount 0.01-999,999,999.99.
 * R7.1: type ∈ {loan, credit_card, mortgage, other}.
 */
const NAME_MAX = 100;
const MIN_AMOUNT = 0.01;
const MAX_AMOUNT = 999999999.99;
const LIABILITY_TYPES = ['loan', 'credit_card', 'mortgage', 'other'];

/**
 * Validation chain shared by POST `/liabilities` and PUT `/liabilities/:id`.
 *
 * Both endpoints take a full liability representation, so the same chain
 * works for create and update. Each field is checked in three steps so the
 * first reported error matches the most natural failure mode:
 *
 *   1. presence (`exists` + `isString` for strings) — R7.2 "missing field",
 *   2. emptiness check (after trimming for strings) — R7.2,
 *   3. format/range — R7.1, R7.3, R7.4.
 *
 * Per R7.4 a non-numeric or out-of-range amount yields a single "amount
 * is invalid" message; the model schema validates the optional `interestRate`,
 * `dueDate`, and `notes` fields when they are supplied.
 *
 * @type {import('express').RequestHandler[]}
 */
const liabilityValidators = [
  // --- name ---
  body('name')
    .exists({ checkNull: true })
    .withMessage('Name is required')
    .bail()
    .isString()
    .withMessage('Name is required')
    .bail()
    .customSanitizer((value) => value.trim())
    .notEmpty()
    .withMessage('Name is required')
    .bail()
    .isLength({ max: NAME_MAX })
    .withMessage(`Name length is out of range (1-${NAME_MAX} characters)`),

  // --- type ---
  body('type')
    .exists({ checkNull: true })
    .withMessage('Type is required')
    .bail()
    .isString()
    .withMessage('Type is required')
    .bail()
    .customSanitizer((value) => value.trim())
    .notEmpty()
    .withMessage('Type is required')
    .bail()
    .isIn(LIABILITY_TYPES)
    .withMessage(`Type must be one of: ${LIABILITY_TYPES.join(', ')}`),

  // --- amount ---
  body('amount')
    .exists({ checkNull: true })
    .withMessage('Amount is required')
    .bail()
    // R7.4: a non-numeric value or one outside [0.01, 999,999,999.99] is
    // reported with the same "amount is invalid" message. `isFloat` treats
    // booleans and non-numeric strings as invalid, satisfying both subcases.
    .isFloat({ min: MIN_AMOUNT, max: MAX_AMOUNT })
    .withMessage(
      `Amount is invalid (must be a number between ${MIN_AMOUNT} and ${MAX_AMOUNT})`
    ),
];

/**
 * Whitelist of fields a client may set on a liability.
 *
 * `user` is intentionally excluded — ownership is forced by the shared
 * helper (R5.2, R5.6) and a client-supplied `user` is silently dropped.
 * Optional model fields are passed through so callers can supply them
 * without a controller change.
 */
const ALLOWED_FIELDS = [
  'name',
  'type',
  'amount',
  'interestRate',
  'dueDate',
  'notes',
];

/**
 * Build a clean payload from the request body that contains only the
 * whitelisted liability fields. Used by both create and update so an extra
 * field (e.g. `user`, `_id`, or anything else) cannot sneak through.
 *
 * @param {Record<string, unknown>} body
 * @returns {Record<string, unknown>}
 */
function pickLiabilityFields(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }
  const out = {};
  for (const key of ALLOWED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      out[key] = body[key];
    }
  }
  return out;
}

/**
 * Translate any errors collected by `liabilityValidators` into a uniform
 * 400 response carrying the first error's message. Returns `true` when a
 * response was sent so the caller can early-return.
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
 * `POST /liabilities` handler.
 *
 * Flow:
 *   1. Surface any validation error from `liabilityValidators` as a 400
 *      response (R7.2, R7.3, R7.4).
 *   2. Whitelist fields from the body, then create the record via
 *      `scopedCreate` so the persisted `user` is the authenticated owner
 *      (R5.2). Any client-supplied `user` is dropped by both the whitelist
 *      and the ownership helper as defense-in-depth.
 *   3. Respond 201 with the created liability (R7.1).
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function createLiability(req, res, next) {
  try {
    if (rejectIfValidationErrors(req, res)) return;

    const payload = pickLiabilityFields(req.body);
    const created = await scopedCreate(Liability, req, payload);

    return res.status(201).json(created);
  } catch (err) {
    return next(err);
  }
}

/**
 * `GET /liabilities` handler.
 *
 * Returns every liability owned by the authenticated user as a JSON array,
 * empty when the user has none. Per R5.1/R5.4 the query is scoped to
 * `user: req.user._id`; records owned by a different user are excluded.
 *
 * Validates: Requirements 5.1, 5.4
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getLiabilities(req, res, next) {
  try {
    const records = await scopedFind(Liability, req).sort({ createdAt: -1 });
    return res.status(200).json(records);
  } catch (err) {
    return next(err);
  }
}

/**
 * `GET /liabilities/:id` handler.
 *
 * Returns the liability with the given id when it is owned by the
 * authenticated user. A malformed id, a missing record, and a record owned
 * by a different user all collapse to a uniform 404 response so the API
 * does not reveal the existence of another user's record (R5.3, R7.7).
 *
 * Validates: Requirements 5.3, 7.7
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getLiability(req, res, next) {
  try {
    const record = await scopedFindById(Liability, req, req.params.id);
    if (!record) {
      return res.status(404).json({ message: 'Liability not found' });
    }
    return res.status(200).json(record);
  } catch (err) {
    return next(err);
  }
}

/**
 * `PUT /liabilities/:id` handler.
 *
 * Flow:
 *   1. Run validators first so an invalid body cannot persist anything,
 *      regardless of ownership (R7.3, R7.4).
 *   2. Apply the sanitized whitelist via `scopedUpdate`. The helper loads
 *      the record by `_id + user`, so a foreign-owner / missing / malformed
 *      id all surface as `null` and are mapped to 404 (R5.3, R7.7).
 *   3. Respond 200 with the updated liability (R7.5).
 *
 * The persisted `user` field is never overwritten — the ownership helper
 * strips `user` from the payload (R5.6).
 *
 * Validates: Requirements 5.3, 5.6, 7.3, 7.4, 7.5, 7.7
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function updateLiability(req, res, next) {
  try {
    if (rejectIfValidationErrors(req, res)) return;

    const payload = pickLiabilityFields(req.body);
    const updated = await scopedUpdate(Liability, req, req.params.id, payload);

    if (!updated) {
      return res.status(404).json({ message: 'Liability not found' });
    }
    return res.status(200).json(updated);
  } catch (err) {
    return next(err);
  }
}

/**
 * `DELETE /liabilities/:id` handler.
 *
 * Removes the liability when it is owned by the authenticated user, and
 * responds 200 with a success body. A malformed id, a missing record, or a
 * record owned by a different user all collapse to 404 so the API does not
 * leak the existence of another user's record (R5.3, R7.7).
 *
 * Validates: Requirements 5.3, 7.6, 7.7
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function deleteLiability(req, res, next) {
  try {
    const removed = await scopedDelete(Liability, req, req.params.id);
    if (!removed) {
      return res.status(404).json({ message: 'Liability not found' });
    }
    return res.status(200).json({
      message: 'Liability deleted',
      id: String(removed._id),
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  liabilityValidators,
  createLiability,
  getLiabilities,
  getLiability,
  updateLiability,
  deleteLiability,
  // Re-exported for tests / route wiring.
  NAME_MAX,
  MIN_AMOUNT,
  MAX_AMOUNT,
  LIABILITY_TYPES,
};
