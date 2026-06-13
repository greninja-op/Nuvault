'use strict';

/**
 * BlacklistedToken model (Feature 2 — JWT invalidation on logout).
 *
 * When a user logs out, their still-valid JWT is recorded here so the auth
 * middleware can reject it for the remainder of its lifetime. A TTL index on
 * `expiresAt` lets MongoDB auto-purge entries once the underlying token would
 * have expired anyway — the collection never grows unbounded.
 */
const mongoose = require('mongoose');

const blacklistedTokenSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// TTL index: MongoDB removes a document once `expiresAt` is in the past
// (expireAfterSeconds: 0 means "expire exactly at the stored time").
blacklistedTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('BlacklistedToken', blacklistedTokenSchema);
