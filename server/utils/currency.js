'use strict';

/**
 * Currency conversion utility.
 *
 * Source of truth: design.md "Currency utility (`utils/currency.js`)" and
 * Requirement 19 (Multi-Currency Support).
 *
 * Contract (mirrors the design):
 *   - `convert(amount, from, to)` is the single entry point used by every
 *     caller that needs to display an amount in a currency different from
 *     the one it is stored in.
 *   - When `from === to` (after case-insensitive normalization), the amount
 *     is returned unchanged with NO network call (R19.2 short-circuit).
 *   - Otherwise the rate is fetched from the ExchangeRate API "pair"
 *     endpoint with a 5-second timeout. On success the converted amount is
 *     rounded to 2 decimal places (R19.2).
 *   - On timeout or failure (network error, non-2xx response, API
 *     "result: error", or missing API key), the helper signals
 *     unavailability so the caller can fall back to displaying the
 *     stored-currency amount with an "unavailable" indicator (R19.3).
 *   - The default display currency for callers is INR (R19.1, R19.4); this
 *     module does not pick a currency on its own — it simply honors the
 *     `to` parameter — but exports {@link DEFAULT_DISPLAY_CURRENCY} so
 *     callers can use it as their fallback.
 *
 * Return shape:
 *   - `{ ok: true,  amount: <number> }`                on success
 *   - `{ ok: false, reason: <string>, ...debug }`      on unavailability
 *
 * Possible `reason` values:
 *   - 'invalid_input'  → amount/currency arguments failed validation
 *   - 'no_api_key'     → EXCHANGERATE_API_KEY is missing or empty
 *   - 'timeout'        → axios request exceeded the 5s timeout
 *   - 'network_error'  → axios rejected (non-timeout) before a response
 *   - 'api_error'      → ExchangeRate API responded but did not return a rate
 *
 * The helper never throws for a "rate could not be obtained" condition; it
 * always resolves with `{ ok: false, ... }` so the caller can keep
 * computing the rest of an aggregated response (e.g. net worth) instead of
 * failing the whole request when one currency lookup is unavailable.
 *
 * Validates: Requirements 19.1, 19.2, 19.3, 19.4.
 */

const axios = require('axios');

/**
 * Default display currency when no per-user preference is selected (R19.1).
 *
 * @type {'INR'}
 */
const DEFAULT_DISPLAY_CURRENCY = 'INR';

/**
 * Maximum time, in milliseconds, allowed for one ExchangeRate API call
 * before the helper gives up and signals unavailability (R19.3).
 *
 * @type {number}
 */
const API_TIMEOUT_MS = 5000;

/**
 * Round a finite number to 2 decimal places.
 *
 * Uses standard JS `Math.round` semantics on the scaled value, with
 * sign-symmetric rounding so negative amounts round with the same magnitude
 * as their positive counterparts. This matches the rounding behavior
 * expected by R19.2 ("round the converted amount to 2 decimal places") for
 * any value an exchange rate can produce. Note that values like `1.005`
 * are not exactly representable in IEEE 754 (they are stored as
 * `1.00499999...`); this helper does not attempt to second-guess that
 * representation.
 *
 * @param {number} n
 * @returns {number}
 */
function roundTo2dp(n) {
  const sign = n < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(n) * 100)) / 100;
}

/**
 * Validate the {@link convert} arguments. Returns `null` when everything is
 * acceptable, or an `unavailability` object when something is off so the
 * caller can short-circuit without contacting the API.
 *
 * @param {unknown} amount
 * @param {unknown} from
 * @param {unknown} to
 * @returns {{ ok: false, reason: string } | null}
 */
function validateInputs(amount, from, to) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return { ok: false, reason: 'invalid_input' };
  }
  if (typeof from !== 'string' || from.trim() === '') {
    return { ok: false, reason: 'invalid_input' };
  }
  if (typeof to !== 'string' || to.trim() === '') {
    return { ok: false, reason: 'invalid_input' };
  }
  return null;
}

/**
 * Build the ExchangeRate v6 "pair" URL. Currencies are upper-cased and the
 * amount is encoded so it round-trips for negative or fractional values.
 *
 * @param {string} apiKey
 * @param {string} from
 * @param {string} to
 * @param {number} amount
 * @returns {string}
 */
function buildPairUrl(apiKey, from, to, amount) {
  const f = encodeURIComponent(from.trim().toUpperCase());
  const t = encodeURIComponent(to.trim().toUpperCase());
  const a = encodeURIComponent(String(amount));
  return `https://v6.exchangerate-api.com/v6/${encodeURIComponent(apiKey)}/pair/${f}/${t}/${a}`;
}

/**
 * Convert `amount` from currency `from` to currency `to`.
 *
 * Behavior:
 *   1. Inputs are validated; invalid inputs short-circuit to
 *      `{ ok: false, reason: 'invalid_input' }`.
 *   2. If `from` and `to` are equal (case-insensitive), the amount is
 *      returned unchanged with `{ ok: true, amount }` and no network
 *      request is made.
 *   3. The ExchangeRate API key is read from
 *      `process.env.EXCHANGERATE_API_KEY`. If absent or empty,
 *      `{ ok: false, reason: 'no_api_key' }` is returned without a
 *      network call.
 *   4. Otherwise the rate is fetched from the v6 "pair" endpoint with a
 *      5-second timeout. The converted amount is rounded to 2 decimal
 *      places before being returned.
 *   5. Timeouts, network errors, non-2xx responses, and `result: 'error'`
 *      payloads all resolve (never throw) with the corresponding
 *      unavailability signal.
 *
 * @param {number} amount        - The amount to convert; any finite number.
 * @param {string} from          - ISO 4217-style source currency code.
 * @param {string} to            - ISO 4217-style target currency code.
 * @param {object} [options]     - Optional injection seam used by tests.
 * @param {typeof axios} [options.client] - Override axios client.
 * @param {string} [options.apiKey]       - Override API key (defaults to env).
 * @param {number} [options.timeoutMs]    - Override request timeout.
 * @returns {Promise<
 *   | { ok: true, amount: number }
 *   | { ok: false, reason: 'invalid_input' | 'no_api_key' | 'timeout' | 'network_error' | 'api_error', detail?: string }
 * >}
 */
async function convert(amount, from, to, options = {}) {
  const invalid = validateInputs(amount, from, to);
  if (invalid) {
    return invalid;
  }

  const fromNorm = from.trim().toUpperCase();
  const toNorm = to.trim().toUpperCase();

  // R19 short-circuit: same currency, no network call.
  if (fromNorm === toNorm) {
    return { ok: true, amount };
  }

  const apiKey =
    options.apiKey !== undefined ? options.apiKey : process.env.EXCHANGERATE_API_KEY;
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    return { ok: false, reason: 'no_api_key' };
  }

  const client = options.client || axios;
  const timeout = typeof options.timeoutMs === 'number' ? options.timeoutMs : API_TIMEOUT_MS;
  const url = buildPairUrl(apiKey.trim(), fromNorm, toNorm, amount);

  let response;
  try {
    response = await client.get(url, { timeout });
  } catch (err) {
    // axios marks request-side timeouts with code 'ECONNABORTED'.
    const code = err && err.code;
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
      return { ok: false, reason: 'timeout' };
    }
    return {
      ok: false,
      reason: 'network_error',
      detail: err && err.message ? String(err.message) : undefined,
    };
  }

  const body = response && response.data;
  if (!body || body.result !== 'success') {
    return {
      ok: false,
      reason: 'api_error',
      detail: body && body['error-type'] ? String(body['error-type']) : undefined,
    };
  }

  // Prefer the API's pre-multiplied conversion_result; fall back to
  // computing it locally if only the rate is present. Both paths round to
  // 2 decimal places per R19.2.
  let converted;
  if (typeof body.conversion_result === 'number' && Number.isFinite(body.conversion_result)) {
    converted = body.conversion_result;
  } else if (typeof body.conversion_rate === 'number' && Number.isFinite(body.conversion_rate)) {
    converted = body.conversion_rate * amount;
  } else {
    return { ok: false, reason: 'api_error', detail: 'missing_rate' };
  }

  return { ok: true, amount: roundTo2dp(converted) };
}

module.exports = {
  convert,
  DEFAULT_DISPLAY_CURRENCY,
  API_TIMEOUT_MS,
  // Exposed for unit tests / advanced callers.
  roundTo2dp,
};
