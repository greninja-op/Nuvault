'use strict';

/**
 * Integration tests for the AI advisor controller (Task 17.1).
 *
 * Covers the controller end-to-end against an in-memory MongoDB:
 *   - validation (R18.4, R18.5) — missing / empty / whitespace-only /
 *     non-string / over-length message,
 *   - happy-path: 200 with `{ reply }` and the snapshot delivered to
 *     Claude with the documented preamble (R18.3),
 *   - snapshot composition: assets, liabilities, 50 most recent
 *     transactions desc, goals, bills, computed netWorth, and per-user
 *     isolation (R18.1, R18.2, R18.7),
 *   - 503 funnel through the uniform error handler when Claude returns
 *     `{ ok: false }`, with the API key absent from the response
 *     (R18.6),
 *   - the conversation is never persisted (R18.7).
 *
 * The Claude utility is mocked so no real network call is made and
 * snapshot composition can be asserted directly. A header-driven fake
 * `protect` middleware swaps users per request, mirroring the pattern
 * established by `transactionController.test.js`.
 */

jest.mock('../utils/claude');

const express = require('express');
const mongoose = require('mongoose');
const supertest = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const errorHandler = require('../middleware/errorHandler');
const Asset = require('../models/Asset');
const Liability = require('../models/Liability');
const Transaction = require('../models/Transaction');
const Goal = require('../models/Goal');
const Bill = require('../models/Bill');

const { chat: chatUtil } = require('../utils/claude');
const {
  chat: chatHandler,
  chatValidators,
  SERVICE_UNAVAILABLE_MESSAGE,
  SNAPSHOT_PREAMBLE,
  RECENT_TRANSACTIONS_LIMIT,
} = require('./aiController');

/**
 * Stand-in for the `protect` middleware. Reads an `X-Test-User` header
 * carrying a Mongoose ObjectId string and attaches it as `req.user._id`.
 * Tests can swap users per request without rebuilding the app.
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
 * Build a minimal Express app exposing the AI chat route. The route is
 * mounted at `/ai/chat` with the fake-protect middleware in front so
 * every request is gated by an `X-Test-User` header. An optional config
 * lets tests inject the api key via `app.set('config', ...)`.
 *
 * @param {{ config?: object } } [options]
 * @returns {import('express').Express}
 */
function buildApp({ config } = {}) {
  const app = express();
  app.use(express.json());
  if (config) {
    app.set('config', config);
  }

  const router = express.Router();
  router.post('/chat', chatValidators, chatHandler);

  app.use('/ai', fakeProtect(), router);
  app.use(errorHandler);
  return app;
}

let mongoServer;
const userA = new mongoose.Types.ObjectId();
const userB = new mongoose.Types.ObjectId();

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { dbName: 'nuvault_ai_test' });
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
});

afterEach(async () => {
  await Promise.all([
    Asset.deleteMany({}),
    Liability.deleteMany({}),
    Transaction.deleteMany({}),
    Goal.deleteMany({}),
    Bill.deleteMany({}),
  ]);
  jest.clearAllMocks();
});

/**
 * Issue an authenticated POST /ai/chat as the given user. Wrapping
 * supertest like this keeps every test concise and centralizes the
 * auth-header convention.
 *
 * @param {import('express').Express} app
 * @param {mongoose.Types.ObjectId} userId
 * @param {object} body
 */
function authedChat(app, userId, body) {
  return supertest(app)
    .post('/ai/chat')
    .set('X-Test-User', String(userId))
    .send(body);
}

// =============================================================================
// Validation (R18.4, R18.5)
// =============================================================================

describe('POST /ai/chat — validation', () => {
  test.each([
    ['missing message', {}],
    ['null message', { message: null }],
    ['non-string message', { message: 42 }],
    ['empty string', { message: '' }],
    ['whitespace-only', { message: '   ' }],
    ['tabs and newlines only', { message: '\t\n  \r' }],
  ])('rejects %s with 400 and does not call Claude (R18.5)', async (_label, body) => {
    chatUtil.mockResolvedValue({ ok: true, reply: 'should never be called' });
    const app = buildApp({ config: { claudeApiKey: 'sk-test' } });

    const res = await authedChat(app, userA, body);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/message/i);
    expect(chatUtil).not.toHaveBeenCalled();
  });

  test('rejects an over-length message with 400 (R18.4)', async () => {
    chatUtil.mockResolvedValue({ ok: true, reply: 'no' });
    const app = buildApp({ config: { claudeApiKey: 'sk-test' } });

    const res = await authedChat(app, userA, { message: 'a'.repeat(4001) });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/4000/);
    expect(chatUtil).not.toHaveBeenCalled();
  });

  test('accepts a message at the exact 4000-character boundary', async () => {
    chatUtil.mockResolvedValue({ ok: true, reply: 'fine' });
    const app = buildApp({ config: { claudeApiKey: 'sk-test' } });

    const res = await authedChat(app, userA, { message: 'a'.repeat(4000) });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reply: 'fine' });
    expect(chatUtil).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// Happy path + snapshot composition (R18.1, R18.2, R18.3, R18.7)
// =============================================================================

describe('POST /ai/chat — snapshot composition (R18.1, R18.2, R18.7)', () => {
  test('builds a user-scoped snapshot, sends it as system context, and returns the reply', async () => {
    chatUtil.mockResolvedValue({ ok: true, reply: 'Looking solid.' });

    // Seed user A with a representative slice of every collection.
    await Asset.create([
      { user: userA, name: 'cash', type: 'cash', value: 100 },
      { user: userA, name: 'savings', type: 'bank', value: 200.5 },
    ]);
    await Liability.create({
      user: userA,
      name: 'card',
      type: 'credit_card',
      amount: 50.25,
    });
    await Goal.create({
      user: userA,
      name: 'vacation',
      targetAmount: 1000,
      savedAmount: 250,
    });
    await Bill.create({
      user: userA,
      name: 'electric',
      amount: 75,
      frequency: 'monthly',
      nextDueDate: new Date('2024-06-15T00:00:00.000Z'),
    });
    // Two transactions for user A — controller should sort desc by date.
    await Transaction.create([
      {
        user: userA,
        type: 'expense',
        category: 'rent',
        amount: 1500,
        date: new Date('2024-05-01T00:00:00.000Z'),
      },
      {
        user: userA,
        type: 'income',
        category: 'salary',
        amount: 5000,
        date: new Date('2024-06-01T00:00:00.000Z'),
      },
    ]);

    // Cross-user noise: every collection gets a record owned by user B
    // that MUST NOT leak into user A's snapshot (R18.7, R5.1, R5.4).
    await Asset.create({ user: userB, name: 'foreign', type: 'cash', value: 9999 });
    await Liability.create({
      user: userB,
      name: 'foreign-debt',
      type: 'loan',
      amount: 8888,
    });
    await Transaction.create({
      user: userB,
      type: 'expense',
      category: 'foreign',
      amount: 7777,
    });
    await Goal.create({
      user: userB,
      name: 'foreign-goal',
      targetAmount: 100,
    });
    await Bill.create({
      user: userB,
      name: 'foreign-bill',
      amount: 1,
      frequency: 'monthly',
      nextDueDate: new Date('2024-06-01T00:00:00.000Z'),
    });

    const app = buildApp({ config: { claudeApiKey: 'sk-test' } });

    const res = await authedChat(app, userA, { message: '  How am I doing?  ' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reply: 'Looking solid.' });

    expect(chatUtil).toHaveBeenCalledTimes(1);
    const callArgs = chatUtil.mock.calls[0][0];

    // The trimmed user message flows through to Claude.
    expect(callArgs.userMessage).toBe('How am I doing?');
    // The injected api key is forwarded verbatim.
    expect(callArgs.apiKey).toBe('sk-test');
    // 30s timeout per R18.3.
    expect(callArgs.timeoutMs).toBe(30_000);

    // System context is the preamble + JSON snapshot.
    expect(callArgs.systemContext.startsWith(SNAPSHOT_PREAMBLE)).toBe(true);

    const jsonStart = callArgs.systemContext.indexOf('\n') + 1;
    const snapshot = JSON.parse(callArgs.systemContext.slice(jsonStart));

    // All five collections appear, scoped to user A only.
    expect(snapshot.assets).toHaveLength(2);
    expect(snapshot.liabilities).toHaveLength(1);
    expect(snapshot.recentTransactions).toHaveLength(2);
    expect(snapshot.goals).toHaveLength(1);
    expect(snapshot.bills).toHaveLength(1);

    for (const a of snapshot.assets) expect(String(a.user)).toBe(String(userA));
    for (const l of snapshot.liabilities) expect(String(l.user)).toBe(String(userA));
    for (const t of snapshot.recentTransactions) expect(String(t.user)).toBe(String(userA));
    for (const g of snapshot.goals) expect(String(g.user)).toBe(String(userA));
    for (const b of snapshot.bills) expect(String(b.user)).toBe(String(userA));

    // Transactions are sorted by date descending (R18.2).
    expect(snapshot.recentTransactions[0].category).toBe('salary');
    expect(snapshot.recentTransactions[1].category).toBe('rent');

    // Net worth = (100 + 200.5) - 50.25 = 250.25 (no currency conversion).
    expect(snapshot.netWorth).toBe(250.25);

    // No foreign records leaked.
    const everyName = JSON.stringify(snapshot);
    expect(everyName).not.toContain('foreign');
  });

  test('limits the snapshot to 50 most recent transactions in date desc order (R18.2)', async () => {
    chatUtil.mockResolvedValue({ ok: true, reply: 'ok' });

    // Seed 60 transactions; the snapshot should pick the freshest 50.
    const docs = [];
    for (let i = 0; i < 60; i += 1) {
      docs.push({
        user: userA,
        type: 'expense',
        category: `cat-${i}`,
        amount: 1 + i,
        // i = 59 is the newest, i = 0 is the oldest.
        date: new Date(Date.UTC(2024, 0, 1) + i * 86_400_000),
      });
    }
    await Transaction.insertMany(docs);

    const app = buildApp({ config: { claudeApiKey: 'sk-test' } });

    const res = await authedChat(app, userA, { message: 'summary please' });

    expect(res.status).toBe(200);

    const callArgs = chatUtil.mock.calls[0][0];
    const jsonStart = callArgs.systemContext.indexOf('\n') + 1;
    const snapshot = JSON.parse(callArgs.systemContext.slice(jsonStart));

    expect(snapshot.recentTransactions).toHaveLength(RECENT_TRANSACTIONS_LIMIT);

    // Newest first.
    expect(snapshot.recentTransactions[0].category).toBe('cat-59');
    // 50th item is i = 10 (60 total - 50 = 10 oldest excluded).
    expect(snapshot.recentTransactions[49].category).toBe('cat-10');

    // Strict desc ordering across the whole window.
    const dates = snapshot.recentTransactions.map((t) => new Date(t.date).getTime());
    for (let i = 0; i < dates.length - 1; i += 1) {
      expect(dates[i]).toBeGreaterThanOrEqual(dates[i + 1]);
    }
  });

  test('emits an empty-but-well-formed snapshot when the user has no data', async () => {
    chatUtil.mockResolvedValue({ ok: true, reply: 'no data yet' });
    const app = buildApp({ config: { claudeApiKey: 'sk-test' } });

    const res = await authedChat(app, userA, { message: 'hi' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reply: 'no data yet' });

    const callArgs = chatUtil.mock.calls[0][0];
    const jsonStart = callArgs.systemContext.indexOf('\n') + 1;
    const snapshot = JSON.parse(callArgs.systemContext.slice(jsonStart));

    expect(snapshot).toEqual({
      assets: [],
      liabilities: [],
      recentTransactions: [],
      goals: [],
      bills: [],
      netWorth: 0,
    });
  });

  test('does not persist the conversation (R18.7)', async () => {
    chatUtil.mockResolvedValue({ ok: true, reply: 'something' });
    const app = buildApp({ config: { claudeApiKey: 'sk-test' } });

    const res = await authedChat(app, userA, { message: 'hello' });
    expect(res.status).toBe(200);

    // None of the existing collections should have any records.
    // Conversation is not stored anywhere — only the read-only snapshot
    // assembly touched the database.
    expect(await Asset.countDocuments({})).toBe(0);
    expect(await Liability.countDocuments({})).toBe(0);
    expect(await Transaction.countDocuments({})).toBe(0);
    expect(await Goal.countDocuments({})).toBe(0);
    expect(await Bill.countDocuments({})).toBe(0);
  });
});

// =============================================================================
// Failure → uniform 503 (R18.6)
// =============================================================================

describe('POST /ai/chat — Claude unavailable (R18.6)', () => {
  test('returns 503 with a generic message when chat() resolves { ok: false }', async () => {
    chatUtil.mockResolvedValue({ ok: false });
    const app = buildApp({ config: { claudeApiKey: 'sk-test' } });

    const res = await authedChat(app, userA, { message: 'help me' });

    expect(res.status).toBe(503);
    expect(res.body.message).toBe(SERVICE_UNAVAILABLE_MESSAGE);
  });

  test('does not include the API key in the failure response body', async () => {
    chatUtil.mockResolvedValue({ ok: false });
    const apiKey = 'sk-secret-do-not-leak-789';
    const app = buildApp({ config: { claudeApiKey: apiKey } });

    const res = await authedChat(app, userA, { message: 'help me' });

    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain(apiKey);
  });

  test('returns 503 when no API key is configured anywhere', async () => {
    // No app config; explicitly clear env so neither path resolves a key.
    const previous = process.env.CLAUDE_API_KEY;
    delete process.env.CLAUDE_API_KEY;
    try {
      // The util receives apiKey: null which short-circuits to ok:false
      // — verify the controller surfaces that as a 503.
      chatUtil.mockResolvedValue({ ok: false });
      const app = buildApp(); // no config

      const res = await authedChat(app, userA, { message: 'hello' });

      expect(res.status).toBe(503);
      expect(res.body.message).toBe(SERVICE_UNAVAILABLE_MESSAGE);
    } finally {
      if (previous !== undefined) process.env.CLAUDE_API_KEY = previous;
    }
  });
});

// =============================================================================
// API key resolution
// =============================================================================

describe('POST /ai/chat — API key resolution', () => {
  test('prefers the api key from req.app.get("config")', async () => {
    chatUtil.mockResolvedValue({ ok: true, reply: 'ok' });
    const previous = process.env.CLAUDE_API_KEY;
    process.env.CLAUDE_API_KEY = 'env-key';
    try {
      const app = buildApp({ config: { claudeApiKey: 'app-key' } });
      await authedChat(app, userA, { message: 'hi' });
      expect(chatUtil.mock.calls[0][0].apiKey).toBe('app-key');
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_API_KEY;
      else process.env.CLAUDE_API_KEY = previous;
    }
  });

  test('falls back to process.env.CLAUDE_API_KEY when no app config is set', async () => {
    chatUtil.mockResolvedValue({ ok: true, reply: 'ok' });
    const previous = process.env.CLAUDE_API_KEY;
    process.env.CLAUDE_API_KEY = 'env-key';
    try {
      const app = buildApp(); // no config

      await authedChat(app, userA, { message: 'hi' });

      expect(chatUtil.mock.calls[0][0].apiKey).toBe('env-key');
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_API_KEY;
      else process.env.CLAUDE_API_KEY = previous;
    }
  });
});
