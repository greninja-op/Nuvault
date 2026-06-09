/**
 * Investment model — a user-owned holding with quantity and buy price.
 *
 * Source of truth: design.md "Data Models" → Investment.
 * Validates: Requirements 13.1, 13.2, 13.3, 13.4.
 *
 * Notes:
 *   - `symbol` powers live pricing for stock/crypto via Yahoo Finance.
 *   - `currentPrice` is the stored fallback used when live pricing is
 *     unavailable or when the type does not use live pricing (R14.6).
 *   - Per-investment P&L and totals are computed in the controller, not
 *     stored on the document.
 */
const mongoose = require('mongoose');

const INVESTMENT_TYPES = ['stock', 'crypto', 'mutual_fund', 'fd', 'other'];

const MAX_MONEY = 999999999.99;

const investmentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  type: {
    type: String,
    required: [true, 'type is required'],
    enum: {
      values: INVESTMENT_TYPES,
      message: 'type must be one of: ' + INVESTMENT_TYPES.join(', '),
    },
  },
  symbol: {
    type: String,
    trim: true,
    default: '',
  },
  name: {
    type: String,
    required: [true, 'name is required'],
    trim: true,
    minlength: [1, 'name must be 1 to 100 characters'],
    maxlength: [100, 'name must be 1 to 100 characters'],
  },
  quantity: {
    type: Number,
    required: [true, 'quantity is required'],
    validate: [
      {
        validator: (v) => Number.isFinite(v) && v > 0,
        message: 'quantity must be greater than 0',
      },
      {
        validator: (v) => Number.isFinite(v) && v <= MAX_MONEY,
        message: 'quantity must be at most 999,999,999.99',
      },
    ],
  },
  buyPrice: {
    type: Number,
    required: [true, 'buyPrice is required'],
    validate: [
      {
        validator: (v) => Number.isFinite(v) && v > 0,
        message: 'buyPrice must be greater than 0',
      },
      {
        validator: (v) => Number.isFinite(v) && v <= MAX_MONEY,
        message: 'buyPrice must be at most 999,999,999.99',
      },
    ],
  },
  currentPrice: {
    type: Number,
    default: null,
  },
  buyDate: {
    type: Date,
    default: null,
  },
  notes: {
    type: String,
    default: '',
  },
});

module.exports = mongoose.model('Investment', investmentSchema);
module.exports.INVESTMENT_TYPES = INVESTMENT_TYPES;
