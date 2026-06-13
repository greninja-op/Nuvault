'use strict';

/**
 * Auth_Service controllers (Tasks 5.1 + 5.2).
 *
 * This module exposes:
 *   - `registerValidators` / `register` (Task 5.1): see their JSDoc below.
 *   - `loginValidators` / `login` (Task 5.2): the login handler. Validators
 *     enforce presence + non-emptiness of `email` and `password` (R2.4) and
 *     lowercase the email so case-insensitive lookup against the stored form
 *     just works (R2.5). The handler resolves the user via a case-insensitive
 *     email lookup, runs `bcrypt.compare`, and on any *credential* mismatch
 *     (no such email, or wrong password) responds with a single generic
 *     `401 Invalid credentials` so the API never reveals which factor failed
 *     (R2.2, R2.3). On success it issues a JWT (R2.6) and returns a safe
 *     user payload of `{ id, name, email }` (R2.1, R2.7).
 *   - `getMe` (Task 5.2): looks up the authenticated user (assumed attached
 *     to `req.user` by the `protect` middleware in task 5.3) by id with the
 *     password field excluded (`.select('-password')`), returns `200` with
 *     the safe profile (R3.1), or `404` if the user can no longer be
 *     resolved (R3.4).
 */

const { body, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');

const User = require('../models/User');
const BlacklistedToken = require('../models/BlacklistedToken');
const generateToken = require('../utils/generateToken');

/**
 * Field bounds. These mirror the acceptance criteria in Requirement 1 and
 * are exposed so tests can assert on the same constants the controller uses.
 *
 * R1.1 / R1.9: name 1-100 chars (1 enforced by `notEmpty` after trim).
 * R1.1 / R1.8: email syntactically valid, max 254 chars.
 * R1.1 / R1.5: password 6-128 chars.
 */
const NAME_MAX = 100;
const EMAIL_MAX = 254;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 128;

/**
 * Validation chain for `POST /api/auth/register`.
 *
 * Each field is validated in this order so the first reported error matches
 * the most natural failure mode:
 *   1. presence (`exists` + `isString`) — guards against missing/non-string
 *      values which would otherwise crash sanitizers like `.trim()`,
 *   2. emptiness check (after trimming where appropriate) — covers R1.4's
 *      "empty or whitespace-only" rule,
 *   3. length / format bounds — R1.5, R1.8, R1.9.
 *
 * @type {import('express').RequestHandler[]}
 */
const registerValidators = [
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

  // --- email ---
  body('email')
    .exists({ checkNull: true })
    .withMessage('Email is required')
    .bail()
    .isString()
    .withMessage('Email is required')
    .bail()
    // Lowercase + trim so the uniqueness check in `register` matches the
    // stored form (the User schema also lowercases on save).
    .customSanitizer((value) => value.trim().toLowerCase())
    .notEmpty()
    .withMessage('Email is required')
    .bail()
    .isLength({ max: EMAIL_MAX })
    .withMessage('Email format is invalid (exceeds maximum length)')
    .bail()
    .isEmail()
    .withMessage('Email format is invalid'),

  // --- password ---
  body('password')
    .exists({ checkNull: true })
    .withMessage('Password is required')
    .bail()
    .isString()
    .withMessage('Password is required')
    .bail()
    // R1.4: empty or whitespace-only password is treated as missing. We do
    // *not* trim the persisted value — whitespace inside a password is
    // significant — so this is a check, not a sanitizer.
    .custom((value) => value.trim().length > 0)
    .withMessage('Password is required')
    .bail()
    .isLength({ min: PASSWORD_MIN, max: PASSWORD_MAX })
    .withMessage(
      `Password length is out of range (${PASSWORD_MIN}-${PASSWORD_MAX} characters)`
    ),
];

/**
 * `POST /api/auth/register` handler.
 *
 * Flow:
 *   1. Translate any validation errors collected by {@link registerValidators}
 *      into a `400` response carrying the first error's message (R1.4–R1.9,
 *      R1.8). Validation runs before this handler, so on entry `req.body`
 *      already reflects the sanitized name/email values.
 *   2. Reject duplicate emails (case-insensitive lookup against the
 *      lowercased value) with `400` and a stable message (R1.3). A second,
 *      defensive branch handles the rare race where the unique index fires
 *      between the lookup and the create.
 *   3. Persist the User. The model's `pre('save')` hook bcrypt-hashes the
 *      password (R1.2) and the schema default sets `currency` to `INR`
 *      (R1.7). The plaintext password and the stored hash are never echoed
 *      back; the response only contains `{ id, name, email }` (R1.6).
 *   4. Issue a JWT via {@link generateToken} (30-day expiry, R2.6) and
 *      respond with `201` and the safe user payload (R1.1).
 *
 * Validates: Requirements 1.1, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.6
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function register(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const first = errors.array({ onlyFirstError: true })[0];
      return res.status(400).json({ message: first.msg });
    }

    const { name, email, password } = req.body;

    // R1.3: case-insensitive uniqueness. The sanitizer above lowercased
    // `email`, and the User schema stores it lowercased, so a strict equals
    // lookup is sufficient.
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: 'Email is already registered' });
    }

    let user;
    try {
      // `currency` intentionally omitted: the schema default ('INR')
      // applies, satisfying R1.7.
      user = await User.create({ name, email, password });
    } catch (err) {
      // Mongo duplicate-key error. Can fire if two registrations race
      // between the `findOne` above and this `create`.
      if (err && err.code === 11000) {
        return res.status(400).json({ message: 'Email is already registered' });
      }
      throw err;
    }

    const token = generateToken(user._id);

    // R1.6: only id/name/email are returned. The password and its hash are
    // never included in the response body.
    return res.status(201).json({
      token,
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
      },
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * Generic message for any login credential mismatch.
 *
 * Used identically for both "no user with that email" (R2.2) and "wrong
 * password" (R2.3) so the API never reveals which factor failed. Keeping
 * this as a single exported constant makes it easy for tests to assert the
 * exact byte-equal response across the two failure modes (Property 10).
 *
 * @type {string}
 */
const INVALID_CREDENTIALS_MESSAGE = 'Invalid credentials';

/**
 * Message returned (HTTP 423) when a login is attempted against a currently
 * locked account (Feature 1).
 *
 * @type {string}
 */
const ACCOUNT_LOCKED_MESSAGE =
  'Account temporarily locked due to too many failed attempts. Try again in 30 minutes.';

/**
 * Max failed attempts before lockout — mirrors the User model constant so the
 * controller can compute `attemptsRemaining` for the response (Feature 6).
 *
 * @type {number}
 */
const MAX_LOGIN_ATTEMPTS = User.MAX_LOGIN_ATTEMPTS || 5;

/**
 * Validation chain for `POST /api/auth/login`.
 *
 * The login validators are deliberately *narrower* than `registerValidators`:
 *   - We only check that `email` and `password` are present and non-empty
 *     (after trim for whitespace-only inputs). This matches R2.4 — the only
 *     condition that produces a `400` response on the login endpoint.
 *   - We do *not* run `isEmail()` here. A syntactically malformed email
 *     simply won't match any stored user, and the handler then returns the
 *     same generic `401 Invalid credentials` it returns for any other
 *     credential mismatch. This avoids leaking "your email format is wrong"
 *     vs "no such user" via different status codes, which would let an
 *     attacker enumerate accounts by probing email shape.
 *   - The email is lowercased + trimmed by a sanitizer so the lookup against
 *     the (lowercased) stored form is a direct equality match (R2.5).
 *
 * @type {import('express').RequestHandler[]}
 */
const loginValidators = [
  // --- email ---
  body('email')
    .exists({ checkNull: true })
    .withMessage('Email is required')
    .bail()
    .isString()
    .withMessage('Email is required')
    .bail()
    .customSanitizer((value) => value.trim().toLowerCase())
    .notEmpty()
    .withMessage('Email is required'),

  // --- password ---
  body('password')
    .exists({ checkNull: true })
    .withMessage('Password is required')
    .bail()
    .isString()
    .withMessage('Password is required')
    .bail()
    // Whitespace-only counts as empty for presence (R2.4), but we do *not*
    // trim the value used for comparison: whitespace inside a real password
    // is significant and must reach `bcrypt.compare` unchanged.
    .custom((value) => value.trim().length > 0)
    .withMessage('Password is required'),
];

/**
 * `POST /api/auth/login` handler.
 *
 * Flow:
 *   1. Translate any validation errors collected by {@link loginValidators}
 *      into a `400` response identifying the missing/empty field (R2.4).
 *      Validation runs before this handler, so on entry `req.body.email` has
 *      already been trimmed and lowercased.
 *   2. Look up the user by the lowercased email. The User schema stores the
 *      email lowercased, so a strict equality query is sufficient and is
 *      itself case-insensitive (R2.5).
 *   3. If no user matches, respond with the generic `401 Invalid credentials`
 *      message (R2.2). The same message is used for the wrong-password case
 *      below so the response is byte-identical between the two (R2.3,
 *      Property 10).
 *   4. Compare the supplied password against the stored bcrypt hash via the
 *      model's `matchPassword` method. On mismatch, respond with the same
 *      generic `401` (R2.3).
 *   5. On success, issue a JWT (30-day expiry, R2.6) and reply with `200`
 *      and a safe user payload of `{ id, name, email }` (R2.1, R2.7). The
 *      stored password hash is never echoed back.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function login(req, res, next) {
  try {
    // R2.4: missing/empty email or password is the only 400 path on login.
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const first = errors.array({ onlyFirstError: true })[0];
      return res.status(400).json({ message: first.msg });
    }

    const { email, password } = req.body;

    // R2.5: case-insensitive lookup. The sanitizer lowercased the input and
    // the User schema stores the email lowercased, so a direct equality
    // query matches any letter-case variant the client sent.
    const user = await User.findOne({ email });
    if (!user) {
      // R2.2: unknown email returns the same generic message as a wrong
      // password (below). Note: no `attemptsRemaining` is attached here, so
      // the unknown-email and wrong-password responses are no longer
      // byte-identical once Feature 6 is enabled (see report).
      return res.status(401).json({ message: INVALID_CREDENTIALS_MESSAGE });
    }

    // Feature 1: refuse login while the account is locked (HTTP 423).
    if (user.isLocked) {
      return res.status(423).json({
        message: ACCOUNT_LOCKED_MESSAGE,
        lockExpiresAt: user.lockUntil,
      });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      // Feature 1: record the failure (may trigger a lock on the 5th try).
      await user.incrementLoginAttempts();

      // Feature 6: tell the client how many tries remain before lockout.
      // If this failure just locked the account, none remain.
      const attemptsRemaining = user.isLocked
        ? 0
        : Math.max(0, MAX_LOGIN_ATTEMPTS - user.loginAttempts);

      return res.status(401).json({
        message: INVALID_CREDENTIALS_MESSAGE,
        attemptsRemaining,
      });
    }

    // Success: clear any accumulated failed-attempt / lock state.
    if (user.loginAttempts !== 0 || user.lockUntil) {
      user.loginAttempts = 0;
      user.lockUntil = undefined;
      await user.save();
    }

    const token = generateToken(user._id);

    // R2.7: only id/name/email are returned. The password hash is never
    // included in the response body.
    return res.status(200).json({
      token,
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
      },
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * `POST /api/auth/logout` handler (Feature 2).
 *
 * Records the caller's still-valid JWT in the blacklist so the auth
 * middleware rejects it for the remainder of its lifetime. The token's `exp`
 * claim (decoded, not re-verified — `protect` already verified it upstream)
 * sets the blacklist entry's `expiresAt`, which the TTL index uses to
 * auto-purge the row once the token would have expired anyway.
 *
 * Idempotent: a token already blacklisted (duplicate key) still yields 200.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function logout(req, res, next) {
  try {
    const rawHeader =
      typeof req.headers.authorization === 'string' ? req.headers.authorization.trim() : '';
    const match = /^Bearer\s+(.+)$/i.exec(rawHeader);
    const token = match ? match[1].trim() : '';

    if (!token) {
      // No token to invalidate — nothing to do, but logout is still a success
      // from the client's perspective.
      return res.status(200).json({ message: 'Logged out successfully' });
    }

    // Decode (not verify) to read the expiry. `protect` already verified the
    // token before this handler runs.
    const decoded = jwt.decode(token);
    const expiresAt =
      decoded && typeof decoded.exp === 'number'
        ? new Date(decoded.exp * 1000)
        : new Date(Date.now() + 24 * 60 * 60 * 1000); // fallback: 24h

    try {
      await BlacklistedToken.create({ token, expiresAt });
    } catch (err) {
      // Duplicate key = token already blacklisted; treat as success.
      if (!(err && err.code === 11000)) {
        throw err;
      }
    }

    return res.status(200).json({ message: 'Logged out successfully' });
  } catch (err) {
    return next(err);
  }
}

/**
 * `GET /api/auth/me` handler.
 *
 * Assumes `req.user` has been attached by the `protect` middleware (task 5.3)
 * after JWT verification. To satisfy R3.4 — return `404` if the user can no
 * longer be resolved — this handler re-queries the user by id and excludes
 * the password from the projection (R3.1). The re-query also handles the
 * narrow window where a user is deleted between `protect` resolving them
 * and this handler running.
 *
 * Response shape mirrors the safe payload used elsewhere (`{ id, name,
 * email, currency, createdAt }`) so callers see a consistent profile object
 * and never receive the password hash.
 *
 * Validates: Requirements 3.1, 3.4
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function getMe(req, res, next) {
  try {
    // Defensive: `protect` should have populated `req.user`, but if the
    // route is mis-mounted or the middleware was bypassed, treat the
    // request as unresolved — same outcome as a deleted user (R3.4).
    const userRef = req.user;
    const userId = userRef && (userRef._id || userRef.id);
    if (!userId) {
      return res.status(404).json({ message: 'User not found' });
    }

    // R3.1: exclude the password hash from the projection. The schema does
    // not mark `password` as `select: false`, so the explicit `-password`
    // is necessary to keep the hash out of the response.
    const user = await User.findById(userId).select('-password');
    if (!user) {
      // R3.4: token was valid but the user has been deleted/unresolved.
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json({
      id: String(user._id),
      name: user.name,
      email: user.email,
      currency: user.currency,
      createdAt: user.createdAt,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  register,
  registerValidators,
  login,
  loginValidators,
  logout,
  getMe,
  // Re-exported for tests / route wiring documentation.
  NAME_MAX,
  EMAIL_MAX,
  PASSWORD_MIN,
  PASSWORD_MAX,
  INVALID_CREDENTIALS_MESSAGE,
  ACCOUNT_LOCKED_MESSAGE,
  MAX_LOGIN_ATTEMPTS,
};
