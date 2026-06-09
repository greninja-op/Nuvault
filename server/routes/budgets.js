'use strict';

/**
 * Budget route definitions (Task 12.1).
 *
 * Builds and exports an Express sub-router for the budget resource.
 * The aggregator in `routes/index.js` mounts it on `protectedRouter`
 * under `/budgets`, so every endpoint defined here automatically
 * inherits the `protect` middleware (R4.1) — no per-route auth wiring
 * required.
 *
 * Endpoints (mounted at `/api/budgets`):
 *   - GET    /              — list the user's budgets (R5.1, R5.4).
 *                             Spending computation and month/year
 *                             defaulting belong to task 12.2 (R12).
 *   - POST   /              — create a budget (R11.1–R11.5).
 *   - GET    /:id           — fetch one budget (R5.3, R11.8).
 *   - PUT    /:id           — update a budget (R11.3–R11.6, R11.8).
 *   - DELETE /:id           — delete a budget (R11.7, R11.8).
 *
 * The shared `budgetValidators` chain is applied to POST and PUT;
 * the controller surfaces the first validation error as a 400 response
 * and translates duplicate-period collisions to 409 (R11.5). The
 * controllers themselves go through the ownership helper, so
 * cross-user id references collapse to a uniform 404 (R5.3).
 */

const express = require('express');

const {
  budgetValidators,
  createBudget,
  getBudgets,
  getBudget,
  updateBudget,
  deleteBudget,
} = require('../controllers/budgetController');

/**
 * Sub-router for the budget resource. Exported so the aggregator in
 * `routes/index.js` can mount it under `/budgets` on the
 * `protectedRouter`, and so tests can mount it on a minimal app
 * without going through the full middleware pipeline.
 *
 * @type {import('express').Router}
 */
const budgetsRouter = express.Router();

// List + fetch (no validators — id correctness is handled by the
// ownership helper, which collapses malformed / cross-user / missing
// ids to 404).
budgetsRouter.get('/', getBudgets);

// Create + update share the same validation chain (R11.1–R11.4) and
// duplicate-period detection (R11.5) lives in the controller.
budgetsRouter.post('/', budgetValidators, createBudget);

// Item-scoped routes.
budgetsRouter.get('/:id', getBudget);
budgetsRouter.put('/:id', budgetValidators, updateBudget);
budgetsRouter.delete('/:id', deleteBudget);

module.exports = budgetsRouter;
module.exports.budgetsRouter = budgetsRouter;
