'use strict';

/**
 * AI route definitions (Task 17.1).
 *
 * Builds and exports an Express sub-router for the AI advisor surface.
 * The aggregator in `routes/index.js` mounts it on `protectedRouter`
 * under `/ai`, so every endpoint defined here automatically inherits
 * the `protect` middleware (R4.1) — no per-route auth wiring required.
 *
 * Endpoints (mounted at `/api/ai`):
 *   - POST   /chat    — assemble the user's rich financial snapshot, send it
 *                       to Gemini with the user's message and recent
 *                       conversation turns, persist the exchange, and return
 *                       `{ reply }`.
 *   - GET    /history — return the user's recent conversation turns.
 *   - DELETE /history — clear the user's conversation history.
 *
 * The shared `chatValidators` chain is applied to POST /chat; the
 * controller surfaces the first validation error as a uniform 400
 * response.
 */

const express = require('express');

const {
  chat,
  chatValidators,
  getHistory,
  clearHistory,
} = require('../controllers/aiController');

/**
 * Sub-router for the AI advisor resource. Exported so the aggregator
 * in `routes/index.js` can mount it under `/ai` on the
 * `protectedRouter`, and so tests can mount it on a minimal app
 * without going through the full middleware pipeline.
 *
 * @type {import('express').Router}
 */
const aiRouter = express.Router();

aiRouter.post('/chat', chatValidators, chat);
aiRouter.get('/history', getHistory);
aiRouter.delete('/history', clearHistory);

module.exports = aiRouter;
module.exports.aiRouter = aiRouter;
