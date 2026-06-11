'use strict';

/**
 * Asset routes (Task 8.1).
 *
 * Exports the Asset CRUD sub-router. The aggregator in `routes/index.js`
 * mounts it on `protectedRouter` under `/assets`, so it automatically
 * inherits the `protect` middleware applied by Task 5.3. The resulting
 * full paths are:
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

module.exports = assetsRouter;
module.exports.assetsRouter = assetsRouter;
