'use strict';

/**
 * Unit tests for the JWT token generator (Task 5.1).
 *
 * These tests exercise the contract of `generateToken` directly:
 *   - The token decodes back to the supplied user id (string-coerced).
 *   - The token carries a 30-day expiry by default and honors overrides.
 *   - Missing `userId` or `JWT_SECRET` raise a clear error rather than
 *     producing a silently malformed token.
 *
 * Property-based coverage of the round-trip is tracked under task 5.7.
 */

const jwt = require('jsonwebtoken');

const generateToken = require('./generateToken');
const { DEFAULT_EXPIRE } = require('./generateToken');

const SECRET = 'unit-test-jwt-secret';

describe('utils/generateToken', () => {
  let originalSecret;
  let originalExpire;

  beforeEach(() => {
    originalSecret = process.env.JWT_SECRET;
    originalExpire = process.env.JWT_EXPIRE;
    process.env.JWT_SECRET = SECRET;
    delete process.env.JWT_EXPIRE;
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalSecret;
    }
    if (originalExpire === undefined) {
      delete process.env.JWT_EXPIRE;
    } else {
      process.env.JWT_EXPIRE = originalExpire;
    }
  });

  test('produces a JWT that verifies and round-trips the user id', () => {
    const token = generateToken('user-abc-123');

    const decoded = jwt.verify(token, SECRET);

    expect(decoded.id).toBe('user-abc-123');
    expect(typeof decoded.iat).toBe('number');
    expect(typeof decoded.exp).toBe('number');
  });

  test('coerces a non-string user id to a string in the token payload', () => {
    // Simulate a Mongoose ObjectId-like value: a non-string with a meaningful toString().
    const objectIdLike = {
      toString() {
        return '507f1f77bcf86cd799439011';
      },
    };

    const token = generateToken(objectIdLike);
    const decoded = jwt.verify(token, SECRET);

    expect(decoded.id).toBe('507f1f77bcf86cd799439011');
  });

  test('defaults to a 30-day expiry when no override is supplied', () => {
    const token = generateToken('user-1');
    const decoded = jwt.verify(token, SECRET);

    const thirtyDaysSeconds = 30 * 24 * 60 * 60;
    // Tolerate up to 5 seconds of test-runner skew.
    expect(decoded.exp - decoded.iat).toBeGreaterThanOrEqual(thirtyDaysSeconds - 5);
    expect(decoded.exp - decoded.iat).toBeLessThanOrEqual(thirtyDaysSeconds + 5);

    expect(DEFAULT_EXPIRE).toBe('30d');
  });

  test('uses JWT_EXPIRE from the environment when the option is not provided', () => {
    process.env.JWT_EXPIRE = '1h';

    const token = generateToken('user-2');
    const decoded = jwt.verify(token, SECRET);

    const oneHour = 60 * 60;
    expect(decoded.exp - decoded.iat).toBeGreaterThanOrEqual(oneHour - 5);
    expect(decoded.exp - decoded.iat).toBeLessThanOrEqual(oneHour + 5);
  });

  test('honors an explicit expiresIn option over the environment value', () => {
    process.env.JWT_EXPIRE = '1h';

    const token = generateToken('user-3', { expiresIn: '15m' });
    const decoded = jwt.verify(token, SECRET);

    const fifteenMinutes = 15 * 60;
    expect(decoded.exp - decoded.iat).toBeGreaterThanOrEqual(fifteenMinutes - 5);
    expect(decoded.exp - decoded.iat).toBeLessThanOrEqual(fifteenMinutes + 5);
  });

  test('throws when userId is missing or resolves to an empty string', () => {
    expect(() => generateToken(undefined)).toThrow(/userId/);
    expect(() => generateToken(null)).toThrow(/userId/);
    expect(() => generateToken('')).toThrow(/userId/);
    expect(() => generateToken('   ')).toThrow(/userId/);
  });

  test('throws when JWT_SECRET is not configured', () => {
    delete process.env.JWT_SECRET;

    expect(() => generateToken('user-4')).toThrow(/JWT_SECRET/);
  });

  test('a token signed with one secret cannot be verified with another', () => {
    const token = generateToken('user-5');

    expect(() => jwt.verify(token, 'other-secret')).toThrow();
  });
});
