'use strict';

/**
 * Transaction routes (Tasks 11.1 + 11.2).
 *
 * Mounts the Transaction CRUD endpoints on the shared `protectedRouter`
 * so every route here is gated by the auth middleware (R4.1) once task
 * 5.3 attaches `protect`. The mount path is `/transactions`, which
 * combined with the `/api` mount of `protectedRouter` in `app.js`
 * produces the design's URLs:
 *
 *   GET    /api/transactions          — list (sorted by date desc;
 *                                       optional ?month=&year= filter)
 *   GET    /api/transactions/summary  — income/expense totals grouped
 *                                       by category (same optional
 *                                       ?month=&year= filter)
 *   POST   /api/transactions          — create
 *   GET    /api/transactions/:id      — read one
 *   PUT    /api/transactions/:id      — update
 *   DELETE /api/transactions/:id      — delete
 *
 * IMPORTANT: `/summary` is registered before `/:id` so that the literal
 * sub-path is matched first. Otherwise Express would treat the string
 * "summary" as an `id` parameter and route every summary request
 * through `getTransaction` instead. (Same pattern is used by
 * `routes/investments.js`.)
 *
 * The router is exported and mounted on `protectedRouter` from
 * `routes/index.js` (matching the pattern used by every other domain
 * router). It does not self-mount.
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8,
 *            10.1, 10.2, 10.3, 10.4, 10.5.
 */

const express = require('express');

const {
  createTransaction,
  getTransactions,
  getTransaction,
  updateTransaction,
  deleteTransaction,
  getSummary,
  transactionValidators,
} = require('../controllers/transactionController');

/** @type {import('express').Router} */
const transactionsRouter = express.Router();

// Collection-scoped routes. Both the list and the summary share the
// same optional ?month=&year= filter, so they share the same validator
// chain (R10.2, R10.3).
transactionsRouter.get('/', transactionValidators.list, getTransactions);

// `/summary` MUST come before `/:id` so the literal path wins when
// matching; otherwise Express captures "summary" as the id parameter.
transactionsRouter.get('/summary', transactionValidators.list, getSummary);

transactionsRouter.post('/', transactionValidators.create, createTransaction);

// Item-scoped routes.
transactionsRouter.get('/:id', getTransaction);
transactionsRouter.put('/:id', transactionValidators.update, updateTransaction);
transactionsRouter.delete('/:id', deleteTransaction);

// Export the router so `routes/index.js` can mount it on
// `protectedRouter` under `/transactions`, matching how every other
// domain router (assets, liabilities, investments, budgets, goals,
// bills, networth) is wired. Avoiding self-mount also avoids the
// circular `require('./index')` that would otherwise yield partial
// exports during module initialization.
module.exports = transactionsRouter;
module.exports.transactionsRouter = transactionsRouter;
