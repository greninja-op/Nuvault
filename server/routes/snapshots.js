'use strict';

/**
 * Net-worth snapshot routes.
 *
 * Exposes the user's recent net-worth history for time-series charts.
 * Mounted under `protectedRouter` at `/snapshots` in `routes/index.js`, so
 * `protect` (JWT auth) applies automatically — the full path is
 * `GET /api/snapshots`.
 */
const express = require('express');

const NetWorthSnapshot = require('../models/NetWorthSnapshot');
const { scopedFind } = require('../utils/ownership');

const snapshotsRouter = express.Router();

/**
 * GET /api/snapshots — last 30 snapshots for the logged-in user, oldest
 * first (ready to plot left-to-right).
 */
snapshotsRouter.get('/', async (req, res, next) => {
  try {
    const docs = await scopedFind(NetWorthSnapshot, req)
      .sort({ date: -1 })
      .limit(30)
      .lean();

    const snapshots = docs
      .reverse()
      .map((d) => ({
        date: d.date,
        netWorth: d.netWorth,
        assets: d.assets,
        liabilities: d.liabilities,
      }));

    res.status(200).json({ snapshots });
  } catch (err) {
    next(err);
  }
});

module.exports = snapshotsRouter;
module.exports.snapshotsRouter = snapshotsRouter;
