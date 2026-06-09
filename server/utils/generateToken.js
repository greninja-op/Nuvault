'use strict';

const jwt = require('jsonwebtoken');

/**
 * Default JWT lifetime. Mirrors the design contract of a 30-day token expiry
 * and is used as a fallback only when neither an explicit `expiresIn` option
 * nor the `JWT_EXPIRE` environment variable is supplied.
 *
 * Validates: Requirements 2.6
 *
 * @type {string}
 */
const DEFAULT_EXPIRE = '30d';

/**
 * Generate a signed JWT for the given user.
 *
 * The token payload is `{ id: <userId> }`, signed with `JWT_SECRET` and an
 * expiry resolved in this order:
 *   1. `options.expiresIn` if provided (used by tests to keep tokens short).
 *   2. `process.env.JWT_EXPIRE` if set (production / staging configuration).
 *   3. {@link DEFAULT_EXPIRE} (`'30d'`), the design's specified lifetime.
 *
 * The user identifier is coerced to a string so a Mongoose `ObjectId` and a
 * raw string both round-trip unchanged through `jwt.verify`.
 *
 * Validates: Requirements 2.6
 *
 * @param {string | object} userId - The user's identifier (typically a
 *   Mongoose `ObjectId` or its string form). Must not be null/undefined or
 *   resolve to an empty string.
 * @param {object} [options]
 * @param {string} [options.secret] - Override secret (testing only). Defaults
 *   to `process.env.JWT_SECRET`.
 * @param {string | number} [options.expiresIn] - Override expiry (testing
 *   only). Defaults to `process.env.JWT_EXPIRE` or `'30d'`.
 * @returns {string} The signed JWT.
 * @throws {Error} when `userId` is missing/empty or `JWT_SECRET` is not set.
 */
function generateToken(userId, options = {}) {
  if (userId === undefined || userId === null || String(userId).trim() === '') {
    throw new Error('generateToken: userId is required');
  }

  const secret =
    options.secret !== undefined ? options.secret : process.env.JWT_SECRET;
  if (typeof secret !== 'string' || secret.trim() === '') {
    throw new Error(
      'generateToken: JWT_SECRET must be set (loadConfig should have validated this at boot)'
    );
  }

  const expiresIn =
    options.expiresIn !== undefined
      ? options.expiresIn
      : process.env.JWT_EXPIRE || DEFAULT_EXPIRE;

  return jwt.sign({ id: String(userId) }, secret, { expiresIn });
}

module.exports = generateToken;
module.exports.generateToken = generateToken;
module.exports.DEFAULT_EXPIRE = DEFAULT_EXPIRE;
