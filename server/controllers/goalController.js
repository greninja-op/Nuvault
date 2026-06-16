'use strict';

/**
 * Goal_Service controller (Task 15.1).
 *
 * Implements the Goal CRUD surface backed by the shared ownership helper,
 * with one important deviation from the other domain controllers: the
 * update endpoint is **additive** rather than a replace. A PUT/PATCH on
 * `/goals/:id` adds the supplied numeric `amount` to the goal's
 * `savedAmount` instead of overwriting fields. This matches the design's
 * "add savings" semantics and Requirement 15.4 directly:
 *
 *   "WHEN a goal update request adds a numeric amount ... to the saved
 *    amount of a Goal owned by the authenticated user, THE Goal_Service
 *    SHALL increase the saved amount by the supplied amount and return
 *    the updated Goal with HTTP status 200."
 *
 * Endpoints owned by this controller:
 *   - `createGoal`   → POST   /api/goals          (R15.1, R15.2, R15.3)
 *   - `getGoals`     → GET    /api/goals          (R5.1, R5.4)
 *   - `getGoal`      → GET    /api/goals/:id      (R5.3)
 *   - `updateGoal`   → PUT    /api/goals/:id      (R15.4, R15.5)
 *   - `deleteGoal`   → DELETE /api/goals/:id      (R15.7)
 *
 * Per-user isolation is funneled through the shared ownership helper, so
 * cross-user / missing / malformed-id requests collapse to a uniform 404
 * (R5.3) and the persisted `user` field is never assignable from the
 * payload (R5.2, R5.6).
 *
 * Every successful response carries `progress = min(savedAmount /
 * targetAmount, 1)`, computed per request and never persisted (R15.6).
 *
 * Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7.
 */

const { body, validationResult } = require('express-validator');

const Goal = require('../models/Goal');
const {
  scopedFind,
  scopedFindById,
  scopedCreate,
  scopedUpdate,
  scopedDelete,
} = require('../utils/ownership');

/**
 * Field bounds for goals. Mirror the model and Requirement 15 exactly so
 * the validator and the schema agree on what "valid" means.
 *
 *   R15.1: name 1–100 chars, targetAmount in [0.01, 999,999,999.99].
 *   R15.4: a contribution amount lies in the same [0.01, 999,999,999.99]
 *          window.
 *
 * Exported so tests can assert against the same constants the controller
 * uses rather than duplicating literals.
 */
const NAME_MAX = 100;
const MIN_AMOUNT = 0.01;
const MAX_AMOUNT = 999999999.99;

/**
 * Coerce a request-supplied numeric field to a finite Number when
 * possible. Numeric fields may arrive as JSON numbers (typical) or
 * numeric strings (form-encoded clients); returning `null` for anything
 * that can't be cleanly interpreted as a finite number lets validators
 * surface a single, uniform "<field> is invalid" message rather than
 * attaching wildly different errors to typed-vs-string inputs.
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
 * Build a custom validator that enforces a "(0, MAX]" numeric range on a
 * named field. Used for both `targetAmount` (on create) and `amount` (on
 * update). On failure it throws an `Error` whose message identifies the
 * field, matching R15.3 / R15.5's "validation message indicating the
 * <field> is invalid" requirement.
 *
 * @param {string} fieldLabel — "targetAmount" or "amount".
 * @returns {(raw: unknown) => true}
 */
function buildPositiveAmountValidator(fieldLabel) {
  return function validate(raw) {
    const value = coerceNumber(raw);
    if (value === null) {
      throw new Error(`${fieldLabel} is invalid`);
    }
    if (value < MIN_AMOUNT) {
      // Captures the "zero, negative" sub-rules of R15.5 too: anything
      // strictly below 0.01 is surfaced with the same message as
      // out-of-range, since they share the same client-facing meaning.
      throw new Error(`${fieldLabel} is invalid`);
    }
    if (value > MAX_AMOUNT) {
      throw new Error(`${fieldLabel} is invalid`);
    }
    return true;
  };
}

/**
 * Validation chain for `POST /api/goals`.
 *
 * Order mirrors the other domain controllers: presence checks first
 * (R15.2 "missing field" → 400 with a field-identifying message), then
 * format / range / length (R15.1, R15.3). `bail()` after each presence
 * check stops follow-on validators from running against `undefined`.
 *
 * @type {import('express').RequestHandler[]}
 */
const createGoalValidators = [
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

  // --- targetAmount ---
  body('targetAmount')
    .exists({ checkNull: true })
    .withMessage('targetAmount is required')
    .bail()
    .custom(buildPositiveAmountValidator('targetAmount')),

  // --- targetDate (optional, but must be a valid future date if given) ---
  body('targetDate')
    .optional({ values: 'falsy' })
    .custom((value) => {
      const d = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(d.getTime())) {
        throw new Error('targetDate must be a valid date');
      }
      if (d.getTime() <= Date.now()) {
        throw new Error('targetDate must be in the future');
      }
      return true;
    }),
];

/**
 * Validation chain for `PUT /api/goals/:id` — additive contribution.
 *
 * The update endpoint accepts a single numeric `amount` representing
 * the contribution to be added to the goal's `savedAmount`. Per R15.5
 * a non-numeric, zero, negative, or out-of-range value is rejected with
 * 400 and the persisted `savedAmount` is left unchanged.
 *
 * @type {import('express').RequestHandler[]}
 */
const updateGoalValidators = [
  body('amount')
    .exists({ checkNull: true })
    .withMessage('amount is required')
    .bail()
    .custom(buildPositiveAmountValidator('amount')),
];

/**
 * Validation chain for `PATCH /api/goals/:id` — partial field edit.
 *
 * Distinct from the additive PUT contribution flow: PATCH edits the goal's
 * descriptive fields (name, targetAmount, targetDate, category). Every field
 * is optional — only those supplied are validated and applied — but
 * `savedAmount` is deliberately NOT editable here (it stays additive-only via
 * PUT). A field that is present but invalid is rejected with a 400 carrying a
 * field-identifying message.
 *
 * @type {import('express').RequestHandler[]}
 */
const patchGoalValidators = [
  body('name')
    .optional()
    .isString()
    .withMessage('name is required')
    .bail()
    .customSanitizer((v) => v.trim())
    .notEmpty()
    .withMessage('name is required')
    .bail()
    .isLength({ max: NAME_MAX })
    .withMessage(`name must be 1 to ${NAME_MAX} characters`),
  body('targetAmount')
    .optional()
    .custom(buildPositiveAmountValidator('targetAmount')),
  body('targetDate')
    .optional({ values: 'falsy' })
    .custom((value) => {
      const d = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(d.getTime())) {
        throw new Error('targetDate must be a valid date');
      }
      return true;
    }),
  body('category').optional().isString().withMessage('category is invalid'),
];

/**
 * Whitelist of fields a client may set on goal creation.
 *
 * `user` and `savedAmount` are intentionally excluded:
 *   - `user`         is forced to `req.user._id` by the shared helper
 *                    (R5.2); a client-supplied `user` is silently
 *                    dropped.
 *   - `savedAmount`  is initialized to 0 by the schema default (R15.1).
 *                    Allowing the client to set it on create would
 *                    bypass the contract that contributions must go
 *                    through the additive update endpoint.
 */
const ALLOWED_CREATE_FIELDS = ['name', 'targetAmount', 'targetDate', 'category'];

/**
 * Project the request body into a clean payload that contains only the
 * whitelisted create fields. Numeric fields are coerced when they look
 * like numbers so the persisted value is uniformly numeric.
 *
 * @param {Record<string, unknown>} src
 * @returns {Record<string, unknown>}
 */
function pickCreateFields(src) {
  if (!src || typeof src !== 'object' || Array.isArray(src)) return {};
  const out = {};
  for (const key of ALLOWED_CREATE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    const value = src[key];
    if (key === 'targetAmount') {
      const coerced = coerceNumber(value);
      out[key] = coerced === null ? value : coerced;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Translate any errors collected by an express-validator chain into a
 * uniform `400 { message }` response carrying the first error's
 * message. Returns `true` when a response was sent so the caller can
 * early-return.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {boolean}
 */
function rejectIfValidationErrors(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;
  const first = errors.array({ onlyFirstError: true })[0];
  res.status(400).json({ message: first.msg });
  return true;
}

/**
 * Compute the derived `progress` field for a goal.
 *
 * R15.6: `progress = min(savedAmount / targetAmount, 1)`. Defensive
 * fallbacks — a non-finite or non-positive `targetAmount` should never
 * exist in the database (the schema validator forbids it on create),
 * but if it ever did we report 0 rather than crash with a divide-by-
 * zero or `Infinity` value leaking into JSON.
 *
 * @param {{ savedAmount: number, targetAmount: number }} goal
 * @returns {number}
 */
function computeProgress(goal) {
  const target = Number(goal.targetAmount);
  const saved = Number(goal.savedAmount);
  if (!Number.isFinite(target) || target <= 0) return 0;
  if (!Number.isFinite(saved) || saved <= 0) return 0;
  const ratio = saved / target;
  return ratio > 1 ? 1 : ratio;
}

/**
 * Project a stored Goal document into the safe response shape, adding
 * the derived `progress` field.
 *
 * `toObject` (vs spreading the doc) avoids serialising Mongoose
 * internals like `$__` while keeping the canonical `_id`. `progress` is
 * computed per-request and intentionally never written back to the
 * document (R15.6).
 *
 * @param {import('mongoose').Document} doc
 * @returns {object}
 */
function toGoalResponse(doc) {
  const obj = doc.toObject({ versionKey: false });
  obj.progress = computeProgress(obj);
  return obj;
}

/**
 * `POST /api/goals` — create a goal owned by the authenticated user.
 *
 * Flow:
 *   1. Translate validator errors to 400 with a field-identifying
 *      message (R15.2, R15.3).
 *   2. Whitelist + sanitize the payload, then create via `scopedCreate`
 *      so the persisted `user` is the authenticated owner (R5.2). Any
 *      client-supplied `user` or `savedAmount` is dropped — the schema
 *      default initializes `savedAmount` to 0 (R15.1).
 *   3. Respond `201` with the created goal plus its computed
 *      `progress` (which is always 0 immediately after creation).
 *
 * Validates: Requirements 15.1, 15.2, 15.3, 15.6
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function createGoal(req, res, next) {
  try {
    if (rejectIfValidationErrors(req, res)) return;

    const payload = pickCreateFields(req.body);
    const created = await scopedCreate(Goal, req, payload);

    return res.status(201).json(toGoalResponse(created));
  } catch (err) {
    return next(err);
  }
}

/**
 * `GET /api/goals` — list goals owned by the authenticated user.
 *
 * Per R5.1/R5.4 the query is scoped to `user: req.user._id`. Records
 * owned by a different user are excluded. Each returned goal carries
 * the computed `progress` field (R15.6).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getGoals(req, res, next) {
  try {
    const docs = await scopedFind(Goal, req).sort({ createdAt: -1 });
    return res.status(200).json(docs.map(toGoalResponse));
  } catch (err) {
    return next(err);
  }
}

/**
 * `GET /api/goals/:id` — fetch a single goal owned by the
 * authenticated user.
 *
 * Resolves `null` for malformed ids, missing records, and records owned
 * by another user — all three collapse to a uniform 404 so the API
 * never confirms the existence of another user's record (R5.3).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getGoal(req, res, next) {
  try {
    const doc = await scopedFindById(Goal, req, req.params.id);
    if (!doc) {
      return res.status(404).json({ message: 'Goal not found' });
    }
    return res.status(200).json(toGoalResponse(doc));
  } catch (err) {
    return next(err);
  }
}

/**
 * `PUT /api/goals/:id` — additive contribution to a goal.
 *
 * **Non-standard semantics**: this endpoint does NOT replace fields on
 * the goal. It treats the request body as a contribution event,
 * extracts a numeric `amount`, and *adds* that amount to the persisted
 * `savedAmount`.
 *
 * Flow:
 *   1. Run validators first (R15.4 / R15.5). An invalid amount cannot
 *      modify state — we return 400 before any database read or write
 *      (the "leave the saved amount unchanged" half of R15.5).
 *   2. Load the goal scoped to `(_id, user)` via `scopedFindById`. The
 *      helper guards malformed ids and foreign-owner records by
 *      collapsing all three failure modes (malformed id, missing,
 *      not-owned) to `null`, which we map to 404 (R5.3).
 *   3. Coerce the validated amount to a finite Number, add it to the
 *      persisted `savedAmount`, and `.save()` so Mongoose validators
 *      run on the new value (e.g. the schema's `min: 0` invariant —
 *      adding a positive contribution can never violate it, but
 *      `.save()` keeps the contract uniform with the other update
 *      paths).
 *   4. Respond `200` with the updated goal plus its computed
 *      `progress` (R15.4, R15.6). The `user` field is never
 *      reassigned (R5.6) — `Object.assign` is not used here, only the
 *      `savedAmount` field is mutated.
 *
 * Validates: Requirements 15.4, 15.5, 15.6
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function updateGoal(req, res, next) {
  try {
    if (rejectIfValidationErrors(req, res)) return;

    const doc = await scopedFindById(Goal, req, req.params.id);
    if (!doc) {
      return res.status(404).json({ message: 'Goal not found' });
    }

    // Validators already guaranteed `req.body.amount` parses to a
    // finite positive number in [MIN_AMOUNT, MAX_AMOUNT]; we re-coerce
    // here so the addition operates on a number rather than a string.
    const contribution = coerceNumber(req.body.amount);
    doc.savedAmount = Number(doc.savedAmount || 0) + contribution;
    await doc.save();

    return res.status(200).json(toGoalResponse(doc));
  } catch (err) {
    return next(err);
  }
}

/**
 * `PATCH /api/goals/:id` — partial field edit (name / targetAmount /
 * targetDate / category).
 *
 * Unlike the additive PUT contribution flow, this replaces the supplied
 * descriptive fields. `savedAmount` is intentionally not editable here, so
 * the only way to change saved progress remains the additive PUT endpoint.
 *
 * Flow:
 *   1. Validate any supplied fields (R15.x style — 400 with a
 *      field-identifying message on the first invalid field).
 *   2. Project only the whitelisted, present fields into an update payload.
 *   3. Apply via the shared `scopedUpdate` helper (findOne by `(_id, user)`,
 *      `Object.assign`, then `.save()` so schema validators run). A
 *      malformed id / missing / foreign-owner record collapses to `null`
 *      → 404 (R5.3). The persisted `user` is never reassigned (R5.6).
 *   4. Respond 200 with the updated goal plus computed `progress`.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function patchGoal(req, res, next) {
  try {
    if (rejectIfValidationErrors(req, res)) return;

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const updates = {};
    if (Object.prototype.hasOwnProperty.call(body, 'name')) {
      updates.name = String(body.name).trim();
    }
    if (Object.prototype.hasOwnProperty.call(body, 'targetAmount')) {
      const coerced = coerceNumber(body.targetAmount);
      updates.targetAmount = coerced === null ? body.targetAmount : coerced;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'targetDate')) {
      updates.targetDate = body.targetDate ? new Date(body.targetDate) : null;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'category')) {
      updates.category = body.category;
    }

    const doc = await scopedUpdate(Goal, req, req.params.id, updates);
    if (!doc) {
      return res.status(404).json({ message: 'Goal not found' });
    }

    return res.status(200).json(toGoalResponse(doc));
  } catch (err) {
    return next(err);
  }
}

/**
 * `DELETE /api/goals/:id` — remove a goal owned by the authenticated
 * user.
 *
 * Mirrors the get/update isolation contract: cross-user / missing /
 * malformed-id deletes resolve to `null` from the helper and are
 * mapped to a 404 with the underlying record left untouched (R5.3).
 *
 * Validates: Requirements 15.7
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function deleteGoal(req, res, next) {
  try {
    const removed = await scopedDelete(Goal, req, req.params.id);
    if (!removed) {
      return res.status(404).json({ message: 'Goal not found' });
    }
    return res.status(200).json({
      message: 'Goal deleted',
      id: String(removed._id),
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  // Handlers
  createGoal,
  getGoals,
  getGoal,
  updateGoal,
  patchGoal,
  deleteGoal,

  // Validator chains
  createGoalValidators,
  updateGoalValidators,
  patchGoalValidators,

  // Helpers exported for tests / re-use
  computeProgress,
  toGoalResponse,

  // Constants exported for tests / re-use
  NAME_MAX,
  MIN_AMOUNT,
  MAX_AMOUNT,
};
