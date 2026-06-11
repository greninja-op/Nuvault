'use strict';

/**
 * Router aggregators for the Nuvault API.
 *
 * Two top-level routers are exposed so domain routers can attach without
 * touching `app.js`:
 *
 *   - {@link publicRouter}    Routes reachable without authentication.
 *                             The auth registration and login endpoints
 *                             mount under this aggregator (R4.6).
 *
 *   - {@link protectedRouter} Routes that require a valid JWT. The
 *                             `protect` middleware is applied at this
 *                             aggregator level (Task 5.3) so every domain
 *                             router under it is gated by authentication
 *                             (R4.1) — domain code never has to remember
 *                             to apply auth itself.
 *
 * Mount order matters here: `protectedRouter.use(protect)` MUST run before
 * any `protectedRouter.use(...)` that attaches a domain router. Express
 * middleware is applied in registration order, so attaching `protect`
 * first guarantees every subsequently mounted handler runs only after
 * authentication has succeeded.
 */

const express = require('express');

const protect = require('../middleware/auth');
const { publicAuthRouter, protectedAuthRouter } = require('./auth');
const liabilitiesRouter = require('./liabilities');
const investmentsRouter = require('./investments');
const portfolioRouter = require('./portfolio');
const netWorthRouter = require('./netWorth');
const goalsRouter = require('./goals');
const billsRouter = require('./bills');
const budgetsRouter = require('./budgets');
const transactionsRouter = require('./transactions');
const aiRouter = require('./ai');
const fxRouter = require('./fx');
/** @type {import('express').Router} */
const publicRouter = express.Router();

/** @type {import('express').Router} */
const protectedRouter = express.Router();

// Gate every route under `protectedRouter` with the JWT auth middleware
// before any domain router attaches. This is the single point of
// enforcement for R4.1: a feature controller mounted on `protectedRouter`
// is never reached without `req.user` being populated by `protect`.
protectedRouter.use(protect);

// Auth surface (Task 5.3):
//   - Public:    POST /api/auth/register, POST /api/auth/login (R4.6)
//   - Protected: GET  /api/auth/me                              (R3.1)
publicRouter.use('/auth', publicAuthRouter);
protectedRouter.use('/auth', protectedAuthRouter);

// Liability surface (Task 9.1) — fully protected (R7).
protectedRouter.use('/liabilities', liabilitiesRouter);

// Transaction surface (Tasks 11.1 + 11.2) — fully protected (R9, R10).
// `/summary` is registered inside the router before `/:id` so the
// literal sub-path wins matching.
protectedRouter.use('/transactions', transactionsRouter);

// Investment surface (Task 14.1) — fully protected (R13).
protectedRouter.use('/investments', investmentsRouter);

// Portfolio surface — fully protected. A single unified PortfolioItem
// resource with a `kind` discriminator; `/summary` is computed on the fly
// and never persisted.
protectedRouter.use('/portfolio', portfolioRouter);

// Budget surface (Task 12.1) — fully protected (R11). The basic CRUD
// surface is implemented here; spending computation and month/year
// defaulting come from task 12.2 (R12) by extending the controller.
protectedRouter.use('/budgets', budgetsRouter);

// Net worth surface (Task 10.3) — fully protected (R8). The result is
// computed on every request and never persisted (R8.4).
protectedRouter.use('/networth', netWorthRouter);

// Goal surface (Task 15.1) — fully protected (R15). The update endpoint
// uses additive contribution semantics, not field replacement.
protectedRouter.use('/goals', goalsRouter);

// Bill surface (Task 16.1) — fully protected (R16). The `/pay` route is
// registered as a 501 placeholder; task 16.2 swaps the handler body.
protectedRouter.use('/bills', billsRouter);

// AI advisor surface (Task 17.1) — fully protected (R18). The chat
// endpoint assembles a per-user snapshot and forwards it to Claude;
// the conversation is never persisted (R18.7) and Claude failures
// surface as a uniform 503 without exposing the API key (R18.6).
protectedRouter.use('/ai', aiRouter);

// FX rate surface — returns the base(INR)→display currency rate so the
// client can convert displayed amounts with one lookup per currency switch.
protectedRouter.use('/fx', fxRouter);

module.exports = {
  publicRouter,
  protectedRouter,
};
