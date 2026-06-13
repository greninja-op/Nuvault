'use strict';

/**
 * Tests for net-worth snapshots: the recorder service + the GET route.
 */

const express = require('express');
const mongoose = require('mongoose');
const supertest = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const errorHandler = require('../middleware/errorHandler');
const Asset = require('../models/Asset');
const Liability = require('../models/Liability');
const NetWorthSnapshot = require('../models/NetWorthSnapshot');
const snapshotsRouter = require('./snapshots');
const { recordSnapshot } = require('../utils/snapshotService');

function fakeProtect() {
  return function protect(req, _res, next) {
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
  app.use('/snapshots', fakeProtect(), snapshotsRouter);
  app.use(errorHandler);
  return app;
}

let mongoServer;
const userA = new mongoose.Types.ObjectId();
const userB = new mongoose.Types.ObjectId();

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { dbName: 'nuvault_snap_test' });
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

afterEach(async () => {
  await Promise.all([
    Asset.deleteMany({}),
    Liability.deleteMany({}),
    NetWorthSnapshot.deleteMany({}),
  ]);
});

describe('recordSnapshot', () => {
  test('computes net worth from assets and liabilities', async () => {
    await Asset.create([
      { user: userA, name: 'cash', type: 'cash', value: 100000 },
      { user: userA, name: 'bank', type: 'bank', value: 50000 },
    ]);
    await Liability.create({ user: userA, name: 'card', type: 'credit_card', amount: 30000 });

    const snap = await recordSnapshot(userA);
    expect(snap.assets).toBe(150000);
    expect(snap.liabilities).toBe(30000);
    expect(snap.netWorth).toBe(120000);
  });

  test('upserts (one snapshot per day) rather than appending', async () => {
    await Asset.create({ user: userA, name: 'cash', type: 'cash', value: 100 });
    await recordSnapshot(userA);
    await recordSnapshot(userA);
    expect(await NetWorthSnapshot.countDocuments({ user: userA })).toBe(1);

    // A new asset changes the same-day snapshot in place.
    await Asset.create({ user: userA, name: 'more', type: 'cash', value: 900 });
    const updated = await recordSnapshot(userA);
    expect(await NetWorthSnapshot.countDocuments({ user: userA })).toBe(1);
    expect(updated.netWorth).toBe(1000);
  });

  test('never throws for a bad input (fire-and-forget safe)', async () => {
    await expect(recordSnapshot(undefined)).resolves.toBeNull();
  });
});

describe('GET /api/snapshots', () => {
  test('returns the user\'s snapshots oldest-first, scoped, capped at 30', async () => {
    const docs = [];
    for (let i = 0; i < 35; i += 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      docs.push({ user: userA, date: d, assets: 1000 + i, liabilities: 100, netWorth: 900 + i });
    }
    docs.push({ user: userB, date: new Date(), assets: 5, liabilities: 0, netWorth: 5 });
    await NetWorthSnapshot.insertMany(docs);

    const res = await supertest(buildApp())
      .get('/snapshots')
      .set('X-Test-User', String(userA));

    expect(res.status).toBe(200);
    expect(res.body.snapshots).toHaveLength(30);
    // Oldest first → ascending dates.
    const dates = res.body.snapshots.map((s) => new Date(s.date).getTime());
    for (let i = 1; i < dates.length; i += 1) {
      expect(dates[i]).toBeGreaterThanOrEqual(dates[i - 1]);
    }
    // Scoped: userB's snapshot never appears.
    expect(res.body.snapshots.some((s) => s.netWorth === 5)).toBe(false);
    // Shape.
    expect(res.body.snapshots[0]).toEqual(
      expect.objectContaining({
        date: expect.any(String),
        netWorth: expect.any(Number),
        assets: expect.any(Number),
        liabilities: expect.any(Number),
      }),
    );
  });

  test('returns an empty array when there is no history', async () => {
    const res = await supertest(buildApp())
      .get('/snapshots')
      .set('X-Test-User', String(userA));
    expect(res.status).toBe(200);
    expect(res.body.snapshots).toEqual([]);
  });
});
