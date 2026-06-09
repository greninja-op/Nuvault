'use strict';

/**
 * Asset controller (Task 8.1).
 *
 * Implements CRUD for the Asset resource (Requirement 6) on top of the
 * shared ownership helper (`utils/ownership.js`, Requirement 5). Every
 * read, write, update, and delete is funneled through that helper so a
 * forgotten `user` filter cannot leak data — the persisted `user` field
 * is always `req.user._id`, regardless of what the client sent in the
 * URL, body, or query.
 *
 * Surface:
 *   - `assetValidators` — express-validator chain shared by `POST /assets`
 *     and `PUT /assets/:id`. Enforces the field rules from R6.1–R6.4:
 *       * `name` is a non-empty string of at most 100 characters,
 *       * `type` is one of the allowed values exposed by the Asset model
 *         (`ASSET_TYPES`),
 *       * `value` is a finite number in the range 0.01–999,999,999.99.
 *     On any failure the handlers below respond with `400` and the first
 *     reported error message (R6.2, R6.3, R6.4).
 *   - `createAsset`  — `POST /assets`  → `201` with the new asset (R6.1).
 *   - `getAssets`    — `GET  /assets`  → `200` with an array (empty when
 *     the user owns no assets); always scoped to the authenticated user
 *     (R5.1, R5.4).
 *   - `getAsset`     — `GET  /assets/:id` → `200` with the asset, or
 *     `404` when the id is malformed/missing or owned by another user
 *     (R5.3).
 *   - `updateAsset`  — `PUT  /assets/:id` → `200` with the updated asset,
 *     or `404` when not owned/missing (R6.5, R6.7). The persisted `user`
 *     is never reassigned (R5.6) — the ownership helper drops any
 *     client-supplied `user` field before applying the payload.
 *   - `deleteAsset`  — `DELETE /assets/:id` → `200` with `{ id, message }`,
 *     or `404` when not owned/missing (R6.6, R6.7).
 *
 * Currency defaulting (R6.8) is handled by the Asset schema's `default:
 * 'INR'` — this controller therefore does not need to inject it.
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8
 */

const { body, validationResult } = require('express-validator');

const Asset = require('../models/Asset');
const { ASSET_TYPES } = Asset;
const {
  scopedFind,
  scopedFindById,
  scopedCreate,
  scopedUpdate,
  scopedDelete,
} = require('../utils/ownership');

/**
 * Field bounds. Mirrored from the Asset schema and Requirement 6 so
 * tests can assert on the same constants the controller uses.
 */
const NAME_MAX = 100;
const VALUE_MIN = 0.01;
const VALUE_MAX = 999999999.99;

/**
 * Stable validation messages. Kept as exported constants so tests can
 * match exactly without being coupled to phrasing changes scattered in
 * the chain below.
 */
const MESSAGES = Object.freeze({
  NAME_REQUIRED: 'Name is required',
  NAME_LENGTH: `Name length is out of range (1-${NAME_MAX} characters)`,
  TYPE_REQUIRED: 'Type is required',
  TYPE_INVALID: `Type must be one of: ${ASSET_TYPES.join(', ')}`,
  VALUE_REQUIRED: 'Value is required',
  VALUE_INVALID: `Value must be a finite number between ${VALUE_MIN} and ${VALUE_MAX}`,
  ASSET_NOT_FOUND: 'Asset not found',
  ASSET_DELETED: 'Asset deleted',
});

/**
 * Validation chain for `POST /assets` and `PUT /assets/:id`.
 *
 * Each field follows the same three-step pattern used in the auth
 * controller so the first reported error matches the most natural
 * failure mode:
 *   1. presence (`exists` + type guard) — guards against missing /
 *      null / non-string values that would crash sanitizers,
 *   2. emptiness check (after trimming where appropriate) — covers
 *      the "empty or whitespace-only" rule,
 *   3. domain bounds — length, enum membership, numeric range.
 *
 * `value` is validated as a JSON number (not a coerced string) and is
 * rejected when non-finite (e.g. `NaN`, `Infinity`) or outside the
 * 0.01–999,999,999.99 window (R6.4). `currency` is intentionally not
 * validated here so the model default ('INR', R6.8) applies when the
 * field is omitted; if the client supplies it, the schema accepts any
 * string.
 *
 * @type {import('express').RequestHandler[]}
 */
const assetValidators = [
  // --- name ---
  body('name')
    .exists({ checkNull: true })
    .withMessage(MESSAGES.NAME_REQUIRED)
    .bail()
    .isString()
    .withMessage(MESSAGES.NAME_REQUIRED)
    .bail()
    .customSanitizer((value) => value.trim())
    .notEmpty()
    .withMessage(MESSAGES.NAME_REQUIRED)
    .bail()
    .isLength({ max: NAME_MAX })
    .withMessage(MESSAGES.NAME_LENGTH),

  // --- type ---
  body('type')
    .exists({ checkNull: true })
    .withMessage(MESSAGES.TYPE_REQUIRED)
    .bail()
    .isString()
    .withMessage(MESSAGES.TYPE_REQUIRED)
    .bail()
    .notEmpty()
    .withMessage(MESSAGES.TYPE_REQUIRED)
    .bail()
    .isIn(ASSET_TYPES)
    .withMessage(MESSAGES.TYPE_INVALID),

  // --- value ---
  body('value')
    .exists({ checkNull: true })
    .withMessage(MESSAGES.VALUE_REQUIRED)
    .bail()
    // Reject strings, booleans, NaN, Infinity. We deliberately do NOT
    // coerce here — accepting only JSON numbers keeps the input shape
    // tight (R6.4: "non-numeric ... outside the range").
    .custom((value) => typeof value === 'number' && Number.isFinite(value))
    .withMessage(MESSAGES.VALUE_INVALID)
    .bail()
    .custom((value) => value >= VALUE_MIN && value <= VALUE_MAX)
    .withMessage(MESSAGES.VALUE_INVALID),
];

/**
 * Translate any validation errors collected by {@link assetValidators}
 * into a `400` response carrying the first error's message. Returns
 * `true` when a response was sent so the caller can stop processing.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {boolean}
 */
function sendValidationErrorIfAny(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return false;
  }
  const first = errors.array({ onlyFirstError: true })[0];
  res.status(400).json({ message: first.msg });
  return true;
}

/**
 * Project a stored Asset document into the safe response shape.
 *
 * Mongoose documents serialize cleanly via `toJSON`, which is the
 * implicit path Express uses when we pass the document to `res.json`.
 * We still funnel everything through this helper so future hidden
 * fields (e.g. soft-delete markers) can be filtered in one place.
 *
 * @param {import('mongoose').Document} doc
 * @returns {object}
 */
function toAssetResponse(doc) {
  // `toObject` (vs spreading the doc) avoids serialising Mongoose
  // internals like `$__` while keeping the canonical `_id` field.
  return doc.toObject({ versionKey: false });
}

/**
 * `POST /assets` handler.
 *
 * Validates the payload (R6.2–R6.4), then delegates to `scopedCreate`
 * which:
 *   - strips any client-supplied `user` (R5.2),
 *   - sets `user` to `req.user._id`,
 *   - lets the schema apply the `INR` default for `currency` (R6.8).
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.8
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function createAsset(req, res, next) {
  try {
    if (sendValidationErrorIfAny(req, res)) {
      return;
    }
    const created = await scopedCreate(Asset, req, req.body);
    res.status(201).json(toAssetResponse(created));
  } catch (err) {
    next(err);
  }
}

/**
 * `GET /assets` handler.
 *
 * Returns the authenticated user's assets as an array, sorted by
 * `updatedAt` descending so the most recently touched record comes
 * first. The empty case (R6 list with no records) returns `200` with
 * `[]` rather than `404` — an empty collection is not an error.
 *
 * Validates: Requirements 5.1, 5.4
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function getAssets(req, res, next) {
  try {
    const docs = await scopedFind(Asset, req).sort({ updatedAt: -1 });
    res.status(200).json(docs.map(toAssetResponse));
  } catch (err) {
    next(err);
  }
}

/**
 * `GET /assets/:id` handler.
 *
 * Resolves to `null` for malformed ids, missing records, and records
 * owned by another user — all three collapse to a uniform `404` so the
 * API never confirms the existence of another user's record (R5.3).
 *
 * Validates: Requirements 5.3, 6.7
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function getAsset(req, res, next) {
  try {
    const doc = await scopedFindById(Asset, req, req.params.id);
    if (!doc) {
      return res.status(404).json({ message: MESSAGES.ASSET_NOT_FOUND });
    }
    res.status(200).json(toAssetResponse(doc));
  } catch (err) {
    next(err);
  }
}

/**
 * `PUT /assets/:id` handler.
 *
 * Validation runs first so an invalid payload yields `400` regardless of
 * ownership (R6.3, R6.4). Then `scopedUpdate` performs the id+user
 * lookup; a `null` result means the record either does not exist or
 * belongs to another user — both map to `404` (R6.7). The ownership
 * helper strips any client-supplied `user` before applying the payload,
 * so an attacker cannot reassign ownership through this endpoint (R5.6).
 *
 * Validates: Requirements 6.3, 6.4, 6.5, 6.7
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function updateAsset(req, res, next) {
  try {
    if (sendValidationErrorIfAny(req, res)) {
      return;
    }
    const updated = await scopedUpdate(Asset, req, req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ message: MESSAGES.ASSET_NOT_FOUND });
    }
    res.status(200).json(toAssetResponse(updated));
  } catch (err) {
    next(err);
  }
}

/**
 * `DELETE /assets/:id` handler.
 *
 * Returns `200` with the deleted record's id and a confirmation message
 * on success (R6.6); `404` when the record is missing or owned by
 * another user (R6.7).
 *
 * Validates: Requirements 6.6, 6.7
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function deleteAsset(req, res, next) {
  try {
    const deleted = await scopedDelete(Asset, req, req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: MESSAGES.ASSET_NOT_FOUND });
    }
    res.status(200).json({
      id: String(deleted._id),
      message: MESSAGES.ASSET_DELETED,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createAsset,
  getAssets,
  getAsset,
  updateAsset,
  deleteAsset,
  assetValidators,
  // Re-exported for tests / wiring documentation.
  NAME_MAX,
  VALUE_MIN,
  VALUE_MAX,
  MESSAGES,
};
