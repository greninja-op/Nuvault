'use strict';

/**
 * Goal route definitions (Task 15.1).
 *
 * Builds and exports an Express sub-router for the goal resource. The
 * aggregator in `routes/index.js` mounts it on `protectedRouter` under
 * `/goals`, so every endpoint defined here automatically inherits the
 * `protect` middleware (R4.1) — no per-route auth wiring required.
 *
 * Endpoints (mounted at `/api/goals`):
 *   - GET    /              — list the user's goals with progress (R15.6).
 *   - GET    /:id           — fetch one goal with progress (R5.3).
 *   - POST   /              — create a goal (R15.1, R15.2, R15.3).
 *   - PUT    /:id           — additive contribution: adds `amount` to
 *                             the goal's `savedAmount` (R15.4, R15.5).
 *                             NOT a field-replacement update — see the
 *                             goalController docstring for the full
 *                             semantics.
 *   - DELETE /:id           — delete a goal (R15.7).
 *
 * Two distinct validator chains are used because create and update have
 * different shapes:
 *   - `createGoalValidators` validates `name` + `targetAmount`.
 *   - `updateGoalValidators` validates `amount` (the contribution).
 *
 * The controllers themselves go through the ownership helper, so
 * cross-user / missing / malformed-id references collapse to a uniform
 * 404 (R5.3).
 */

const express = require('express');

const {
  createGoalValidators,
  updateGoalValidators,
  createGoal,
  getGoals,
  getGoal,
  updateGoal,
  deleteGoal,
} = require('../controllers/goalController');

/**
 * Sub-router for the goal resource. Exported so the aggregator in
 * `routes/index.js` can mount it under `/goals` on the
 * `protectedRouter`, and so tests can mount it on a minimal app
 * without going through the full middleware pipeline.
 *
 * @type {import('express').Router}
 */
const goalsRouter = express.Router();

// Collection-scoped routes.
goalsRouter.get('/', getGoals);
goalsRouter.post('/', createGoalValidators, createGoal);

// Item-scoped routes. Note that PUT uses the *update* validator chain
// (which validates a single `amount` field) — not the create chain.
goalsRouter.get('/:id', getGoal);
goalsRouter.put('/:id', updateGoalValidators, updateGoal);
goalsRouter.delete('/:id', deleteGoal);

module.exports = goalsRouter;
module.exports.goalsRouter = goalsRouter;
