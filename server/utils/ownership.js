'use strict';

/**
 * Shared ownership / per-user isolation helper.
 *
 * Source of truth: design.md "Ownership Helper" and Requirement 5
 * (Per-User Data Isolation). Every domain controller MUST go through these
 * primitives to read, create, update, or delete a stored financial record.
 * Centralizing the pattern means a forgotten `user` filter cannot leak data
 * — there is exactly one place where `user: req.user._id` is enforced.
 *
 * Contract (mirrors the design):
 *   - scopedFind        → Model.find({ ...filter, user: req.user._id })
 *   - scopedFindOne     → Model.findOne({ ...filter, user: req.user._id })
 *   - scopedFindById    → Model.findOne({ _id: id, user: req.user._id })
 *                         (resolves to `null` when the id is malformed,
 *                         missing, or owned by a different user — so the
 *                         controller can return a uniform 404)
 *   - scopedCreate      → strips `user` from the payload, then
 *                         Model.create({ ...sanitized, user: req.user._id })
 *   - scopedUpdate      → findOne by id+user; returns `null` when not found;
 *                         strips `user` from the payload before applying it;
 *                         the persisted `user` is never reassigned
 *   - scopedDelete      → findOneAndDelete by id+user; returns `null` when
 *                         not found
 *
 * The `user` field on every result is therefore *always* the authenticated
 * user's id, regardless of what the client sent in the URL, body, or query.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.6.
 */

const mongoose = require('mongoose');

/**
 * Resolve the authenticated user's id from a request.
 *
 * The auth middleware (R4.2) attaches a fully resolved `req.user` to every
 * protected request. If a controller calls one of these helpers without that
 * middleware in place, refuse loudly: silently falling back to an unscoped
 * query would defeat the entire isolation guarantee.
 *
 * @param {{ user?: { _id?: unknown } } | undefined} req
 * @returns {unknown} the owner id (typically a Mongoose ObjectId)
 * @throws {Error} when `req.user._id` is missing
 */
function getOwnerId(req) {
  if (!req || !req.user || req.user._id === undefined || req.user._id === null) {
    throw new Error(
      'ownership helper invoked without an authenticated request: ' +
        'req.user._id is missing. Mount the auth middleware before any ' +
        'scoped read/create/update/delete.'
    );
  }
  return req.user._id;
}

/**
 * Return a shallow copy of `payload` with the `user` field removed.
 *
 * The client must never be able to assign or change ownership of a record
 * (R5.2 on create, R5.6 on update). Stripping the field is the single,
 * uniform mechanism: callers never have to remember to filter the field
 * themselves.
 *
 * Non-object payloads (`null`, `undefined`, primitives) collapse to an
 * empty object so create/update calls remain well-formed even with
 * pathological inputs.
 *
 * @template T
 * @param {T} payload
 * @returns {Omit<T, 'user'> | {}}
 */
function sanitizePayload(payload) {
  if (payload === null || payload === undefined) {
    return {};
  }
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }
  // Pull `user` out and discard it; everything else is forwarded verbatim.
  // eslint-disable-next-line no-unused-vars
  const { user, ...rest } = payload;
  return rest;
}

/**
 * Cheap guard that returns `true` for ids Mongoose would refuse to cast.
 *
 * `Model.findOne({ _id: badId })` would normally throw a CastError, which
 * surfaces as HTTP 500 through the error handler — leaking the existence of
 * the record-not-found path. Treating malformed ids as "not found" lets the
 * controller return a clean 404 (R5.3).
 *
 * @param {unknown} id
 * @returns {boolean}
 */
function isInvalidObjectId(id) {
  if (id === undefined || id === null) {
    return true;
  }
  return !mongoose.isValidObjectId(id);
}

/**
 * Build a query filter that always carries `user: req.user._id`.
 *
 * The user override is applied last so a caller-supplied `user` field is
 * silently replaced; it is never possible to query records belonging to
 * anybody else through this helper.
 *
 * @param {object | undefined} filter
 * @param {unknown} userId
 * @returns {object}
 */
function buildScopedFilter(filter, userId) {
  const safe = filter && typeof filter === 'object' && !Array.isArray(filter) ? filter : {};
  return { ...safe, user: userId };
}

/**
 * Scoped read returning the Mongoose query so callers can chain
 * `.sort()`, `.limit()`, `.populate()`, etc. before awaiting.
 *
 * @param {import('mongoose').Model<any>} Model
 * @param {{ user: { _id: unknown } }} req
 * @param {object} [filter={}]
 * @returns {import('mongoose').Query<any[], any>}
 */
function scopedFind(Model, req, filter = {}) {
  const userId = getOwnerId(req);
  return Model.find(buildScopedFilter(filter, userId));
}

/**
 * Scoped single-document read. Like {@link scopedFind} but for one record.
 *
 * @param {import('mongoose').Model<any>} Model
 * @param {{ user: { _id: unknown } }} req
 * @param {object} [filter={}]
 * @returns {import('mongoose').Query<any, any>}
 */
function scopedFindOne(Model, req, filter = {}) {
  const userId = getOwnerId(req);
  return Model.findOne(buildScopedFilter(filter, userId));
}

/**
 * Find a record by id, restricted to the authenticated user.
 *
 * Resolves to `null` when:
 *   - the id is missing or malformed (would cause a CastError otherwise),
 *   - no record with that id exists, or
 *   - a record exists but is owned by a different user.
 *
 * The three cases are deliberately indistinguishable to the caller so the
 * controller responds with a uniform 404 (R5.3, "do not confirm existence
 * of another user's record").
 *
 * @param {import('mongoose').Model<any>} Model
 * @param {{ user: { _id: unknown } }} req
 * @param {unknown} id
 * @returns {Promise<any | null>}
 */
async function scopedFindById(Model, req, id) {
  const userId = getOwnerId(req);
  if (isInvalidObjectId(id)) {
    return null;
  }
  return Model.findOne({ _id: id, user: userId });
}

/**
 * Create a record owned by the authenticated user.
 *
 * Any `user` field present in the payload is dropped before the create call
 * (R5.2), guaranteeing the persisted owner is always `req.user._id`.
 *
 * @param {import('mongoose').Model<any>} Model
 * @param {{ user: { _id: unknown } }} req
 * @param {object} payload
 * @returns {Promise<any>}
 */
async function scopedCreate(Model, req, payload) {
  const userId = getOwnerId(req);
  const sanitized = sanitizePayload(payload);
  return Model.create({ ...sanitized, user: userId });
}

/**
 * Update a record owned by the authenticated user.
 *
 * The record is loaded with `findOne({ _id, user })` so a row owned by
 * somebody else (or a malformed id) results in `null`, which the controller
 * translates to 404 (R5.3). A loaded document has the sanitized payload
 * applied via `Object.assign` and is then `.save()`-d so Mongoose validators
 * and pre-save hooks run — important for resources like `User` whose
 * password hashing lives on a hook.
 *
 * The persisted `user` field is never written from the payload (R5.6); the
 * existing owner remains owner.
 *
 * @param {import('mongoose').Model<any>} Model
 * @param {{ user: { _id: unknown } }} req
 * @param {unknown} id
 * @param {object} payload
 * @returns {Promise<any | null>} the updated document, or null if not owned/found
 */
async function scopedUpdate(Model, req, id, payload) {
  const userId = getOwnerId(req);
  if (isInvalidObjectId(id)) {
    return null;
  }

  const doc = await Model.findOne({ _id: id, user: userId });
  if (!doc) {
    return null;
  }

  const sanitized = sanitizePayload(payload);
  Object.assign(doc, sanitized);
  await doc.save();
  return doc;
}

/**
 * Delete a record owned by the authenticated user.
 *
 * Returns the deleted document on success, or `null` if no matching record
 * exists for this user (the controller maps that to 404). A malformed id
 * collapses to `null` for the same reason as {@link scopedFindById}.
 *
 * @param {import('mongoose').Model<any>} Model
 * @param {{ user: { _id: unknown } }} req
 * @param {unknown} id
 * @returns {Promise<any | null>}
 */
async function scopedDelete(Model, req, id) {
  const userId = getOwnerId(req);
  if (isInvalidObjectId(id)) {
    return null;
  }
  return Model.findOneAndDelete({ _id: id, user: userId });
}

module.exports = {
  scopedFind,
  scopedFindOne,
  scopedFindById,
  scopedCreate,
  scopedUpdate,
  scopedDelete,
  // Exported for unit tests and for advanced callers that need to reuse
  // the sanitization rule directly.
  sanitizePayload,
  getOwnerId,
  isInvalidObjectId,
};
