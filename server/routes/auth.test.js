'use strict';

/**
 * Integration smoke tests for the wired auth routes (Task 5.3).
 *
 * The dedicated controller and middleware tests cover behavior in
 * isolation; this file's job is narrower — to prove the *wiring*:
 *
 *   - POST /api/auth/register is reachable without auth (R4.6)
 *   - POST /api/auth/login    is reachable without auth (R4.6)
 *   - GET  /api/auth/me        is gated by `protect` and returns 401
 *                              without a Bearer token (R4.1, R4.3)
 *   - GET  /api/auth/me        with a valid Bearer token returns the
 *                              authenticated profile minus password
 *                              (R3.1, R4.2)
 *
 * The tests run against the real `createApp` factory so they exercise
 * the full middleware pipeline (CORS / Helmet / rate limit / JSON / the
 * router aggregators / error handler). The router aggregator is a
 * module-level singleton, so the tests cannot accidentally bypass any
 * step the production server takes.
 */

const mongoose = require('mongoose');
const supertest = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Stable JWT settings. Must be set before any module that reads them at
// require time is loaded.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'auth-routes-test-secret';
process.env.JWT_EXPIRE = process.env.JWT_EXPIRE || '30d';

const { createApp } = require('../app');
const User = require('../models/User');

const VALID_CONFIG = Object.freeze({
  clientOrigin: 'https://app.nuvault.test',
  nodeEnv: 'test',
});

let mongoServer;
let app;
let request;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), {
    dbName: 'nuvault_auth_routes_test',
  });
  app = createApp({ config: VALID_CONFIG });
  request = supertest(app);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
});

afterEach(async () => {
  await User.deleteMany({});
});

const VALID_BODY = Object.freeze({
  name: 'Wired Routes',
  email: 'wired@example.com',
  password: 'a-real-password',
});

describe('public auth routes (R4.6)', () => {
  test('POST /api/auth/register is reachable without authentication', async () => {
    const res = await request
      .post('/api/auth/register')
      .set('Origin', VALID_CONFIG.clientOrigin)
      .send(VALID_BODY);

    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user).toEqual({
      id: expect.any(String),
      name: VALID_BODY.name,
      email: VALID_BODY.email,
    });
  });

  test('POST /api/auth/login is reachable without authentication', async () => {
    // Seed the user via the registration route so the login path uses
    // the same bcrypt-hashed credential a real client would.
    await request
      .post('/api/auth/register')
      .set('Origin', VALID_CONFIG.clientOrigin)
      .send(VALID_BODY);

    const res = await request
      .post('/api/auth/login')
      .set('Origin', VALID_CONFIG.clientOrigin)
      .send({ email: VALID_BODY.email, password: VALID_BODY.password });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user.email).toBe(VALID_BODY.email);
  });
});

describe('protected auth routes (R3.1, R4.1, R4.2, R4.3)', () => {
  test('GET /api/auth/me without a Bearer token returns 401', async () => {
    const res = await request
      .get('/api/auth/me')
      .set('Origin', VALID_CONFIG.clientOrigin)
      .send();

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/not authorized/i);
  });

  test('GET /api/auth/me with a valid Bearer token returns the profile (no password)', async () => {
    const registerRes = await request
      .post('/api/auth/register')
      .set('Origin', VALID_CONFIG.clientOrigin)
      .send(VALID_BODY);
    expect(registerRes.status).toBe(201);
    const { token, user } = registerRes.body;

    const res = await request
      .get('/api/auth/me')
      .set('Origin', VALID_CONFIG.clientOrigin)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: user.id,
      name: VALID_BODY.name,
      email: VALID_BODY.email,
      currency: 'INR',
      createdAt: expect.any(String),
    });
    // R3.1: the bcrypt hash must never appear in the response.
    expect(res.body).not.toHaveProperty('password');
    expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$/);
  });
});
