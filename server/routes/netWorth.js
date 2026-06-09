'use strict';

/**
 * Net Worth route definitions (Task 10.3).
 *
 * Exposes a single read-only endpoint that returns the authenticated
 * user's computed net worth together with both lists and both totals.
 * The aggregator in `routes/index.js` mounts this sub-router on
 * `protectedRouter` under `/networth`, so the endpoint automatically
 * inherits the `protect` middleware (R4.1) — no per-route auth wiring
 * required.
 *
 * Endpoint (mounted at `/api/networth`):
 *   - GET / — compute and return the user's net worth
 *             (R8.1, R8.2, R8.3, R8.5, R8.6).
 *
 * The controller never writes to MongoDB (R8.4): the result is recomputed
 * on every request from the user's stored Asset and Liability records.
 */

const express = require('express');

const { getNetWorth } = require('../controllers/netWorthController');

/**
 * Sub-router for the net worth resource. Exported so the aggregator in
 * `routes/index.js` can mount it under `/networth` on the
 * `protectedRouter`, and so tests can mount it on a minimal app without
 * going through the full middleware pipeline.
 *
 * @type {import('express').Router}
 */
const netWorthRouter = express.Router();

netWorthRouter.get('/', getNetWorth);

module.exports = netWorthRouter;
module.exports.netWorthRouter = netWorthRouter;
