'use strict';

/**
 * Liability route definitions (Task 9.1).
 *
 * Builds and exports an Express sub-router for the liability resource. The
 * aggregator in `routes/index.js` mounts it on `protectedRouter` under
 * `/liabilities`, so every endpoint defined here automatically inherits
 * the `protect` middleware (R4.1) — no per-route auth wiring required.
 *
 * Endpoints (mounted at `/api/liabilities`):
 *   - GET    /              — list the user's liabilities (R5.1, R5.4).
 *   - GET    /:id           — fetch one liability (R5.3, R7.7).
 *   - POST   /              — create a liability (R7.1–R7.4).
 *   - PUT    /:id           — update a liability (R7.3–R7.5, R7.7).
 *   - DELETE /:id           — delete a liability (R7.6, R7.7).
 *
 * The shared `liabilityValidators` chain is applied to POST and PUT; the
 * controller surfaces the first validation error as a 400 response. The
 * controllers themselves go through the ownership helper, so cross-user
 * id references collapse to a uniform 404 (R5.3).
 */

const express = require('express');

const {
  liabilityValidators,
  createLiability,
  getLiabilities,
  getLiability,
  updateLiability,
  deleteLiability,
} = require('../controllers/liabilityController');

/**
 * Sub-router for the liability resource. Exported so the aggregator in
 * `routes/index.js` can mount it under `/liabilities` on the
 * `protectedRouter`, and so tests can mount it on a minimal app without
 * going through the full middleware pipeline.
 *
 * @type {import('express').Router}
 */
const liabilitiesRouter = express.Router();

// List + fetch (no validators — id correctness is handled by the ownership
// helper, which collapses malformed / cross-user / missing ids to 404).
liabilitiesRouter.get('/', getLiabilities);
liabilitiesRouter.get('/:id', getLiability);

// Create + update share the same validation chain (R7.1–R7.4).
liabilitiesRouter.post('/', liabilityValidators, createLiability);
liabilitiesRouter.put('/:id', liabilityValidators, updateLiability);

liabilitiesRouter.delete('/:id', deleteLiability);

module.exports = liabilitiesRouter;
module.exports.liabilitiesRouter = liabilitiesRouter;
