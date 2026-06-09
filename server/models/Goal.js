/**
 * Goal model — a savings target with target amount and accumulating saved
 * amount.
 *
 * Source of truth: design.md "Data Models" → Goal.
 * Validates: Requirements 15.1 (savedAmount default 0), 15.2, 15.3.
 *
 * Notes:
 *   - `progress = min(savedAmount / targetAmount, 1)` is computed in the
 *     controller, not stored.
 */
const mongoose = require('mongoose');

const MAX_MONEY = 999999999.99;
const MIN_MONEY = 0.01;

const goalSchema = new mongoose.Schema({
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
  targetAmount: {
    type: Number,
    required: [true, 'targetAmount is required'],
    min: [MIN_MONEY, 'targetAmount must be between 0.01 and 999,999,999.99'],
    max: [MAX_MONEY, 'targetAmount must be between 0.01 and 999,999,999.99'],
  },
  savedAmount: {
    type: Number,
    default: 0,
    min: [0, 'savedAmount must be greater than or equal to 0'],
  },
  targetDate: {
    type: Date,
    default: null,
  },
  category: {
    type: String,
    default: '',
    trim: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Goal', goalSchema);
