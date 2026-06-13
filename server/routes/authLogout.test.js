'use strict';

/**
 * Integration test for JWT blacklisting on logout (Feature 2).
 *
 * Wires the REAL `protect` middleware + `/logout` controller against an
 * in-memory MongoDB and asserts the full lifecycle:
 *   1. a valid token reaches a protected route,
 *   2. POST /logout blacklists it,
 *   3. the same token is then rejected with 401 "Token has been invalidated".
 */

const express = require('express');
const mongoose = require('mongoose');
const supertest = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'logout-test-secret';
process.env.JWT_EXPIRE = process.env.JWT_EXPIRE || '30d';

const protect = require('../middleware/auth');
const { TOKEN_INVALIDATED_MESSAGE } = require('../middleware/auth');
const errorHandler = require('../middleware/errorHandler');
const { logout } = require('../controllers/authController');
const User = require('../models/User');
const BlacklistedToken = require('../models/BlacklistedToken');
const generateToken = require('../utils/generateToken');

let mongoServer;
let app;
let request;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { dbName: 'nuvault_logout_test' });

  // Ensure unique/TTL indexes are built before the tests rely on them.
  await Promise.all([User.init(), BlacklistedToken.init()]);

  app = express();
  app.use(express.json());
  app.get('/protected', protect, (req, res) => res.status(200).json({ ok: true }));
  app.post('/logout', protect, logout);
  app.use(errorHandler);
  request = supertest(app);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

afterEach(async () => {
  await Promise.all([User.deleteMany({}), BlacklistedToken.deleteMany({})]);
});

async function makeUserAndToken() {
  const user = await User.create({
    name: 'Logout Tester',
    email: `logout-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'correct-horse-battery',
  });
  return { user, token: generateToken(user._id) };
}

describe('JWT blacklist on logout (Feature 2)', () => {
  test('valid token works before logout, is rejected after', async () => {
    const { token } = await makeUserAndToken();

    const before = await request.get('/protected').set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(200);

    const out = await request.post('/logout').set('Authorization', `Bearer ${token}`);
    expect(out.status).toBe(200);
    expect(out.body.message).toMatch(/logged out/i);

    // The token is now blacklisted.
    expect(await BlacklistedToken.countDocuments({ token })).toBe(1);

    const after = await request.get('/protected').set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(401);
    expect(after.body.message).toBe(TOKEN_INVALIDATED_MESSAGE);
  });

  test('a second logout with the same token is blocked by protect (already invalidated)', async () => {
    const { token } = await makeUserAndToken();
    const first = await request.post('/logout').set('Authorization', `Bearer ${token}`);
    expect(first.status).toBe(200);

    // The token is now blacklisted, so `protect` rejects the second logout
    // before it reaches the handler — and no duplicate row is created.
    const second = await request.post('/logout').set('Authorization', `Bearer ${token}`);
    expect(second.status).toBe(401);
    expect(second.body.message).toBe(TOKEN_INVALIDATED_MESSAGE);
    expect(await BlacklistedToken.countDocuments({ token })).toBe(1);
  });
});
