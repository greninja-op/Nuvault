'use strict';

/**
 * Net_Worth_Service controller (Task 10.3).
 *
 * Implements the read-only net worth endpoint described in the design's
 * "Net_Worth_Service" section and Requirement 8. The result is computed
 * on every request from the authenticated user's stored Asset and
 * Liability records and is never persisted (R8.4) — keeping the derived
 * value in lockstep with its source data.
 *
 * Algorithm:
 *
 *   1. Pick a display currency for the response, in this order:
 *      a) `?currency=<code>` query parameter (case-insensitive),
 *      b) `req.user.currency` (the user's saved preference),
 *      c) `INR` — the global default per R19.1.
 *
 *   2. Load the user's Assets and Liabilities through the shared
 *      ownership helper so per-user isolation (R5) is enforced
 *      uniformly. An empty asset or liability set is treated as a sum of
 *      0 — both empty therefore yields a net worth of 0 with empty
 *      lists (R8.5).
 *
 *   3. For every asset and liability whose stored currency differs from
 *      the display currency, call the Currency util's `convert()` to
 *      obtain the amount in the display currency (R8.6, R19.2). On
 *      `{ ok: false, ... }` (timeout, network error, missing API key,
 *      etc.) the helper signals unavailability; this controller then
 *      falls back to the stored-currency amount unchanged (R19.3) and
 *      attaches a `conversionUnavailable: true` flag so the client can
 *      surface the "conversion unavailable" indicator described in the
 *      design's "External Integration Degradation" section.
 *
 *   4. Sum each side, then compute
 *
 *        netWorth = totalAssets − totalLiabilities
 *
 *      rounded to 2 decimal places (R8.1). Because empty sets sum to 0,
 *      the formula naturally produces 0 when there are no records and a
 *      negative value when liabilities exceed assets (R8.2).
 *
 *   5. Return both lists and both totals (R8.3) along with the chosen
 *      `displayCurrency`. Nothing is written to MongoDB (R8.4).
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.5, 8.6 (and 19.1, 19.2, 19.3
 * indirectly via the Currency util).
 */

const Asset = require('../models/Asset');
const Liability = require('../models/Liability');
const { scopedFind } = require('../utils/ownership');
const {
  convert,
  DEFAULT_DISPLAY_CURRENCY,
  roundTo2dp,
} = require('../utils/currency');

/**
 * Default currency assumed when an asset or liability has no `currency`
 * field stored. The Asset schema defaults its `currency` to `INR`, and
 * the Liability schema does not declare a `currency` field at all, so
 * this constant covers both "field omitted" cases uniformly.
 *
 * @type {'INR'}
 */
const ASSUMED_RECORD_CURRENCY = DEFAULT_DISPLAY_CURRENCY;

/**
 * Resolve the display currency for a net worth response.
 *
 * Order of precedence (R19.1, R19.4):
 *   1. `?currency=<code>` query parameter — lets the client request a
 *      one-off override without touching their saved preference.
 *   2. The authenticated user's stored `currency` field.
 *   3. The global default `INR`.
 *
 * The chosen value is always uppercased and trimmed so callers compare
 * canonical codes (e.g. `usd` and `USD` are equivalent).
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function resolveDisplayCurrency(req) {
  const fromQuery = req && req.query ? req.query.currency : undefined;
  if (typeof fromQuery === 'string' && fromQuery.trim() !== '') {
    return fromQuery.trim().toUpperCase();
  }

  const fromUser = req && req.user ? req.user.currency : undefined;
  if (typeof fromUser === 'string' && fromUser.trim() !== '') {
    return fromUser.trim().toUpperCase();
  }

  return DEFAULT_DISPLAY_CURRENCY;
}

/**
 * Read the source-currency code from a stored record, defaulting to the
 * assumed record currency when the field is missing or non-string. This
 * keeps the controller robust to legacy data and to schemas (like
 * Liability) that do not declare a `currency` field at all.
 *
 * @param {{ currency?: unknown }} record
 * @returns {string}
 */
function readRecordCurrency(record) {
  const raw = record && record.currency;
  if (typeof raw === 'string' && raw.trim() !== '') {
    return raw.trim().toUpperCase();
  }
  return ASSUMED_RECORD_CURRENCY;
}

/**
 * Convert a single record's amount to `displayCurrency`, returning the
 * converted (rounded) amount along with metadata about whether the
 * conversion succeeded.
 *
 * On `{ ok: false }` from the Currency util (R19.3), the stored amount
 * is returned unchanged and `conversionUnavailable: true` is set so the
 * client can render the indicator described in the design while the
 * total still includes the record (sum continues, individual record is
 * displayed in its stored currency).
 *
 * @param {number} amount
 * @param {string} fromCurrency
 * @param {string} displayCurrency
 * @returns {Promise<{ amount: number, conversionUnavailable: boolean, sourceCurrency: string }>}
 */
async function convertOrFallback(amount, fromCurrency, displayCurrency) {
  const result = await convert(amount, fromCurrency, displayCurrency);
  if (result && result.ok === true) {
    return {
      amount: roundTo2dp(result.amount),
      conversionUnavailable: false,
      sourceCurrency: fromCurrency,
    };
  }
  return {
    amount: roundTo2dp(amount),
    conversionUnavailable: true,
    sourceCurrency: fromCurrency,
  };
}

/**
 * Project a stored Asset document into the response shape, replacing
 * `value` with the display-currency amount and annotating the original
 * stored currency / unavailability flag for the client.
 *
 * @param {import('mongoose').Document} doc
 * @param {{ amount: number, conversionUnavailable: boolean, sourceCurrency: string }} converted
 * @param {string} displayCurrency
 * @returns {object}
 */
function toAssetResponse(doc, converted, displayCurrency) {
  const obj = doc.toObject({ versionKey: false });
  return {
    ...obj,
    value: converted.amount,
    currency: displayCurrency,
    sourceCurrency: converted.sourceCurrency,
    conversionUnavailable: converted.conversionUnavailable,
  };
}

/**
 * Project a stored Liability document into the response shape, replacing
 * `amount` with the display-currency amount.
 *
 * @param {import('mongoose').Document} doc
 * @param {{ amount: number, conversionUnavailable: boolean, sourceCurrency: string }} converted
 * @param {string} displayCurrency
 * @returns {object}
 */
function toLiabilityResponse(doc, converted, displayCurrency) {
  const obj = doc.toObject({ versionKey: false });
  return {
    ...obj,
    amount: converted.amount,
    currency: displayCurrency,
    sourceCurrency: converted.sourceCurrency,
    conversionUnavailable: converted.conversionUnavailable,
  };
}

/**
 * `GET /networth` handler.
 *
 * Computes net worth from the authenticated user's assets and
 * liabilities and returns it together with both lists and both totals.
 * The result is never persisted (R8.4); each request recomputes from
 * the live source records.
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.5, 8.6
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function getNetWorth(req, res, next) {
  try {
    const displayCurrency = resolveDisplayCurrency(req);

    // Per-user isolation (R5.1, R5.4) is delegated to the shared helper:
    // the persisted `user` field is compared against `req.user._id`, so
    // records owned by another user are excluded by construction.
    const [assetDocs, liabilityDocs] = await Promise.all([
      scopedFind(Asset, req).sort({ updatedAt: -1 }),
      scopedFind(Liability, req).sort({ createdAt: -1 }),
    ]);

    const assets = await Promise.all(
      assetDocs.map(async (doc) => {
        const converted = await convertOrFallback(
          doc.value,
          readRecordCurrency(doc),
          displayCurrency
        );
        return toAssetResponse(doc, converted, displayCurrency);
      })
    );

    const liabilities = await Promise.all(
      liabilityDocs.map(async (doc) => {
        const converted = await convertOrFallback(
          doc.amount,
          readRecordCurrency(doc),
          displayCurrency
        );
        return toLiabilityResponse(doc, converted, displayCurrency);
      })
    );

    // Empty arrays naturally yield 0 from `reduce(..., 0)` (R8.5). All
    // monetary values are rounded to 2 dp before being returned (R8.1).
    const totalAssets = roundTo2dp(
      assets.reduce((sum, a) => sum + a.value, 0)
    );
    const totalLiabilities = roundTo2dp(
      liabilities.reduce((sum, l) => sum + l.amount, 0)
    );
    const netWorth = roundTo2dp(totalAssets - totalLiabilities);

    res.status(200).json({
      assets,
      liabilities,
      totalAssets,
      totalLiabilities,
      netWorth,
      displayCurrency,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getNetWorth,
  // Re-exported for unit tests / advanced callers.
  resolveDisplayCurrency,
  readRecordCurrency,
  convertOrFallback,
  ASSUMED_RECORD_CURRENCY,
};
