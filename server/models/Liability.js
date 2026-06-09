/**
 * Liability model — a user-owned debt or obligation.
 *
 * Source of truth: design.md "Data Models" → Liability.
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4.
 */
const mongoose = require('mongoose');

const LIABILITY_TYPES = ['loan', 'credit_card', 'mortgage', 'other'];

const MAX_MONEY = 999999999.99;
const MIN_MONEY = 0.01;

const liabilitySchema = new mongoose.Schema({
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
      values: LIABILITY_TYPES,
      message: 'type must be one of: ' + LIABILITY_TYPES.join(', '),
    },
  },
  amount: {
    type: Number,
    required: [true, 'amount is required'],
    min: [MIN_MONEY, 'amount must be between 0.01 and 999,999,999.99'],
    max: [MAX_MONEY, 'amount must be between 0.01 and 999,999,999.99'],
  },
  interestRate: {
    type: Number,
    default: null,
  },
  dueDate: {
    type: Date,
    default: null,
  },
  notes: {
    type: String,
    default: '',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Liability', liabilitySchema);
module.exports.LIABILITY_TYPES = LIABILITY_TYPES;
