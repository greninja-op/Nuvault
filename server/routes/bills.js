'use strict';

/**
 * Bill route definitions (Task 16.1).
 *
 * Builds and exports an Express sub-router for the bill resource.
 * The aggregator in `routes/index.js` mounts it on `protectedRouter`
 * under `/bills`, so every endpoint defined here automatically inherits
 * the `protect` middleware (R4.1) — no per-route auth wiring required.
 *
 * Endpoints (mounted at `/api/bills`):
 *   - GET    /              — list the user's bills (R5.1, R5.4).
 *   - POST   /              — create a bill (R16.1–R16.4).
 *   - GET    /:id           — fetch one bill (R5.3, R16.7).
 *   - PUT    /:id           — update a bill (R16.3–R16.5, R16.7).
 *   - DELETE /:id           — delete a bill (R16.6, R16.7).
 *   - PATCH  /:id/pay       — placeholder for payment + advancement (16.2).
 *
 * IMPORTANT: `/:id/pay` is a multi-segment path that does not collide
 * with `/:id`, so registration order is unconstrained for these two.
 * The placeholder is registered here so task 16.2 only has to swap the
 * controller body — no further router edits required.
 *
 * The shared `billValidators` chain is applied to POST and PUT; the
 * controller surfaces the first validation error as a 400 response.
 * The controllers themselves go through the ownership helper, so
 * cross-user id references collapse to a uniform 404 (R5.3).
 */

const express = require('express');

const {
  billValidators,
  createBill,
  getBills,
  getBill,
  updateBill,
  deleteBill,
  payBill,
} = require('../controllers/billController');

/**
 * Sub-router for the bill resource. Exported so the aggregator in
 * `routes/index.js` can mount it under `/bills` on the
 * `protectedRouter`, and so tests can mount it on a minimal app
 * without going through the full middleware pipeline.
 *
 * @type {import('express').Router}
 */
const billsRouter = express.Router();

// Collection-scoped routes.
billsRouter.get('/', getBills);

// Create + update share the same validation chain (R16.1–R16.4).
billsRouter.post('/', billValidators, createBill);

// Item-scoped routes.
billsRouter.get('/:id', getBill);
billsRouter.put('/:id', billValidators, updateBill);
billsRouter.delete('/:id', deleteBill);

// Payment + due-date advancement (Task 16.2). Registered as a 501
// placeholder for now so the route is reserved without pretending to
// implement R17.
billsRouter.patch('/:id/pay', payBill);

module.exports = billsRouter;
module.exports.billsRouter = billsRouter;
