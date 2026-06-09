'use strict';

/**
 * Integration tests for the investment summary endpoint (Task 14.2).
 *
 * Covers the controller end-to-end against an in-memory MongoDB:
 *   - per-user isolation of the summary scope (R5.1, R5.4),
 *   - live pricing for `stock` / `crypto` types (R14.1),
 *   - stored-price use for `mutual_fund` / `fd` / `other` (R14.2),
 *   - per-investment gain/loss math and the buyPrice×quantity guard
 *     (R14.3, R14.4),
 *   - aggregate totals (R14.5),
 *   - graceful fallback when a single live-price lookup fails — the
 *     remaining investments still produce results (R14.6),
 *   - sane behavior with an empty investment set.
 *
 * The Yahoo Finance utility is mocked at the module level so no real
 * network call is made and the controller's price-source selection can
 * be verified per test. The tests build a minimal Express app that
 * mounts the investments router directly behind a fake `protect`
 * middleware — same pattern as the other controller tests in this
 * codebase.
 */

jest.mock('../utils/yahooFinance');

const express = require('express');
const mongoose = require('mongoose');
const supertest = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const errorHandler = require('../middleware/errorHandler');
const Investment = require('../models/Investment');
const { fetchPrice } = require('../utils/yahooFinance');
const investmentsRouter = require('../routes/investments');

/**
 * Stand-in for the `protect` middleware. Reads an `X-Test-User` header
 * carrying a Mongoose ObjectId string and attaches it as
 * `req.user._id`. Tests can swap users per request without rebuilding
 * the app.
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
 * Build a minimal Express app exposing the investments router behind
 * the fake protect middleware. Production wiring mounts the same
 * router under `protect`, so the test mounts it under `fakeProtect`
 * here at the same `/investments` prefix.
 *
 * @returns {import('express').Express}
 */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/investments', fakeProtect(), investmentsRouter);
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
  jest.clearAllMocks();
});

/**
 * Issue an authenticated request as the given user id.
 *
 * @param {string} method
 * @param {string} url
 * @param {mongoose.Types.ObjectId} userId
 */
function authed(method, url, userId) {
  return request[method](url).set('X-Test-User', String(userId));
}

/**
 * Map a list of summary items by symbol or name for stable lookup
 * regardless of insertion or sort order.
 *
 * @param {Array<{ symbol?: string, name: string }>} items
 * @returns {Record<string, any>}
 */
function indexByKey(items) {
  const out = {};
  for (const item of items) {
    const key = item.symbol && String(item.symbol).trim() !== '' ? item.symbol : item.name;
    out[key] = item;
  }
  return out;
}

// =============================================================================
// Empty case
// =============================================================================

describe('GET /investments/summary — empty set', () => {
  test('returns zeros and an empty items array when the user has no investments', async () => {
    const res = await authed('get', '/investments/summary', userA).send();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [],
      totalInvested: 0,
      totalCurrentValue: 0,
      totalPnL: 0,
    });
    // No live-price fetch attempts when there is nothing to price.
    expect(fetchPrice).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Price-source selection (R14.1, R14.2)
// =============================================================================

describe('GET /investments/summary — price source by type', () => {
  test('uses a live price for stock/crypto and the stored price for mutual_fund/fd/other (R14.1, R14.2)', async () => {
    // Stock/crypto: live price is returned for each symbol.
    fetchPrice.mockImplementation(async (symbol) => {
      if (symbol === 'AAPL') return { ok: true, price: 200 };
      if (symbol === 'BTC-USD') return { ok: true, price: 60_000 };
      return { ok: false };
    });

    await Investment.create([
      { user: userA, type: 'stock', symbol: 'AAPL', name: 'Apple Inc.', quantity: 10, buyPrice: 100, currentPrice: 1 /* should be ignored — live wins */ },
      { user: userA, type: 'crypto', symbol: 'BTC-USD', name: 'Bitcoin', quantity: 0.5, buyPrice: 30_000, currentPrice: 1 },
      { user: userA, type: 'mutual_fund', name: 'Index Fund', quantity: 100, buyPrice: 50, currentPrice: 75 },
      { user: userA, type: 'fd', name: 'FD 2024', quantity: 1, buyPrice: 1000, currentPrice: 1080 },
      { user: userA, type: 'other', name: 'Collectible', quantity: 1, buyPrice: 500, currentPrice: 750 },
    ]);

    const res = await authed('get', '/investments/summary', userA).send();
    expect(res.status).toBe(200);

    const items = indexByKey(res.body.items);

    // stock: live price ($200)
    expect(items.AAPL.priceSource).toBe('live');
    expect(items.AAPL.currentPrice).toBe(200);
    expect(items.AAPL.invested).toBe(1000);
    expect(items.AAPL.currentValue).toBe(2000);
    expect(items.AAPL.gainLoss).toBe(1000);
    expect(items.AAPL.gainLossPercent).toBe(100);

    // crypto: live price ($60,000)
    expect(items['BTC-USD'].priceSource).toBe('live');
    expect(items['BTC-USD'].currentPrice).toBe(60_000);
    expect(items['BTC-USD'].invested).toBe(15_000);
    expect(items['BTC-USD'].currentValue).toBe(30_000);
    expect(items['BTC-USD'].gainLoss).toBe(15_000);
    expect(items['BTC-USD'].gainLossPercent).toBe(100);

    // mutual_fund / fd / other: stored price wins, no live fetch
    expect(items['Index Fund'].priceSource).toBe('stored');
    expect(items['Index Fund'].currentPrice).toBe(75);
    expect(items['FD 2024'].priceSource).toBe('stored');
    expect(items['FD 2024'].currentPrice).toBe(1080);
    expect(items.Collectible.priceSource).toBe('stored');

    // fetchPrice should be invoked exactly twice — once per stock/crypto.
    expect(fetchPrice).toHaveBeenCalledTimes(2);
    const calledSymbols = fetchPrice.mock.calls.map((args) => args[0]).sort();
    expect(calledSymbols).toEqual(['AAPL', 'BTC-USD']);
  });

  test('does not fetch live for stock/crypto without a symbol', async () => {
    await Investment.create({
      user: userA,
      type: 'stock',
      // symbol omitted entirely — model default is the empty string.
      name: 'Mystery Stock',
      quantity: 5,
      buyPrice: 50,
      currentPrice: 60,
    });

    const res = await authed('get', '/investments/summary', userA).send();

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].priceSource).toBe('stored');
    expect(res.body.items[0].currentPrice).toBe(60);
    expect(fetchPrice).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Live-price fallback (R14.6)
// =============================================================================

describe('GET /investments/summary — live-price fallback (R14.6)', () => {
  test('falls back to stored price when fetchPrice returns { ok: false }', async () => {
    fetchPrice.mockResolvedValue({ ok: false });

    await Investment.create({
      user: userA,
      type: 'stock',
      symbol: 'AAPL',
      name: 'Apple',
      quantity: 10,
      buyPrice: 100,
      currentPrice: 150,
    });

    const res = await authed('get', '/investments/summary', userA).send();

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].priceSource).toBe('stored');
    expect(res.body.items[0].currentPrice).toBe(150);
    expect(res.body.items[0].gainLoss).toBe(500);
    expect(fetchPrice).toHaveBeenCalledWith('AAPL');
  });

  test('falls back to buyPrice when both live and stored prices are unavailable', async () => {
    fetchPrice.mockResolvedValue({ ok: false });

    await Investment.create({
      user: userA,
      type: 'crypto',
      symbol: 'BTC-USD',
      name: 'Bitcoin',
      quantity: 1,
      buyPrice: 50_000,
      currentPrice: null, // no stored price either
    });

    const res = await authed('get', '/investments/summary', userA).send();

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].priceSource).toBe('fallback');
    // currentPrice falls through to buyPrice → zero gain/loss.
    expect(res.body.items[0].currentPrice).toBe(50_000);
    expect(res.body.items[0].gainLoss).toBe(0);
    expect(res.body.items[0].gainLossPercent).toBe(0);
  });

  test('a single symbol failure does not abort the rest of the summary (R14.6)', async () => {
    // AAPL fails (rejects), MSFT succeeds. Mutual fund uses stored.
    fetchPrice.mockImplementation(async (symbol) => {
      if (symbol === 'AAPL') {
        // The utility itself never rejects, but defend in depth: even
        // an escaped exception must not abort the rest of the summary.
        throw new Error('boom');
      }
      if (symbol === 'MSFT') return { ok: true, price: 400 };
      return { ok: false };
    });

    await Investment.create([
      { user: userA, type: 'stock', symbol: 'AAPL', name: 'Apple', quantity: 1, buyPrice: 100, currentPrice: 120 },
      { user: userA, type: 'stock', symbol: 'MSFT', name: 'Microsoft', quantity: 2, buyPrice: 200, currentPrice: 0 },
      { user: userA, type: 'mutual_fund', name: 'Index Fund', quantity: 10, buyPrice: 50, currentPrice: 60 },
    ]);

    const res = await authed('get', '/investments/summary', userA).send();

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3);

    const items = indexByKey(res.body.items);

    // AAPL fell back to stored.
    expect(items.AAPL.priceSource).toBe('stored');
    expect(items.AAPL.currentPrice).toBe(120);
    expect(items.AAPL.gainLoss).toBe(20);

    // MSFT got its live price.
    expect(items.MSFT.priceSource).toBe('live');
    expect(items.MSFT.currentPrice).toBe(400);
    expect(items.MSFT.invested).toBe(400);
    expect(items.MSFT.currentValue).toBe(800);
    expect(items.MSFT.gainLoss).toBe(400);

    // Mutual fund used stored price as expected.
    expect(items['Index Fund'].priceSource).toBe('stored');
    expect(items['Index Fund'].currentPrice).toBe(60);
  });
});

// =============================================================================
// Aggregate totals (R14.5)
// =============================================================================

describe('GET /investments/summary — totals (R14.5)', () => {
  test('totals equal the sum of per-item invested and currentValue with totalPnL = current − invested', async () => {
    fetchPrice.mockImplementation(async (symbol) => {
      if (symbol === 'AAPL') return { ok: true, price: 200 }; // 10 × 200 = 2000
      return { ok: false };
    });

    await Investment.create([
      { user: userA, type: 'stock', symbol: 'AAPL', name: 'Apple', quantity: 10, buyPrice: 100 },
      // mutual fund: stored price → 100 × 75 = 7500, invested = 100 × 50 = 5000
      { user: userA, type: 'mutual_fund', name: 'Index Fund', quantity: 100, buyPrice: 50, currentPrice: 75 },
    ]);

    const res = await authed('get', '/investments/summary', userA).send();

    expect(res.status).toBe(200);
    // invested = 1000 + 5000 = 6000
    // currentValue = 2000 + 7500 = 9500
    // pnl = 3500
    expect(res.body.totalInvested).toBe(6000);
    expect(res.body.totalCurrentValue).toBe(9500);
    expect(res.body.totalPnL).toBe(3500);
  });

  test('produces a negative gainLoss / totalPnL when the current value drops below invested', async () => {
    fetchPrice.mockResolvedValue({ ok: true, price: 50 });

    await Investment.create({
      user: userA,
      type: 'stock',
      symbol: 'AAPL',
      name: 'Apple',
      quantity: 10,
      buyPrice: 100,
    });

    const res = await authed('get', '/investments/summary', userA).send();

    expect(res.status).toBe(200);
    expect(res.body.items[0].gainLoss).toBe(-500);
    expect(res.body.items[0].gainLossPercent).toBe(-50);
    expect(res.body.totalPnL).toBe(-500);
  });

  test('rounds money fields to 2 decimal places', async () => {
    fetchPrice.mockResolvedValue({ ok: true, price: 33.333333 });

    await Investment.create({
      user: userA,
      type: 'stock',
      symbol: 'AAPL',
      name: 'Apple',
      quantity: 3,
      buyPrice: 10,
    });

    const res = await authed('get', '/investments/summary', userA).send();

    expect(res.status).toBe(200);
    // 3 * 33.333333 = 99.999999 → rounds to 100.00
    expect(res.body.items[0].currentValue).toBe(100);
    expect(res.body.items[0].currentPrice).toBe(33.33);
    // invested = 30, gainLoss = 100 - 30 = 70
    expect(res.body.items[0].gainLoss).toBe(70);
    // ((100 - 30) / 30) * 100 = 233.333... → rounds to 233.33
    expect(res.body.items[0].gainLossPercent).toBe(233.33);
  });
});

// =============================================================================
// Per-user isolation (R5.1, R5.4)
// =============================================================================

describe('GET /investments/summary — per-user isolation', () => {
  test('only includes investments owned by the authenticated user', async () => {
    fetchPrice.mockResolvedValue({ ok: false });

    await Investment.create([
      { user: userA, type: 'mutual_fund', name: 'Mine', quantity: 1, buyPrice: 100, currentPrice: 110 },
      { user: userB, type: 'mutual_fund', name: 'Theirs', quantity: 99, buyPrice: 1, currentPrice: 999 },
    ]);

    const res = await authed('get', '/investments/summary', userA).send();

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].name).toBe('Mine');
    // Total reflects only the authenticated user's data.
    expect(res.body.totalInvested).toBe(100);
    expect(res.body.totalCurrentValue).toBe(110);
    expect(res.body.totalPnL).toBe(10);
  });
});
