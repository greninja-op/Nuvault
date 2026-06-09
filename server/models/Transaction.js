/**
 * Transaction model — an income or expense entry belonging to a user.
 *
 * Source of truth: design.md "Data Models" → Transaction.
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5 (date default).
 *
 * Notes:
 *   - amount must be > 0, ≤ 999,999,999.99, with at most 2 decimal places.
 *   - When `date` is omitted at creation, Mongoose applies the default of
 *     creation time (Requirement 9.5).
 */
const mongoose = require('mongoose');

const TRANSACTION_TYPES = ['income', 'expense'];

const MAX_MONEY = 999999999.99;

/** Returns true when `v` is a finite number with at most 2 decimal places. */
function hasAtMostTwoDecimalPlaces(v) {
  if (!Number.isFinite(v)) return false;
  // Compare the value against its 2-dp string round-trip; handles common
  // floating-point inputs such as 1.23 (true), 1.235 (false), 1.00 (true).
  return Number(v.toFixed(2)) === v;
}

const transactionSchema = new mongoose.Schema({
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
      values: TRANSACTION_TYPES,
      message: 'type must be one of: ' + TRANSACTION_TYPES.join(', '),
    },
  },
  category: {
    type: String,
    required: [true, 'category is required'],
    trim: true,
    minlength: [1, 'category must be 1 to 100 characters'],
    maxlength: [100, 'category must be 1 to 100 characters'],
  },
  amount: {
    type: Number,
    required: [true, 'amount is required'],
    validate: [
      {
        validator: (v) => Number.isFinite(v) && v > 0,
        message: 'amount must be greater than 0',
      },
      {
        validator: (v) => Number.isFinite(v) && v <= MAX_MONEY,
        message: 'amount must be at most 999,999,999.99',
      },
      {
        validator: hasAtMostTwoDecimalPlaces,
        message: 'amount must have at most 2 decimal places',
      },
    ],
  },
  description: {
    type: String,
    default: '',
  },
  date: {
    type: Date,
    default: Date.now,
  },
  tags: {
    type: [String],
    default: [],
  },
});

module.exports = mongoose.model('Transaction', transactionSchema);
module.exports.TRANSACTION_TYPES = TRANSACTION_TYPES;
