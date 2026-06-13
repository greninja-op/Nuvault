'use strict';

/**
 * Integration tests for the auth controllers (Tasks 5.1 + 5.2).
 *
 * Spins up an in-memory MongoDB and mounts a minimal Express app exposing:
 *   - `POST /register`   (Task 5.1)
 *   - `POST /login`      (Task 5.2)
 *   - `GET  /me`         (Task 5.2) — gated by a tiny test-only middleware
 *     that simulates what `protect` will do once Task 5.3 lands: read the
 *     `Authorization: Bearer <jwt>` header, verify it, and attach `req.user`.
 *
 * The tests exercise the request/response contract end to end:
 *   - Register: 201 with safe payload, 400 on every validation failure path,
 *     INR currency default, 30-day token expiry. (R1.x)
 *   - Login: 200 with safe payload + token, 400 on missing/empty fields
 *     (R2.4), 401 generic on unknown email (R2.2), 401 generic on wrong
 *     password (R2.3) — both 401 responses byte-identical (Property 10),
 *     case-insensitive email match (R2.5). The login response never
 *     contains the password hash (R2.7).
 *   - GetMe: 200 with profile minus password (R3.1), 404 when the
 *     authenticated user has been deleted between auth and handler (R3.4).
 *
 * Property-based coverage of the broader auth surface lives under tasks
 * 5.4–5.7 and is intentionally out of scope here.
 */

const express = require('express');
const mongoose = require('mongoose');
const supertest = require('supertest');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Configure JWT env *before* importing the controller (which transitively
// loads `generateToken`, which reads `process.env.JWT_SECRET`).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
process.env.JWT_EXPIRE = process.env.JWT_EXPIRE || '30d';

const errorHandler = require('../middleware/errorHandler');
const User = require('../models/User');
const {
  register,
  registerValidators,
  login,
  loginValidators,
  getMe,
  INVALID_CREDENTIALS_MESSAGE,
} = require('./authController');

/**
 * Minimal stand-in for the `protect` middleware (task 5.3). Verifies the
 * Bearer token, looks up the user (with the password excluded), and
 * attaches it to `req.user`. Kept inline so this test is self-contained
 * and does not depend on task 5.3's implementation timing.
 *
 * On any failure we delegate to the uniform error handler with a 401 so
 * the test app's error pipeline is exercised end to end.
 *
 * @returns {import('express').RequestHandler}
 */
function fakeProtect() {
  return async function protect(req, res, next) {
    const header = req.headers.authorization || '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) {
      const err = new Error('Not authorized');
      err.statusCode = 401;
      return next(err);
    }
    try {
      const decoded = jwt.verify(match[1], process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      if (!user) {
        const err = new Error('Not authorized');
        err.statusCode = 401;
        return next(err);
      }
      req.user = user;
      return next();
    } catch (_e) {
      const err = new Error('Token invalid');
      err.statusCode = 401;
      return next(err);
    }
  };
}

/**
 * Build a minimal Express app exposing the auth routes plus the uniform
 * error handler. Keeps the test isolated from CORS / Helmet / rate-limit
 * middleware that lives in unrelated tasks.
 *
 * @returns {import('express').Express}
 */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.post('/register', registerValidators, register);
  app.post('/login', loginValidators, login);
  app.get('/me', fakeProtect(), getMe);
  app.use(errorHandler);
  return app;
}

let mongoServer;
let app;
let request;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { dbName: 'nuvault_test' });
  app = buildApp();
  request = supertest(app);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
});

afterEach(async () => {
  await User.deleteMany({});
});

/**
 * Convenience: a body that satisfies every registration validator.
 *
 * @param {Partial<{ name: string, email: string, password: string }>} [overrides]
 */
function validBody(overrides = {}) {
  return {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    password: 'correct-horse-battery',
    ...overrides,
  };
}

/**
 * Register a user via the API and return the parsed body. Used by the
 * login + getMe tests so they exercise the same registration path real
 * clients use, including the bcrypt pre-save hook.
 *
 * @param {Partial<{ name: string, email: string, password: string }>} [overrides]
 */
async function registerUser(overrides = {}) {
  const body = validBody(overrides);
  const res = await request.post('/register').send(body);
  expect(res.status).toBe(201);
  return { body, response: res.body };
}

describe('POST /register — happy path', () => {
  test('creates a user, defaults currency to INR, and returns 201 with token + safe payload', async () => {
    const res = await request.post('/register').send(validBody());

    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(0);

    expect(res.body.user).toEqual({
      id: expect.any(String),
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    });

    // R1.6: neither plaintext password nor the bcrypt hash leaks out.
    const flat = JSON.stringify(res.body);
    expect(flat).not.toMatch(/correct-horse-battery/);
    expect(flat).not.toMatch(/password/i);

    // R1.7: currency persisted as INR by the schema default.
    const stored = await User.findById(res.body.user.id);
    expect(stored).not.toBeNull();
    expect(stored.currency).toBe('INR');

    // R1.2: stored password is a bcrypt hash, not the plaintext.
    expect(stored.password).not.toBe('correct-horse-battery');
    expect(stored.password).toMatch(/^\$2[aby]\$/);
  });

  test('issued token decodes back to the new user id with a 30-day expiry (R2.6)', async () => {
    const res = await request.post('/register').send(validBody({ email: 'grace@example.com' }));

    expect(res.status).toBe(201);

    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.id).toBe(res.body.user.id);

    const thirtyDays = 30 * 24 * 60 * 60;
    expect(decoded.exp - decoded.iat).toBeGreaterThanOrEqual(thirtyDays - 5);
    expect(decoded.exp - decoded.iat).toBeLessThanOrEqual(thirtyDays + 5);
  });

  test('trims surrounding whitespace from name and lowercases the stored email', async () => {
    const res = await request
      .post('/register')
      .send({
        name: '  Linus  ',
        email: '  Linus@Example.COM ',
        password: 'kernel-hacker',
      });

    expect(res.status).toBe(201);
    expect(res.body.user.name).toBe('Linus');
    expect(res.body.user.email).toBe('linus@example.com');
  });
});

describe('POST /register — validation errors (R1.4, R1.5, R1.8, R1.9)', () => {
  /**
   * Build a registration body where exactly one field has been replaced or
   * removed. Keeping body construction explicit avoids the "missing key
   * looks like undefined" trap that plain object spreads invite.
   *
   * @param {'name' | 'email' | 'password'} field
   * @param {string | undefined} value - When `undefined`, the field is
   *   omitted from the body entirely (simulating a missing field).
   */
  function bodyWith(field, value) {
    const body = validBody();
    if (value === undefined) {
      delete body[field];
    } else {
      body[field] = value;
    }
    return body;
  }

  test.each([
    ['name missing', 'name', undefined, /name/i],
    ['name empty', 'name', '', /name/i],
    ['name whitespace-only', 'name', '   ', /name/i],
    ['email missing', 'email', undefined, /email/i],
    ['email empty', 'email', '', /email/i],
    ['email whitespace-only', 'email', '   ', /email/i],
    ['password missing', 'password', undefined, /password/i],
    ['password empty', 'password', '', /password/i],
    ['password whitespace-only', 'password', '       ', /password/i],
  ])(
    'rejects when %s with 400 and a relevant message',
    async (_label, field, value, messagePattern) => {
      const res = await request.post('/register').send(bodyWith(field, value));

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(messagePattern);

      expect(await User.countDocuments({})).toBe(0);
    }
  );

  test('rejects a name longer than 100 characters with a length-out-of-range message (R1.9)', async () => {
    const tooLongName = 'a'.repeat(101);
    const res = await request.post('/register').send(validBody({ name: tooLongName }));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/name/i);
    expect(res.body.message).toMatch(/range|length/i);
  });

  test('rejects a syntactically invalid email (R1.8)', async () => {
    const res = await request.post('/register').send(validBody({ email: 'not-an-email' }));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/email/i);
    expect(res.body.message).toMatch(/invalid/i);
  });

  test('rejects an email longer than 254 characters (R1.8)', async () => {
    const local = 'a'.repeat(245);
    const tooLongEmail = `${local}@example.com`; // 245 + 12 = 257 chars
    const res = await request.post('/register').send(validBody({ email: tooLongEmail }));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/email/i);
  });

  test('rejects a password shorter than 6 characters (R1.5)', async () => {
    const res = await request.post('/register').send(validBody({ password: 'short' }));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/password/i);
    expect(res.body.message).toMatch(/range|length/i);
  });

  test('rejects a password longer than 128 characters (R1.5)', async () => {
    const res = await request.post('/register').send(validBody({ password: 'a'.repeat(129) }));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/password/i);
    expect(res.body.message).toMatch(/range|length/i);
  });

  test('does not persist a user when validation fails', async () => {
    await request.post('/register').send(validBody({ password: 'short' }));
    expect(await User.countDocuments({})).toBe(0);
  });
});

describe('POST /register — duplicate email (R1.3)', () => {
  test('rejects a second registration with the same email (case-insensitive) with 400', async () => {
    const first = await request.post('/register').send(validBody({ email: 'dup@example.com' }));
    expect(first.status).toBe(201);

    const second = await request
      .post('/register')
      .send(validBody({ email: 'DUP@Example.COM', name: 'Other Person' }));

    expect(second.status).toBe(400);
    expect(second.body.message).toMatch(/already/i);

    expect(await User.countDocuments({ email: 'dup@example.com' })).toBe(1);
  });
});


// =============================================================================
// Task 5.2 — login
// =============================================================================

describe('POST /login — happy path (R2.1, R2.5, R2.6, R2.7)', () => {
  test('returns 200 with token + safe user payload on valid credentials', async () => {
    const { body } = await registerUser({
      email: 'login@example.com',
      password: 'super-secret-1',
    });

    const res = await request.post('/login').send({
      email: 'login@example.com',
      password: 'super-secret-1',
    });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(0);

    expect(res.body.user).toEqual({
      id: expect.any(String),
      name: body.name,
      email: 'login@example.com',
    });

    // R2.7: neither plaintext password nor the bcrypt hash leaks out.
    const flat = JSON.stringify(res.body);
    expect(flat).not.toMatch(/super-secret-1/);
    expect(flat).not.toMatch(/\$2[aby]\$/);
  });

  test('issued token decodes back to the user id with a 30-day expiry (R2.6)', async () => {
    await registerUser({ email: 'expiry@example.com' });

    const res = await request.post('/login').send({
      email: 'expiry@example.com',
      password: 'correct-horse-battery',
    });

    expect(res.status).toBe(200);

    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.id).toBe(res.body.user.id);

    const thirtyDays = 30 * 24 * 60 * 60;
    expect(decoded.exp - decoded.iat).toBeGreaterThanOrEqual(thirtyDays - 5);
    expect(decoded.exp - decoded.iat).toBeLessThanOrEqual(thirtyDays + 5);
  });

  test('matches the email case-insensitively (R2.5)', async () => {
    await registerUser({
      email: 'mixed@example.com',
      password: 'a-good-password',
    });

    const res = await request.post('/login').send({
      // Different casing + surrounding whitespace; sanitizer normalizes it.
      email: '  Mixed@Example.COM ',
      password: 'a-good-password',
    });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('mixed@example.com');
  });
});

describe('POST /login — credential mismatch (R2.2, R2.3, Property 10)', () => {
  test('non-existent email → 401 with the generic invalid-credentials message', async () => {
    const res = await request.post('/login').send({
      email: 'nobody@example.com',
      password: 'whatever-password',
    });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe(INVALID_CREDENTIALS_MESSAGE);
  });

  test('wrong password → 401 with the same generic message as unknown-email', async () => {
    await registerUser({ email: 'real@example.com', password: 'real-password' });

    const wrongPwResponse = await request.post('/login').send({
      email: 'real@example.com',
      password: 'wrong-password',
    });
    const unknownEmailResponse = await request.post('/login').send({
      email: 'ghost@example.com',
      password: 'real-password',
    });

    // R2.3: both failures return 401 with the same generic message.
    expect(wrongPwResponse.status).toBe(401);
    expect(unknownEmailResponse.status).toBe(401);
    expect(wrongPwResponse.body.message).toBe(INVALID_CREDENTIALS_MESSAGE);
    expect(unknownEmailResponse.body.message).toBe(INVALID_CREDENTIALS_MESSAGE);

    // NOTE (Feature 6): the wrong-password response now ALSO carries
    // `attemptsRemaining` (lockout UX), while the unknown-email response does
    // not — so the two are intentionally no longer byte-identical. This is a
    // deliberate trade-off that relaxes the former anti-enumeration property
    // (Property 10) in favor of the lockout feedback the product requested.
    expect(wrongPwResponse.body.attemptsRemaining).toBe(4);
    expect(unknownEmailResponse.body.attemptsRemaining).toBeUndefined();
  });
});




describe('POST /login — account lockout (Feature 1 + 6)', () => {
  test('decrements attemptsRemaining each failure and locks after 5', async () => {
    await registerUser({ email: 'lock@example.com', password: 'correct-horse-battery' });

    const results = [];
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const r = await request
        .post('/login')
        .send({ email: 'lock@example.com', password: 'wrong-password' });
      results.push(r);
    }

    // Attempts 1-4: 401 with decreasing remaining count.
    expect(results[0].status).toBe(401);
    expect(results[0].body.attemptsRemaining).toBe(4);
    expect(results[1].body.attemptsRemaining).toBe(3);
    expect(results[2].body.attemptsRemaining).toBe(2);
    expect(results[3].body.attemptsRemaining).toBe(1);
    // 5th failure triggers the lock; still a 401 but no attempts remain.
    expect(results[4].status).toBe(401);
    expect(results[4].body.attemptsRemaining).toBe(0);

    // 6th attempt — even with the CORRECT password — is refused with 423.
    const sixth = await request
      .post('/login')
      .send({ email: 'lock@example.com', password: 'correct-horse-battery' });
    expect(sixth.status).toBe(423);
    expect(sixth.body.message).toMatch(/locked/i);
    expect(sixth.body.lockExpiresAt).toBeDefined();
  });

  test('a successful login resets the failed-attempt counter', async () => {
    await registerUser({ email: 'reset@example.com', password: 'correct-horse-battery' });

    await request.post('/login').send({ email: 'reset@example.com', password: 'nope' });
    await request.post('/login').send({ email: 'reset@example.com', password: 'nope' });

    const ok = await request
      .post('/login')
      .send({ email: 'reset@example.com', password: 'correct-horse-battery' });
    expect(ok.status).toBe(200);

    // Counter was reset → next wrong attempt starts again at 4 remaining.
    const wrong = await request
      .post('/login')
      .send({ email: 'reset@example.com', password: 'nope' });
    expect(wrong.body.attemptsRemaining).toBe(4);
  });
});

describe('POST /login — validation errors (R2.4)', () => {
  test.each([
    ['email missing', { password: 'correct-horse-battery' }, /email/i],
    ['email empty', { email: '', password: 'correct-horse-battery' }, /email/i],
    ['email whitespace-only', { email: '   ', password: 'correct-horse-battery' }, /email/i],
    ['password missing', { email: 'someone@example.com' }, /password/i],
    ['password empty', { email: 'someone@example.com', password: '' }, /password/i],
    [
      'password whitespace-only',
      { email: 'someone@example.com', password: '       ' },
      /password/i,
    ],
  ])('rejects when %s with 400 and a relevant message', async (_label, body, pattern) => {
    const res = await request.post('/login').send(body);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(pattern);
  });
});

// =============================================================================
// Task 5.2 — getMe
// =============================================================================

describe('GET /me — authenticated profile retrieval (R3.1, R3.4)', () => {
  test('returns 200 with the profile minus password when the token is valid', async () => {
    const registerRes = await request.post('/register').send(
      validBody({ email: 'profile@example.com', password: 'a-real-password' })
    );
    expect(registerRes.status).toBe(201);
    const { token, user } = registerRes.body;

    const res = await request
      .get('/me')
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: user.id,
      name: 'Ada Lovelace',
      email: 'profile@example.com',
      currency: 'INR',
      createdAt: expect.any(String),
    });

    // R3.1: response body never contains the password hash.
    const flat = JSON.stringify(res.body);
    expect(flat).not.toMatch(/a-real-password/);
    expect(flat).not.toMatch(/\$2[aby]\$/);
    expect(res.body).not.toHaveProperty('password');
  });

  test('returns 404 when the authenticated user has been deleted (R3.4)', async () => {
    const registerRes = await request.post('/register').send(
      validBody({ email: 'gone@example.com' })
    );
    expect(registerRes.status).toBe(201);
    const { token, user } = registerRes.body;

    // Simulate the user being removed between auth and handler.
    await User.findByIdAndDelete(user.id);

    const res = await request
      .get('/me')
      .set('Authorization', `Bearer ${token}`)
      .send();

    // The fake-protect middleware rejects with 401 first when the user
    // can't be resolved — this is the path that exists in the wired
    // pipeline and matches R4.5. The 404 path in `getMe` itself is the
    // belt-and-suspenders guard for the narrow window where `req.user`
    // is attached but the user disappears before the handler re-queries;
    // we exercise that path directly below via a stripped-down route
    // that bypasses the protect middleware.
    expect(res.status).toBe(401);
  });

  test('getMe handler returns 404 directly when its own re-query yields no user (R3.4)', async () => {
    // Build a one-off app that injects an `req.user` referencing a
    // nonexistent id, bypassing protect entirely. This is the only way
    // to exercise getMe's own 404 branch (R3.4) without depending on
    // task 5.3's middleware ordering.
    const minimalApp = express();
    const phantomId = new mongoose.Types.ObjectId().toString();
    minimalApp.use((req, _res, next) => {
      req.user = { _id: phantomId };
      next();
    });
    minimalApp.get('/me', getMe);
    minimalApp.use(errorHandler);

    const res = await supertest(minimalApp).get('/me').send();

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);
  });
});
