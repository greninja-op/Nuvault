/**
 * Uniform error-handling middleware.
 *
 * Terminal Express middleware that converts any thrown/`next(err)` error into a
 * JSON response of the shape `{ message, stack? }`.
 *
 * Behavior:
 *   - Mongoose `ValidationError` is mapped to HTTP 400 (R20.5).
 *   - Otherwise, the error's `statusCode` (or `status`) is used; if neither is
 *     set, HTTP 500 is returned (R20.2).
 *   - The response body always includes a non-empty `message` field (R20.1).
 *   - The error's `stack` is included only when `NODE_ENV !== 'production'`
 *     (R20.3, R20.4).
 *
 * Must be mounted as the LAST middleware in the Express app, after all routes,
 * so unhandled errors funnel into it.
 *
 * @param {Error & { statusCode?: number, status?: number, errors?: Record<string, { message?: string }> }} err
 * @param {import('express').Request} _req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} _next
 */
function errorHandler(err, _req, res, _next) {
  const statusCode = resolveStatusCode(err);
  const message = resolveMessage(err);

  const body = { message };

  if (process.env.NODE_ENV !== 'production' && err && typeof err.stack === 'string') {
    body.stack = err.stack;
  }

  res.status(statusCode).json(body);
}

/**
 * Resolve the HTTP status to send for the given error.
 *
 * Mongoose validation errors are forced to 400. Any other error falls back to
 * its own `statusCode`/`status` field, or 500 when neither is present.
 *
 * @param {*} err
 * @returns {number}
 */
function resolveStatusCode(err) {
  if (err && err.name === 'ValidationError') {
    return 400;
  }

  if (err) {
    const candidate = err.statusCode || err.status;
    if (Number.isInteger(candidate) && candidate >= 100 && candidate <= 599) {
      return candidate;
    }
  }

  return 500;
}

/**
 * Resolve a non-empty user-facing message for the given error.
 *
 * For Mongoose validation errors the per-field messages are joined; otherwise
 * the error's own `message` is used. Falls back to a generic string when no
 * usable message is available, so the response always has a non-empty
 * `message` field (R20.1).
 *
 * @param {*} err
 * @returns {string}
 */
function resolveMessage(err) {
  if (err && err.name === 'ValidationError' && err.errors && typeof err.errors === 'object') {
    const fieldMessages = Object.values(err.errors)
      .map((entry) => (entry && typeof entry.message === 'string' ? entry.message.trim() : ''))
      .filter((msg) => msg.length > 0);

    if (fieldMessages.length > 0) {
      return fieldMessages.join('; ');
    }
    return 'Validation failed';
  }

  if (err && typeof err.message === 'string' && err.message.trim().length > 0) {
    return err.message;
  }

  return 'Internal Server Error';
}

module.exports = errorHandler;
module.exports.errorHandler = errorHandler;
