'use strict';

/**
 * Unit tests for the shared ownership helper (utils/ownership.js).
 *
 * These tests exercise the helpers against an in-memory MongoDB so they
 * cover the real Mongoose code paths controllers will hit, not a mock.
 * They focus on the contract from the design ("Ownership Helper") and
 * Requirement 5 (Per-User Data Isolation):
 *
 *   - scoped reads always include `user: req.user._id`
 *   - scoped create injects the user and discards client-supplied user
 *   - scoped update applies the payload, never reassigns user, and returns
 *     null for cross-user / missing / malformed ids
 *   - scoped delete deletes only when the record is owned by the user, and
 *     returns null otherwise
 *
 * Property tests for the cross-resource isolation properties (Properties
 * 3, 4, 5) live in task 18.x; this file is the unit-level coverage that
 * matches task 7.1.
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Asset = require('../models/Asset');
const {
  scopedFind,
  scopedFindOne,
  scopedFindById,
  scopedCreate,
  scopedUpdate,
  scopedDelete,
  sanitizePayload,
  getOwnerId,
  isInvalidObjectId,
} = require('./ownership');

let mongo;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) {
    await mongo.stop();
  }
});

afterEach(async () => {
  await Asset.deleteMany({});
});

/**
 * Build a fake request object with a fresh ObjectId as the user id, so each
 * test exercises a unique owner. Returns both the request and the raw id
 * for convenience.
 */
function makeReq() {
  const _id = new mongoose.Types.ObjectId();
  return { req: { user: { _id } }, userId: _id };
}

/**
 * Convenience: persist an Asset directly via the model so the test sets up
 * data without going through the helpers under test.
 */
function seedAsset(userId, overrides = {}) {
  return Asset.create({
    user: userId,
    name: 'Seed asset',
    type: 'cash',
    value: 100,
    ...overrides,
  });
}

describe('sanitizePayload', () => {
  test('returns a copy without the user field', () => {
    const input = { name: 'x', user: 'attacker', value: 5 };
    const out = sanitizePayload(input);
    expect(out).toEqual({ name: 'x', value: 5 });
    // Original payload is untouched.
    expect(input.user).toBe('attacker');
  });

  test('returns an empty object for null/undefined/non-object inputs', () => {
    expect(sanitizePayload(null)).toEqual({});
    expect(sanitizePayload(undefined)).toEqual({});
    expect(sanitizePayload(42)).toEqual({});
    expect(sanitizePayload('hello')).toEqual({});
    expect(sanitizePayload([1, 2, 3])).toEqual({});
  });

  test('preserves payloads that have no user field', () => {
    expect(sanitizePayload({ a: 1, b: 'two' })).toEqual({ a: 1, b: 'two' });
  });
});

describe('getOwnerId / isInvalidObjectId', () => {
  test('getOwnerId throws when req.user._id is missing', () => {
    expect(() => getOwnerId(undefined)).toThrow(/req.user._id/);
    expect(() => getOwnerId({})).toThrow(/req.user._id/);
    expect(() => getOwnerId({ user: {} })).toThrow(/req.user._id/);
    expect(() => getOwnerId({ user: { _id: null } })).toThrow(/req.user._id/);
  });

  test('getOwnerId returns the id when present', () => {
    const id = new mongoose.Types.ObjectId();
    expect(getOwnerId({ user: { _id: id } })).toBe(id);
  });

  test('isInvalidObjectId catches missing and malformed ids', () => {
    expect(isInvalidObjectId(undefined)).toBe(true);
    expect(isInvalidObjectId(null)).toBe(true);
    expect(isInvalidObjectId('not-an-id')).toBe(true);

    expect(isInvalidObjectId(new mongoose.Types.ObjectId())).toBe(false);
    expect(isInvalidObjectId(String(new mongoose.Types.ObjectId()))).toBe(false);
  });
});

describe('scopedFind', () => {
  test('returns only records owned by req.user._id', async () => {
    const a = makeReq();
    const b = makeReq();

    await seedAsset(a.userId, { name: 'A1' });
    await seedAsset(a.userId, { name: 'A2' });
    await seedAsset(b.userId, { name: 'B1' });

    const aResults = await scopedFind(Asset, a.req);
    expect(aResults).toHaveLength(2);
    for (const doc of aResults) {
      expect(String(doc.user)).toBe(String(a.userId));
    }

    const bResults = await scopedFind(Asset, b.req);
    expect(bResults).toHaveLength(1);
    expect(bResults[0].name).toBe('B1');
  });

  test('overrides any user value supplied in the filter', async () => {
    const a = makeReq();
    const b = makeReq();

    await seedAsset(a.userId, { name: 'A1' });
    await seedAsset(b.userId, { name: 'B1' });

    // Caller tries to query as a different user; helper must ignore it.
    const results = await scopedFind(Asset, a.req, { user: b.userId });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('A1');
  });

  test('combines additional filter fields with the user scope', async () => {
    const a = makeReq();
    await seedAsset(a.userId, { name: 'cash-1', type: 'cash' });
    await seedAsset(a.userId, { name: 'bank-1', type: 'bank' });

    const cashOnly = await scopedFind(Asset, a.req, { type: 'cash' });
    expect(cashOnly).toHaveLength(1);
    expect(cashOnly[0].name).toBe('cash-1');
  });
});

describe('scopedFindOne', () => {
  test('returns null when no match exists for this user', async () => {
    const a = makeReq();
    const b = makeReq();
    await seedAsset(b.userId, { name: 'B1' });

    const result = await scopedFindOne(Asset, a.req, { name: 'B1' });
    expect(result).toBeNull();
  });

  test('returns the matching record for the authenticated user', async () => {
    const a = makeReq();
    await seedAsset(a.userId, { name: 'mine' });

    const result = await scopedFindOne(Asset, a.req, { name: 'mine' });
    expect(result).not.toBeNull();
    expect(String(result.user)).toBe(String(a.userId));
  });
});

describe('scopedFindById', () => {
  test('returns the document when it belongs to the user', async () => {
    const a = makeReq();
    const doc = await seedAsset(a.userId);

    const result = await scopedFindById(Asset, a.req, doc._id);
    expect(result).not.toBeNull();
    expect(String(result._id)).toBe(String(doc._id));
  });

  test('returns null when the document belongs to a different user', async () => {
    const a = makeReq();
    const b = makeReq();
    const doc = await seedAsset(b.userId);

    const result = await scopedFindById(Asset, a.req, doc._id);
    expect(result).toBeNull();
  });

  test('returns null for a malformed id rather than throwing', async () => {
    const a = makeReq();
    await expect(scopedFindById(Asset, a.req, 'not-an-id')).resolves.toBeNull();
    await expect(scopedFindById(Asset, a.req, undefined)).resolves.toBeNull();
  });

  test('returns null for a well-formed id that does not exist', async () => {
    const a = makeReq();
    const ghostId = new mongoose.Types.ObjectId();
    const result = await scopedFindById(Asset, a.req, ghostId);
    expect(result).toBeNull();
  });
});

describe('scopedCreate', () => {
  test('persists the record with user = req.user._id', async () => {
    const a = makeReq();
    const created = await scopedCreate(Asset, a.req, {
      name: 'wallet',
      type: 'cash',
      value: 50,
    });

    expect(String(created.user)).toBe(String(a.userId));

    const reloaded = await Asset.findById(created._id);
    expect(String(reloaded.user)).toBe(String(a.userId));
  });

  test('discards a client-supplied user field on the payload', async () => {
    const a = makeReq();
    const attackerId = new mongoose.Types.ObjectId();

    const created = await scopedCreate(Asset, a.req, {
      name: 'wallet',
      type: 'cash',
      value: 50,
      user: attackerId, // attempted ownership injection
    });

    expect(String(created.user)).toBe(String(a.userId));
    expect(String(created.user)).not.toBe(String(attackerId));
  });

  test('validates against the model schema (propagates ValidationError)', async () => {
    const a = makeReq();
    // `value` is below the allowed minimum; helper does not silence model
    // validation, so the controller layer can map ValidationError to 400.
    await expect(
      scopedCreate(Asset, a.req, { name: 'bad', type: 'cash', value: 0 })
    ).rejects.toThrow(/value/);
  });
});

describe('scopedUpdate', () => {
  test('applies the sanitized payload and saves the record', async () => {
    const a = makeReq();
    const doc = await seedAsset(a.userId, { name: 'old', value: 10 });

    const updated = await scopedUpdate(Asset, a.req, doc._id, {
      name: 'new',
      value: 99,
    });

    expect(updated).not.toBeNull();
    expect(updated.name).toBe('new');
    expect(updated.value).toBe(99);
    expect(String(updated.user)).toBe(String(a.userId));

    const reloaded = await Asset.findById(doc._id);
    expect(reloaded.name).toBe('new');
    expect(reloaded.value).toBe(99);
  });

  test('never reassigns the user even when the payload supplies one', async () => {
    const a = makeReq();
    const attackerId = new mongoose.Types.ObjectId();
    const doc = await seedAsset(a.userId, { name: 'old' });

    const updated = await scopedUpdate(Asset, a.req, doc._id, {
      name: 'renamed',
      user: attackerId,
    });

    expect(updated).not.toBeNull();
    expect(String(updated.user)).toBe(String(a.userId));

    const reloaded = await Asset.findById(doc._id);
    expect(String(reloaded.user)).toBe(String(a.userId));
  });

  test('returns null when the record belongs to another user (no mutation)', async () => {
    const a = makeReq();
    const b = makeReq();
    const doc = await seedAsset(b.userId, { name: 'other-user-asset', value: 10 });

    const result = await scopedUpdate(Asset, a.req, doc._id, {
      name: 'hijacked',
      value: 9999,
    });

    expect(result).toBeNull();

    // The other user's record is unchanged.
    const reloaded = await Asset.findById(doc._id);
    expect(reloaded.name).toBe('other-user-asset');
    expect(reloaded.value).toBe(10);
  });

  test('returns null for a malformed or missing id', async () => {
    const a = makeReq();
    await expect(scopedUpdate(Asset, a.req, 'not-an-id', { name: 'x' })).resolves.toBeNull();
    await expect(
      scopedUpdate(Asset, a.req, new mongoose.Types.ObjectId(), { name: 'x' })
    ).resolves.toBeNull();
  });
});

describe('scopedDelete', () => {
  test('deletes the record when it belongs to the user', async () => {
    const a = makeReq();
    const doc = await seedAsset(a.userId);

    const result = await scopedDelete(Asset, a.req, doc._id);
    expect(result).not.toBeNull();
    expect(String(result._id)).toBe(String(doc._id));

    const reloaded = await Asset.findById(doc._id);
    expect(reloaded).toBeNull();
  });

  test('returns null and leaves the record intact for a different user', async () => {
    const a = makeReq();
    const b = makeReq();
    const doc = await seedAsset(b.userId);

    const result = await scopedDelete(Asset, a.req, doc._id);
    expect(result).toBeNull();

    const reloaded = await Asset.findById(doc._id);
    expect(reloaded).not.toBeNull();
  });

  test('returns null for malformed ids', async () => {
    const a = makeReq();
    await expect(scopedDelete(Asset, a.req, 'not-an-id')).resolves.toBeNull();
    await expect(
      scopedDelete(Asset, a.req, new mongoose.Types.ObjectId())
    ).resolves.toBeNull();
  });
});
