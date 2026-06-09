'use strict';

/**
 * Integration tests for the budget list + spending computation
 * (Task 12.2).
 *
 * Scope:
 *   - Default month/year defaulting from the server clock (R12.1).
 *   - Explicit month/year filtering (R12.2).
 *   - Both-or-neither query validation and bounds (R10.3-style
 *     symmetry; month 1–12, year 1970–2100).
 *   - Per-budget spending derivation from expense transactions (R12.3),
 *     including the inclusive month-range boundary, exclusion of
 *     income transactions, exclusion of cross-user transactions, and
 *     correct grouping by category.
 *   - Response decoration: `spent`, `remaining = limit − spent`,
 *     `overBudget = spent > limit` (R12.4).
 *   - Empty matching set yields `spent = 0`, `remaining = limit`
 *     (R12.5).
 *   - Spending is never written to the persisted Budget document
 *     (R12.6).
 *
 * The setup mirrors `transactionController.test.js`: a minimal Express
 * app mounts the budgets sub-router behind a header-driven fake
 * `protect` middleware so each test can act as either of two distinct
 * users without rebuilding the app.
 *
 * Property tests (Property 18 + 19) are tasks 12.3 / 12.4 and live in a
 * separate file when implemented.
 */

const express = require('express');
const mongoose = require('mongoose');
const supertest = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const errorHandler = require('../middleware/errorHandler');
const Budget = require('../models/Budget');
const Transaction = require('../models/Transaction');
const budgetsRouter = require('../routes/budgets');

/**
 * Stand-in for the production `protect` middleware. Reads an
 * `X-Test-User` header carrying a Mongoose ObjectId string and attaches
 * it as `req.user._id`. Tests can therefore swap users per request
 * without rebuilding the app.
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

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/budgets', fakeProtect(), budgetsRouter);
  app.use(errorHandler);
  return app;
}

let mongoServer;
let app;
let request;

const userA = new mongoose.Types.ObjectId();
const userB = new mongoose.Types.ObjectId();

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { dbName: 'nuvault_test' });
  // Build indexes so duplicate-key tests would behave correctly even
  // though we don't exercise them here; cheap insurance against a
  // shared mongoose connection across test files.
  await Budget.syncIndexes();
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
  await Promise.all([Budget.deleteMany({}), Transaction.deleteMany({})]);
});

function authed(method, url, userId) {
  return request[method](url).set('X-Test-User', String(userId));
}

/**
 * Convenience wrapper that builds a stored Budget document for a user.
 * @param {object} overrides
 */
async function makeBudget(overrides) {
  return Budget.create({
    user: userA,
    category: 'groceries',
    limit: 500,
    month: 6,
    year: 2024,
    ...overrides,
  });
}

/**
 * Convenience wrapper that builds a stored Transaction for a user.
 * @param {object} overrides
 */
async function makeTransaction(overrides) {
  return Transaction.create({
    user: userA,
    type: 'expense',
    category: 'groceries',
    amount: 100,
    date: new Date('2024-06-15T12:00:00.000Z'),
    ...overrides,
  });
}

// =============================================================================
// Default period (server clock)
// =============================================================================

describe('GET /budgets — default month/year (R12.1)', () => {
  test('defaults to the current server month and year when both query params are omitted', async () => {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // A budget for the current period should appear.
    await makeBudget({
      category: 'now',
      limit: 100,
      month: currentMonth,
      year: currentYear,
    });
    // A budget for a different period should NOT appear.
    await makeBudget({
      category: 'past',
      limit: 100,
      month: currentMonth === 1 ? 12 : currentMonth - 1,
      year: currentMonth === 1 ? currentYear - 1 : currentYear,
    });

    const res = await authed('get', '/budgets', userA).send();

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].category).toBe('now');
    expect(res.body[0].month).toBe(currentMonth);
    expect(res.body[0].year).toBe(currentYear);
  });

  test('returns an empty array (200) when the user has no budgets for the current period', async () => {
    const res = await authed('get', '/budgets', userA).send();
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// =============================================================================
// Explicit period
// =============================================================================

describe('GET /budgets — explicit month/year (R12.2)', () => {
  test('returns only budgets matching the supplied month/year', async () => {
    await makeBudget({ category: 'june-budget', month: 6, year: 2024 });
    await makeBudget({ category: 'may-budget', month: 5, year: 2024 });
    await makeBudget({ category: 'june-2023', month: 6, year: 2023 });

    const res = await authed('get', '/budgets?month=6&year=2024', userA).send();

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].category).toBe('june-budget');
    expect(res.body[0].month).toBe(6);
    expect(res.body[0].year).toBe(2024);
  });

  test("excludes another user's budgets even when the period matches (R5.4)", async () => {
    await makeBudget({ user: userA, category: 'mine', month: 6, year: 2024 });
    await Budget.create({
      user: userB,
      category: 'theirs',
      limit: 200,
      month: 6,
      year: 2024,
    });

    const res = await authed('get', '/budgets?month=6&year=2024', userA).send();

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].category).toBe('mine');
  });

  test('accepts numeric strings for month/year', async () => {
    await makeBudget({ category: 'q', month: 1, year: 2024 });
    const res = await authed('get', '/budgets?month=01&year=2024', userA).send();
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

// =============================================================================
// Validation
// =============================================================================

describe('GET /budgets — query validation', () => {
  test('rejects with 400 when only month is supplied', async () => {
    const res = await authed('get', '/budgets?month=6', userA).send();
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/both/i);
  });

  test('rejects with 400 when only year is supplied', async () => {
    const res = await authed('get', '/budgets?year=2024', userA).send();
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/both/i);
  });

  test.each([
    ['month=0&year=2024', /month/i],
    ['month=13&year=2024', /month/i],
    ['month=abc&year=2024', /month/i],
    ['month=1.5&year=2024', /month/i],
  ])('rejects when query is %s', async (qs, pattern) => {
    const res = await authed('get', `/budgets?${qs}`, userA).send();
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(pattern);
  });

  test.each([
    ['month=6&year=1969', /year/i],
    ['month=6&year=2101', /year/i],
    ['month=6&year=abc', /year/i],
    ['month=6&year=2024.5', /year/i],
  ])('rejects when query is %s', async (qs, pattern) => {
    const res = await authed('get', `/budgets?${qs}`, userA).send();
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(pattern);
  });
});

// =============================================================================
// Spending computation (R12.3, R12.4, R12.5)
// =============================================================================

describe('GET /budgets — spending computation', () => {
  test('reports spent = 0 and remaining = limit when no matching transactions exist (R12.5)', async () => {
    await makeBudget({ category: 'groceries', limit: 500, month: 6, year: 2024 });

    const res = await authed('get', '/budgets?month=6&year=2024', userA).send();

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      category: 'groceries',
      limit: 500,
      spent: 0,
      remaining: 500,
      overBudget: false,
    });
  });

  test('sums matching expense transactions within the budget month (R12.3)', async () => {
    await makeBudget({ category: 'groceries', limit: 500, month: 6, year: 2024 });

    await makeTransaction({
      category: 'groceries',
      amount: 120.5,
      date: new Date('2024-06-05T10:00:00.000Z'),
    });
    await makeTransaction({
      category: 'groceries',
      amount: 79.5,
      date: new Date('2024-06-20T10:00:00.000Z'),
    });

    const res = await authed('get', '/budgets?month=6&year=2024', userA).send();

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      category: 'groceries',
      limit: 500,
      spent: 200,
      remaining: 300,
      overBudget: false,
    });
  });

  test('excludes income transactions even when category matches (R12.3)', async () => {
    await makeBudget({ category: 'salary', limit: 500, month: 6, year: 2024 });
    await makeTransaction({
      type: 'income',
      category: 'salary',
      amount: 5000,
      date: new Date('2024-06-15T10:00:00.000Z'),
    });

    const res = await authed('get', '/budgets?month=6&year=2024', userA).send();

    expect(res.body[0].spent).toBe(0);
    expect(res.body[0].remaining).toBe(500);
    expect(res.body[0].overBudget).toBe(false);
  });

  test('excludes transactions whose category does not match', async () => {
    await makeBudget({ category: 'groceries', limit: 500, month: 6, year: 2024 });
    await makeTransaction({
      category: 'rent',
      amount: 1500,
      date: new Date('2024-06-15T10:00:00.000Z'),
    });

    const res = await authed('get', '/budgets?month=6&year=2024', userA).send();

    expect(res.body[0].spent).toBe(0);
  });

  test("excludes another user's transactions (R5.1)", async () => {
    await makeBudget({ category: 'groceries', limit: 500, month: 6, year: 2024 });
    await Transaction.create({
      user: userB,
      type: 'expense',
      category: 'groceries',
      amount: 999,
      date: new Date('2024-06-15T10:00:00.000Z'),
    });

    const res = await authed('get', '/budgets?month=6&year=2024', userA).send();

    expect(res.body[0].spent).toBe(0);
  });

  test('includes transactions on the first day of the month at 00:00 (inclusive lower bound)', async () => {
    await makeBudget({ category: 'groceries', limit: 500, month: 6, year: 2024 });
    // Local time first instant of June 2024.
    await makeTransaction({
      amount: 50,
      date: new Date(2024, 5, 1, 0, 0, 0, 0),
    });

    const res = await authed('get', '/budgets?month=6&year=2024', userA).send();

    expect(res.body[0].spent).toBe(50);
  });

  test('includes transactions on the last day of the month near 23:59 (inclusive upper bound)', async () => {
    await makeBudget({ category: 'groceries', limit: 500, month: 6, year: 2024 });
    await makeTransaction({
      amount: 75,
      date: new Date(2024, 5, 30, 23, 59, 59, 999),
    });

    const res = await authed('get', '/budgets?month=6&year=2024', userA).send();

    expect(res.body[0].spent).toBe(75);
  });

  test('excludes transactions on the first instant of the next month (exclusive upper bound)', async () => {
    await makeBudget({ category: 'groceries', limit: 500, month: 6, year: 2024 });
    await makeTransaction({
      amount: 999,
      date: new Date(2024, 6, 1, 0, 0, 0, 0),
    });

    const res = await authed('get', '/budgets?month=6&year=2024', userA).send();

    expect(res.body[0].spent).toBe(0);
  });

  test('handles December correctly when computing the next-month boundary', async () => {
    await makeBudget({ category: 'gifts', limit: 500, month: 12, year: 2024 });
    // In-month
    await makeTransaction({
      category: 'gifts',
      amount: 100,
      date: new Date(2024, 11, 31, 12, 0, 0, 0),
    });
    // First instant of January 2025 — must be excluded.
    await makeTransaction({
      category: 'gifts',
      amount: 999,
      date: new Date(2025, 0, 1, 0, 0, 0, 0),
    });

    const res = await authed('get', '/budgets?month=12&year=2024', userA).send();

    expect(res.body[0].spent).toBe(100);
  });

  test('flags overBudget=true when spent strictly exceeds limit (R12.4)', async () => {
    await makeBudget({ category: 'groceries', limit: 500, month: 6, year: 2024 });
    await makeTransaction({
      amount: 600,
      date: new Date('2024-06-10T10:00:00.000Z'),
    });

    const res = await authed('get', '/budgets?month=6&year=2024', userA).send();

    expect(res.body[0]).toMatchObject({
      spent: 600,
      remaining: -100,
      overBudget: true,
    });
  });

  test('flags overBudget=false when spent equals limit exactly (R12.4 strict-inequality)', async () => {
    await makeBudget({ category: 'groceries', limit: 500, month: 6, year: 2024 });
    await makeTransaction({
      amount: 500,
      date: new Date('2024-06-10T10:00:00.000Z'),
    });

    const res = await authed('get', '/budgets?month=6&year=2024', userA).send();

    expect(res.body[0]).toMatchObject({
      spent: 500,
      remaining: 0,
      overBudget: false,
    });
  });

  test('computes spending independently per budget category in the same response', async () => {
    await makeBudget({ category: 'groceries', limit: 500, month: 6, year: 2024 });
    await makeBudget({ category: 'rent', limit: 1500, month: 6, year: 2024 });
    await makeBudget({ category: 'gym', limit: 100, month: 6, year: 2024 });

    await makeTransaction({
      category: 'groceries',
      amount: 200,
      date: new Date('2024-06-10T10:00:00.000Z'),
    });
    await makeTransaction({
      category: 'rent',
      amount: 1500,
      date: new Date('2024-06-01T10:00:00.000Z'),
    });
    // No transactions for 'gym'.

    const res = await authed('get', '/budgets?month=6&year=2024', userA).send();

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);

    const byCategory = Object.fromEntries(res.body.map((b) => [b.category, b]));
    expect(byCategory.groceries.spent).toBe(200);
    expect(byCategory.groceries.remaining).toBe(300);
    expect(byCategory.groceries.overBudget).toBe(false);
    expect(byCategory.rent.spent).toBe(1500);
    expect(byCategory.rent.remaining).toBe(0);
    expect(byCategory.rent.overBudget).toBe(false);
    expect(byCategory.gym.spent).toBe(0);
    expect(byCategory.gym.remaining).toBe(100);
    expect(byCategory.gym.overBudget).toBe(false);
  });

  test('never persists spent/remaining/overBudget on the budget document (R12.6)', async () => {
    const budget = await makeBudget({
      category: 'groceries',
      limit: 500,
      month: 6,
      year: 2024,
    });
    await makeTransaction({
      amount: 250,
      date: new Date('2024-06-10T10:00:00.000Z'),
    });

    const res = await authed('get', '/budgets?month=6&year=2024', userA).send();

    expect(res.body[0].spent).toBe(250);

    // Re-fetch the persisted document and assert no derived fields are
    // there. Mongoose will only surface schema-defined fields, so an
    // accidental write would show up as an unknown property here.
    const reloaded = await Budget.collection.findOne({ _id: budget._id });
    expect(reloaded).not.toBeNull();
    expect(reloaded.spent).toBeUndefined();
    expect(reloaded.remaining).toBeUndefined();
    expect(reloaded.overBudget).toBeUndefined();

    // The persisted shape contains only the schema-defined fields plus
    // Mongoose's internal `__v` versionKey — definitely not the
    // computed spending fields.
    const persistedKeys = Object.keys(reloaded)
      .filter((k) => k !== '__v')
      .sort();
    expect(persistedKeys).toEqual(
      ['_id', 'category', 'limit', 'month', 'user', 'year'].sort(),
    );
  });
});
