'use strict';

/**
 * Unit tests for the currency conversion utility (Task 10.1).
 *
 * The tests mock `axios` so no real network call is made and so the
 * "axios was not called" assertions are meaningful.
 *
 * Property-based coverage of the formula and fallback (Property 28) is
 * tracked as the optional task 10.2.
 */

jest.mock('axios');

const axios = require('axios');

const {
  convert,
  DEFAULT_DISPLAY_CURRENCY,
  roundTo2dp,
} = require('./currency');

const ORIGINAL_API_KEY = process.env.EXCHANGERATE_API_KEY;

beforeEach(() => {
  jest.clearAllMocks();
  // Ensure tests start from a known API-key state. Each test sets it
  // explicitly when needed so behavior does not depend on outer env.
  process.env.EXCHANGERATE_API_KEY = 'test-key-abc';
});

afterAll(() => {
  if (ORIGINAL_API_KEY === undefined) {
    delete process.env.EXCHANGERATE_API_KEY;
  } else {
    process.env.EXCHANGERATE_API_KEY = ORIGINAL_API_KEY;
  }
});

describe('utils/currency', () => {
  test('exports INR as the default display currency (R19.1)', () => {
    expect(DEFAULT_DISPLAY_CURRENCY).toBe('INR');
  });

  describe('roundTo2dp', () => {
    test('rounds positive values to 2 decimal places', () => {
      expect(roundTo2dp(2.34501)).toBeCloseTo(2.35, 5);
      expect(roundTo2dp(2.34499)).toBeCloseTo(2.34, 5);
      expect(roundTo2dp(831.2345)).toBeCloseTo(831.23, 5);
      expect(roundTo2dp(831.2356)).toBeCloseTo(831.24, 5);
      expect(roundTo2dp(0)).toBe(0);
      expect(roundTo2dp(100)).toBe(100);
    });

    test('rounds negative values symmetrically by magnitude', () => {
      expect(roundTo2dp(-2.34501)).toBeCloseTo(-2.35, 5);
      expect(roundTo2dp(-2.34499)).toBeCloseTo(-2.34, 5);
      expect(roundTo2dp(-831.2356)).toBeCloseTo(-831.24, 5);
    });
  });

  describe('convert: same-currency short-circuit (R19.2)', () => {
    test('returns the amount unchanged with no network call when from === to', async () => {
      const result = await convert(123.456, 'INR', 'INR');

      expect(result).toEqual({ ok: true, amount: 123.456 });
      expect(axios.get).not.toHaveBeenCalled();
    });

    test('matches case-insensitively and still skips the network call', async () => {
      const result = await convert(50, 'usd', 'USD');

      expect(result).toEqual({ ok: true, amount: 50 });
      expect(axios.get).not.toHaveBeenCalled();
    });
  });

  describe('convert: successful API response (R19.2)', () => {
    test('returns the converted amount rounded to 2 decimal places using conversion_result', async () => {
      axios.get.mockResolvedValueOnce({
        status: 200,
        data: {
          result: 'success',
          base_code: 'USD',
          target_code: 'INR',
          conversion_rate: 83.1234,
          conversion_result: 831.2345, // → rounded to 831.23
        },
      });

      const result = await convert(10, 'USD', 'INR');

      expect(result).toEqual({ ok: true, amount: 831.23 });
      expect(axios.get).toHaveBeenCalledTimes(1);

      // Verify the URL targets the v6 pair endpoint, includes the API key,
      // upper-cases the currencies, and uses a 5s timeout.
      const [url, opts] = axios.get.mock.calls[0];
      expect(url).toMatch(
        /^https:\/\/v6\.exchangerate-api\.com\/v6\/test-key-abc\/pair\/USD\/INR\/10$/
      );
      expect(opts).toEqual({ timeout: 5000 });
    });

    test('falls back to conversion_rate × amount when conversion_result is missing', async () => {
      axios.get.mockResolvedValueOnce({
        status: 200,
        data: {
          result: 'success',
          conversion_rate: 0.9013,
        },
      });

      const result = await convert(100, 'USD', 'EUR');

      // 100 * 0.9013 = 90.13
      expect(result).toEqual({ ok: true, amount: 90.13 });
    });

    test('returns api_error when the response is success but rate fields are missing', async () => {
      axios.get.mockResolvedValueOnce({
        status: 200,
        data: { result: 'success' },
      });

      const result = await convert(10, 'USD', 'EUR');

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('api_error');
    });
  });

  describe('convert: timeout / network failure signals unavailability (R19.3)', () => {
    test('returns reason "timeout" when axios aborts with ECONNABORTED', async () => {
      const err = new Error('timeout of 5000ms exceeded');
      err.code = 'ECONNABORTED';
      axios.get.mockRejectedValueOnce(err);

      const result = await convert(10, 'USD', 'INR');

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('timeout');
    });

    test('returns reason "network_error" for other axios rejections', async () => {
      axios.get.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

      const result = await convert(10, 'USD', 'INR');

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('network_error');
      expect(result.detail).toMatch(/ECONNREFUSED/);
    });

    test('returns reason "api_error" when the API responds with result: "error"', async () => {
      axios.get.mockResolvedValueOnce({
        status: 200,
        data: { result: 'error', 'error-type': 'unsupported-code' },
      });

      const result = await convert(10, 'USD', 'XYZ');

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('api_error');
      expect(result.detail).toBe('unsupported-code');
    });
  });

  describe('convert: missing API key still functions but signals unavailability', () => {
    test('signals unavailability when EXCHANGERATE_API_KEY is unset', async () => {
      delete process.env.EXCHANGERATE_API_KEY;

      const result = await convert(10, 'USD', 'INR');

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('no_api_key');
      expect(axios.get).not.toHaveBeenCalled();
    });

    test('signals unavailability when EXCHANGERATE_API_KEY is empty', async () => {
      process.env.EXCHANGERATE_API_KEY = '';

      const result = await convert(10, 'USD', 'INR');

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('no_api_key');
      expect(axios.get).not.toHaveBeenCalled();
    });

    test('signals unavailability when EXCHANGERATE_API_KEY is whitespace-only', async () => {
      process.env.EXCHANGERATE_API_KEY = '   ';

      const result = await convert(10, 'USD', 'INR');

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('no_api_key');
      expect(axios.get).not.toHaveBeenCalled();
    });

    test('still short-circuits same-currency calls without an API key', async () => {
      delete process.env.EXCHANGERATE_API_KEY;

      const result = await convert(42, 'INR', 'INR');

      expect(result).toEqual({ ok: true, amount: 42 });
      expect(axios.get).not.toHaveBeenCalled();
    });
  });

  describe('convert: input validation', () => {
    test('rejects non-numeric / non-finite amounts with reason "invalid_input"', async () => {
      const cases = [undefined, null, NaN, Infinity, -Infinity, '10', {}, []];
      for (const bad of cases) {
        // eslint-disable-next-line no-await-in-loop
        const result = await convert(bad, 'USD', 'INR');
        expect(result).toEqual({ ok: false, reason: 'invalid_input' });
      }
      expect(axios.get).not.toHaveBeenCalled();
    });

    test('rejects empty / non-string currency codes', async () => {
      const cases = [
        [10, '', 'INR'],
        [10, 'USD', ''],
        [10, '   ', 'INR'],
        [10, 'USD', null],
        [10, 123, 'INR'],
      ];
      for (const args of cases) {
        // eslint-disable-next-line no-await-in-loop
        const result = await convert(...args);
        expect(result).toEqual({ ok: false, reason: 'invalid_input' });
      }
      expect(axios.get).not.toHaveBeenCalled();
    });
  });
});
