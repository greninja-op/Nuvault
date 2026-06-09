'use strict';

/**
 * Asset routes (Task 8.1).
 *
 * Mounts the Asset CRUD endpoints under the shared `protectedRouter` so
 * they automatically inherit the `protect` middleware applied by Task
 * 5.3. Importing this module is the only side effect needed to wire
 * the routes — `app.js` already mounts `protectedRouter` at `/api`, so
 * the resulting full paths are:
 *
 *   GET    /api/assets       → getAssets
 *   POST   /api/assets       → createAsset      (assetValidators)
 *   GET    /api/assets/:id   → getAsset
 *   PUT    /api/assets/:id   → updateAsset      (assetValidators)
 *   DELETE /api/assets/:id   → deleteAsset
 *
 * The router is also exported by name (`assetsRouter`) so tests and
 * other call sites can mount it directly on a minimal Express app
 * without dragging in the full middleware stack — the integration
 * test for this controller uses that path.
 *
 * Validates: Requirements 6.1, 6.5, 6.6, 6.7
 */

const express = require('express');

const { protectedRouter } = require('./index');
const {
  createAsset,
  getAssets,
  getAsset,
  updateAsset,
  deleteAsset,
  assetValidators,
} = require('../controllers/assetController');

/** @type {import('express').Router} */
const assetsRouter = express.Router();

assetsRouter
  .route('/')
  .get(getAssets)
  .post(assetValidators, createAsset);

assetsRouter
  .route('/:id')
  .get(getAsset)
  .put(assetValidators, updateAsset)
  .delete(deleteAsset);

// Mount under the protected aggregator so authentication is enforced
// uniformly via the `protect` middleware wired by Task 5.3 (R4.1).
protectedRouter.use('/assets', assetsRouter);

module.exports = assetsRouter;
module.exports.assetsRouter = assetsRouter;
