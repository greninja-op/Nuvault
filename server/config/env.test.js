'use strict';

/**
 * Unit tests for the environment config loader and startup guard.
 *
 * These tests focus narrowly on the loader's contract (R22.1, R22.2):
 *   - Every required key is detected when absent.
 *   - The guard logs each missing key and calls the supplied `exit`.
 *   - When `exit` does not terminate, the guard throws so bootstrap stops.
 *   - With a complete environment, `loadConfig` returns the populated config.
 *
 * The broader smoke / property tests for this module are tracked separately
 * as tasks 2.2 and 2.3.
 */

const {
  REQUIRED_KEYS,
  MissingSecretError,
  findMissingKeys,
  assertRequiredSecrets,
  loadConfig,
} = require('./env');

/**
 * Build a synthetic environment object that satisfies every required key.
 *
 * @param {Partial<Record<string, string>>} [overrides]
 * @returns {Record<string, string>}
 */
function completeEnv(overrides = {}) {
  return {
    MONGO_URI: 'mongodb://localhost:27017/nuvault',
    JWT_SECRET: 'test-jwt-secret',
    JWT_EXPIRE: '30d',
    GEMINI_API_KEY: 'test-gemini-key',
    EXCHANGERATE_API_KEY: 'test-fx-key',
    CLIENT_ORIGIN: 'http://localhost:5173',
    NODE_ENV: 'test',
    PORT: '5000',
    ...overrides,
  };
}

/**
 * Logger stub that records `error` calls so assertions can confirm the
 * missing-key messages were emitted.
 */
function makeLogger() {
  const calls = [];
  return {
    calls,
    error: (...args) => {
      calls.push(args.join(' '));
    },
  };
}

describe('config/env REQUIRED_KEYS', () => {
  test('includes every secret named in the design and is frozen', () => {
    expect(Object.isFrozen(REQUIRED_KEYS)).toBe(true);
    expect(REQUIRED_KEYS).toEqual([
      'MONGO_URI',
      'JWT_SECRET',
      'JWT_EXPIRE',
      'GEMINI_API_KEY',
      'EXCHANGERATE_API_KEY',
      'CLIENT_ORIGIN',
    ]);
  });
});

describe('config/env findMissingKeys', () => {
  test('returns no keys when every required value is present and non-empty', () => {
    expect(findMissingKeys(completeEnv())).toEqual([]);
  });

  test('treats undefined, missing, and whitespace-only values as absent', () => {
    const env = completeEnv({
      JWT_SECRET: undefined,
      GEMINI_API_KEY: '   ',
    });
    delete env.MONGO_URI;

    const missing = findMissingKeys(env);

    expect(missing).toEqual(
      expect.arrayContaining(['MONGO_URI', 'JWT_SECRET', 'GEMINI_API_KEY'])
    );
    expect(missing).toHaveLength(3);
  });
});

describe('config/env assertRequiredSecrets', () => {
  test('returns silently when every required secret is present', () => {
    const logger = makeLogger();
    const exit = jest.fn();

    expect(() =>
      assertRequiredSecrets({ env: completeEnv(), logger, exit })
    ).not.toThrow();

    expect(exit).not.toHaveBeenCalled();
    expect(logger.calls).toEqual([]);
  });

  test('logs each missing key, calls exit(1), and throws MissingSecretError', () => {
    const env = completeEnv();
    delete env.JWT_SECRET;
    delete env.CLIENT_ORIGIN;

    const logger = makeLogger();
    // exit() is stubbed to a no-op so we can also observe the throw path.
    const exit = jest.fn();

    let captured;
    try {
      assertRequiredSecrets({ env, logger, exit });
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeInstanceOf(MissingSecretError);
    expect(captured.missingKeys).toEqual(['JWT_SECRET', 'CLIENT_ORIGIN']);

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);

    // One log line per missing key, plus the trailing halt notice.
    expect(logger.calls).toEqual(
      expect.arrayContaining([
        expect.stringContaining('JWT_SECRET'),
        expect.stringContaining('CLIENT_ORIGIN'),
        expect.stringContaining('halted'),
      ])
    );
  });
});

describe('config/env loadConfig', () => {
  test('returns a frozen config populated from the supplied env on success', () => {
    const config = loadConfig({
      env: completeEnv({ PORT: '4123', NODE_ENV: 'production' }),
      logger: makeLogger(),
      exit: jest.fn(),
    });

    expect(Object.isFrozen(config)).toBe(true);
    expect(config).toEqual({
      mongoUri: 'mongodb://localhost:27017/nuvault',
      jwtSecret: 'test-jwt-secret',
      jwtExpire: '30d',
      geminiApiKey: 'test-gemini-key',
      exchangeRateApiKey: 'test-fx-key',
      clientOrigin: 'http://localhost:5173',
      nodeEnv: 'production',
      port: 4123,
    });
  });

  test('falls back to nodeEnv=development and port=5000 when not set', () => {
    const env = completeEnv();
    delete env.NODE_ENV;
    delete env.PORT;

    const config = loadConfig({ env, logger: makeLogger(), exit: jest.fn() });

    expect(config.nodeEnv).toBe('development');
    expect(config.port).toBe(5000);
  });

  test('halts when a required secret is missing (R22.2)', () => {
    const env = completeEnv();
    delete env.EXCHANGERATE_API_KEY;

    const logger = makeLogger();
    const exit = jest.fn();

    expect(() => loadConfig({ env, logger, exit })).toThrow(MissingSecretError);
    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.calls.some((line) => line.includes('EXCHANGERATE_API_KEY'))).toBe(
      true
    );
  });
});
