'use strict';

/**
 * Integration tests for the AI advisor controller (updated for Gemini).
 *
 * The controller now calls Gemini 1.5 Flash directly via axios (no separate
 * claude utility), so axios is mocked at the module level. All snapshot /
 * validation / isolation / persistence behavior is unchanged.
 */

jest.mock('axios');

const axios = require('axios');
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

const {
  chat: chatHandler,
  chatValidators,
  SERVICE_UNAVAILABLE_MESSAGE,
  SNAPSHOT_PREAMBLE,
  RECENT_TRANSACTIONS_LIMIT,
  GEMINI_ENDPOINT,
} = require('./aiController');

/** A minimal valid Gemini success response. */
function geminiOk(text) {
  return {
    data: {
      candidates: [{ content: { parts: [{ text }] } }],
    },
  };
}

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

function buildApp({ config } = {}) {
  const app = express();
  app.use(express.json());
  if (config) app.set('config', config);
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
  if (mongoServer) await mongoServer.stop();
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
  ])('rejects %s with 400 and does not call Gemini (R18.5)', async (_label, body) => {
    const app = buildApp({ config: { geminiApiKey: 'test-key' } });

    const res = await authedChat(app, userA, body);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/message/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('rejects an over-length message with 400 (R18.4)', async () => {
    const app = buildApp({ config: { geminiApiKey: 'test-key' } });

    const res = await authedChat(app, userA, { message: 'a'.repeat(4001) });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/4000/);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('accepts a message at the exact 4000-character boundary', async () => {
    axios.post.mockResolvedValueOnce(geminiOk('fine'));
    const app = buildApp({ config: { geminiApiKey: 'test-key' } });

    const res = await authedChat(app, userA, { message: 'a'.repeat(4000) });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reply: 'fine' });
    expect(axios.post).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// Happy path + snapshot composition
// =============================================================================

describe('POST /ai/chat — snapshot composition', () => {
  test('builds a user-scoped snapshot, calls Gemini, and returns the reply', async () => {
    axios.post.mockResolvedValueOnce(geminiOk('Looking solid.'));

    await Asset.create([
      { user: userA, name: 'cash', type: 'cash', value: 100 },
      { user: userA, name: 'savings', type: 'bank', value: 200.5 },
    ]);
    await Liability.create({ user: userA, name: 'card', type: 'credit_card', amount: 50.25 });
    await Goal.create({ user: userA, name: 'vacation', targetAmount: 1000, savedAmount: 250 });
    await Bill.create({
      user: userA, name: 'electric', amount: 75, frequency: 'monthly',
      nextDueDate: new Date('2024-06-15T00:00:00.000Z'),
    });
    await Transaction.create([
      { user: userA, type: 'expense', category: 'rent', amount: 1500, date: new Date('2024-05-01T00:00:00.000Z') },
      { user: userA, type: 'income', category: 'salary', amount: 5000, date: new Date('2024-06-01T00:00:00.000Z') },
    ]);

    // Cross-user noise that must NOT appear in the snapshot.
    await Asset.create({ user: userB, name: 'foreign', type: 'cash', value: 9999 });
    await Liability.create({ user: userB, name: 'foreign-debt', type: 'loan', amount: 8888 });
    await Transaction.create({ user: userB, type: 'expense', category: 'foreign', amount: 7777 });
    await Goal.create({ user: userB, name: 'foreign-goal', targetAmount: 100 });
    await Bill.create({
      user: userB, name: 'foreign-bill', amount: 1, frequency: 'monthly',
      nextDueDate: new Date('2024-06-01T00:00:00.000Z'),
    });

    const app = buildApp({ config: { geminiApiKey: 'test-key' } });
    const res = await authedChat(app, userA, { message: '  How am I doing?  ' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reply: 'Looking solid.' });

    // Verify axios was called with the Gemini endpoint (key embedded in URL).
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toMatch(GEMINI_ENDPOINT);
    expect(url).toContain('test-key');

    // Verify Gemini request body shape.
    expect(body.system_instruction.parts[0].text).toContain(SNAPSHOT_PREAMBLE);
    expect(body.contents[0].role).toBe('user');
    expect(body.contents[0].parts[0].text).toBe('How am I doing?');

    // Parse the snapshot out of the system instruction.
    const systemText = body.system_instruction.parts[0].text;
    const jsonStart = systemText.indexOf('\n') + 1;
    const snapshot = JSON.parse(systemText.slice(jsonStart));

    expect(snapshot.assets).toHaveLength(2);
    expect(snapshot.liabilities).toHaveLength(1);
    expect(snapshot.recentTransactions).toHaveLength(2);
    expect(snapshot.goals).toHaveLength(1);
    expect(snapshot.bills).toHaveLength(1);
    expect(snapshot.netWorth).toBe(250.25);

    for (const a of snapshot.assets) expect(String(a.user)).toBe(String(userA));
    for (const l of snapshot.liabilities) expect(String(l.user)).toBe(String(userA));
    for (const t of snapshot.recentTransactions) expect(String(t.user)).toBe(String(userA));

    expect(snapshot.recentTransactions[0].category).toBe('salary');
    expect(snapshot.recentTransactions[1].category).toBe('rent');
    expect(JSON.stringify(snapshot)).not.toContain('foreign');
  });

  test('limits snapshot to 50 most recent transactions', async () => {
    const docs = [];
    for (let i = 0; i < 60; i += 1) {
      docs.push({
        user: userA, type: 'expense', category: `cat-${i}`, amount: 1 + i,
        date: new Date(Date.UTC(2024, 0, 1) + i * 86_400_000),
      });
    }
    await Transaction.insertMany(docs);

    axios.post.mockResolvedValueOnce(geminiOk('ok'));
    const app = buildApp({ config: { geminiApiKey: 'test-key' } });
    const res = await authedChat(app, userA, { message: 'summary please' });

    expect(res.status).toBe(200);
    const systemText = axios.post.mock.calls[0][1].system_instruction.parts[0].text;
    const snapshot = JSON.parse(systemText.slice(systemText.indexOf('\n') + 1));

    expect(snapshot.recentTransactions).toHaveLength(RECENT_TRANSACTIONS_LIMIT);
    expect(snapshot.recentTransactions[0].category).toBe('cat-59');
    expect(snapshot.recentTransactions[49].category).toBe('cat-10');
  });

  test('emits an empty snapshot when user has no data', async () => {
    axios.post.mockResolvedValueOnce(geminiOk('no data yet'));
    const app = buildApp({ config: { geminiApiKey: 'test-key' } });
    const res = await authedChat(app, userA, { message: 'hi' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reply: 'no data yet' });

    const systemText = axios.post.mock.calls[0][1].system_instruction.parts[0].text;
    const snapshot = JSON.parse(systemText.slice(systemText.indexOf('\n') + 1));
    expect(snapshot).toEqual({ assets: [], liabilities: [], recentTransactions: [], goals: [], bills: [], netWorth: 0 });
  });

  test('does not persist the conversation (R18.7)', async () => {
    axios.post.mockResolvedValueOnce(geminiOk('something'));
    const app = buildApp({ config: { geminiApiKey: 'test-key' } });
    const res = await authedChat(app, userA, { message: 'hello' });

    expect(res.status).toBe(200);
    expect(await Asset.countDocuments({})).toBe(0);
    expect(await Transaction.countDocuments({})).toBe(0);
  });
});

// =============================================================================
// Gemini failure → 503
// =============================================================================

describe('POST /ai/chat — Gemini unavailable (R18.6)', () => {
  test('returns 503 when axios rejects (network error)', async () => {
    axios.post.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    const app = buildApp({ config: { geminiApiKey: 'test-key' } });

    const res = await authedChat(app, userA, { message: 'help me' });

    expect(res.status).toBe(503);
    expect(res.body.message).toBe(SERVICE_UNAVAILABLE_MESSAGE);
  });

  test('returns 503 when Gemini returns an empty / malformed body', async () => {
    axios.post.mockResolvedValueOnce({ data: {} });
    const app = buildApp({ config: { geminiApiKey: 'test-key' } });

    const res = await authedChat(app, userA, { message: 'help me' });

    expect(res.status).toBe(503);
    expect(res.body.message).toBe(SERVICE_UNAVAILABLE_MESSAGE);
  });

  test('returns 503 when no API key is configured', async () => {
    const prev = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      axios.post.mockRejectedValueOnce(new Error('no key'));
      const app = buildApp();
      const res = await authedChat(app, userA, { message: 'hello' });

      expect(res.status).toBe(503);
      expect(res.body.message).toBe(SERVICE_UNAVAILABLE_MESSAGE);
    } finally {
      if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
    }
  });

  test('API key never appears in the failure response', async () => {
    axios.post.mockRejectedValueOnce(new Error('timeout'));
    const apiKey = 'secret-gemini-key-do-not-leak';
    const app = buildApp({ config: { geminiApiKey: apiKey } });

    const res = await authedChat(app, userA, { message: 'hello' });

    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain(apiKey);
  });
});

// =============================================================================
// API key resolution
// =============================================================================

describe('POST /ai/chat — API key resolution', () => {
  test('prefers geminiApiKey from app config over env', async () => {
    axios.post.mockResolvedValueOnce(geminiOk('ok'));
    const prev = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'env-key';
    try {
      const app = buildApp({ config: { geminiApiKey: 'app-key' } });
      await authedChat(app, userA, { message: 'hi' });
      const url = axios.post.mock.calls[0][0];
      expect(url).toContain('app-key');
      expect(url).not.toContain('env-key');
    } finally {
      if (prev === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prev;
    }
  });

  test('falls back to process.env.GEMINI_API_KEY when no app config', async () => {
    axios.post.mockResolvedValueOnce(geminiOk('ok'));
    const prev = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'env-gemini-key';
    try {
      const app = buildApp();
      await authedChat(app, userA, { message: 'hi' });
      const url = axios.post.mock.calls[0][0];
      expect(url).toContain('env-gemini-key');
    } finally {
      if (prev === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prev;
    }
  });
});
