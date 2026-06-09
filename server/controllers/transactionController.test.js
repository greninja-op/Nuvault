'use strict';

/**
 * Integration tests for the transaction controller (Tasks 11.1 + 11.2).
 *
 * Covers the controller end-to-end against an in-memory MongoDB:
 *   - happy-path CRUD (R9.1, R9.6, R9.7),
 *   - the date-default-to-now contract (R9.5),
 *   - validation (R9.2, R9.3, R9.4) — missing fields, invalid type,
 *     non-numeric / out-of-range / >2dp amount, invalid date,
 *   - 404 for cross-user / missing / malformed-id access (R9.8 + R5.3),
 *   - list filtering by month/year, including both-or-neither and
 *     range validation (R10.1, R10.2, R10.3),
 *   - the income/expense summary grouped by category, including the
 *     empty-scope path (R10.4, R10.5).
 *
 * The tests build a minimal Express app that mounts the transactions
 * router directly. Authentication is stubbed via a header-driven
 * middleware that resolves `req.user` from `X-Test-User` so a single
 * test can exercise both User A and User B in the same server.
 *
 * Property tests for the broader transaction surface (Properties 1, 2,
 * 3, 4, 5, 7, 15, 16, 17) live in tasks 11.3–11.5 and 18.x; this file
 * is the unit-level integration coverage that matches tasks 11.1 and
 * 11.2.
 */

const express = require('express');
const mongoose = require('mongoose');
const supertest = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const errorHandler = require('../middleware/errorHandler');
const Transaction = require('../models/Transaction');
const {
  createTransaction,
  getTransactions,
  getTransaction,
  updateTransaction,
  deleteTransaction,
  getSummary,
  transactionValidators,
} = require('./transactionController');

/**
 * Stand-in for the `protect` middleware (task 5.3). Reads an
 * `X-Test-User` header carrying a Mongoose ObjectId string and attaches
 * it as `req.user._id`. Tests can swap users per request without
 * rebuilding the app.
 *
 * If the header is missing the request is rejected with 401 — mirroring
 * what `protect` would do for an unauthenticated call (R4.3).
 *
 * @returns {import('express').RequestHandler}
 */
function fakeProtect() {
  return function protect(req, res, next) {
    const raw = req.headers['x-test-user'];
    if (!raw || !mongoose.isValidObjectId(raw)) {
      const err = new Error('Not authorized');
      err.statusCode = 401;
      return next(err);
    }
    req.user = { _id: new mongoose.Types.ObjectId(String(raw)) };
    return next();
  };
}

/**
 * Build a minimal Express app exposing the transaction routes. The
 * routes are mounted at `/transactions` (matching the production mount
 * path) with the fake-protect middleware in front so every route is
 * gated by an `X-Test-User` header.
 *
 * @returns {import('express').Express}
 */
function buildApp() {
  const app = express();
  app.use(express.json());

  const router = express.Router();
  router.get('/', transactionValidators.list, getTransactions);
  // `/summary` MUST come before `/:id` so the literal path wins when
  // matching; otherwise Express captures "summary" as the id parameter.
  router.get('/summary', transactionValidators.list, getSummary);
  router.post('/', transactionValidators.create, createTransaction);
  router.get('/:id', getTransaction);
  router.put('/:id', transactionValidators.update, updateTransaction);
  router.delete('/:id', deleteTransaction);

  app.use('/transactions', fakeProtect(), router);
  app.use(errorHandler);
  return app;
}

let mongoServer;
let app;
let request;

// Two stable test-user ids reused across every test. Created here (not
// per-test) so the tests can write `userA` / `userB` inline without
// having to thread fresh ids through every helper.
const userA = new mongoose.Types.ObjectId();
const userB = new mongoose.Types.ObjectId();

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
  await Transaction.deleteMany({});
});

/**
 * Convenience: produce a body that satisfies every create validator.
 * Tests override individual fields by spreading the result.
 *
 * @param {object} [overrides]
 * @returns {object}
 */
function validBody(overrides = {}) {
  return {
    type: 'expense',
    category: 'groceries',
    amount: 12.34,
    description: 'weekly groceries',
    ...overrides,
  };
}

/**
 * Issue an authenticated request as the given user id. Wrapping
 * supertest like this keeps every test concise: the explicit `userId`
 * argument makes per-request user-switching obvious in cross-user
 * tests, and the helper centralizes the auth-header convention.
 *
 * @param {string} method
 * @param {string} url
 * @param {mongoose.Types.ObjectId} userId
 */
function authed(method, url, userId) {
  return request[method](url).set('X-Test-User', String(userId));
}

// =============================================================================
// POST /transactions — happy path
// =============================================================================

describe('POST /transactions — happy path', () => {
  test('creates an expense and returns 201 with the persisted record (R9.1)', async () => {
    const res = await authed('post', '/transactions', userA).send(validBody());

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      type: 'expense',
      category: 'groceries',
      amount: 12.34,
      description: 'weekly groceries',
    });
    expect(typeof res.body._id).toBe('string');
    expect(String(res.body.user)).toBe(String(userA));

    // The persisted record carries the same fields.
    const stored = await Transaction.findById(res.body._id);
    expect(stored).not.toBeNull();
    expect(stored.amount).toBe(12.34);
  });

  test('creates an income transaction (covers the other allowed type)', async () => {
    const res = await authed('post', '/transactions', userA).send(
      validBody({ type: 'income', category: 'salary', amount: 5000 })
    );

    expect(res.status).toBe(201);
    expect(res.body.type).toBe('income');
    expect(res.body.category).toBe('salary');
    expect(res.body.amount).toBe(5000);
  });

  test('defaults the date to creation time when omitted (R9.5)', async () => {
    const before = Date.now();
    const res = await authed('post', '/transactions', userA).send(validBody());
    const after = Date.now();

    expect(res.status).toBe(201);
    expect(typeof res.body.date).toBe('string');
    const persistedMs = new Date(res.body.date).getTime();

    // Allow a tiny clock-skew window in either direction.
    expect(persistedMs).toBeGreaterThanOrEqual(before - 5);
    expect(persistedMs).toBeLessThanOrEqual(after + 5);
  });

  test('respects an explicit date when supplied', async () => {
    const explicit = new Date('2024-01-15T10:00:00.000Z').toISOString();
    const res = await authed('post', '/transactions', userA).send(
      validBody({ date: explicit })
    );

    expect(res.status).toBe(201);
    expect(new Date(res.body.date).toISOString()).toBe(explicit);
  });

  test('forces the persisted user to req.user._id, ignoring any client-supplied user (R5.2)', async () => {
    const attackerId = new mongoose.Types.ObjectId();
    const res = await authed('post', '/transactions', userA).send({
      ...validBody(),
      user: attackerId,
    });

    expect(res.status).toBe(201);
    expect(String(res.body.user)).toBe(String(userA));
    expect(String(res.body.user)).not.toBe(String(attackerId));
  });
});

// =============================================================================
// POST /transactions — validation (R9.2, R9.3, R9.4)
// =============================================================================

describe('POST /transactions — validation errors', () => {
  // Each case mutates a fresh, valid body to express the failure mode
  // explicitly. Using a mutator function instead of a partial-override
  // object avoids the "is `undefined` a 'missing' key or a present key
  // with a missing value?" ambiguity that JSON serialization papers
  // over but tests should not depend on.
  test.each([
    ['type missing', (b) => delete b.type, /type/i],
    ['category missing', (b) => delete b.category, /category/i],
    ['category empty', (b) => { b.category = ''; }, /category/i],
    ['category whitespace-only', (b) => { b.category = '   '; }, /category/i],
    ['amount missing', (b) => delete b.amount, /amount/i],
  ])('rejects when %s with 400 and a relevant message (R9.2)', async (_label, mutate, pattern) => {
    const body = validBody();
    mutate(body);

    const res = await authed('post', '/transactions', userA).send(body);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(pattern);
    expect(await Transaction.countDocuments({})).toBe(0);
  });

  test('rejects an invalid type with 400 (R9.3)', async () => {
    const res = await authed('post', '/transactions', userA).send(
      validBody({ type: 'transfer' })
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/type/i);
    expect(await Transaction.countDocuments({})).toBe(0);
  });

  test('rejects a category longer than 100 characters with 400', async () => {
    const res = await authed('post', '/transactions', userA).send(
      validBody({ category: 'a'.repeat(101) })
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/category/i);
  });

  test.each([
    ['non-numeric amount', { amount: 'not-a-number' }],
    ['amount of zero', { amount: 0 }],
    ['negative amount', { amount: -5 }],
    ['amount above the maximum', { amount: 1_000_000_000 }],
    ['amount with 3 decimal places', { amount: 1.234 }],
  ])('rejects when %s with 400 (R9.4)', async (_label, override) => {
    const res = await authed('post', '/transactions', userA).send(validBody(override));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/amount/i);
    expect(await Transaction.countDocuments({})).toBe(0);
  });

  test('rejects an unparsable date with 400', async () => {
    const res = await authed('post', '/transactions', userA).send(
      validBody({ date: 'not-a-date' })
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/date/i);
  });
});

// =============================================================================
// GET /transactions — list (sorted by date desc)
// =============================================================================

describe('GET /transactions — list', () => {
  test('returns only the authenticated user\'s transactions, sorted by date descending', async () => {
    // Two transactions for user A, one for user B; the response for A
    // must contain exactly A's records in newest-first order.
    await Transaction.create({
      user: userA,
      type: 'expense',
      category: 'old',
      amount: 10,
      date: new Date('2023-01-01T00:00:00.000Z'),
    });
    await Transaction.create({
      user: userA,
      type: 'income',
      category: 'newer',
      amount: 50,
      date: new Date('2024-06-01T00:00:00.000Z'),
    });
    await Transaction.create({
      user: userB,
      type: 'expense',
      category: 'someone-else',
      amount: 99,
      date: new Date('2099-12-31T00:00:00.000Z'),
    });

    const res = await authed('get', '/transactions', userA).send();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);

    // Sorted by date descending: 2024 record before 2023 record.
    expect(res.body[0].category).toBe('newer');
    expect(res.body[1].category).toBe('old');

    // No leakage of user B's record (R5.4).
    for (const t of res.body) {
      expect(String(t.user)).toBe(String(userA));
      expect(t.category).not.toBe('someone-else');
    }
  });

  test('returns an empty array when the user has no transactions (R10.5)', async () => {
    const res = await authed('get', '/transactions', userA).send();

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// =============================================================================
// GET /transactions/:id — read one
// =============================================================================

describe('GET /transactions/:id', () => {
  test('returns the transaction when it belongs to the authenticated user', async () => {
    const doc = await Transaction.create({
      user: userA,
      type: 'expense',
      category: 'rent',
      amount: 1500,
    });

    const res = await authed('get', `/transactions/${doc._id}`, userA).send();

    expect(res.status).toBe(200);
    expect(String(res.body._id)).toBe(String(doc._id));
    expect(res.body.category).toBe('rent');
  });

  test('returns 404 for a transaction owned by a different user (R9.8 + R5.3)', async () => {
    const doc = await Transaction.create({
      user: userB,
      type: 'expense',
      category: 'private',
      amount: 42,
    });

    const res = await authed('get', `/transactions/${doc._id}`, userA).send();

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);

    // The other user's record is untouched.
    const reloaded = await Transaction.findById(doc._id);
    expect(reloaded).not.toBeNull();
    expect(reloaded.category).toBe('private');
  });

  test('returns 404 for a non-existent id', async () => {
    const ghost = new mongoose.Types.ObjectId();
    const res = await authed('get', `/transactions/${ghost}`, userA).send();

    expect(res.status).toBe(404);
  });

  test('returns 404 (not 500) for a malformed id', async () => {
    const res = await authed('get', '/transactions/not-an-id', userA).send();

    expect(res.status).toBe(404);
  });
});

// =============================================================================
// PUT /transactions/:id — update
// =============================================================================

describe('PUT /transactions/:id', () => {
  test('applies the partial update and returns 200 with the updated record (R9.6)', async () => {
    const doc = await Transaction.create({
      user: userA,
      type: 'expense',
      category: 'old-category',
      amount: 10,
    });

    const res = await authed('put', `/transactions/${doc._id}`, userA).send({
      category: 'new-category',
      amount: 99.99,
    });

    expect(res.status).toBe(200);
    expect(res.body.category).toBe('new-category');
    expect(res.body.amount).toBe(99.99);
    // Untouched field survives the partial update.
    expect(res.body.type).toBe('expense');

    const reloaded = await Transaction.findById(doc._id);
    expect(reloaded.category).toBe('new-category');
    expect(reloaded.amount).toBe(99.99);
  });

  test('returns 404 and leaves the record unchanged when targeting another user\'s transaction (R9.8)', async () => {
    const doc = await Transaction.create({
      user: userB,
      type: 'expense',
      category: 'private',
      amount: 42,
    });

    const res = await authed('put', `/transactions/${doc._id}`, userA).send({
      category: 'hijacked',
      amount: 9999,
    });

    expect(res.status).toBe(404);

    const reloaded = await Transaction.findById(doc._id);
    expect(reloaded.category).toBe('private');
    expect(reloaded.amount).toBe(42);
  });

  test('rejects an invalid amount on update with 400 and does not persist (R9.4)', async () => {
    const doc = await Transaction.create({
      user: userA,
      type: 'expense',
      category: 'rent',
      amount: 1500,
    });

    const res = await authed('put', `/transactions/${doc._id}`, userA).send({
      amount: -1,
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/amount/i);

    const reloaded = await Transaction.findById(doc._id);
    expect(reloaded.amount).toBe(1500);
  });

  test('rejects an invalid type on update with 400 (R9.3)', async () => {
    const doc = await Transaction.create({
      user: userA,
      type: 'expense',
      category: 'rent',
      amount: 1500,
    });

    const res = await authed('put', `/transactions/${doc._id}`, userA).send({
      type: 'transfer',
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/type/i);
  });

  test('does not reassign the user field even when the payload supplies one (R5.6)', async () => {
    const doc = await Transaction.create({
      user: userA,
      type: 'expense',
      category: 'rent',
      amount: 1500,
    });
    const attackerId = new mongoose.Types.ObjectId();

    const res = await authed('put', `/transactions/${doc._id}`, userA).send({
      category: 'updated',
      user: attackerId,
    });

    expect(res.status).toBe(200);
    expect(String(res.body.user)).toBe(String(userA));

    const reloaded = await Transaction.findById(doc._id);
    expect(String(reloaded.user)).toBe(String(userA));
  });

  test('returns 404 for a non-existent id', async () => {
    const ghost = new mongoose.Types.ObjectId();
    const res = await authed('put', `/transactions/${ghost}`, userA).send({
      category: 'whatever',
    });

    expect(res.status).toBe(404);
  });
});

// =============================================================================
// DELETE /transactions/:id
// =============================================================================

describe('DELETE /transactions/:id', () => {
  test('deletes the transaction and returns 200 (R9.7)', async () => {
    const doc = await Transaction.create({
      user: userA,
      type: 'expense',
      category: 'rent',
      amount: 1500,
    });

    const res = await authed('delete', `/transactions/${doc._id}`, userA).send();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });

    const reloaded = await Transaction.findById(doc._id);
    expect(reloaded).toBeNull();
  });

  test('returns 404 and leaves the record intact for another user\'s transaction (R9.8)', async () => {
    const doc = await Transaction.create({
      user: userB,
      type: 'expense',
      category: 'private',
      amount: 42,
    });

    const res = await authed('delete', `/transactions/${doc._id}`, userA).send();

    expect(res.status).toBe(404);

    const reloaded = await Transaction.findById(doc._id);
    expect(reloaded).not.toBeNull();
  });

  test('returns 404 for a non-existent id', async () => {
    const ghost = new mongoose.Types.ObjectId();
    const res = await authed('delete', `/transactions/${ghost}`, userA).send();

    expect(res.status).toBe(404);
  });

  test('returns 404 (not 500) for a malformed id', async () => {
    const res = await authed('delete', '/transactions/not-an-id', userA).send();

    expect(res.status).toBe(404);
  });
});

// =============================================================================
// GET /transactions — month/year filter (Task 11.2, R10.1–R10.3)
// =============================================================================

describe('GET /transactions — month/year filter', () => {
  /**
   * Seed three transactions in distinct months for user A plus one for
   * user B, so each filter test can assert both inclusion (correct
   * month/year) and exclusion (other months and other users).
   */
  async function seedAcrossMonths() {
    await Transaction.create([
      {
        user: userA,
        type: 'expense',
        category: 'jan',
        amount: 100,
        date: new Date('2024-01-15T12:00:00.000Z'),
      },
      {
        user: userA,
        type: 'expense',
        category: 'jan-end',
        amount: 50,
        // Boundary: the very last millisecond of January must land in
        // the January bucket, not February.
        date: new Date('2024-01-31T23:59:59.999Z'),
      },
      {
        user: userA,
        type: 'income',
        category: 'feb',
        amount: 200,
        date: new Date('2024-02-10T00:00:00.000Z'),
      },
      {
        user: userB,
        type: 'expense',
        category: 'jan-other-user',
        amount: 999,
        date: new Date('2024-01-15T12:00:00.000Z'),
      },
    ]);
  }

  test('returns every transaction for the user when no filter is supplied (R10.1)', async () => {
    await seedAcrossMonths();

    const res = await authed('get', '/transactions', userA).send();

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    // Sorted by date descending: feb (Feb 10) → jan (Jan 15) → jan-end? no:
    // jan-end is Jan 31 23:59 (later than Jan 15 12:00) so feb → jan-end → jan.
    expect(res.body.map((t) => t.category)).toEqual(['feb', 'jan-end', 'jan']);
  });

  test('returns only the requested month/year (R10.2) and excludes other users (R5.4)', async () => {
    await seedAcrossMonths();

    const res = await authed('get', '/transactions?month=1&year=2024', userA).send();

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((t) => t.category).sort()).toEqual(['jan', 'jan-end']);
    // jan-other-user belongs to user B and must not appear.
    for (const t of res.body) {
      expect(String(t.user)).toBe(String(userA));
      expect(t.category).not.toBe('jan-other-user');
    }
  });

  test('returns an empty array for a month with no transactions, with status 200 (R10.5)', async () => {
    await seedAcrossMonths();

    const res = await authed('get', '/transactions?month=7&year=2024', userA).send();

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  // --- both-or-neither (R10.3) ---
  test.each([
    ['only month supplied', '/transactions?month=3'],
    ['only year supplied', '/transactions?year=2024'],
  ])('rejects %s with 400 (R10.3)', async (_label, url) => {
    const res = await authed('get', url, userA).send();

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/together/i);
  });

  // --- range validation (R10.3) ---
  test.each([
    ['month below 1', '/transactions?month=0&year=2024', /month/i],
    ['month above 12', '/transactions?month=13&year=2024', /month/i],
    ['month not an integer', '/transactions?month=abc&year=2024', /month/i],
    ['year below 1970', '/transactions?month=6&year=1969', /year/i],
    ['year above 9999', '/transactions?month=6&year=10000', /year/i],
    ['year not an integer', '/transactions?month=6&year=twenty', /year/i],
  ])('rejects %s with 400 (R10.3)', async (_label, url, pattern) => {
    const res = await authed('get', url, userA).send();

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(pattern);
  });

  test('accepts the inclusive year boundaries 1970 and 9999', async () => {
    // No data — we only care that the filter passes validation and
    // returns a clean empty list.
    const low = await authed('get', '/transactions?month=1&year=1970', userA).send();
    const high = await authed('get', '/transactions?month=12&year=9999', userA).send();

    expect(low.status).toBe(200);
    expect(low.body).toEqual([]);
    expect(high.status).toBe(200);
    expect(high.body).toEqual([]);
  });
});

// =============================================================================
// GET /transactions/summary — category totals (Task 11.2, R10.4–R10.5)
// =============================================================================

describe('GET /transactions/summary', () => {
  test('returns income and expense totals grouped by category for the user (R10.4)', async () => {
    // Mix of categories per type, plus a duplicate-category record per
    // type so the test asserts the summer is actually summing.
    await Transaction.create([
      { user: userA, type: 'income', category: 'salary', amount: 5000, date: new Date('2024-01-10') },
      { user: userA, type: 'income', category: 'salary', amount: 1000, date: new Date('2024-02-10') },
      { user: userA, type: 'income', category: 'gifts', amount: 250, date: new Date('2024-03-15') },
      { user: userA, type: 'expense', category: 'groceries', amount: 100, date: new Date('2024-01-05') },
      { user: userA, type: 'expense', category: 'groceries', amount: 50.5, date: new Date('2024-02-05') },
      { user: userA, type: 'expense', category: 'rent', amount: 1500, date: new Date('2024-01-01') },
      // Cross-user record must NEVER contribute to user A's totals
      // (R5.1, R5.4).
      { user: userB, type: 'income', category: 'salary', amount: 9999, date: new Date('2024-01-10') },
      { user: userB, type: 'expense', category: 'groceries', amount: 8888, date: new Date('2024-01-10') },
    ]);

    const res = await authed('get', '/transactions/summary', userA).send();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      // Sorted alphabetically by category for stability.
      income: [
        { category: 'gifts', total: 250 },
        { category: 'salary', total: 6000 },
      ],
      expense: [
        { category: 'groceries', total: 150.5 },
        { category: 'rent', total: 1500 },
      ],
    });
  });

  test('returns 200 with empty income/expense arrays when the user has no transactions (R10.5)', async () => {
    const res = await authed('get', '/transactions/summary', userA).send();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ income: [], expense: [] });
  });

  test('honors the month/year filter when summing (R10.4 + R10.2)', async () => {
    await Transaction.create([
      { user: userA, type: 'income', category: 'salary', amount: 5000, date: new Date('2024-01-15T00:00:00.000Z') },
      { user: userA, type: 'income', category: 'salary', amount: 6000, date: new Date('2024-02-15T00:00:00.000Z') },
      { user: userA, type: 'expense', category: 'rent', amount: 1500, date: new Date('2024-01-01T00:00:00.000Z') },
      { user: userA, type: 'expense', category: 'rent', amount: 1500, date: new Date('2024-02-01T00:00:00.000Z') },
    ]);

    const jan = await authed('get', '/transactions/summary?month=1&year=2024', userA).send();

    expect(jan.status).toBe(200);
    expect(jan.body).toEqual({
      income: [{ category: 'salary', total: 5000 }],
      expense: [{ category: 'rent', total: 1500 }],
    });
  });

  test('returns empty arrays when the requested month has no records (R10.5)', async () => {
    await Transaction.create([
      { user: userA, type: 'income', category: 'salary', amount: 5000, date: new Date('2024-01-15') },
    ]);

    const res = await authed('get', '/transactions/summary?month=7&year=2024', userA).send();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ income: [], expense: [] });
  });

  test.each([
    ['only month supplied', '/transactions/summary?month=3'],
    ['only year supplied', '/transactions/summary?year=2024'],
    ['month out of range', '/transactions/summary?month=13&year=2024'],
    ['year out of range', '/transactions/summary?month=6&year=1969'],
  ])('rejects %s with 400 (R10.3 applied to summary)', async (_label, url) => {
    const res = await authed('get', url, userA).send();

    expect(res.status).toBe(400);
  });
});
