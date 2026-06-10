/**
 * PortfolioItem model — a unified, user-owned portfolio holding.
 *
 * A single collection (`portfolioitems`) stores every kind of holding the
 * portfolio feature tracks. The `kind` discriminator selects which optional
 * fields are meaningful for a given document, so the database shows one tidy
 * collection instead of eight near-identical ones.
 *
 * Source of truth: the portfolio feature spec.
 *
 * Notes:
 *   - Only `user`, `kind`, and `name` are required; every other field is
 *     optional and defaults sensibly so a caller supplies only the fields
 *     relevant to the chosen `kind`.
 *   - Money / numeric fields are validated as finite and >= 0 when present;
 *     monetary fields are additionally capped at MAX_MONEY. They stay `null`
 *     by default so "absent" is distinguishable from "zero".
 *   - Per-item invested / current-value and the summary totals are computed
 *     in the controller, never stored on the document.
 */
const mongoose = require('mongoose');

const PORTFOLIO_KINDS = [
  'fd',
  'bank',
  'mutual_fund',
  'stock',
  'crypto',
  'ppf_epf',
  'real_estate',
  'gold',
];

const COMPOUNDING_VALUES = ['monthly', 'quarterly', 'yearly'];

const MAX_MONEY = 999999999.99;

/**
 * Reusable validator set for an optional money field: when a value is
 * present (not null/undefined) it must be a finite number in [0, MAX_MONEY].
 *
 * @param {string} label
 * @returns {Array<{ validator: Function, message: string }>}
 */
function optionalMoneyValidators(label) {
  return [
    {
      validator: (v) => v === null || v === undefined || (Number.isFinite(v) && v >= 0),
      message: `${label} must be a finite number >= 0`,
    },
    {
      validator: (v) => v === null || v === undefined || (Number.isFinite(v) && v <= MAX_MONEY),
      message: `${label} must be at most 999,999,999.99`,
    },
  ];
}

/**
 * Reusable validator for an optional non-negative finite number that is not
 * a monetary amount (e.g. units, interestRate, tenureMonths) — finite and
 * >= 0 when set.
 *
 * @param {string} label
 * @returns {Array<{ validator: Function, message: string }>}
 */
function optionalNonNegativeValidators(label) {
  return [
    {
      validator: (v) => v === null || v === undefined || (Number.isFinite(v) && v >= 0),
      message: `${label} must be a finite number >= 0`,
    },
  ];
}

const portfolioItemSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  kind: {
    type: String,
    required: [true, 'kind is required'],
    enum: {
      values: PORTFOLIO_KINDS,
      message: 'kind must be one of: ' + PORTFOLIO_KINDS.join(', '),
    },
  },
  name: {
    type: String,
    required: [true, 'name is required'],
    trim: true,
    minlength: [1, 'name must be 1 to 100 characters'],
    maxlength: [100, 'name must be 1 to 100 characters'],
  },

  // --- fd, ppf_epf, real_estate (purchase value) ---
  principal: {
    type: Number,
    default: null,
    validate: optionalMoneyValidators('principal'),
  },

  // --- bank, ppf_epf (corpus) ---
  currentBalance: {
    type: Number,
    default: null,
    validate: optionalMoneyValidators('currentBalance'),
  },

  // --- fd, ppf_epf ---
  interestRate: {
    type: Number,
    default: null,
    validate: optionalNonNegativeValidators('interestRate'),
  },

  // --- fd ---
  compounding: {
    type: String,
    enum: {
      values: COMPOUNDING_VALUES,
      message: 'compounding must be one of: ' + COMPOUNDING_VALUES.join(', '),
    },
    default: 'yearly',
  },
  startDate: {
    type: Date,
    default: null,
  },
  maturityDate: {
    type: Date,
    default: null,
  },
  tenureMonths: {
    type: Number,
    default: null,
    validate: optionalNonNegativeValidators('tenureMonths'),
  },

  // --- mutual_fund, stock, crypto, gold ---
  units: {
    type: Number,
    default: null,
    validate: optionalNonNegativeValidators('units'),
  },
  buyPrice: {
    type: Number,
    default: null,
    validate: optionalMoneyValidators('buyPrice'),
  },
  currentPrice: {
    type: Number,
    default: null,
    validate: optionalMoneyValidators('currentPrice'),
  },

  // --- fd (maturity), real_estate (current est.), ppf_epf ---
  currentValue: {
    type: Number,
    default: null,
    validate: optionalMoneyValidators('currentValue'),
  },

  // --- ppf_epf ---
  yearlyContribution: {
    type: Number,
    default: null,
    validate: optionalMoneyValidators('yearlyContribution'),
  },

  // --- stock, crypto ---
  symbol: {
    type: String,
    trim: true,
    default: '',
  },

  // --- bank, ppf_epf ---
  accountType: {
    type: String,
    default: '',
  },

  notes: {
    type: String,
    default: '',
  },
});

module.exports = mongoose.model('PortfolioItem', portfolioItemSchema);
module.exports.PORTFOLIO_KINDS = PORTFOLIO_KINDS;
module.exports.COMPOUNDING_VALUES = COMPOUNDING_VALUES;
module.exports.MAX_MONEY = MAX_MONEY;
