'use strict';

/**
 * FX route — exposes the base→display currency rate for the client.
 * Mounted under `protectedRouter` at `/fx`, so it inherits JWT auth.
 */

const express = require('express');
const { getRate } = require('../controllers/fxController');

const fxRouter = express.Router();

fxRouter.get('/rate', getRate);

module.exports = fxRouter;
module.exports.fxRouter = fxRouter;
