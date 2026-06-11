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

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');

const errorHandler = require('./middleware/errorHandler');
const { publicRouter, protectedRouter } = require('./routes');

/**
 * Absolute path to the built React client (`client/dist`). When this
 * directory exists (i.e. the client has been built with `npm run build`),
 * the API server also serves the SPA so the whole app runs from a single
 * process on a single port — no separate dev server needed, and a hard
 * refresh on any client route works because unmatched non-`/api` GET
 * requests fall back to `index.html`.
 *
 * @type {string}
 */
const CLIENT_DIST = path.resolve(__dirname, '..', 'client', 'dist');

/**
 * Rate-limit window: 15 minutes (in milliseconds). Applies to both the
 * general and the auth limiters.
 *
 * @type {number}
 */
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Max general API requests per window per IP before `429` (R22.5).
 *
 * @type {number}
 */
const GENERAL_RATE_LIMIT_MAX = 100;

/**
 * Max auth requests (login/register) per window per IP. Much stricter than
 * the general limit to blunt credential-stuffing / brute-force attempts.
 *
 * @type {number}
 */
const AUTH_RATE_LIMIT_MAX = 10;

/**
 * Exact paths the stricter auth limiter guards.
 *
 * @type {string[]}
 */
const AUTH_PATHS = ['/api/auth/login', '/api/auth/register'];

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
  // Support a comma-separated list so the API accepts requests both from
  // the single-port production server (e.g. http://localhost:5001) and
  // from the Vite dev server (http://localhost:5173) without reconfig.
  const allowed = new Set(
    String(clientOrigin)
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)
  );
  return cors({
    origin(origin, callback) {
      if (!origin || allowed.has(origin)) {
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
 * Build the Helmet security-header middleware with a Content-Security-Policy
 * tuned for serving the built React SPA from this same Express origin.
 *
 * CSP notes:
 *   - `default-src 'self'` covers the same-origin SPA (production serves
 *     `client/dist` from this server; dev serves it from Vite).
 *   - `script-src 'self'` — the Vite production build emits external,
 *     hashed module scripts (no inline scripts), so no `'unsafe-inline'`
 *     is needed for scripts.
 *   - `style-src` allows `'unsafe-inline'` because Tailwind utilities and
 *     charting libs (Recharts) set inline `style=""` attributes.
 *   - `connect-src` is `'self'` plus every configured client origin so
 *     XHR/fetch works whether the SPA is same-origin or served from a
 *     separate host. Add your deployed origin (e.g. the Vercel URL) to
 *     `CLIENT_ORIGIN` and it flows in here automatically.
 *   - `upgrade-insecure-requests` is DISABLED (set to null). Helmet turns
 *     it on by default, which would force asset requests to https and
 *     break the app over plain `http://localhost`.
 *
 * @param {{ clientOrigin: string }} config
 * @returns {import('express').RequestHandler}
 */
function buildHelmetMiddleware(config) {
  const configuredOrigins = String(config.clientOrigin)
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  // 'self' + configured origins + the conventional CRA dev origin the
  // hardening spec calls out. De-duplicated.
  const connectSrc = Array.from(
    new Set(["'self'", 'http://localhost:3000', ...configuredOrigins])
  );

  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'https:', 'data:'],
        connectSrc,
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        // Disable the default upgrade-insecure-requests so local http works.
        upgradeInsecureRequests: null,
      },
    },
    // Allow cross-origin loading of static assets if ever served from a
    // CDN/other host; harmless for same-origin serving.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
}

/**
 * General rate limiter: 100 requests / 15 min per IP across the API.
 *
 * Skips:
 *   - non-`/api` requests (static SPA assets — a single page view loads
 *     many files and would otherwise exhaust the budget),
 *   - the auth login/register paths (those get the stricter auth limiter),
 *   - the test environment (so the Jest suite isn't throttled).
 *
 * @param {{ nodeEnv?: string }} config
 * @returns {import('express').RequestHandler}
 */
function buildGeneralRateLimiter(config) {
  return rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: GENERAL_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests; please try again later.' },
    skip: (req) =>
      config.nodeEnv === 'test' ||
      !req.originalUrl.startsWith('/api') ||
      AUTH_PATHS.some((p) => req.originalUrl.startsWith(p)),
  });
}

/**
 * Auth rate limiter: 10 requests / 15 min per IP, applied only to the
 * login and register endpoints. Returns a clean JSON error on `429`.
 * Skipped in the test environment.
 *
 * @param {{ nodeEnv?: string }} config
 * @returns {import('express').RequestHandler}
 */
function buildAuthRateLimiter(config) {
  return rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: AUTH_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      message: 'Too many authentication attempts; please try again later.',
    },
    skip: () => config.nodeEnv === 'test',
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

  // 2. Helmet — security headers (R22.4) with a Content-Security-Policy
  // tuned for serving the React SPA from this origin. Keeps Helmet's
  // defaults (noSniff, frameguard/X-Frame-Options, HSTS) and adds a CSP
  // whose connect-src is driven by the configured client origins.
  app.use(buildHelmetMiddleware(config));

  // 3. Rate limiting (R22.5). The stricter auth limiter (10/15min) guards
  // login + register; the general limiter (100/15min) covers the rest of
  // the API. Both are no-ops in the test environment.
  app.use(AUTH_PATHS, buildAuthRateLimiter(config));
  app.use(buildGeneralRateLimiter(config));

  // 4. JSON body parsing.
  app.use(express.json());

  // 4b. NoSQL-injection hardening: strip Mongo operator characters
  // (`$`, `.`) from request keys in body/query/params before they reach
  // any controller or query.
  app.use(mongoSanitize());

  // 4c. HTTP Parameter Pollution guard: collapse duplicated query/body
  // params to a single value so `?x=a&x=b` can't smuggle arrays into
  // handlers expecting scalars.
  app.use(hpp());

  // 5. Pre-mount the aggregator routers at /api so domain routers in
  // later tasks attach by calling `publicRouter.use(...)` /
  // `protectedRouter.use(...)` without editing this file.
  app.use('/api', publicRouter);
  app.use('/api', protectedRouter);

  // 5b. Serve the built React client (single-process / single-port mode).
  // Only active when `client/dist` has been built. Static assets are
  // served directly; any other non-`/api` GET falls back to index.html
  // so client-side routes (e.g. /portfolio, /calculators) survive a hard
  // browser refresh instead of 404-ing.
  if (fs.existsSync(path.join(CLIENT_DIST, 'index.html'))) {
    app.use(express.static(CLIENT_DIST));
    // Regex matches any path that does NOT start with `/api`. Unknown
    // `/api/*` routes are left to fall through to the error handler /
    // default 404 so the API contract is unchanged.
    app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
      res.sendFile(path.join(CLIENT_DIST, 'index.html'));
    });
  }

  // 6. Terminal error handler — must remain the last middleware so
  // every thrown / next(err) error funnels through it (R20).
  app.use(errorHandler);

  return app;
}

module.exports = {
  createApp,
  // Exported for tests and future tuning; not part of the public surface.
  RATE_LIMIT_WINDOW_MS,
  GENERAL_RATE_LIMIT_MAX,
  AUTH_RATE_LIMIT_MAX,
  AUTH_PATHS,
};
