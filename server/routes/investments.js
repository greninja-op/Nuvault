'use strict';

/**
 * Investment route definitions (Task 14.1).
 *
 * Builds and exports an Express sub-router for the investment resource.
 * The aggregator in `routes/index.js` mounts it on `protectedRouter`
 * under `/investments`, so every endpoint defined here automatically
 * inherits the `protect` middleware (R4.1) — no per-route auth wiring
 * required.
 *
 * Endpoints (mounted at `/api/investments`):
 *   - GET    /              — list the user's investments (R5.1, R5.4).
 *   - GET    /summary       — live pricing + P&L summary (R14.1–R14.6).
 *   - POST   /              — create an investment (R13.1–R13.4).
 *   - GET    /:id           — fetch one investment (R5.3, R13.7).
 *   - PUT    /:id           — update an investment (R13.3–R13.5, R13.7).
 *   - DELETE /:id           — delete an investment (R13.6, R13.7).
 *
 * IMPORTANT: `/summary` is registered before `/:id` so that the literal
 * sub-path is matched first. Otherwise Express would treat the string
 * "summary" as an `id` parameter and route every summary request
 * through `getInvestment`.
 *
 * The shared `investmentValidators` chain is applied to POST and PUT;
 * the controller surfaces the first validation error as a 400 response.
 * The controllers themselves go through the ownership helper, so
 * cross-user id references collapse to a uniform 404 (R5.3).
 */

const express = require('express');

const {
  investmentValidators,
  createInvestment,
  getInvestments,
  getInvestment,
  updateInvestment,
  deleteInvestment,
  getSummary,
} = require('../controllers/investmentController');

/**
 * Sub-router for the investment resource. Exported so the aggregator
 * in `routes/index.js` can mount it under `/investments` on the
 * `protectedRouter`, and so tests can mount it on a minimal app
 * without going through the full middleware pipeline.
 *
 * @type {import('express').Router}
 */
const investmentsRouter = express.Router();

// List + summary. `/summary` MUST come before `/:id` so the literal
// path wins when matching; otherwise Express captures "summary" as
// the id parameter.
investmentsRouter.get('/', getInvestments);
investmentsRouter.get('/summary', getSummary);

// Create + update share the same validation chain (R13.1–R13.4).
investmentsRouter.post('/', investmentValidators, createInvestment);

// Item-scoped routes.
investmentsRouter.get('/:id', getInvestment);
investmentsRouter.put('/:id', investmentValidators, updateInvestment);
investmentsRouter.delete('/:id', deleteInvestment);

module.exports = investmentsRouter;
module.exports.investmentsRouter = investmentsRouter;
