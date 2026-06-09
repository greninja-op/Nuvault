'use strict';

/**
 * Yahoo Finance live-price utility.
 *
 * Source of truth: design.md "Investment_Service" → live pricing, and
 * Requirement 14 (Investment Pricing and Profit/Loss Summary).
 *
 * Contract (mirrors the design):
 *   - `fetchPrice(symbol)` is the single entry point used by the
 *     investment summary controller to retrieve a current market price
 *     for a `stock` or `crypto` holding (R14.1).
 *   - The call MUST complete within 10 seconds; anything longer is
 *     treated as unavailability so the caller can fall back to the
 *     stored `currentPrice` (R14.6) instead of stalling the summary
 *     response.
 *   - Network errors, non-2xx responses, missing/malformed payloads,
 *     and the API explicitly returning no quote ALL collapse to
 *     `{ ok: false }` so the caller has a single, uniform unavailability
 *     signal to react to. The helper NEVER throws for an "unavailable"
 *     condition.
 *   - On success the function resolves to `{ ok: true, price: <number> }`
 *     where `price` is a finite, strictly positive number — Yahoo's
 *     `regularMarketPrice` from the chart endpoint's meta block.
 *
 * Why the chart endpoint:
 *   - `https://query1.finance.yahoo.com/v8/finance/chart/{symbol}` is
 *     the simplest stable endpoint that does not require an API key, an
 *     API token, or cookies. It returns a structured JSON payload with
 *     `chart.result[0].meta.regularMarketPrice` for every supported
 *     symbol (equities, ETFs, crypto pairs like `BTC-USD`, FX, etc.).
 *   - The richer `/v7/finance/quote` endpoint requires a `crumb`/cookie
 *     handshake that breaks in headless server environments.
 *
 * Validates: Requirements 14.1, 14.6.
 */

const axios = require('axios');

/**
 * Maximum time, in milliseconds, allowed for a single Yahoo Finance
 * request before the helper gives up and signals unavailability (R14.1,
 * R14.6).
 *
 * @type {number}
 */
const API_TIMEOUT_MS = 10_000;

/**
 * Base URL of the Yahoo Finance chart endpoint. Exported so tests can
 * assert the helper hits the right endpoint without relying on string
 * matching against the full URL.
 *
 * @type {string}
 */
const BASE_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';

/**
 * Build the chart URL for a given symbol. The symbol is URL-encoded so
 * exotic tickers (e.g. `BRK-B`, `BTC-USD`) round-trip safely.
 *
 * @param {string} symbol
 * @returns {string}
 */
function buildChartUrl(symbol) {
  return `${BASE_URL}/${encodeURIComponent(symbol)}`;
}

/**
 * Pick `regularMarketPrice` out of a Yahoo Finance chart payload.
 *
 * Returns the price when the response body has the expected shape AND
 * the price is a finite, strictly positive number. Returns `null` for
 * anything else (missing fields, non-numeric price, NaN, Infinity, 0,
 * negative values, payload `error` set, etc.) so the caller can collapse
 * those to a single unavailability signal.
 *
 * @param {unknown} body
 * @returns {number | null}
 */
function extractPrice(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }
  // Yahoo returns errors as `{ chart: { result: null, error: { ... } } }`.
  const chart = /** @type {any} */ (body).chart;
  if (!chart || typeof chart !== 'object') {
    return null;
  }
  if (chart.error) {
    return null;
  }
  const result = chart.result;
  if (!Array.isArray(result) || result.length === 0) {
    return null;
  }
  const meta = result[0] && result[0].meta;
  if (!meta || typeof meta !== 'object') {
    return null;
  }
  const price = meta.regularMarketPrice;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    return null;
  }
  return price;
}

/**
 * Fetch the current market price for `symbol` from Yahoo Finance.
 *
 * Behavior:
 *   1. A non-string / empty / whitespace-only `symbol` short-circuits to
 *      `{ ok: false }` without making a network call — there is nothing
 *      meaningful to look up, and treating it as unavailability lets the
 *      controller fall back to the stored price uniformly (R14.6).
 *   2. Otherwise the chart endpoint is called with a 10-second timeout
 *      (R14.1). The price is read from
 *      `chart.result[0].meta.regularMarketPrice`.
 *   3. Timeouts (axios `ECONNABORTED` / `ETIMEDOUT`), other network
 *      errors, non-2xx responses, and any payload missing a usable
 *      price all resolve to `{ ok: false }` (R14.6). The helper never
 *      throws for a "price could not be obtained" condition.
 *
 * @param {string} symbol - Ticker / pair (e.g. "AAPL", "BTC-USD").
 * @param {object} [options] - Optional injection seam used by tests.
 * @param {typeof axios} [options.client] - Override axios client.
 * @param {number} [options.timeoutMs] - Override request timeout.
 * @returns {Promise<{ ok: true, price: number } | { ok: false }>}
 */
async function fetchPrice(symbol, options = {}) {
  if (typeof symbol !== 'string' || symbol.trim() === '') {
    return { ok: false };
  }

  const client = options.client || axios;
  const timeout =
    typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
      ? options.timeoutMs
      : API_TIMEOUT_MS;
  const url = buildChartUrl(symbol.trim());

  let response;
  try {
    response = await client.get(url, { timeout });
  } catch (_err) {
    // Timeouts, DNS failures, connection resets, non-2xx (axios rejects
    // by default) — every transport-level error is unavailability per
    // R14.6. The error object itself is intentionally ignored: the
    // controller does not surface a reason to the client, only the
    // fallback behavior.
    return { ok: false };
  }

  const price = extractPrice(response && response.data);
  if (price === null) {
    return { ok: false };
  }
  return { ok: true, price };
}

module.exports = {
  fetchPrice,
  API_TIMEOUT_MS,
  BASE_URL,
  // Exposed for unit tests / advanced callers.
  extractPrice,
  buildChartUrl,
};
