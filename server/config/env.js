'use strict';

/**
 * Environment configuration loader and required-secret startup guard.
 *
 * Responsibilities (Task 2.1):
 *   - Load every secret the server depends on (`MONGO_URI`, `JWT_SECRET`,
 *     `JWT_EXPIRE`, `CLAUDE_API_KEY`, `EXCHANGERATE_API_KEY`, `CLIENT_ORIGIN`)
 *     from environment variables exclusively. No secret may be embedded in
 *     source (R22.1).
 *   - Validate that every required secret is present at boot. When any is
 *     absent, log the missing key(s) and halt startup so no request is ever
 *     served (R22.2).
 *
 * The module exposes `loadConfig` as the function called from the server
 * bootstrap. It is also fully testable: `env`, `logger`, and `exit` are
 * injectable so unit tests can simulate missing secrets without terminating
 * the test runner.
 */

const path = require('path');

/**
 * The full list of secrets / configuration values the server requires to
 * accept a single request. Order matters only for the deterministic logging
 * sequence when several keys are missing simultaneously.
 *
 * @type {ReadonlyArray<string>}
 */
const REQUIRED_KEYS = Object.freeze([
  'MONGO_URI',
  'JWT_SECRET',
  'JWT_EXPIRE',
  'CLAUDE_API_KEY',
  'EXCHANGERATE_API_KEY',
  'CLIENT_ORIGIN',
]);

/**
 * Treat `undefined`, `null`, and whitespace-only strings as "absent". An
 * empty `JWT_SECRET=""` in a `.env` file is just as dangerous as an unset
 * one, so the guard rejects it.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isAbsent(value) {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value !== 'string') {
    return false;
  }
  return value.trim().length === 0;
}

/**
 * Return the subset of {@link REQUIRED_KEYS} that are missing from the given
 * environment object. The order of returned keys matches the declaration
 * order in {@link REQUIRED_KEYS} so log output is deterministic.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {string[]}
 */
function findMissingKeys(env = process.env) {
  return REQUIRED_KEYS.filter((key) => isAbsent(env[key]));
}

/**
 * Load `.env` from the server directory if dotenv is available. Failures to
 * load `.env` are non-fatal here: the required-secret check below is the
 * authoritative gate. This keeps the function safe to call in test runs
 * where dotenv is intentionally bypassed.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {void}
 */
function applyDotenv(env) {
  // Only load dotenv when operating on the real process.env. Tests that
  // pass a synthetic env object should not have their inputs overwritten
  // by whatever happens to be on disk.
  if (env !== process.env) {
    return;
  }
  try {
    // eslint-disable-next-line global-require
    const dotenv = require('dotenv');
    dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
  } catch (_err) {
    // dotenv is optional at runtime; the env may already be populated by
    // the host (e.g. in production). The required-secret check will catch
    // anything actually missing.
  }
}

/**
 * Halt-on-missing-secret error. Carries the list of missing keys so callers
 * (and tests) can inspect what was wrong without parsing log output.
 */
class MissingSecretError extends Error {
  /**
   * @param {string[]} missingKeys
   */
  constructor(missingKeys) {
    super(
      `Missing required environment variable(s): ${missingKeys.join(', ')}. ` +
        'Server startup halted; no requests will be served.'
    );
    this.name = 'MissingSecretError';
    /** @type {string[]} */
    this.missingKeys = missingKeys.slice();
  }
}

/**
 * Validate that every required secret is present in the supplied environment.
 *
 * On success returns silently. On failure:
 *   1. Logs each missing key to the supplied logger (defaults to `console`).
 *   2. Calls `exit(1)` to terminate the process so no request is served.
 *   3. Throws {@link MissingSecretError} as a defense-in-depth bail-out for
 *      the case where `exit` is mocked (tests) or otherwise non-terminal.
 *
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env=process.env]
 * @param {Pick<Console, 'error'>} [options.logger=console]
 * @param {(code: number) => void} [options.exit]
 * @returns {void}
 * @throws {MissingSecretError} when one or more required secrets are absent
 */
function assertRequiredSecrets({
  env = process.env,
  logger = console,
  exit = (code) => process.exit(code),
} = {}) {
  const missing = findMissingKeys(env);
  if (missing.length === 0) {
    return;
  }

  for (const key of missing) {
    logger.error(`[nuvault] Missing required environment variable: ${key}`);
  }
  logger.error(
    `[nuvault] Server startup halted. Set the variable(s) above and restart.`
  );

  exit(1);

  // If `exit` did not actually terminate the process (e.g. it was stubbed in
  // a test, or replaced by a no-op in a hosted runtime), throw so the
  // bootstrap call site does not continue and start serving requests.
  throw new MissingSecretError(missing);
}

/**
 * Build the immutable runtime configuration object the rest of the server
 * consumes. Secrets are pulled from environment variables only (R22.1).
 *
 * Optional values (`NODE_ENV`, `PORT`) are not part of {@link REQUIRED_KEYS}
 * and fall back to safe defaults.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {Readonly<{
 *   mongoUri: string,
 *   jwtSecret: string,
 *   jwtExpire: string,
 *   claudeApiKey: string,
 *   exchangeRateApiKey: string,
 *   clientOrigin: string,
 *   nodeEnv: string,
 *   port: number,
 * }>}
 */
function buildConfig(env) {
  const portRaw = env.PORT;
  const portParsed = portRaw !== undefined ? Number.parseInt(portRaw, 10) : NaN;

  return Object.freeze({
    mongoUri: env.MONGO_URI,
    jwtSecret: env.JWT_SECRET,
    jwtExpire: env.JWT_EXPIRE,
    claudeApiKey: env.CLAUDE_API_KEY,
    exchangeRateApiKey: env.EXCHANGERATE_API_KEY,
    clientOrigin: env.CLIENT_ORIGIN,
    nodeEnv: env.NODE_ENV || 'development',
    port: Number.isInteger(portParsed) && portParsed > 0 ? portParsed : 5000,
  });
}

/**
 * Top-level entry point. Call this once from the server bootstrap before
 * binding any port or wiring any router.
 *
 * Steps:
 *   1. Load `.env` (when operating on the real `process.env`).
 *   2. Run the required-secret guard.
 *   3. Return a frozen config object on success.
 *
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env=process.env]
 * @param {Pick<Console, 'error'>} [options.logger=console]
 * @param {(code: number) => void} [options.exit]
 * @returns {ReturnType<typeof buildConfig>}
 */
function loadConfig(options = {}) {
  const env = options.env || process.env;

  applyDotenv(env);

  assertRequiredSecrets({
    env,
    logger: options.logger || console,
    exit: options.exit,
  });

  return buildConfig(env);
}

module.exports = {
  REQUIRED_KEYS,
  MissingSecretError,
  findMissingKeys,
  assertRequiredSecrets,
  loadConfig,
};
