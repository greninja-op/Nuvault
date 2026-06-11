'use strict';

/**
 * FX (foreign-exchange) rate controller.
 *
 * Exposes the conversion rate from the app's base currency (INR) to a
 * requested display currency, so the client can convert every displayed
 * amount with a single rate lookup per currency switch instead of calling
 * the ExchangeRate API once per value.
 *
 * GET /api/fx/rate?to=<CODE>
 *   → 200 { base: 'INR', to: '<CODE>', rate: <number>, unavailable: false }
 *   → 200 { base: 'INR', to, rate: 1, unavailable: true }  (rate lookup failed)
 *
 * The endpoint never fails the request for a rate problem: on any
 * unavailability it returns rate 1 with `unavailable: true` so the client
 * can show the base amount with an indicator rather than breaking.
 */

const { convert, DEFAULT_DISPLAY_CURRENCY } = require('../utils/currency');

async function getRate(req, res, next) {
  try {
    const base = DEFAULT_DISPLAY_CURRENCY; // 'INR'
    const toRaw = req.query.to;
    const to =
      typeof toRaw === 'string' && toRaw.trim() !== ''
        ? toRaw.trim().toUpperCase()
        : base;

    // Same currency → rate is exactly 1, no network call.
    if (to === base) {
      return res.status(200).json({ base, to, rate: 1, unavailable: false });
    }

    // Derive the rate from a large sample so 2-dp rounding inside convert()
    // doesn't destroy precision (convert(1,...) would round 0.01049 → 0.01).
    const SAMPLE = 1_000_000;
    const result = await convert(SAMPLE, base, to);
    if (result && result.ok === true && Number.isFinite(result.amount)) {
      const rate = result.amount / SAMPLE;
      return res.status(200).json({ base, to, rate, unavailable: false });
    }

    // Graceful fallback: rate 1, flagged unavailable.
    return res.status(200).json({ base, to, rate: 1, unavailable: true });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getRate };
