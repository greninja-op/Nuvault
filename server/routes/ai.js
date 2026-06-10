'use strict';

/**
 * AI route definitions (Task 17.1).
 *
 * Builds and exports an Express sub-router for the AI advisor surface.
 * The aggregator in `routes/index.js` mounts it on `protectedRouter`
 * under `/ai`, so every endpoint defined here automatically inherits
 * the `protect` middleware (R4.1) — no per-route auth wiring required.
 *
 * Endpoint (mounted at `/api/ai`):
 *   - POST /chat — assemble the user's financial snapshot, send it to
 *                  Claude with the user's message, return `{ reply }`.
 *                  Validation, ownership, snapshot composition, and
 *                  the failure → uniform 503 path all live in the
 *                  controller. (R18.1–R18.7)
 *
 * The shared `chatValidators` chain is applied to POST /chat; the
 * controller surfaces the first validation error as a uniform 400
 * response. The conversation is never persisted (R18.7).
 */

const express = require('express');

const { chat, chatValidators } = require('../controllers/aiController');

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

module.exports = aiRouter;
module.exports.aiRouter = aiRouter;
