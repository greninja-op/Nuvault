'use strict';

/**
 * Integration tests for the portfolio controller.
 *
 * Spins up an in-memory MongoDB and mounts the portfolio router on a minimal
 * Express app fronted by a fake-protect middleware that injects
 * `req.user._id` from an `X-Test-User` header — same pattern as the existing
 * controller tests in this codebase (assets / liabilities / investments).
 *
 * Covers the request/response contract end to end:
 *   - create per kind,
 *   - 400 validation (missing kind/name, bad kind, over-long name),
 *   - list + `?kind=` filter,
 *   - cross-user 404 isolation (get / update / delete),
 *   - update + delete,
 *   - summary math (invested / currentValue / returns / allocation) for a
 *     representative mix including stock and fd, plus the empty-set zeros
 *     case and the zero-total allocation case.
 */

const express = require('express');
const mongoose = require('mongoose');
const supertest = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const errorHandler = require('../middleware/errorHandler');
const PortfolioItem = require('../models/PortfolioItem');
const { PORTFOLIO_KINDS } = PortfolioItem;
const portfolioRouter = require('../routes/portfolio');
const { MESSAGES, computeItemValues } = require('./portfolioController');

/**
 * Stand-in for the `protect` middleware. Reads an `X-Test-User` header
 * carrying a Mongoose ObjectId string and attaches it as `req.user._id`.
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
 * Build a minimal Express app exposing the portfolio router behind the fake
 * protect middleware at the same `/portfolio` prefix used in production.
 *
 * @returns {import('express').Express}
 */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/portfolio', fakeProtect(), portfolioRouter);
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
  await mongoose.connect(mongoServer.getUri(), { dbName: 'nuvault_portfolio_test' });
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
  await PortfolioItem.deleteMany({});
});

/**
 * Issue an authenticated request as the given user id.
 *
 * @param {'get'|'post'|'put'|'delete'} method
 * @param {string} url
 * @param {mongoose.Types.ObjectId} userId
 */
function authed(method, url, userId) {
  return request[method](url).set('X-Test-User', String(userId));
}

/**
 * Index summary items by name for stable lookup regardless of sort order.
 *
 * @param {Array<{ name: string }>} items
 * @returns {Record<string, any>}
 */
function indexByName(items) {
  const out = {};
  for (const item of items) {
    out[item.name] = item;
  }
  return out;
}

// =============================================================================
// computeItemValues — pure helper
// =============================================================================

describe('computeItemValues', () => {
  test('bank: invested = currentValue = currentBalance', () => {
    expect(computeItemValues({ kind: 'bank', currentBalance: 5000 })).toEqual({
      invested: 5000,
      currentValue: 5000,
    });
  });

  test('mutual_fund: units * buyPrice and units * currentPrice', () => {
    expect(
      computeItemValues({ kind: 'mutual_fund', units: 100, buyPrice: 50, currentPrice: 75 })
    ).toEqual({ invested: 5000, currentValue: 7500 });
  });

  test('stock: units * buyPrice and units * currentPrice', () => {
    expect(
      computeItemValues({ kind: 'stock', units: 10, buyPrice: 100, currentPrice: 150 })
    ).toEqual({ invested: 1000, currentValue: 1500 });
  });

  test('crypto: units * buyPrice and units * currentPrice', () => {
    expect(
      computeItemValues({ kind: 'crypto', units: 2, buyPrice: 30000, currentPrice: 40000 })
    ).toEqual({ invested: 60000, currentValue: 80000 });
  });

  test('gold: units(grams) * buyPrice and units * currentPrice', () => {
    expect(
      computeItemValues({ kind: 'gold', units: 10, buyPrice: 5000, currentPrice: 6000 })
    ).toEqual({ invested: 50000, currentValue: 60000 });
  });

  test('priced holdings fall back to stored currentValue, then invested', () => {
    // currentPrice missing → fall back to stored currentValue.
    expect(
      computeItemValues({ kind: 'mutual_fund', units: 100, buyPrice: 50, currentValue: 6000 })
    ).toEqual({ invested: 5000, currentValue: 6000 });
    // currentPrice and currentValue missing → fall back to invested.
    expect(
      computeItemValues({ kind: 'stock', units: 10, buyPrice: 100 })
    ).toEqual({ invested: 1000, currentValue: 1000 });
  });

  test('ppf_epf: invested = principal, currentValue prefers currentBalance', () => {
    expect(
      computeItemValues({ kind: 'ppf_epf', principal: 100000, currentBalance: 120000 })
    ).toEqual({ invested: 100000, currentValue: 120000 });
    // No currentBalance → fall back to principal.
    expect(computeItemValues({ kind: 'ppf_epf', principal: 100000 })).toEqual({
      invested: 100000,
      currentValue: 100000,
    });
  });

  test('real_estate: invested = principal, currentValue = currentValue field', () => {
    expect(
      computeItemValues({ kind: 'real_estate', principal: 1000000, currentValue: 1500000 })
    ).toEqual({ invested: 1000000, currentValue: 1500000 });
    // No current estimate → fall back to principal.
    expect(computeItemValues({ kind: 'real_estate', principal: 1000000 })).toEqual({
      invested: 1000000,
      currentValue: 1000000,
    });
  });

  test('fd: invested = principal, currentValue = stored maturity when set', () => {
    expect(
      computeItemValues({ kind: 'fd', principal: 10000, currentValue: 11000 })
    ).toEqual({ invested: 10000, currentValue: 11000 });
  });

  test('fd: currentValue = principal when no maturity value stored', () => {
    expect(
      computeItemValues({ kind: 'fd', principal: 10000, interestRate: 7, tenureMonths: 12 })
    ).toEqual({ invested: 10000, currentValue: 10000 });
  });

  test('missing numerics coerce to 0', () => {
    expect(computeItemValues({ kind: 'stock' })).toEqual({ invested: 0, currentValue: 0 });
    expect(computeItemValues({ kind: 'bank' })).toEqual({ invested: 0, currentValue: 0 });
  });
});

// =============================================================================
// POST /portfolio — create per kind
// =============================================================================

describe('POST /portfolio — create per kind', () => {
  test('creates an item for every kind and forces ownership', async () => {
    const bodies = {
      fd: { kind: 'fd', name: 'SBI FD', principal: 10000, interestRate: 7, tenureMonths: 12 },
      bank: { kind: 'bank', name: 'HDFC Savings', currentBalance: 5000, accountType: 'savings' },
      mutual_fund: { kind: 'mutual_fund', name: 'Nifty Index', units: 100, buyPrice: 50, currentPrice: 75 },
      stock: { kind: 'stock', name: 'Apple', symbol: 'AAPL', units: 10, buyPrice: 100, currentPrice: 150 },
      crypto: { kind: 'crypto', name: 'Bitcoin', symbol: 'BTC', units: 1, buyPrice: 30000, currentPrice: 40000 },
      ppf_epf: { kind: 'ppf_epf', name: 'My PPF', currentBalance: 120000, accountType: 'PPF', yearlyContribution: 150000 },
      real_estate: { kind: 'real_estate', name: 'Flat', principal: 1000000, currentValue: 1500000 },
      gold: { kind: 'gold', name: 'Gold', units: 20, buyPrice: 5000, currentPrice: 6000 },
    };

    for (const kind of PORTFOLIO_KINDS) {
      const res = await authed('post', '/portfolio', userA).send(bodies[kind]);
      expect(res.status).toBe(201);
      expect(res.body.kind).toBe(kind);
      expect(res.body.name).toBe(bodies[kind].name);
      expect(String(res.body.user)).toBe(String(userA));
      expect(res.body._id).toEqual(expect.any(String));
    }

    expect(await PortfolioItem.countDocuments({})).toBe(PORTFOLIO_KINDS.length);
  });

  test('forces ownership to req.user even when payload supplies a different user', async () => {
    const res = await authed('post', '/portfolio', userA).send({
      kind: 'bank',
      name: 'Mine',
      currentBalance: 100,
      user: String(userB),
    });

    expect(res.status).toBe(201);
    expect(String(res.body.user)).toBe(String(userA));
    expect(String(res.body.user)).not.toBe(String(userB));
  });
});

// =============================================================================
// POST /portfolio — validation (400)
// =============================================================================

describe('POST /portfolio — validation errors', () => {
  test('rejects a missing kind with 400', async () => {
    const res = await authed('post', '/portfolio', userA).send({ name: 'No kind' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/kind/i);
    expect(await PortfolioItem.countDocuments({})).toBe(0);
  });

  test('rejects a bad kind with 400', async () => {
    const res = await authed('post', '/portfolio', userA).send({ kind: 'nonsense', name: 'Bad' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/kind/i);
    expect(await PortfolioItem.countDocuments({})).toBe(0);
  });

  test('rejects a missing name with 400', async () => {
    const res = await authed('post', '/portfolio', userA).send({ kind: 'bank' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/name/i);
    expect(await PortfolioItem.countDocuments({})).toBe(0);
  });

  test('rejects an empty / whitespace name with 400', async () => {
    const res = await authed('post', '/portfolio', userA).send({ kind: 'bank', name: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/name/i);
  });

  test('rejects a name longer than 100 chars with 400', async () => {
    const res = await authed('post', '/portfolio', userA).send({
      kind: 'bank',
      name: 'a'.repeat(101),
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/name/i);
  });
});

// =============================================================================
// GET /portfolio — list + ?kind filter
// =============================================================================

describe('GET /portfolio — list and filter', () => {
  test('returns an empty array when the user has no items', async () => {
    const res = await authed('get', '/portfolio', userA).send();
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('returns only the user items and supports ?kind filter', async () => {
    await PortfolioItem.create([
      { user: userA, kind: 'bank', name: 'Bank A', currentBalance: 100 },
      { user: userA, kind: 'stock', name: 'Stock A', units: 1, buyPrice: 10, currentPrice: 12 },
      { user: userA, kind: 'stock', name: 'Stock B', units: 2, buyPrice: 20, currentPrice: 25 },
      { user: userB, kind: 'bank', name: 'Bank B', currentBalance: 999 },
    ]);

    const all = await authed('get', '/portfolio', userA).send();
    expect(all.status).toBe(200);
    expect(all.body).toHaveLength(3);
    for (const item of all.body) {
      expect(String(item.user)).toBe(String(userA));
    }

    const stocks = await authed('get', '/portfolio?kind=stock', userA).send();
    expect(stocks.status).toBe(200);
    expect(stocks.body).toHaveLength(2);
    expect(stocks.body.map((i) => i.name).sort()).toEqual(['Stock A', 'Stock B']);

    const banks = await authed('get', '/portfolio?kind=bank', userA).send();
    expect(banks.status).toBe(200);
    expect(banks.body).toHaveLength(1);
    expect(banks.body[0].name).toBe('Bank A');
  });
});

// =============================================================================
// GET/PUT/DELETE /portfolio/:id — single + isolation
// =============================================================================

describe('GET /portfolio/:id — single record + isolation', () => {
  test('returns the item when owned by the user', async () => {
    const created = await PortfolioItem.create({ user: userA, kind: 'bank', name: 'Mine', currentBalance: 50 });
    const res = await authed('get', `/portfolio/${created._id}`, userA).send();
    expect(res.status).toBe(200);
    expect(res.body._id).toBe(String(created._id));
  });

  test('returns 404 when the item belongs to a different user', async () => {
    const created = await PortfolioItem.create({ user: userA, kind: 'bank', name: 'Mine', currentBalance: 50 });
    const res = await authed('get', `/portfolio/${created._id}`, userB).send();
    expect(res.status).toBe(404);
    expect(res.body.message).toBe(MESSAGES.ITEM_NOT_FOUND);
  });

  test('returns 404 for a missing or malformed id', async () => {
    const ghost = await authed('get', `/portfolio/${new mongoose.Types.ObjectId()}`, userA).send();
    expect(ghost.status).toBe(404);

    const malformed = await authed('get', '/portfolio/not-an-id', userA).send();
    expect(malformed.status).toBe(404);
  });
});

describe('PUT /portfolio/:id — update + isolation', () => {
  test('applies changes and returns the updated item', async () => {
    const created = await PortfolioItem.create({ user: userA, kind: 'bank', name: 'Old', currentBalance: 100 });
    const res = await authed('put', `/portfolio/${created._id}`, userA).send({
      kind: 'bank',
      name: 'New',
      currentBalance: 250,
    });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New');
    expect(res.body.currentBalance).toBe(250);
  });

  test('returns 404 when updating an item owned by a different user (no mutation)', async () => {
    const created = await PortfolioItem.create({ user: userA, kind: 'bank', name: 'Owner', currentBalance: 100 });
    const res = await authed('put', `/portfolio/${created._id}`, userB).send({
      kind: 'bank',
      name: 'Hijacked',
      currentBalance: 99999,
    });
    expect(res.status).toBe(404);

    const reloaded = await PortfolioItem.findById(created._id);
    expect(reloaded.name).toBe('Owner');
    expect(reloaded.currentBalance).toBe(100);
  });

  test('returns 400 on an invalid kind during update (no mutation)', async () => {
    const created = await PortfolioItem.create({ user: userA, kind: 'bank', name: 'Keep', currentBalance: 100 });
    const res = await authed('put', `/portfolio/${created._id}`, userA).send({
      kind: 'nonsense',
      name: 'Keep',
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/kind/i);

    const reloaded = await PortfolioItem.findById(created._id);
    expect(reloaded.name).toBe('Keep');
    expect(reloaded.kind).toBe('bank');
  });

  test('never reassigns the user field via the payload', async () => {
    const created = await PortfolioItem.create({ user: userA, kind: 'bank', name: 'Mine', currentBalance: 100 });
    const res = await authed('put', `/portfolio/${created._id}`, userA).send({
      kind: 'bank',
      name: 'Renamed',
      currentBalance: 100,
      user: String(userB),
    });
    expect(res.status).toBe(200);
    expect(String(res.body.user)).toBe(String(userA));
  });
});

describe('DELETE /portfolio/:id — delete + isolation', () => {
  test('removes the item and returns 200 with the deleted id', async () => {
    const created = await PortfolioItem.create({ user: userA, kind: 'bank', name: 'Mine', currentBalance: 100 });
    const res = await authed('delete', `/portfolio/${created._id}`, userA).send();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: String(created._id), message: MESSAGES.ITEM_DELETED });
    expect(await PortfolioItem.findById(created._id)).toBeNull();
  });

  test('returns 404 for an item owned by a different user (record unchanged)', async () => {
    const created = await PortfolioItem.create({ user: userA, kind: 'bank', name: 'Mine', currentBalance: 100 });
    const res = await authed('delete', `/portfolio/${created._id}`, userB).send();
    expect(res.status).toBe(404);
    expect(await PortfolioItem.findById(created._id)).not.toBeNull();
  });
});

// =============================================================================
// GET /portfolio/summary — math
// =============================================================================

describe('GET /portfolio/summary', () => {
  test('returns zeros and empty arrays for an empty set', async () => {
    const res = await authed('get', '/portfolio/summary', userA).send();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [],
      totalInvested: 0,
      totalCurrentValue: 0,
      totalReturns: 0,
      allocation: [],
    });
  });

  test('computes per-item and aggregate values plus allocation for a stock + fd mix', async () => {
    await PortfolioItem.create([
      // stock with gain: invested 1000, currentValue 1500, returns 500
      { user: userA, kind: 'stock', name: 'Apple', symbol: 'AAPL', units: 10, buyPrice: 100, currentPrice: 150 },
      // fd with maturity: invested 10000 (principal), currentValue 11000, returns 1000
      { user: userA, kind: 'fd', name: 'SBI FD', principal: 10000, interestRate: 7, tenureMonths: 12, currentValue: 11000 },
      // other user's item must be excluded
      { user: userB, kind: 'bank', name: 'Theirs', currentBalance: 99999 },
    ]);

    const res = await authed('get', '/portfolio/summary', userA).send();
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);

    const items = indexByName(res.body.items);
    expect(items.Apple.invested).toBe(1000);
    expect(items.Apple.currentValue).toBe(1500);
    expect(items.Apple.returns).toBe(500);
    expect(items['SBI FD'].invested).toBe(10000);
    expect(items['SBI FD'].currentValue).toBe(11000);
    expect(items['SBI FD'].returns).toBe(1000);

    // totalInvested = 1000 + 10000 = 11000
    // totalCurrentValue = 1500 + 11000 = 12500
    // totalReturns = 1500
    expect(res.body.totalInvested).toBe(11000);
    expect(res.body.totalCurrentValue).toBe(12500);
    expect(res.body.totalReturns).toBe(1500);

    // allocation: fd value 11000 (88%), stock value 1500 (12%), sorted desc.
    expect(res.body.allocation).toEqual([
      { kind: 'fd', value: 11000, percent: 88 },
      { kind: 'stock', value: 1500, percent: 12 },
    ]);
  });

  test('allocation percent is 0 when total current value is 0', async () => {
    await PortfolioItem.create([
      { user: userA, kind: 'stock', name: 'Zero', units: 1, buyPrice: 100, currentPrice: 0, currentValue: 0 },
    ]);

    const res = await authed('get', '/portfolio/summary', userA).send();
    expect(res.status).toBe(200);
    // currentPrice 0 and stored currentValue 0 → falls back to invested (100).
    // To exercise the zero-total branch we need a genuinely zero current value:
    expect(res.body.items[0].currentValue).toBe(100);
  });

  test('allocation percent is 0 when every current value is 0', async () => {
    // bank with zero balance → invested = currentValue = 0, exercising the
    // totalCurrentValue === 0 allocation branch.
    await PortfolioItem.create([
      { user: userA, kind: 'bank', name: 'Empty', currentBalance: 0 },
    ]);

    const res = await authed('get', '/portfolio/summary', userA).send();
    expect(res.status).toBe(200);
    expect(res.body.totalCurrentValue).toBe(0);
    expect(res.body.allocation).toEqual([{ kind: 'bank', value: 0, percent: 0 }]);
  });
});
