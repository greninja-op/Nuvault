'use strict';

/**
 * Integration tests for the liability controllers (Task 9.1).
 *
 * Spins up an in-memory MongoDB and mounts the liability sub-router on a
 * minimal Express app. A tiny middleware injects a fake `req.user` so the
 * tests cover the controller + ownership helper end to end without
 * depending on the real `protect` middleware (Task 5.3) — the auth path
 * is covered separately in `authController.test.js`.
 *
 * Coverage map:
 *   - POST   /liabilities           — happy path (201), validators (400),
 *                                     `user` injection ignored (R5.2).
 *   - GET    /liabilities           — empty list, populated list, scoped
 *                                     to the authenticated user (R5.1, R5.4).
 *   - GET    /liabilities/:id       — happy path, foreign-owner → 404,
 *                                     missing → 404, malformed → 404 (R5.3).
 *   - PUT    /liabilities/:id       — happy path (200), validators (400),
 *                                     foreign-owner → 404 with no mutation
 *                                     (R5.3, R7.5, R7.7), `user` immutability
 *                                     (R5.6).
 *   - DELETE /liabilities/:id       — happy path (200), foreign-owner →
 *                                     404 with the record intact (R7.6, R7.7).
 *
 * Property tests for cross-user isolation, default fields, and so on live
 * under task 18.x and are intentionally out of scope here.
 */

const express = require('express');
const mongoose = require('mongoose');
const supertest = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const errorHandler = require('../middleware/errorHandler');
const Liability = require('../models/Liability');
const liabilitiesRouter = require('../routes/liabilities');
const {
  LIABILITY_TYPES,
  MAX_AMOUNT,
} = require('./liabilityController');

/**
 * Build a minimal Express app that mounts the liability router behind a
 * fake-auth middleware. The middleware reads the desired user id from a
 * test-only `x-test-user` header; this is the simplest way to drive the
 * cross-user isolation cases without spinning up real JWTs.
 *
 * @returns {import('express').Express}
 */
function buildApp() {
  const app = express();
  app.use(express.json());

  // Inject `req.user` from the `x-test-user` header so each request can
  // act as a different authenticated user. Missing/invalid → 401, which
  // mirrors what `protect` does in production but without the JWT round
  // trip.
  app.use((req, res, next) => {
    const raw = req.headers['x-test-user'];
    if (!raw || !mongoose.isValidObjectId(raw)) {
      return res.status(401).json({ message: 'Not authorized' });
    }
    req.user = { _id: new mongoose.Types.ObjectId(String(raw)) };
    return next();
  });

  app.use('/liabilities', liabilitiesRouter);
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
  await Liability.deleteMany({});
});

/**
 * Convenience: a fresh user id for the current test.
 */
function makeUserId() {
  return new mongoose.Types.ObjectId();
}

/**
 * Convenience: a body that satisfies every validator.
 *
 * @param {Partial<{ name: string, type: string, amount: number }>} [overrides]
 */
function validBody(overrides = {}) {
  return {
    name: 'Car loan',
    type: 'loan',
    amount: 12500.55,
    ...overrides,
  };
}

/**
 * Persist a liability directly via the model so tests can set up data
 * without going through the API. Returns the saved document.
 *
 * @param {mongoose.Types.ObjectId} userId
 * @param {object} [overrides]
 */
function seedLiability(userId, overrides = {}) {
  return Liability.create({
    user: userId,
    name: 'Existing liability',
    type: 'loan',
    amount: 1000,
    ...overrides,
  });
}

// =============================================================================
// POST /liabilities
// =============================================================================

describe('POST /liabilities — happy path (R7.1)', () => {
  test('creates a liability owned by the authenticated user and returns 201', async () => {
    const userId = makeUserId();

    const res = await request
      .post('/liabilities')
      .set('x-test-user', String(userId))
      .send(validBody({ name: 'Mortgage', type: 'mortgage', amount: 250000.99 }));

    expect(res.status).toBe(201);
    expect(res.body).toEqual(
      expect.objectContaining({
        name: 'Mortgage',
        type: 'mortgage',
        amount: 250000.99,
        user: String(userId),
      })
    );
    expect(res.body._id).toEqual(expect.any(String));

    const stored = await Liability.findById(res.body._id);
    expect(stored).not.toBeNull();
    expect(String(stored.user)).toBe(String(userId));
    expect(stored.name).toBe('Mortgage');
    expect(stored.type).toBe('mortgage');
    expect(stored.amount).toBe(250000.99);
  });

  test('discards a client-supplied `user` field — ownership comes from the request (R5.2)', async () => {
    const owner = makeUserId();
    const attacker = makeUserId();

    const res = await request
      .post('/liabilities')
      .set('x-test-user', String(owner))
      .send({ ...validBody(), user: attacker });

    expect(res.status).toBe(201);
    expect(String(res.body.user)).toBe(String(owner));

    const stored = await Liability.findById(res.body._id);
    expect(String(stored.user)).toBe(String(owner));
    expect(String(stored.user)).not.toBe(String(attacker));
  });

  test('accepts every allowed type', async () => {
    const userId = makeUserId();

    for (const type of LIABILITY_TYPES) {
      const res = await request
        .post('/liabilities')
        .set('x-test-user', String(userId))
        .send(validBody({ type, name: `liability-${type}` }));

      expect(res.status).toBe(201);
      expect(res.body.type).toBe(type);
    }
  });
});

describe('POST /liabilities — validation errors (R7.2, R7.3, R7.4)', () => {
  /**
   * Build a body where exactly one field has been replaced or removed.
   *
   * @param {'name' | 'type' | 'amount'} field
   * @param {*} value - When `undefined`, the field is omitted entirely.
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
    ['type missing', 'type', undefined, /type/i],
    ['type empty', 'type', '', /type/i],
    ['amount missing', 'amount', undefined, /amount/i],
  ])('rejects when %s with 400 and a relevant message', async (_label, field, value, pattern) => {
    const userId = makeUserId();

    const res = await request
      .post('/liabilities')
      .set('x-test-user', String(userId))
      .send(bodyWith(field, value));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(pattern);

    expect(await Liability.countDocuments({})).toBe(0);
  });

  test('rejects a type outside the allowed set with 400 (R7.3)', async () => {
    const userId = makeUserId();

    const res = await request
      .post('/liabilities')
      .set('x-test-user', String(userId))
      .send(validBody({ type: 'not-a-real-type' }));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/type/i);
    expect(await Liability.countDocuments({})).toBe(0);
  });

  test('rejects a name longer than 100 characters with 400', async () => {
    const userId = makeUserId();

    const res = await request
      .post('/liabilities')
      .set('x-test-user', String(userId))
      .send(validBody({ name: 'a'.repeat(101) }));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/name/i);
    expect(res.body.message).toMatch(/range|length/i);
  });

  test.each([
    ['amount non-numeric', 'not-a-number'],
    ['amount as boolean', true],
    ['amount below minimum', 0.001],
    ['amount of 0', 0],
    ['amount negative', -1],
    ['amount above maximum', MAX_AMOUNT + 0.01],
  ])('rejects when %s with 400 (R7.4)', async (_label, badAmount) => {
    const userId = makeUserId();

    const res = await request
      .post('/liabilities')
      .set('x-test-user', String(userId))
      .send(validBody({ amount: badAmount }));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/amount/i);
    expect(await Liability.countDocuments({})).toBe(0);
  });
});

// =============================================================================
// GET /liabilities
// =============================================================================

describe('GET /liabilities — list (R5.1, R5.4)', () => {
  test('returns 200 with an empty array when the user has no liabilities', async () => {
    const userId = makeUserId();

    const res = await request
      .get('/liabilities')
      .set('x-test-user', String(userId))
      .send();

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test("returns 200 with the user's own liabilities and excludes other users' records", async () => {
    const userA = makeUserId();
    const userB = makeUserId();

    await seedLiability(userA, { name: 'A1', type: 'loan', amount: 100 });
    await seedLiability(userA, { name: 'A2', type: 'credit_card', amount: 200 });
    await seedLiability(userB, { name: 'B1', type: 'mortgage', amount: 9999 });

    const res = await request
      .get('/liabilities')
      .set('x-test-user', String(userA))
      .send();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    for (const item of res.body) {
      expect(String(item.user)).toBe(String(userA));
    }

    const names = res.body.map((r) => r.name).sort();
    expect(names).toEqual(['A1', 'A2']);
  });
});

// =============================================================================
// GET /liabilities/:id
// =============================================================================

describe('GET /liabilities/:id — fetch one (R5.3, R7.7)', () => {
  test('returns 200 with the liability when owned by the authenticated user', async () => {
    const userId = makeUserId();
    const doc = await seedLiability(userId, { name: 'mine', amount: 42 });

    const res = await request
      .get(`/liabilities/${doc._id}`)
      .set('x-test-user', String(userId))
      .send();

    expect(res.status).toBe(200);
    expect(res.body._id).toBe(String(doc._id));
    expect(res.body.name).toBe('mine');
    expect(res.body.amount).toBe(42);
  });

  test('returns 404 when the liability belongs to a different user (R5.3)', async () => {
    const owner = makeUserId();
    const intruder = makeUserId();
    const doc = await seedLiability(owner, { name: 'private' });

    const res = await request
      .get(`/liabilities/${doc._id}`)
      .set('x-test-user', String(intruder))
      .send();

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);

    // Owner's record is unchanged.
    const reloaded = await Liability.findById(doc._id);
    expect(reloaded).not.toBeNull();
    expect(String(reloaded.user)).toBe(String(owner));
  });

  test('returns 404 for a well-formed but nonexistent id', async () => {
    const userId = makeUserId();
    const ghostId = new mongoose.Types.ObjectId();

    const res = await request
      .get(`/liabilities/${ghostId}`)
      .set('x-test-user', String(userId))
      .send();

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);
  });

  test('returns 404 for a malformed id (no 500 / cast error leak)', async () => {
    const userId = makeUserId();

    const res = await request
      .get('/liabilities/not-an-id')
      .set('x-test-user', String(userId))
      .send();

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);
  });
});

// =============================================================================
// PUT /liabilities/:id
// =============================================================================

describe('PUT /liabilities/:id — update (R7.5, R7.7)', () => {
  test('returns 200 with the updated liability when owned by the user', async () => {
    const userId = makeUserId();
    const doc = await seedLiability(userId, {
      name: 'original',
      type: 'loan',
      amount: 100,
    });

    const res = await request
      .put(`/liabilities/${doc._id}`)
      .set('x-test-user', String(userId))
      .send({ name: 'renamed', type: 'credit_card', amount: 5000.5 });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('renamed');
    expect(res.body.type).toBe('credit_card');
    expect(res.body.amount).toBe(5000.5);

    const reloaded = await Liability.findById(doc._id);
    expect(reloaded.name).toBe('renamed');
    expect(reloaded.type).toBe('credit_card');
    expect(reloaded.amount).toBe(5000.5);
    expect(String(reloaded.user)).toBe(String(userId));
  });

  test('never reassigns the user even when the body supplies one (R5.6)', async () => {
    const owner = makeUserId();
    const attacker = makeUserId();
    const doc = await seedLiability(owner, { name: 'original' });

    const res = await request
      .put(`/liabilities/${doc._id}`)
      .set('x-test-user', String(owner))
      .send({
        name: 'renamed',
        type: 'loan',
        amount: 10,
        user: attacker,
      });

    expect(res.status).toBe(200);
    expect(String(res.body.user)).toBe(String(owner));

    const reloaded = await Liability.findById(doc._id);
    expect(String(reloaded.user)).toBe(String(owner));
  });

  test('returns 404 when the liability belongs to a different user and leaves it unchanged (R5.3, R7.7)', async () => {
    const owner = makeUserId();
    const intruder = makeUserId();
    const doc = await seedLiability(owner, {
      name: 'protected',
      type: 'mortgage',
      amount: 999,
    });

    const res = await request
      .put(`/liabilities/${doc._id}`)
      .set('x-test-user', String(intruder))
      .send({ name: 'hijacked', type: 'loan', amount: 1 });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);

    // Owner's record unchanged.
    const reloaded = await Liability.findById(doc._id);
    expect(reloaded.name).toBe('protected');
    expect(reloaded.type).toBe('mortgage');
    expect(reloaded.amount).toBe(999);
  });

  test('returns 404 for a well-formed but nonexistent id', async () => {
    const userId = makeUserId();
    const ghostId = new mongoose.Types.ObjectId();

    const res = await request
      .put(`/liabilities/${ghostId}`)
      .set('x-test-user', String(userId))
      .send(validBody());

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);
  });

  test('returns 400 on invalid input and does not mutate the record (R7.3, R7.4)', async () => {
    const userId = makeUserId();
    const doc = await seedLiability(userId, {
      name: 'original',
      type: 'loan',
      amount: 100,
    });

    const res = await request
      .put(`/liabilities/${doc._id}`)
      .set('x-test-user', String(userId))
      .send({ name: 'renamed', type: 'not-a-real-type', amount: 50 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/type/i);

    const reloaded = await Liability.findById(doc._id);
    expect(reloaded.name).toBe('original');
    expect(reloaded.type).toBe('loan');
    expect(reloaded.amount).toBe(100);
  });
});

// =============================================================================
// DELETE /liabilities/:id
// =============================================================================

describe('DELETE /liabilities/:id — delete (R7.6, R7.7)', () => {
  test('returns 200 and removes the liability when owned by the user', async () => {
    const userId = makeUserId();
    const doc = await seedLiability(userId, { name: 'goodbye' });

    const res = await request
      .delete(`/liabilities/${doc._id}`)
      .set('x-test-user', String(userId))
      .send();

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/deleted/i),
        id: String(doc._id),
      })
    );

    const reloaded = await Liability.findById(doc._id);
    expect(reloaded).toBeNull();
  });

  test('returns 404 and leaves the record intact when owned by another user (R5.3, R7.7)', async () => {
    const owner = makeUserId();
    const intruder = makeUserId();
    const doc = await seedLiability(owner, { name: 'safe' });

    const res = await request
      .delete(`/liabilities/${doc._id}`)
      .set('x-test-user', String(intruder))
      .send();

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);

    const reloaded = await Liability.findById(doc._id);
    expect(reloaded).not.toBeNull();
    expect(String(reloaded.user)).toBe(String(owner));
    expect(reloaded.name).toBe('safe');
  });

  test('returns 404 for a malformed id (no 500 / cast error leak)', async () => {
    const userId = makeUserId();

    const res = await request
      .delete('/liabilities/not-an-id')
      .set('x-test-user', String(userId))
      .send();

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);
  });

  test('returns 404 for a well-formed but nonexistent id', async () => {
    const userId = makeUserId();
    const ghostId = new mongoose.Types.ObjectId();

    const res = await request
      .delete(`/liabilities/${ghostId}`)
      .set('x-test-user', String(userId))
      .send();

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);
  });
});
