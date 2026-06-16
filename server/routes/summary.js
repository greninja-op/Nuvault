'use strict';

/**
 * Summary route — exposes the read-only aggregate at `/api/summary`.
 *
 * Mounted on `protectedRouter` in routes/index.js, so it inherits the
 * `protect` JWT middleware like every other domain route; no per-route auth
 * wiring is needed here.
 */

const express = require('express');
const { getSummary } = require('../controllers/summaryController');

const summaryRouter = express.Router();

summaryRouter.get('/', getSummary);

module.exports = summaryRouter;
module.exports.summaryRouter = summaryRouter;
