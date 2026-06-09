'use strict';

/**
 * Integration tests for the asset controller (Task 8.1).
 *
 * Spins up an in-memory MongoDB and mounts the asset router on a
 * minimal Express app fronted by a fake-protect middleware that
 * injects `req.user._id`. This mirrors the pattern used by
 * `authController.test.js` and keeps the test isolated from the
 * (separate) JWT verification path that lives in Task 5.3.
 *
 * The tests cover the request/response contract end to end:
 *   - happy paths for create/list/get/update/delete (R6.1, R6.5, R6.6),
 *   - `400` on every documented validation failure path (R6.2–R6.4),
 *   - `404` for cross-user reads/updates/deletes and missing/malformed
 *     ids (R5.3, R6.7),
 *   - INR currency default when the field is omitted (R6.8),
 *   - ownership cannot be reassigned via a payload `user` field (R5.2,
 *     R5.6).
 *
 * Property-based coverage of the broader CRUD/isolation surface lives
 * under tasks 18.x and is intentionally out of scope here.
 */

const express = require('express');
const mongoose = require('mongoose');
const supertest = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const errorHandler = require('../middleware/errorHandler');
const Asset = require('../models/Asset');
const { ASSET_TYPES } = Asset;
const {
  createAsset,
  getAssets,
  getAsset,
  updateAsset,
  deleteAsset,
  assetValidators,
  MESSAGES,
} = require('./assetController');

/**
 * Build a minimal Express app that mounts the asset routes behind a
 * tiny middleware that injects a configurable `req.user._id`. The id
 * source is a per-request header (`x-user-id`) so a single app can
 * exercise multiple users — that is exactly what the cross-user
 * isolation tests need.
 *
 * The app also installs the uniform error handler so the same error
 * pipeline runs in tests as in production.
 *
 * @returns {import('express').Express}
 */
function buildApp() {
  const app = express();
  app.use(express.json());

  // Fake-protect: pull the current user id out of the request header
  // and attach it to `req.user`. Tests set the header via supertest's
  // `.set('x-user-id', ...)`. Missing/invalid ids are rejected with
  // 401 so the controller is never reached without an owner — matches
  // what the real `protect` middleware will guarantee (R4.1, R4.5).
  app.use((req, _res, next) => {
    const raw = req.headers['x-user-id'];
    if (typeof raw !== 'string' || !mongoose.isValidObjectId(raw)) {
      const err = new Error('Not authorized');
      err.statusCode = 401;
      return next(err);
    }
    req.user = { _id: new mongoose.Types.ObjectId(raw) };
    next();
  });

  app.get('/assets', getAssets);
  app.post('/assets', assetValidators, createAsset);
  app.get('/assets/:id', getAsset);
  app.put('/assets/:id', assetValidators, updateAsset);
  app.delete('/assets/:id', deleteAsset);

  app.use(errorHandler);
  return app;
}

let mongoServer;
let app;
let request;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { dbName: 'nuvault_assets_test' });
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
  await Asset.deleteMany({});
});

/**
 * Allocate a fresh user id for a test. Strings (rather than ObjectIds)
 * are returned because supertest sends string header values — the
 * fake-protect middleware re-hydrates them into ObjectIds.
 *
 * @returns {string}
 */
function newUserId() {
  return new mongoose.Types.ObjectId().toString();
}

/**
 * A body that satisfies every asset validator.
 *
 * @param {Partial<{ name: string, type: string, value: number, currency: string }>} [overrides]
 */
function validBody(overrides = {}) {
  return {
    name: 'Emergency Fund',
    type: 'cash',
    value: 1500.5,
    ...overrides,
  };
}

/**
 * Convenience: register an asset for `userId` via the API.
 */
async function createViaApi(userId, body = validBody()) {
  const res = await request
    .post('/assets')
    .set('x-user-id', userId)
    .send(body);
  expect(res.status).toBe(201);
  return res.body;
}

describe('POST /assets — happy path (R6.1, R6.8)', () => {
  test('creates an asset, defaults currency to INR, and returns 201', async () => {
    const userId = newUserId();

    const res = await request
      .post('/assets')
      .set('x-user-id', userId)
      .send({ name: 'Emergency Fund', type: 'cash', value: 1500.5 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Emergency Fund',
      type: 'cash',
      value: 1500.5,
      currency: 'INR',
    });
    expect(res.body._id).toEqual(expect.any(String));
    expect(String(res.body.user)).toBe(userId);

    const stored = await Asset.findById(res.body._id);
    expect(stored).not.toBeNull();
    expect(String(stored.user)).toBe(userId);
    expect(stored.currency).toBe('INR');
  });

  test('honors a client-supplied currency when provided', async () => {
    const userId = newUserId();

    const res = await request
      .post('/assets')
      .set('x-user-id', userId)
      .send({ name: 'USD Savings', type: 'bank', value: 100, currency: 'USD' });

    expect(res.status).toBe(201);
    expect(res.body.currency).toBe('USD');
  });

  test('forces ownership to req.user even when the payload supplies a different `user` (R5.2)', async () => {
    const ownerId = newUserId();
    const attackerId = newUserId();

    const res = await request
      .post('/assets')
      .set('x-user-id', ownerId)
      .send({ ...validBody(), user: attackerId });

    expect(res.status).toBe(201);
    expect(String(res.body.user)).toBe(ownerId);
    expect(String(res.body.user)).not.toBe(attackerId);
  });

  test('accepts the lower bound (0.01) and upper bound (999,999,999.99) for value', async () => {
    const userId = newUserId();

    const low = await request
      .post('/assets')
      .set('x-user-id', userId)
      .send(validBody({ value: 0.01 }));
    expect(low.status).toBe(201);
    expect(low.body.value).toBeCloseTo(0.01, 2);

    const high = await request
      .post('/assets')
      .set('x-user-id', userId)
      .send(validBody({ value: 999999999.99 }));
    expect(high.status).toBe(201);
    expect(high.body.value).toBeCloseTo(999999999.99, 2);
  });
});

describe('POST /assets — validation errors (R6.2, R6.3, R6.4)', () => {
  /**
   * Build a body where exactly one field has been replaced or removed.
   *
   * @param {'name' | 'type' | 'value'} field
   * @param {unknown} value
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
    ['name missing', 'name', undefined, /name/i],
    ['name empty', 'name', '', /name/i],
    ['name whitespace-only', 'name', '   ', /name/i],
    ['name too long', 'name', 'a'.repeat(101), /name/i],
    ['type missing', 'type', undefined, /type/i],
    ['type empty', 'type', '', /type/i],
    ['type unknown value', 'type', 'gold-bars', /type/i],
    ['value missing', 'value', undefined, /value/i],
    ['value as string', 'value', '100', /value/i],
    ['value NaN', 'value', NaN, /value/i],
    ['value zero', 'value', 0, /value/i],
    ['value below minimum', 'value', 0.001, /value/i],
    ['value negative', 'value', -10, /value/i],
    ['value above maximum', 'value', 1_000_000_000, /value/i],
  ])(
    'rejects when %s with 400 and a relevant message',
    async (_label, field, value, pattern) => {
      const userId = newUserId();

      const res = await request
        .post('/assets')
        .set('x-user-id', userId)
        .send(bodyWith(field, value));

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(pattern);

      // R6.2/R6.3/R6.4: invalid input must not persist.
      expect(await Asset.countDocuments({})).toBe(0);
    }
  );

  test('every documented type is accepted', async () => {
    const userId = newUserId();
    for (const type of ASSET_TYPES) {
      const res = await request
        .post('/assets')
        .set('x-user-id', userId)
        .send(validBody({ name: `holding-${type}`, type }));
      expect(res.status).toBe(201);
      expect(res.body.type).toBe(type);
    }
  });
});

describe('GET /assets — list (R5.1, R5.4)', () => {
  test('returns an empty array when the user has no assets', async () => {
    const res = await request
      .get('/assets')
      .set('x-user-id', newUserId());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  test('returns only the authenticated user\'s assets', async () => {
    const aliceId = newUserId();
    const bobId = newUserId();

    await createViaApi(aliceId, validBody({ name: 'Alice 1' }));
    await createViaApi(aliceId, validBody({ name: 'Alice 2', type: 'bank' }));
    await createViaApi(bobId, validBody({ name: 'Bob 1', type: 'crypto' }));

    const aliceRes = await request
      .get('/assets')
      .set('x-user-id', aliceId);
    expect(aliceRes.status).toBe(200);
    expect(aliceRes.body).toHaveLength(2);
    for (const asset of aliceRes.body) {
      expect(String(asset.user)).toBe(aliceId);
    }
    const aliceNames = aliceRes.body.map((a) => a.name).sort();
    expect(aliceNames).toEqual(['Alice 1', 'Alice 2']);

    const bobRes = await request.get('/assets').set('x-user-id', bobId);
    expect(bobRes.status).toBe(200);
    expect(bobRes.body).toHaveLength(1);
    expect(bobRes.body[0].name).toBe('Bob 1');
  });
});

describe('GET /assets/:id — single record (R5.3, R6.7)', () => {
  test('returns the asset when it belongs to the authenticated user', async () => {
    const userId = newUserId();
    const created = await createViaApi(userId);

    const res = await request
      .get(`/assets/${created._id}`)
      .set('x-user-id', userId);

    expect(res.status).toBe(200);
    expect(res.body._id).toBe(created._id);
    expect(res.body.name).toBe(created.name);
  });

  test('returns 404 when the asset belongs to a different user', async () => {
    const ownerId = newUserId();
    const intruderId = newUserId();
    const created = await createViaApi(ownerId);

    const res = await request
      .get(`/assets/${created._id}`)
      .set('x-user-id', intruderId);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe(MESSAGES.ASSET_NOT_FOUND);

    // R5.3: the owner's record is unchanged.
    const stored = await Asset.findById(created._id);
    expect(stored).not.toBeNull();
    expect(String(stored.user)).toBe(ownerId);
  });

  test('returns 404 for a well-formed id that does not exist', async () => {
    const userId = newUserId();
    const ghostId = new mongoose.Types.ObjectId().toString();

    const res = await request
      .get(`/assets/${ghostId}`)
      .set('x-user-id', userId);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe(MESSAGES.ASSET_NOT_FOUND);
  });

  test('returns 404 for a malformed id rather than 500', async () => {
    const userId = newUserId();

    const res = await request
      .get('/assets/not-an-id')
      .set('x-user-id', userId);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe(MESSAGES.ASSET_NOT_FOUND);
  });
});

describe('PUT /assets/:id — update (R6.5, R6.7, R5.6)', () => {
  test('applies the changes and returns the updated asset', async () => {
    const userId = newUserId();
    const created = await createViaApi(userId, validBody({ name: 'Old', value: 100 }));

    const res = await request
      .put(`/assets/${created._id}`)
      .set('x-user-id', userId)
      .send({ name: 'New', type: 'bank', value: 250.75 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      _id: created._id,
      name: 'New',
      type: 'bank',
      value: 250.75,
    });

    const reloaded = await Asset.findById(created._id);
    expect(reloaded.name).toBe('New');
    expect(reloaded.value).toBe(250.75);
  });

  test('rejects an invalid payload with 400 and leaves the record unchanged', async () => {
    const userId = newUserId();
    const created = await createViaApi(userId, validBody({ name: 'Stable', value: 42 }));

    const res = await request
      .put(`/assets/${created._id}`)
      .set('x-user-id', userId)
      .send({ name: 'Stable', type: 'cash', value: -1 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/value/i);

    const reloaded = await Asset.findById(created._id);
    expect(reloaded.value).toBe(42);
    expect(reloaded.name).toBe('Stable');
  });

  test('returns 404 when updating an asset owned by a different user (no mutation)', async () => {
    const ownerId = newUserId();
    const intruderId = newUserId();
    const created = await createViaApi(ownerId, validBody({ name: 'OwnerAsset', value: 100 }));

    const res = await request
      .put(`/assets/${created._id}`)
      .set('x-user-id', intruderId)
      .send({ name: 'Hijacked', type: 'cash', value: 99999 });

    expect(res.status).toBe(404);
    expect(res.body.message).toBe(MESSAGES.ASSET_NOT_FOUND);

    const reloaded = await Asset.findById(created._id);
    expect(reloaded.name).toBe('OwnerAsset');
    expect(reloaded.value).toBe(100);
    expect(String(reloaded.user)).toBe(ownerId);
  });

  test('returns 404 for missing/malformed ids', async () => {
    const userId = newUserId();

    const ghostRes = await request
      .put(`/assets/${new mongoose.Types.ObjectId()}`)
      .set('x-user-id', userId)
      .send(validBody());
    expect(ghostRes.status).toBe(404);

    const malformedRes = await request
      .put('/assets/not-an-id')
      .set('x-user-id', userId)
      .send(validBody());
    expect(malformedRes.status).toBe(404);
  });

  test('never reassigns the user field via the payload (R5.6)', async () => {
    const ownerId = newUserId();
    const attackerId = newUserId();
    const created = await createViaApi(ownerId);

    const res = await request
      .put(`/assets/${created._id}`)
      .set('x-user-id', ownerId)
      .send({ ...validBody({ name: 'Renamed' }), user: attackerId });

    expect(res.status).toBe(200);
    expect(String(res.body.user)).toBe(ownerId);

    const reloaded = await Asset.findById(created._id);
    expect(String(reloaded.user)).toBe(ownerId);
  });
});

describe('DELETE /assets/:id — delete (R6.6, R6.7)', () => {
  test('removes the asset and returns 200 with the deleted id', async () => {
    const userId = newUserId();
    const created = await createViaApi(userId);

    const res = await request
      .delete(`/assets/${created._id}`)
      .set('x-user-id', userId);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: created._id,
      message: MESSAGES.ASSET_DELETED,
    });

    expect(await Asset.findById(created._id)).toBeNull();
  });

  test('returns 404 for an asset owned by a different user (record unchanged)', async () => {
    const ownerId = newUserId();
    const intruderId = newUserId();
    const created = await createViaApi(ownerId);

    const res = await request
      .delete(`/assets/${created._id}`)
      .set('x-user-id', intruderId);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe(MESSAGES.ASSET_NOT_FOUND);

    const reloaded = await Asset.findById(created._id);
    expect(reloaded).not.toBeNull();
  });

  test('returns 404 for missing/malformed ids', async () => {
    const userId = newUserId();

    const ghostRes = await request
      .delete(`/assets/${new mongoose.Types.ObjectId()}`)
      .set('x-user-id', userId);
    expect(ghostRes.status).toBe(404);

    const malformedRes = await request
      .delete('/assets/not-an-id')
      .set('x-user-id', userId);
    expect(malformedRes.status).toBe(404);
  });
});
