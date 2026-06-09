'use strict';

/**
 * Unit tests for the Yahoo Finance live-price utility (Task 14.2).
 *
 * The tests mock `axios` so no real network call is made and so the
 * "axios was/wasn't called" assertions are meaningful. They cover the
 * pieces of the contract that the investment summary relies on:
 *
 *   - Successful response → `{ ok: true, price }` with the chart's
 *     `regularMarketPrice` (R14.1).
 *   - Network errors, timeouts, non-2xx, missing fields, malformed
 *     payloads, and Yahoo's `chart.error` payload all collapse to
 *     `{ ok: false }` so the controller has a single unavailability
 *     signal to react to (R14.6).
 *   - Empty / whitespace-only / non-string symbols short-circuit to
 *     `{ ok: false }` without a network call.
 *
 * Property-based coverage of the price-source rule, P&L computation,
 * and the live-price fallback (Properties 20, 21, 22) is tracked as
 * the optional tasks 14.3 / 14.4 / 14.5.
 */

jest.mock('axios');

const axios = require('axios');

const {
  fetchPrice,
  API_TIMEOUT_MS,
  BASE_URL,
  extractPrice,
  buildChartUrl,
} = require('./yahooFinance');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('utils/yahooFinance', () => {
  describe('constants', () => {
    test('exposes a 10-second timeout (R14.1)', () => {
      expect(API_TIMEOUT_MS).toBe(10_000);
    });

    test('targets the chart endpoint', () => {
      expect(BASE_URL).toBe('https://query1.finance.yahoo.com/v8/finance/chart');
    });
  });

  describe('buildChartUrl', () => {
    test('appends the URL-encoded symbol to the base', () => {
      expect(buildChartUrl('AAPL')).toBe(`${BASE_URL}/AAPL`);
      expect(buildChartUrl('BTC-USD')).toBe(`${BASE_URL}/BTC-USD`);
      expect(buildChartUrl('a b')).toBe(`${BASE_URL}/a%20b`);
    });
  });

  describe('extractPrice', () => {
    test('returns regularMarketPrice from a well-formed chart payload', () => {
      expect(
        extractPrice({
          chart: {
            error: null,
            result: [{ meta: { regularMarketPrice: 175.43 } }],
          },
        })
      ).toBe(175.43);
    });

    test('returns null when chart.error is set', () => {
      expect(
        extractPrice({
          chart: { error: { code: 'Not Found' }, result: null },
        })
      ).toBeNull();
    });

    test.each([
      ['null body', null],
      ['undefined body', undefined],
      ['non-object body', 42],
      ['missing chart', {}],
      ['empty result array', { chart: { result: [], error: null } }],
      ['result not an array', { chart: { result: 'oops', error: null } }],
      ['missing meta', { chart: { result: [{}], error: null } }],
      ['missing regularMarketPrice', {
        chart: { result: [{ meta: {} }], error: null },
      }],
      ['non-numeric price', {
        chart: { result: [{ meta: { regularMarketPrice: 'NaN' } }], error: null },
      }],
      ['NaN price', {
        chart: { result: [{ meta: { regularMarketPrice: Number.NaN } }], error: null },
      }],
      ['Infinity price', {
        chart: { result: [{ meta: { regularMarketPrice: Infinity } }], error: null },
      }],
      ['zero price', {
        chart: { result: [{ meta: { regularMarketPrice: 0 } }], error: null },
      }],
      ['negative price', {
        chart: { result: [{ meta: { regularMarketPrice: -1 } }], error: null },
      }],
    ])('returns null for %s', (_label, body) => {
      expect(extractPrice(body)).toBeNull();
    });
  });

  describe('fetchPrice: input validation', () => {
    test.each([
      ['undefined', undefined],
      ['null', null],
      ['empty string', ''],
      ['whitespace-only string', '   '],
      ['number', 123],
      ['object', {}],
    ])('returns { ok: false } and makes no network call for %s symbol', async (_label, bad) => {
      const result = await fetchPrice(bad);
      expect(result).toEqual({ ok: false });
      expect(axios.get).not.toHaveBeenCalled();
    });
  });

  describe('fetchPrice: successful response (R14.1)', () => {
    test('returns the regularMarketPrice on a well-formed payload', async () => {
      axios.get.mockResolvedValueOnce({
        status: 200,
        data: {
          chart: {
            error: null,
            result: [{ meta: { regularMarketPrice: 175.43 } }],
          },
        },
      });

      const result = await fetchPrice('AAPL');

      expect(result).toEqual({ ok: true, price: 175.43 });
      expect(axios.get).toHaveBeenCalledTimes(1);

      const [url, opts] = axios.get.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/AAPL`);
      expect(opts).toEqual({ timeout: 10_000 });
    });

    test('trims whitespace from the symbol before encoding it into the URL', async () => {
      axios.get.mockResolvedValueOnce({
        status: 200,
        data: {
          chart: {
            error: null,
            result: [{ meta: { regularMarketPrice: 50_000 } }],
          },
        },
      });

      await fetchPrice('  BTC-USD  ');

      const [url] = axios.get.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/BTC-USD`);
    });
  });

  describe('fetchPrice: failures collapse to { ok: false } (R14.6)', () => {
    test('returns { ok: false } on axios timeout (ECONNABORTED)', async () => {
      const err = new Error('timeout of 10000ms exceeded');
      err.code = 'ECONNABORTED';
      axios.get.mockRejectedValueOnce(err);

      expect(await fetchPrice('AAPL')).toEqual({ ok: false });
    });

    test('returns { ok: false } on a generic network error', async () => {
      axios.get.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

      expect(await fetchPrice('AAPL')).toEqual({ ok: false });
    });

    test('returns { ok: false } when the API responds with chart.error', async () => {
      axios.get.mockResolvedValueOnce({
        status: 200,
        data: {
          chart: { error: { code: 'Not Found' }, result: null },
        },
      });

      expect(await fetchPrice('NOPE')).toEqual({ ok: false });
    });

    test('returns { ok: false } when the payload is missing regularMarketPrice', async () => {
      axios.get.mockResolvedValueOnce({
        status: 200,
        data: { chart: { error: null, result: [{ meta: {} }] } },
      });

      expect(await fetchPrice('AAPL')).toEqual({ ok: false });
    });

    test('does not throw for any failure mode', async () => {
      axios.get.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'ETIMEDOUT' }));
      await expect(fetchPrice('AAPL')).resolves.toEqual({ ok: false });
    });
  });

  describe('fetchPrice: option overrides', () => {
    test('uses an injected client when provided (no real axios call)', async () => {
      const fakeClient = {
        get: jest.fn().mockResolvedValue({
          status: 200,
          data: {
            chart: {
              error: null,
              result: [{ meta: { regularMarketPrice: 10 } }],
            },
          },
        }),
      };

      const result = await fetchPrice('FOO', { client: fakeClient, timeoutMs: 1234 });

      expect(result).toEqual({ ok: true, price: 10 });
      expect(fakeClient.get).toHaveBeenCalledTimes(1);
      expect(fakeClient.get.mock.calls[0][1]).toEqual({ timeout: 1234 });
      expect(axios.get).not.toHaveBeenCalled();
    });
  });
});
