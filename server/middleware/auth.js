'use strict';

/**
 * Auth_Middleware (Task 5.3).
 *
 * Implements `protect`, the middleware that guards every Protected_Route.
 * It enforces the design's authentication contract end to end:
 *
 *   - Extract a Bearer token from the `Authorization` header. When the
 *     header is missing or doesn't carry a Bearer credential, reject with
 *     HTTP 401 ("Not authorized") and the request never reaches a
 *     controller (R3.2, R4.1, R4.3).
 *   - Verify the token with `JWT_SECRET` via `jwt.verify`. Any verification
 *     failure (bad signature, malformed token, expired token) is rejected
 *     with HTTP 401 ("Token invalid") (R3.3, R4.4).
 *   - Resolve the user referenced by the token's `id` claim, excluding
 *     the password from the projection so a leaked `req.user` reference
 *     can never carry the bcrypt hash. If the user can't be resolved
 *     (deleted, never existed, malformed id, etc.), reject with HTTP 401
 *     ("Not authorized") (R4.5).
 *   - On success, attach the resolved User to `req.user` and yield to the
 *     next handler. The controller is therefore never reached without a
 *     resolved owner (R4.2).
 *
 * Errors are surfaced via `next(err)` with `err.statusCode = 401` so the
 * uniform error handler produces the canonical `{ message }` body — every
 * 401 from this middleware looks identical in shape to a 401 from any
 * other path in the API.
 */

const jwt = require('jsonwebtoken');

const User = require('../models/User');
const BlacklistedToken = require('../models/BlacklistedToken');

/**
 * Generic "no/invalid identity" message. Used for absent tokens (R3.2,
 * R4.3) and unresolvable users (R4.5) so the API never reveals which of
 * the two failure modes occurred.
 *
 * @type {string}
 */
const NOT_AUTHORIZED_MESSAGE = 'Not authorized';

/**
 * Specific message for token-shape / verification failures (R3.3, R4.4):
 * malformed JWT, bad signature, expired token. Distinct from
 * {@link NOT_AUTHORIZED_MESSAGE} because the design explicitly calls for
 * a "token is invalid" wording in the response when verification fails.
 *
 * @type {string}
 */
const TOKEN_INVALID_MESSAGE = 'Token invalid';

/**
 * Message for a token that was valid but has been explicitly invalidated via
 * logout (Feature 2). Distinct wording so the client can tell the difference
 * between "your token is malformed/expired" and "you logged out".
 *
 * @type {string}
 */
const TOKEN_INVALIDATED_MESSAGE = 'Token has been invalidated';

/**
 * Match the standard `Authorization: Bearer <token>` header form. The
 * Bearer scheme is case-insensitive per RFC 6750, so we use the `i` flag
 * — clients sending `bearer <token>` (lowercase) are still accepted.
 *
 * @type {RegExp}
 */
const BEARER_REGEX = /^Bearer\s+(.+)$/i;

/**
 * Build a 401 error tagged with `statusCode` so the uniform error handler
 * picks up the right status (R20.2).
 *
 * @param {string} message
 * @returns {Error & { statusCode: number }}
 */
function buildUnauthorized(message) {
  const err = new Error(message);
  err.statusCode = 401;
  return err;
}

/**
 * Auth middleware: gates every Protected_Route by requiring a valid JWT
 * whose `id` claim resolves to a real User record.
 *
 * Validates: Requirements 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} _res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function protect(req, _res, next) {
  // 1. Extract the Bearer token. The header may be absent, set to
  // something other than Bearer, or carry an empty credential — all
  // three are treated as "no token presented" (R3.2, R4.3).
  const rawHeader =
    typeof req.headers.authorization === 'string'
      ? req.headers.authorization.trim()
      : '';
  const match = BEARER_REGEX.exec(rawHeader);
  if (!match) {
    return next(buildUnauthorized(NOT_AUTHORIZED_MESSAGE));
  }
  const token = match[1].trim();
  if (token.length === 0) {
    return next(buildUnauthorized(NOT_AUTHORIZED_MESSAGE));
  }

  // 2. Verify the token. `jwt.verify` throws on bad signature / malformed
  // payload / expired token; we coalesce all three into a single 401 with
  // the "Token invalid" message (R3.3, R4.4) so the API never reveals
  // *why* the token was rejected.
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (_err) {
    return next(buildUnauthorized(TOKEN_INVALID_MESSAGE));
  }

  if (!decoded || typeof decoded !== 'object' || !decoded.id) {
    return next(buildUnauthorized(TOKEN_INVALID_MESSAGE));
  }

  // 2b. Reject tokens that were invalidated via logout (Feature 2). Even a
  // cryptographically valid, unexpired token must not be honored once it has
  // been blacklisted. A transient DB error here is surfaced to the uniform
  // error handler rather than silently allowing the request.
  try {
    const blacklisted = await BlacklistedToken.findOne({ token }).lean();
    if (blacklisted) {
      return next(buildUnauthorized(TOKEN_INVALIDATED_MESSAGE));
    }
  } catch (err) {
    return next(err);
  }

  // 3. Resolve the user. `select('-password')` keeps the bcrypt hash off
  // `req.user` so any subsequent middleware / controller / response
  // serializer that touches the user document cannot accidentally leak
  // it (R3.1, R22.8 defense-in-depth).
  let user;
  try {
    user = await User.findById(decoded.id).select('-password');
  } catch (err) {
    // A `CastError` from `findById` means the token's `id` claim is not
    // a valid ObjectId — i.e. the token's payload is malformed. Treat
    // this as an authentication failure rather than a 500: the user
    // cannot be resolved and the controller must not run (R4.5).
    if (err && err.name === 'CastError') {
      return next(buildUnauthorized(TOKEN_INVALID_MESSAGE));
    }
    // Any other error (e.g. transient DB failure) is a real server-side
    // problem — let the uniform error handler decide the status.
    return next(err);
  }

  if (!user) {
    // Token decoded successfully but the user has been deleted /
    // never existed (R4.5).
    return next(buildUnauthorized(NOT_AUTHORIZED_MESSAGE));
  }

  // 4. Attach the resolved owner and yield. From here on every downstream
  // controller can safely query with `user: req.user._id` and trust the
  // ownership filter (R5.1, R5.2, R5.3, R5.4).
  req.user = user;
  return next();
}

module.exports = protect;
module.exports.protect = protect;
module.exports.NOT_AUTHORIZED_MESSAGE = NOT_AUTHORIZED_MESSAGE;
module.exports.TOKEN_INVALID_MESSAGE = TOKEN_INVALID_MESSAGE;
module.exports.TOKEN_INVALIDATED_MESSAGE = TOKEN_INVALIDATED_MESSAGE;
