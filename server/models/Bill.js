/**
 * Bill model — a recurring or one-time payment obligation.
 *
 * Source of truth: design.md "Data Models" → Bill.
 * Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.8 (autoPay default false).
 *
 * Notes:
 *   - `amount` must be > 0, ≤ 999,999,999.99, with at most 2 decimal places.
 *   - `nextDueDate` must be a valid calendar date; Mongoose's Date casting
 *     rejects unparseable inputs, and the validator below guards against
 *     invalid Date instances reaching the database.
 *   - Payment-driven advancement of `nextDueDate` is performed in the
 *     controller (Requirement 17), not in the schema.
 */
const mongoose = require('mongoose');

const BILL_FREQUENCIES = ['monthly', 'weekly', 'yearly', 'one-time'];

const MAX_MONEY = 999999999.99;

/** Returns true when `v` is a finite number with at most 2 decimal places. */
function hasAtMostTwoDecimalPlaces(v) {
  if (!Number.isFinite(v)) return false;
  return Number(v.toFixed(2)) === v;
}

/** Returns true when `v` is a Date instance representing a real moment. */
function isValidCalendarDate(v) {
  return v instanceof Date && !Number.isNaN(v.valueOf());
}

const billSchema = new mongoose.Schema({
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
  frequency: {
    type: String,
    required: [true, 'frequency is required'],
    enum: {
      values: BILL_FREQUENCIES,
      message: 'frequency must be one of: ' + BILL_FREQUENCIES.join(', '),
    },
  },
  nextDueDate: {
    type: Date,
    required: [true, 'nextDueDate is required'],
    validate: {
      validator: isValidCalendarDate,
      message: 'nextDueDate must be a valid calendar date',
    },
  },
  category: {
    type: String,
    default: '',
    trim: true,
  },
  isPaid: {
    type: Boolean,
    default: false,
  },
  autoPay: {
    type: Boolean,
    default: false,
  },
});

module.exports = mongoose.model('Bill', billSchema);
module.exports.BILL_FREQUENCIES = BILL_FREQUENCIES;
