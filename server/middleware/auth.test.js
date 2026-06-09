'use strict';

/**
 * Tests for the `protect` middleware (Task 5.3).
 *
 * Spins up an in-memory MongoDB and a small Express app whose only
 * protected route echoes the resolved `req.user`. Each test asserts how
 * `protect` handles a single failure mode or success path:
 *
 *   - Missing Authorization header                  → 401 (R3.2, R4.3)
 *   - Authorization without a Bearer scheme         → 401 (R3.2, R4.3)
 *   - Bearer with an empty credential               → 401 (R3.2, R4.3)
 *   - Bearer with a malformed JWT                   → 401 (R3.3, R4.4)
 *   - Bearer signed with a different secret         → 401 (R3.3, R4.4)
 *   - Bearer that has expired                       → 401 (R3.3, R4.4)
 *   - Token id is not a valid ObjectId              → 401 (R4.4 / R4.5)
 *   - Valid token but the user has been deleted     → 401 (R4.5)
 *   - Valid token resolves a real user              → 200, req.user
 *                                                     attached, password
 *                                                     hash absent (R4.2,
 *                                                     defense-in-depth
 *                                                     for R3.1)
 *
 * The tests always call the middleware through Express + the uniform
 * error handler, so they exercise the same response pipeline a real
 * request would.
 */

const express = require('express');
const mongoose = require('mongoose');
const supertest = require('supertest');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Set the JWT secret BEFORE requiring the middleware. The middleware
// itself reads `process.env.JWT_SECRET` lazily at verify time, but a
// stable, non-empty secret here keeps the tests deterministic regardless
// of the host environment.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'protect-test-secret';
process.env.JWT_EXPIRE = process.env.JWT_EXPIRE || '30d';

const protect = require('./auth');
const errorHandler = require('./errorHandler');
const User = require('../models/User');

let mongoServer;
let app;
let request;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { dbName: 'nuvault_protect_test' });

  // Minimal app whose only route is gated by `protect` and echoes the
  // attached user. Going through the real error handler ensures the
  // 401 responses are shaped uniformly (R20.1, R20.2).
  app = express();
  app.get('/protected', protect, (req, res) => {
    const userObj = req.user.toObject ? req.user.toObject() : req.user;
    res.status(200).json({
      userId: String(req.user._id),
      email: req.user.email,
      // Confirm the password projection was excluded — a downstream
      // controller / serializer must never see the bcrypt hash.
      hasPassword: Object.prototype.hasOwnProperty.call(userObj, 'password'),
    });
  });
  app.use(errorHandler);
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

let userCounter = 0;

/**
 * Persist a user and return both the document and a freshly issued JWT
 * for that user. Each call uses a unique email so tests can run in any
 * order without colliding on the unique index.
 *
 * @param {object} [options]
 * @param {string|number} [options.expiresIn='30d']
 * @returns {Promise<{ user: import('mongoose').HydratedDocument, token: string }>}
 */
async function createUserAndToken(options = {}) {
  userCounter += 1;
  const user = await User.create({
    name: 'Protect Test',
    email: `protect-${Date.now()}-${userCounter}@example.com`,
    password: 'real-password-1',
  });
  const token = jwt.sign(
    { id: String(user._id) },
    process.env.JWT_SECRET,
    { expiresIn: options.expiresIn || '30d' }
  );
  return { user, token };
}

describe('protect — missing or non-Bearer Authorization (R3.2, R4.3)', () => {
  test('rejects with 401 when the Authorization header is absent', async () => {
    const res = await request.get('/protected').send();

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/not authorized/i);
  });

  test('rejects with 401 when the Authorization header lacks a Bearer scheme', async () => {
    const res = await request
      .get('/protected')
      .set('Authorization', 'Basic abcdefg')
      .send();

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/not authorized/i);
  });

  test('rejects with 401 when the Bearer credential is empty', async () => {
    const res = await request
      .get('/protected')
      .set('Authorization', 'Bearer ')
      .send();

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/not authorized/i);
  });
});

describe('protect — token verification failures (R3.3, R4.4)', () => {
  test('rejects with 401 when the token is malformed', async () => {
    const res = await request
      .get('/protected')
      .set('Authorization', 'Bearer not-a-jwt')
      .send();

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid/i);
  });

  test('rejects with 401 when the token is signed with a different secret', async () => {
    const { user } = await createUserAndToken();
    const wrongToken = jwt.sign({ id: String(user._id) }, 'a-different-secret', {
      expiresIn: '30d',
    });

    const res = await request
      .get('/protected')
      .set('Authorization', `Bearer ${wrongToken}`)
      .send();

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid/i);
  });

  test('rejects with 401 when the token is expired', async () => {
    const { user } = await createUserAndToken();
    // Negative expiresIn → already past at issue time.
    const expiredToken = jwt.sign(
      { id: String(user._id) },
      process.env.JWT_SECRET,
      { expiresIn: -10 }
    );

    const res = await request
      .get('/protected')
      .set('Authorization', `Bearer ${expiredToken}`)
      .send();

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid/i);
  });

  test('rejects with 401 when the token id is not a valid ObjectId', async () => {
    const malformedToken = jwt.sign(
      { id: 'not-an-objectid' },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    const res = await request
      .get('/protected')
      .set('Authorization', `Bearer ${malformedToken}`)
      .send();

    // The id is valid JWT-shaped but cannot be cast to an ObjectId; the
    // middleware coalesces this with other token-shape failures into a
    // single 401 so the API never reveals which factor broke.
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid|not authorized/i);
  });
});

describe('protect — user resolution (R4.5)', () => {
  test('rejects with 401 when the token references a user that does not exist', async () => {
    const phantomId = new mongoose.Types.ObjectId().toString();
    const ghostToken = jwt.sign({ id: phantomId }, process.env.JWT_SECRET, {
      expiresIn: '30d',
    });

    const res = await request
      .get('/protected')
      .set('Authorization', `Bearer ${ghostToken}`)
      .send();

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/not authorized/i);
  });

  test('rejects with 401 when the user is deleted between issuance and request', async () => {
    const { user, token } = await createUserAndToken();
    // Simulate the user being removed after the token was issued.
    await User.findByIdAndDelete(user._id);

    const res = await request
      .get('/protected')
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/not authorized/i);
  });
});

describe('protect — happy path (R4.2)', () => {
  test('attaches req.user (without password) and yields to the controller on a valid token', async () => {
    const { user, token } = await createUserAndToken();

    const res = await request
      .get('/protected')
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(String(user._id));
    expect(res.body.email).toBe(user.email);
    // R3.1 / R22.8 defense-in-depth: the bcrypt hash is never present on
    // `req.user`, so even a buggy downstream serializer cannot leak it.
    expect(res.body.hasPassword).toBe(false);
  });

  test('accepts the Bearer scheme case-insensitively', async () => {
    const { token } = await createUserAndToken();

    const res = await request
      .get('/protected')
      .set('Authorization', `bearer ${token}`)
      .send();

    expect(res.status).toBe(200);
  });

  test('tolerates extra whitespace around the Bearer credential', async () => {
    const { token } = await createUserAndToken();

    const res = await request
      .get('/protected')
      .set('Authorization', `Bearer  ${token}  `)
      .send();

    expect(res.status).toBe(200);
  });
});
