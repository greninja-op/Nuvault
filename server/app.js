'use strict';

/**
 * Express application factory for the Nuvault API server.
 *
 * Builds and returns a configured Express app with the full middleware
 * pipeline assembled in the exact order required by the design document
 * ("Middleware Pipeline Order"):
 *
 *   1. CORS         — admit only the configured client origin (R22.3).
 *   2. Helmet       — security headers including X-Content-Type-Options,
 *                     X-Frame-Options, and Strict-Transport-Security
 *                     (R22.4).
 *   3. Rate limiter — 100 requests / 60s per client identifier; replies
 *                     `429` once the limit is exceeded (R22.5).
 *   4. JSON parser  — `express.json()` body parsing.
 *   5. Routers      — the public and protected aggregator routers,
 *                     pre-mounted at `/api` so domain routers attach in
 *                     later tasks without further app edits.
 *   6. Error handler — terminal middleware that produces the uniform
 *                      JSON error response (R20).
 *
 * The factory takes the loaded runtime config so secrets and the client
 * origin are passed in explicitly; the module never reads `process.env`
 * directly. This keeps the app trivially testable: callers can build an
 * app against any config object without booting the real environment.
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const errorHandler = require('./middleware/errorHandler');
const { publicRouter, protectedRouter } = require('./routes');

/**
 * Window in milliseconds over which the rate limiter counts requests.
 *
 * @type {number}
 */
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/**
 * Maximum number of requests allowed per client identifier within the
 * rate-limit window before the limiter returns `429` (R22.5).
 *
 * @type {number}
 */
const RATE_LIMIT_MAX_REQUESTS = 100;

/**
 * Build the CORS middleware. Only requests whose `Origin` header matches
 * the configured client origin are admitted (R22.3). Requests with no
 * `Origin` header (e.g. server-to-server, curl, same-origin browser
 * requests) are allowed through so non-browser callers and health
 * checks are not accidentally blocked.
 *
 * @param {string} clientOrigin
 * @returns {import('express').RequestHandler}
 */
function buildCorsMiddleware(clientOrigin) {
  return cors({
    origin(origin, callback) {
      if (!origin || origin === clientOrigin) {
        return callback(null, true);
      }
      const err = new Error('Origin not allowed by CORS policy');
      // Tag the error so the uniform error handler responds with 403
      // rather than the default 500.
      err.statusCode = 403;
      return callback(err);
    },
    credentials: true,
  });
}

/**
 * Build the rate-limiting middleware. Uses the default key generator
 * (the request's resolved IP) as the per-client identifier and replies
 * with `429` plus a uniform JSON body once a client exceeds the budget
 * (R22.5).
 *
 * @returns {import('express').RequestHandler}
 */
function buildRateLimitMiddleware() {
  return rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests; please try again later.' },
  });
}

/**
 * Assemble the Express app for a given runtime configuration.
 *
 * @param {object} options
 * @param {{ clientOrigin: string }} options.config
 *   Runtime configuration produced by `loadConfig` (or any equivalent
 *   object in tests). Must carry a non-empty `clientOrigin`.
 * @returns {import('express').Express}
 */
function createApp({ config } = {}) {
  if (
    !config ||
    typeof config.clientOrigin !== 'string' ||
    config.clientOrigin.trim().length === 0
  ) {
    throw new Error(
      'createApp requires a config object with a non-empty `clientOrigin`.'
    );
  }

  const app = express();

  // Disable the X-Powered-By header before any other middleware runs so
  // it never leaks on responses produced by error paths either.
  app.disable('x-powered-by');

  // 1. CORS — admit only the configured client origin (R22.3).
  app.use(buildCorsMiddleware(config.clientOrigin));

  // 2. Helmet — security headers (R22.4). The default Helmet bundle
  // includes X-Content-Type-Options (`noSniff`), X-Frame-Options
  // (`frameguard`), and Strict-Transport-Security (`hsts`), which are
  // the three explicitly required by the design.
  app.use(helmet());

  // 3. Rate limiter — 100 requests / 60s per client identifier (R22.5).
  app.use(buildRateLimitMiddleware());

  // 4. JSON body parsing.
  app.use(express.json());

  // 5. Pre-mount the aggregator routers at /api so domain routers in
  // later tasks attach by calling `publicRouter.use(...)` /
  // `protectedRouter.use(...)` without editing this file.
  app.use('/api', publicRouter);
  app.use('/api', protectedRouter);

  // 6. Terminal error handler — must remain the last middleware so
  // every thrown / next(err) error funnels through it (R20).
  app.use(errorHandler);

  return app;
}

module.exports = {
  createApp,
  // Exported for tests and future tuning; not part of the public surface.
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
};
