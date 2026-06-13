'use strict';

/**
 * Auth route definitions (Task 5.3).
 *
 * Splits the auth surface into two mini-routers so the public and
 * protected halves can be mounted under their respective aggregators in
 * `routes/index.js`:
 *
 *   - {@link publicAuthRouter}    — routes reachable without a JWT.
 *       POST /register   (R1, R4.6)
 *       POST /login      (R2, R4.6)
 *
 *   - {@link protectedAuthRouter} — routes reachable only with a JWT
 *       resolved by `protect`.
 *       GET  /me         (R3.1)
 *
 * The aggregator mounts both routers under `/auth`, yielding the final
 * paths the design's Route Map specifies:
 *   POST /api/auth/register
 *   POST /api/auth/login
 *   GET  /api/auth/me
 */

const express = require('express');

const {
  register,
  registerValidators,
  login,
  loginValidators,
  logout,
  getMe,
} = require('../controllers/authController');

/**
 * Routes that must remain reachable without authentication. Per R4.6 the
 * registration and login endpoints are the only such routes in the API,
 * and they must explicitly NOT be gated by `protect`.
 *
 * @type {import('express').Router}
 */
const publicAuthRouter = express.Router();

publicAuthRouter.post('/register', registerValidators, register);
publicAuthRouter.post('/login', loginValidators, login);

/**
 * Routes that require a valid JWT. The aggregator applies `protect` to
 * the parent `protectedRouter` once, so this mini-router does not need
 * to repeat the middleware locally.
 *
 * @type {import('express').Router}
 */
const protectedAuthRouter = express.Router();

protectedAuthRouter.get('/me', getMe);
protectedAuthRouter.post('/logout', logout);

module.exports = {
  publicAuthRouter,
  protectedAuthRouter,
};
