/**
 * Asset model — a user-owned item of monetary value.
 *
 * Source of truth: design.md "Data Models" → Asset.
 * Per-user isolation is enforced at the controller layer (Requirement 5);
 * this schema only declares the field constraints and the required
 * `user` reference.
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.8 (currency default).
 */
const mongoose = require('mongoose');

const ASSET_TYPES = [
  'cash',
  'bank',
  'stock',
  'crypto',
  'mutual_fund',
  'fd',
  'real_estate',
  'other',
];

const MAX_MONEY = 999999999.99;
const MIN_MONEY = 0.01;

const assetSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  name: {
    type: String,
    required: [true, 'name is required'],
    trim: true,
    minlength: [1, 'name must be 1 to 100 characters'],
    maxlength: [100, 'name must be 1 to 100 characters'],
  },
  type: {
    type: String,
    required: [true, 'type is required'],
    enum: {
      values: ASSET_TYPES,
      message: 'type must be one of: ' + ASSET_TYPES.join(', '),
    },
  },
  value: {
    type: Number,
    required: [true, 'value is required'],
    min: [MIN_MONEY, 'value must be between 0.01 and 999,999,999.99'],
    max: [MAX_MONEY, 'value must be between 0.01 and 999,999,999.99'],
  },
  currency: {
    type: String,
    default: 'INR',
    trim: true,
  },
  notes: {
    type: String,
    default: '',
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Asset', assetSchema);
module.exports.ASSET_TYPES = ASSET_TYPES;
