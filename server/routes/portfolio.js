'use strict';

/**
 * Portfolio route definitions.
 *
 * Builds and exports an Express sub-router for the portfolio resource. The
 * aggregator in `routes/index.js` mounts it on `protectedRouter` under
 * `/portfolio`, so every endpoint defined here automatically inherits the
 * `protect` middleware (R4.1) — no per-route auth wiring required.
 *
 * Endpoints (mounted at `/api/portfolio`):
 *   - GET    /              — list the user's portfolio items (optional
 *                             `?kind=` filter).
 *   - GET    /summary       — computed invested / current-value / returns +
 *                             per-kind allocation.
 *   - POST   /              — create a portfolio item.
 *   - GET    /:id           — fetch one item.
 *   - PUT    /:id           — update an item.
 *   - DELETE /:id           — delete an item.
 *
 * IMPORTANT: `/summary` is registered before `/:id` so the literal sub-path
 * is matched first. Otherwise Express would treat the string "summary" as an
 * `id` parameter and route every summary request through `getItem`.
 *
 * The shared `portfolioValidators` chain is applied to POST and PUT; the
 * controller surfaces the first validation error as a 400 response. The
 * controllers go through the ownership helper, so cross-user id references
 * collapse to a uniform 404 (R5.3).
 */

const express = require('express');

const {
  portfolioValidators,
  createItem,
  getItems,
  getItem,
  updateItem,
  deleteItem,
  getSummary,
} = require('../controllers/portfolioController');

/**
 * Sub-router for the portfolio resource. Exported so the aggregator in
 * `routes/index.js` can mount it under `/portfolio` on the `protectedRouter`,
 * and so tests can mount it on a minimal app without the full middleware
 * pipeline.
 *
 * @type {import('express').Router}
 */
const portfolioRouter = express.Router();

// List + summary. `/summary` MUST come before `/:id` so the literal path
// wins when matching; otherwise Express captures "summary" as the id param.
portfolioRouter.get('/', getItems);
portfolioRouter.get('/summary', getSummary);

// Create + update share the same validation chain.
portfolioRouter.post('/', portfolioValidators, createItem);

// Item-scoped routes.
portfolioRouter.get('/:id', getItem);
portfolioRouter.put('/:id', portfolioValidators, updateItem);
portfolioRouter.delete('/:id', deleteItem);

module.exports = portfolioRouter;
module.exports.portfolioRouter = portfolioRouter;
