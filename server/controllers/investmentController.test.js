'use strict';

/**
 * Integration tests for the investment controller (Task 14.1).
 *
 * Spins up an in-memory MongoDB and mounts the investment sub-router
 * on a minimal Express app behind a fake-protect middleware that
 * injects `req.user` from a per-request header. This mirrors the
 * pattern already used by `assetController.test.js`,
 * `liabilityController.test.js`, and `transactionController.test.js`,
 * and keeps the test isolated from the JWT verification path covered
 * separately by the auth tests.
 *
 * Coverage map (Task 14.1 / Requirements 13.1–13.7):
 *   - POST   /investments        — happy path (R13.1), all allowed types
 *                                  accepted, client-supplied `user` is
 *                                  ignored (R5.2).
 *   - POST   /investments        — validators reject missing fields
 *                                  (R13.2), out-of-set type (R13.3),
 *                                  out-of-range / non-numeric quantity
 *                                  and buyPrice (R13.4); none persists.
 *   - GET    /investments        — empty list, populated list, scoped to
 *                                  the authenticated user (R5.1, R5.4).
 *   - GET    /investments/:id    — happy path, foreign-owner → 404,
 *                                  missing → 404, malformed → 404
 *                                  (R5.3, R13.7).
 *   - PUT    /investments/:id    — happy path (R13.5), validators on
 *                                  update (R13.3, R13.4) without
 *                                  mutation, foreign-owner → 404 with
 *                                  the record unchanged (R5.3, R13.7),
 *                                  ownership immutable (R5.6).
 *   - DELETE /investments/:id    — happy path (R13.6), foreign-owner →
 *                                  404 with the record intact (R13.7),
 *                                  missing/malformed → 404.
 *   - GET    /investments/summary— placeholder route routes to `getSummary`
 *                                  (501), confirming `/summary` is matched
 *                                  before the `/:id` parameter route.
 *
 * The summary stub is exercised only as a routing smoke check — the real
 * pricing/P&L behavior belongs to task 14.2 and is intentionally out of
 * scope here. Property-based coverage of the broader CRUD/isolation
 * surface lives under tasks 18.x.
 */

const express = require('express');
const mongoose = require('mongoose');
const supertest = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const errorHandler = require('../middleware/errorHandler');
const Investment = require('../models/Investment');
const investmentsRouter = require('../routes/investments');
const {
  INVESTMENT_TYPES,
  MAX_AMOUNT,
} = require('./investmentController');

/**
 * Build a minimal Express app that mounts the investment router behind
 * a fake-auth middleware. The user id is read from a test-only
 * `x-test-user` header so each request can act as a different
 * authenticated user — exactly what the cross-user isolation checks
 * need without a real JWT round trip.
 *
 * @returns {import('express').Express}
 */
function buildApp() {
  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    const raw = req.headers['x-test-user'];
    if (!raw || !mongoose.isValidObjectId(raw)) {
      return res.status(401).json({ message: 'Not authorized' });
    }
    req.user = { _id: new mongoose.Types.ObjectId(String(raw)) };
    return next();
  });

  app.use('/investments', investmentsRouter);
  app.use(errorHandler);
  return app;
}

let mongoServer;
let app;
let request;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { dbName: 'nuvault_investments_test' });
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
  await Investment.deleteMany({});
});

/** Allocate a fresh user id (as ObjectId) for the current test. */
function makeUserId() {
  return new mongoose.Types.ObjectId();
}

/**
 * A body that satisfies every investment validator.
 *
 * @param {Partial<{
 *   type: string,
 *   name: string,
 *   quantity: number,
 *   buyPrice: number,
 *   symbol: string,
 *   currentPrice: number,
 *   buyDate: string | Date,
 *   notes: string
 * }>} [overrides]
 */
function validBody(overrides = {}) {
  return {
    type: 'stock',
    name: 'Acme Corp',
    quantity: 10,
    buyPrice: 125.5,
    ...overrides,
  };
}

/**
 * Persist an investment directly via the model so tests can set up data
 * without going through the API. Returns the saved document.
 *
 * @param {mongoose.Types.ObjectId} userId
 * @param {object} [overrides]
 */
function seedInvestment(userId, overrides = {}) {
  return Investment.create({
    user: userId,
    type: 'stock',
    name: 'Existing holding',
    quantity: 1,
    buyPrice: 100,
    ...overrides,
  });
}

// =============================================================================
// POST /investments
// =============================================================================

describe('POST /investments — happy path (R13.1)', () => {
  test('creates an investment owned by the authenticated user and returns 201', async () => {
    const userId = makeUserId();

    const res = await request
      .post('/investments')
      .set('x-test-user', String(userId))
      .send(
        validBody({
          type: 'crypto',
          name: 'Bitcoin',
          quantity: 0.5,
          buyPrice: 60000.99,
          symbol: 'BTC-USD',
        })
      );

    expect(res.status).toBe(201);
    expect(res.body).toEqual(
      expect.objectContaining({
        type: 'crypto',
        name: 'Bitcoin',
        quantity: 0.5,
        buyPrice: 60000.99,
        symbol: 'BTC-USD',
        user: String(userId),
      })
    );
    expect(res.body._id).toEqual(expect.any(String));

    const stored = await Investment.findById(res.body._id);
    expect(stored).not.toBeNull();
    expect(String(stored.user)).toBe(String(userId));
    expect(stored.type).toBe('crypto');
    expect(stored.name).toBe('Bitcoin');
    expect(stored.quantity).toBe(0.5);
    expect(stored.buyPrice).toBe(60000.99);
  });

  test('discards a client-supplied `user` field — ownership comes from the request (R5.2)', async () => {
    const owner = makeUserId();
    const attacker = makeUserId();

    const res = await request
      .post('/investments')
      .set('x-test-user', String(owner))
      .send({ ...validBody(), user: attacker });

    expect(res.status).toBe(201);
    expect(String(res.body.user)).toBe(String(owner));

    const stored = await Investment.findById(res.body._id);
    expect(String(stored.user)).toBe(String(owner));
    expect(String(stored.user)).not.toBe(String(attacker));
  });

  test('accepts every allowed type', async () => {
    const userId = makeUserId();

    for (const type of INVESTMENT_TYPES) {
      const res = await request
        .post('/investments')
        .set('x-test-user', String(userId))
        .send(validBody({ type, name: `holding-${type}` }));

      expect(res.status).toBe(201);
      expect(res.body.type).toBe(type);
    }
  });

  test('accepts the boundary values for quantity and buyPrice', async () => {
    const userId = makeUserId();

    const low = await request
      .post('/investments')
      .set('x-test-user', String(userId))
      .send(validBody({ name: 'low', quantity: 0.01, buyPrice: 0.01 }));
    expect(low.status).toBe(201);
    expect(low.body.quantity).toBeCloseTo(0.01, 2);
    expect(low.body.buyPrice).toBeCloseTo(0.01, 2);

    const high = await request
      .post('/investments')
      .set('x-test-user', String(userId))
      .send(
        validBody({
          name: 'high',
          quantity: MAX_AMOUNT,
          buyPrice: MAX_AMOUNT,
        })
      );
    expect(high.status).toBe(201);
    expect(high.body.quantity).toBeCloseTo(MAX_AMOUNT, 2);
    expect(high.body.buyPrice).toBeCloseTo(MAX_AMOUNT, 2);
  });
});

describe('POST /investments — validation errors (R13.2, R13.3, R13.4)', () => {
  /**
   * Build a body where exactly one field has been replaced or removed.
   *
   * @param {'type' | 'name' | 'quantity' | 'buyPrice'} field
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
    ['type missing', 'type', undefined, /type/i],
    ['type empty', 'type', '', /type/i],
    ['type whitespace-only', 'type', '   ', /type/i],
    ['name missing', 'name', undefined, /name/i],
    ['name empty', 'name', '', /name/i],
    ['name whitespace-only', 'name', '   ', /name/i],
    ['quantity missing', 'quantity', undefined, /quantity/i],
    ['buyPrice missing', 'buyPrice', undefined, /buyPrice/i],
  ])('rejects when %s with 400 and a relevant message', async (_label, field, value, pattern) => {
    const userId = makeUserId();

    const res = await request
      .post('/investments')
      .set('x-test-user', String(userId))
      .send(bodyWith(field, value));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(pattern);

    expect(await Investment.countDocuments({})).toBe(0);
  });

  test('rejects a type outside the allowed set with 400 (R13.3)', async () => {
    const userId = makeUserId();

    const res = await request
      .post('/investments')
      .set('x-test-user', String(userId))
      .send(validBody({ type: 'not-a-real-type' }));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/type/i);
    expect(await Investment.countDocuments({})).toBe(0);
  });

  test('rejects a name longer than 100 characters with 400', async () => {
    const userId = makeUserId();

    const res = await request
      .post('/investments')
      .set('x-test-user', String(userId))
      .send(validBody({ name: 'a'.repeat(101) }));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/name/i);
    expect(await Investment.countDocuments({})).toBe(0);
  });

  test.each([
    ['quantity non-numeric', 'quantity', 'not-a-number'],
    ['quantity as boolean', 'quantity', true],
    ['quantity zero', 'quantity', 0],
    ['quantity negative', 'quantity', -1],
    ['quantity above maximum', 'quantity', MAX_AMOUNT + 0.01],
    ['quantity NaN', 'quantity', NaN],
  ])('rejects when %s with 400 (R13.4)', async (_label, field, badValue) => {
    const userId = makeUserId();

    const res = await request
      .post('/investments')
      .set('x-test-user', String(userId))
      .send(validBody({ [field]: badValue }));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/quantity/i);
    expect(await Investment.countDocuments({})).toBe(0);
  });

  test.each([
    ['buyPrice non-numeric', 'buyPrice', 'not-a-number'],
    ['buyPrice as boolean', 'buyPrice', true],
    ['buyPrice zero', 'buyPrice', 0],
    ['buyPrice negative', 'buyPrice', -1],
    ['buyPrice above maximum', 'buyPrice', MAX_AMOUNT + 0.01],
    ['buyPrice NaN', 'buyPrice', NaN],
  ])('rejects when %s with 400 (R13.4)', async (_label, field, badValue) => {
    const userId = makeUserId();

    const res = await request
      .post('/investments')
      .set('x-test-user', String(userId))
      .send(validBody({ [field]: badValue }));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/buyPrice/i);
    expect(await Investment.countDocuments({})).toBe(0);
  });
});

// =============================================================================
// GET /investments
// =============================================================================

describe('GET /investments — list (R5.1, R5.4)', () => {
  test('returns 200 with an empty array when the user has no investments', async () => {
    const userId = makeUserId();

    const res = await request
      .get('/investments')
      .set('x-test-user', String(userId))
      .send();

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test("returns 200 with the user's own investments and excludes other users' records", async () => {
    const userA = makeUserId();
    const userB = makeUserId();

    await seedInvestment(userA, { name: 'A1', type: 'stock', quantity: 1, buyPrice: 10 });
    await seedInvestment(userA, { name: 'A2', type: 'crypto', quantity: 2, buyPrice: 20 });
    await seedInvestment(userB, { name: 'B1', type: 'fd', quantity: 3, buyPrice: 30 });

    const res = await request
      .get('/investments')
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
// GET /investments/:id
// =============================================================================

describe('GET /investments/:id — fetch one (R5.3, R13.7)', () => {
  test('returns 200 with the investment when owned by the authenticated user', async () => {
    const userId = makeUserId();
    const doc = await seedInvestment(userId, {
      name: 'mine',
      type: 'mutual_fund',
      quantity: 4,
      buyPrice: 42,
    });

    const res = await request
      .get(`/investments/${doc._id}`)
      .set('x-test-user', String(userId))
      .send();

    expect(res.status).toBe(200);
    expect(res.body._id).toBe(String(doc._id));
    expect(res.body.name).toBe('mine');
    expect(res.body.type).toBe('mutual_fund');
    expect(res.body.quantity).toBe(4);
    expect(res.body.buyPrice).toBe(42);
  });

  test('returns 404 when the investment belongs to a different user (R5.3)', async () => {
    const owner = makeUserId();
    const intruder = makeUserId();
    const doc = await seedInvestment(owner, { name: 'private' });

    const res = await request
      .get(`/investments/${doc._id}`)
      .set('x-test-user', String(intruder))
      .send();

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);

    // Owner's record is unchanged.
    const reloaded = await Investment.findById(doc._id);
    expect(reloaded).not.toBeNull();
    expect(String(reloaded.user)).toBe(String(owner));
  });

  test('returns 404 for a well-formed but nonexistent id', async () => {
    const userId = makeUserId();
    const ghostId = new mongoose.Types.ObjectId();

    const res = await request
      .get(`/investments/${ghostId}`)
      .set('x-test-user', String(userId))
      .send();

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);
  });

  test('returns 404 for a malformed id (no 500 / cast error leak)', async () => {
    const userId = makeUserId();

    const res = await request
      .get('/investments/not-an-id')
      .set('x-test-user', String(userId))
      .send();

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);
  });
});

// =============================================================================
// PUT /investments/:id
// =============================================================================

describe('PUT /investments/:id — update (R13.5, R13.7)', () => {
  test('returns 200 with the updated investment when owned by the user', async () => {
    const userId = makeUserId();
    const doc = await seedInvestment(userId, {
      name: 'original',
      type: 'stock',
      quantity: 1,
      buyPrice: 10,
    });

    const res = await request
      .put(`/investments/${doc._id}`)
      .set('x-test-user', String(userId))
      .send({
        name: 'renamed',
        type: 'crypto',
        quantity: 2.5,
        buyPrice: 99.99,
      });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('renamed');
    expect(res.body.type).toBe('crypto');
    expect(res.body.quantity).toBe(2.5);
    expect(res.body.buyPrice).toBe(99.99);

    const reloaded = await Investment.findById(doc._id);
    expect(reloaded.name).toBe('renamed');
    expect(reloaded.type).toBe('crypto');
    expect(reloaded.quantity).toBe(2.5);
    expect(reloaded.buyPrice).toBe(99.99);
    expect(String(reloaded.user)).toBe(String(userId));
  });

  test('never reassigns the user even when the body supplies one (R5.6)', async () => {
    const owner = makeUserId();
    const attacker = makeUserId();
    const doc = await seedInvestment(owner, { name: 'original' });

    const res = await request
      .put(`/investments/${doc._id}`)
      .set('x-test-user', String(owner))
      .send({
        name: 'renamed',
        type: 'stock',
        quantity: 1,
        buyPrice: 10,
        user: attacker,
      });

    expect(res.status).toBe(200);
    expect(String(res.body.user)).toBe(String(owner));

    const reloaded = await Investment.findById(doc._id);
    expect(String(reloaded.user)).toBe(String(owner));
  });

  test('returns 404 when the investment belongs to a different user and leaves it unchanged (R5.3, R13.7)', async () => {
    const owner = makeUserId();
    const intruder = makeUserId();
    const doc = await seedInvestment(owner, {
      name: 'protected',
      type: 'fd',
      quantity: 5,
      buyPrice: 250,
    });

    const res = await request
      .put(`/investments/${doc._id}`)
      .set('x-test-user', String(intruder))
      .send({ name: 'hijacked', type: 'stock', quantity: 1, buyPrice: 1 });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);

    const reloaded = await Investment.findById(doc._id);
    expect(reloaded.name).toBe('protected');
    expect(reloaded.type).toBe('fd');
    expect(reloaded.quantity).toBe(5);
    expect(reloaded.buyPrice).toBe(250);
  });

  test('returns 404 for a well-formed but nonexistent id', async () => {
    const userId = makeUserId();
    const ghostId = new mongoose.Types.ObjectId();

    const res = await request
      .put(`/investments/${ghostId}`)
      .set('x-test-user', String(userId))
      .send(validBody());

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);
  });

  test('returns 404 for a malformed id (no 500 / cast error leak)', async () => {
    const userId = makeUserId();

    const res = await request
      .put('/investments/not-an-id')
      .set('x-test-user', String(userId))
      .send(validBody());

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);
  });

  test('returns 400 on invalid input and does not mutate the record (R13.3, R13.4)', async () => {
    const userId = makeUserId();
    const doc = await seedInvestment(userId, {
      name: 'original',
      type: 'stock',
      quantity: 5,
      buyPrice: 10,
    });

    const res = await request
      .put(`/investments/${doc._id}`)
      .set('x-test-user', String(userId))
      .send({ name: 'renamed', type: 'stock', quantity: -3, buyPrice: 10 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/quantity/i);

    const reloaded = await Investment.findById(doc._id);
    expect(reloaded.name).toBe('original');
    expect(reloaded.quantity).toBe(5);
    expect(reloaded.buyPrice).toBe(10);
  });
});

// =============================================================================
// DELETE /investments/:id
// =============================================================================

describe('DELETE /investments/:id — delete (R13.6, R13.7)', () => {
  test('returns 200 and removes the investment when owned by the user', async () => {
    const userId = makeUserId();
    const doc = await seedInvestment(userId, { name: 'goodbye' });

    const res = await request
      .delete(`/investments/${doc._id}`)
      .set('x-test-user', String(userId))
      .send();

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/deleted/i),
        id: String(doc._id),
      })
    );

    const reloaded = await Investment.findById(doc._id);
    expect(reloaded).toBeNull();
  });

  test('returns 404 and leaves the record intact when owned by another user (R5.3, R13.7)', async () => {
    const owner = makeUserId();
    const intruder = makeUserId();
    const doc = await seedInvestment(owner, { name: 'safe' });

    const res = await request
      .delete(`/investments/${doc._id}`)
      .set('x-test-user', String(intruder))
      .send();

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);

    const reloaded = await Investment.findById(doc._id);
    expect(reloaded).not.toBeNull();
    expect(String(reloaded.user)).toBe(String(owner));
    expect(reloaded.name).toBe('safe');
  });

  test('returns 404 for a malformed id (no 500 / cast error leak)', async () => {
    const userId = makeUserId();

    const res = await request
      .delete('/investments/not-an-id')
      .set('x-test-user', String(userId))
      .send();

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);
  });

  test('returns 404 for a well-formed but nonexistent id', async () => {
    const userId = makeUserId();
    const ghostId = new mongoose.Types.ObjectId();

    const res = await request
      .delete(`/investments/${ghostId}`)
      .set('x-test-user', String(userId))
      .send();

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);
  });
});

// =============================================================================
// GET /investments/summary — routing smoke check (full implementation tested
// in investmentController.summary.test.js)
// =============================================================================

describe('GET /investments/summary — routing', () => {
  // The summary handler does the heavy lifting in task 14.2; this test
  // only confirms the route is reachable and that `/summary` is matched
  // before `/:id` (otherwise Express would treat "summary" as an id and
  // route through `getInvestment`, which would 404). The full pricing
  // and P&L behavior is covered by `investmentController.summary.test.js`.
  test('responds 200 with the expected summary shape for a user with no investments', async () => {
    const userId = makeUserId();

    const res = await request
      .get('/investments/summary')
      .set('x-test-user', String(userId))
      .send();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [],
      totalInvested: 0,
      totalCurrentValue: 0,
      totalPnL: 0,
    });
  });
});
