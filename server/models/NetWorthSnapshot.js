'use strict';

/**
 * NetWorthSnapshot — a point-in-time record of a user's net worth.
 *
 * One document per user per day (the snapshot service upserts the current
 * day's row). These power the real time-series net-worth area chart, since
 * Nuvault otherwise only stores current balances, not history.
 */
const mongoose = require('mongoose');

const netWorthSnapshotSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  date: {
    type: Date,
    default: Date.now,
  },
  netWorth: {
    type: Number,
    required: true,
  },
  assets: {
    type: Number,
    required: true,
  },
  liabilities: {
    type: Number,
    required: true,
  },
});

// Fast per-user, newest-first queries.
netWorthSnapshotSchema.index({ user: 1, date: -1 });

module.exports = mongoose.model('NetWorthSnapshot', netWorthSnapshotSchema);
