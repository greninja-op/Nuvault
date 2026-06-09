/**
 * Budget model — a per-category spending limit scoped to a month and year.
 *
 * Source of truth: design.md "Data Models" → Budget.
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5 (compound unique index).
 *
 * Notes:
 *   - The `spent` value is **not** stored; it is computed per request from
 *     the user's matching expense transactions (Requirement 12.6).
 *   - The compound unique index on `(user, category, month, year)` enforces
 *     one budget per category/period per user (Requirement 11.5).
 */
const mongoose = require('mongoose');

const MAX_MONEY = 999999999.99;

const budgetSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  category: {
    type: String,
    required: [true, 'category is required'],
    trim: true,
    minlength: [1, 'category must be 1 to 100 characters'],
    maxlength: [100, 'category must be 1 to 100 characters'],
  },
  limit: {
    type: Number,
    required: [true, 'limit is required'],
    validate: [
      {
        validator: (v) => Number.isFinite(v) && v > 0,
        message: 'limit must be greater than 0',
      },
      {
        validator: (v) => Number.isFinite(v) && v <= MAX_MONEY,
        message: 'limit must be at most 999,999,999.99',
      },
    ],
  },
  month: {
    type: Number,
    required: [true, 'month is required'],
    min: [1, 'month must be between 1 and 12'],
    max: [12, 'month must be between 1 and 12'],
    validate: {
      validator: Number.isInteger,
      message: 'month must be an integer',
    },
  },
  year: {
    type: Number,
    required: [true, 'year is required'],
    min: [1970, 'year must be between 1970 and 2100'],
    max: [2100, 'year must be between 1970 and 2100'],
    validate: {
      validator: Number.isInteger,
      message: 'year must be an integer',
    },
  },
});

// Enforces R11.5: one budget per (user, category, month, year).
budgetSchema.index(
  { user: 1, category: 1, month: 1, year: 1 },
  { unique: true, name: 'user_category_month_year_unique' },
);

module.exports = mongoose.model('Budget', budgetSchema);
