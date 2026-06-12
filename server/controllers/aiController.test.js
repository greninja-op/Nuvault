'use strict';

/**
 * Integration tests for the AI advisor controller (Gemini, rich snapshot +
 * persisted chat history).
 *
 * The controller calls Gemini directly via axios, so axios is mocked at the
 * module level. The system prompt is now formatted human-readable text (not
 * JSON), every successful chat persists two ChatHistory turns, and there are
 * dedicated history read / clear endpoints.
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
const Budget = require('../models/Budget');
const Investment = require('../models/Investment');
const ChatHistory = require('../models/ChatHistory');

const {
  chat: chatHandler,
  chatValidators,
  getHistory,
  clearHistory,
  SERVICE_UNAVAILABLE_MESSAGE,
  SNAPSHOT_HEADER,
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
  router.get('/history', getHistory);
  router.delete('/history', clearHistory);
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
    Budget.deleteMany({}),
    Investment.deleteMany({}),
    ChatHistory.deleteMany({}),
  ]);
  jest.clearAllMocks();
});

function authedChat(app, userId, body) {
  return supertest(app).post('/ai/chat').set('X-Test-User', String(userId)).send(body);
}

function authedGet(app, userId) {
  return supertest(app).get('/ai/history').set('X-Test-User', String(userId));
}

function authedDelete(app, userId) {
  return supertest(app).delete('/ai/history').set('X-Test-User', String(userId));
}

/** Pull the system prompt text out of the most recent axios.post call. */
function lastSystemPrompt() {
  const body = axios.post.mock.calls[axios.post.mock.calls.length - 1][1];
  return body.system_instruction.parts[0].text;
}

// =============================================================================
// Validation
// =============================================================================

describe('POST /ai/chat — validation', () => {
  test.each([
    ['missing message', {}],
    ['null message', { message: null }],
    ['non-string message', { message: 42 }],
    ['empty string', { message: '' }],
    ['whitespace-only', { message: '   ' }],
    ['tabs and newlines only', { message: '\t\n  \r' }],
  ])('rejects %s with 400 and does not call Gemini', async (_label, body) => {
    const app = buildApp({ config: { geminiApiKey: 'test-key' } });

    const res = await authedChat(app, userA, body);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/message/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('rejects an over-length message with 400', async () => {
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

    const app = buildApp({ config: { geminiApiKey: 'test-key' } });
    const res = await authedChat(app, userA, { message: '  How am I doing?  ' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reply: 'Looking solid.' });

    // axios called with the Gemini endpoint (key embedded in URL).
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toMatch(GEMINI_ENDPOINT);
    expect(url).toContain('test-key');

    // The final content turn carries the trimmed user message.
    const last = body.contents[body.contents.length - 1];
    expect(last.role).toBe('user');
    expect(last.parts[0].text).toBe('How am I doing?');

    // The system prompt is formatted text containing the snapshot header,
    // the real net-worth figure, and the user's own transactions — but never
    // another user's data.
    const prompt = body.system_instruction.parts[0].text;
    expect(prompt).toContain(SNAPSHOT_HEADER);
    expect(prompt).toContain('INR 250.25'); // 100 + 200.5 - 50.25
    expect(prompt).toContain('salary');
    expect(prompt).toContain('rent');
    expect(prompt).not.toContain('foreign');
  });

  test(`limits recent transactions to ${RECENT_TRANSACTIONS_LIMIT}`, async () => {
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
    const prompt = lastSystemPrompt();
    // Most recent 30 are cat-59 .. cat-30; cat-29 falls outside the window.
    expect(prompt).toContain('cat-59');
    expect(prompt).toContain('cat-30');
    expect(prompt).not.toContain('cat-29');
  });

  test('renders an empty snapshot gracefully when the user has no data', async () => {
    axios.post.mockResolvedValueOnce(geminiOk('no data yet'));
    const app = buildApp({ config: { geminiApiKey: 'test-key' } });
    const res = await authedChat(app, userA, { message: 'hi' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reply: 'no data yet' });

    const prompt = lastSystemPrompt();
    expect(prompt).toContain(SNAPSHOT_HEADER);
    expect(prompt).toContain('INR 0'); // net worth
    expect(prompt).toContain('(no transactions recorded)');
  });

  test('addresses the user by first name when available', async () => {
    axios.post.mockResolvedValueOnce(geminiOk('hello'));
    // Inject a named user via a custom protect for this app.
    const app = express();
    app.use(express.json());
    app.set('config', { geminiApiKey: 'test-key' });
    const router = express.Router();
    router.post('/chat', chatValidators, chatHandler);
    app.use('/ai', (req, _res, next) => {
      req.user = { _id: userA, name: 'Ada Lovelace', currency: 'USD' };
      next();
    }, router);
    app.use(errorHandler);

    const res = await supertest(app).post('/ai/chat').send({ message: 'hi' });

    expect(res.status).toBe(200);
    const prompt = lastSystemPrompt();
    expect(prompt).toContain('Ada');
    expect(prompt).not.toContain('Lovelace'); // only the first name is used
    expect(prompt).toContain('USD');
  });
});

// =============================================================================
// Persistence
// =============================================================================

describe('POST /ai/chat — persistence', () => {
  test('persists both the user message and the model reply on success', async () => {
    axios.post.mockResolvedValueOnce(geminiOk('Solid progress.'));
    const app = buildApp({ config: { geminiApiKey: 'test-key' } });

    const res = await authedChat(app, userA, { message: 'hello there' });
    expect(res.status).toBe(200);

    const turns = await ChatHistory.find({ user: userA }).sort({ timestamp: 1 }).lean();
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ role: 'user', message: 'hello there' });
    expect(turns[1]).toMatchObject({ role: 'model', message: 'Solid progress.' });
  });

  test('sends prior turns to Gemini as conversation context', async () => {
    await ChatHistory.create([
      { user: userA, role: 'user', message: 'earlier question', timestamp: new Date('2024-01-01T00:00:00Z') },
      { user: userA, role: 'model', message: 'earlier answer', timestamp: new Date('2024-01-01T00:00:01Z') },
    ]);

    axios.post.mockResolvedValueOnce(geminiOk('follow-up answer'));
    const app = buildApp({ config: { geminiApiKey: 'test-key' } });
    const res = await authedChat(app, userA, { message: 'follow-up question' });

    expect(res.status).toBe(200);
    const body = axios.post.mock.calls[0][1];
    // history (2) + new user message (1)
    expect(body.contents).toHaveLength(3);
    expect(body.contents[0]).toEqual({ role: 'user', parts: [{ text: 'earlier question' }] });
    expect(body.contents[1]).toEqual({ role: 'model', parts: [{ text: 'earlier answer' }] });
    expect(body.contents[2]).toEqual({ role: 'user', parts: [{ text: 'follow-up question' }] });
  });

  test('does NOT persist anything when Gemini is unavailable', async () => {
    axios.post.mockRejectedValueOnce(new Error('boom'));
    const app = buildApp({ config: { geminiApiKey: 'test-key' } });

    const res = await authedChat(app, userA, { message: 'hello' });

    expect(res.status).toBe(503);
    expect(await ChatHistory.countDocuments({ user: userA })).toBe(0);
  });
});

// =============================================================================
// History endpoints
// =============================================================================

describe('GET /ai/history', () => {
  test('returns the user\'s turns in chronological order, scoped to the owner', async () => {
    await ChatHistory.create([
      { user: userA, role: 'user', message: 'first', timestamp: new Date('2024-01-01T00:00:00Z') },
      { user: userA, role: 'model', message: 'second', timestamp: new Date('2024-01-01T00:00:01Z') },
      { user: userB, role: 'user', message: 'other-user', timestamp: new Date('2024-01-01T00:00:02Z') },
    ]);

    const app = buildApp();
    const res = await authedGet(app, userA);

    expect(res.status).toBe(200);
    expect(res.body.history).toHaveLength(2);
    expect(res.body.history[0]).toMatchObject({ role: 'user', message: 'first' });
    expect(res.body.history[1]).toMatchObject({ role: 'model', message: 'second' });
    expect(JSON.stringify(res.body)).not.toContain('other-user');
  });

  test('returns an empty array when there is no history', async () => {
    const app = buildApp();
    const res = await authedGet(app, userA);

    expect(res.status).toBe(200);
    expect(res.body.history).toEqual([]);
  });
});

describe('DELETE /ai/history', () => {
  test('clears only the requesting user\'s history', async () => {
    await ChatHistory.create([
      { user: userA, role: 'user', message: 'mine' },
      { user: userB, role: 'user', message: 'theirs' },
    ]);

    const app = buildApp();
    const res = await authedDelete(app, userA);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(await ChatHistory.countDocuments({ user: userA })).toBe(0);
    expect(await ChatHistory.countDocuments({ user: userB })).toBe(1);
  });
});

// =============================================================================
// Gemini failure → 503
// =============================================================================

describe('POST /ai/chat — Gemini unavailable', () => {
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

  test('returns a quota-specific 503 message when Gemini returns 429 on every model', async () => {
    const quotaError = {
      response: { status: 429, data: { error: { message: 'quota exceeded' } } },
    };
    // Two models × (1 quota response — no retries on quota): 2 mocked rejects.
    axios.post
      .mockRejectedValueOnce(quotaError)
      .mockRejectedValueOnce(quotaError);

    const app = buildApp({ config: { geminiApiKey: 'test-key' } });
    const res = await authedChat(app, userA, { message: 'hello' });

    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/quota/i);
    // Quota path must NOT retry the same model (would deepen the hole).
    expect(axios.post).toHaveBeenCalledTimes(2);
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
