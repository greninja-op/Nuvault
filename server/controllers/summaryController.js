'use strict';

/**
 * Summary controller — a single read-only aggregate of the user's finances.
 *
 * Powers the data-aware AI starter prompts on the client. It returns only a
 * handful of cheap, pre-aggregated values (no raw records) so the chat page
 * can phrase prompts like "How is my ₹X portfolio performing?" without
 * pulling full collections.
 *
 * Endpoint (mounted at `/api/summary`, behind `protect`):
 *   GET / — aggregate counts/totals for the authenticated user.
 *
 * Everything is strictly user-scoped via the ownership helper. Empty
 * collections collapse to 0 / null / false — never an error.
 */

const Investment = require('../models/Investment');
const Bill = require('../models/Bill');
const Goal = require('../models/Goal');
const Liability = require('../models/Liability');
const Asset = require('../models/Asset');
const { scopedFind } = require('../utils/ownership');
const { roundTo2dp } = require('../utils/currency');

const MS_PER_DAY = 86_400_000;
const DUE_SOON_DAYS = 7;

/**
 * GET /api/summary — aggregated, user-scoped financial summary.
 *
 * Shape:
 *   {
 *     investmentTotal:   Number,        // Σ currentValue across investments
 *     investmentCount:   Number,
 *     billsDueSoonCount: Number,        // unpaid bills due within 7 days
 *     goalsCount:        Number,
 *     firstGoalName:     String | null, // earliest-created goal's name
 *     liabilityTotal:    Number,        // Σ amount across liabilities
 *     hasAssets:         Boolean
 *   }
 */
async function getSummary(req, res, next) {
  try {
    const now = new Date();
    const dueSoonCutoff = new Date(now.getTime() + DUE_SOON_DAYS * MS_PER_DAY);

    const [investments, billsDueSoonCount, goals, liabilities, assetCount] =
      await Promise.all([
        scopedFind(Investment, req).lean(),
        scopedFind(Bill, req, {
          isPaid: false,
          nextDueDate: { $lte: dueSoonCutoff },
        }).countDocuments(),
        scopedFind(Goal, req).sort({ createdAt: 1 }).lean(),
        scopedFind(Liability, req).lean(),
        scopedFind(Asset, req).countDocuments(),
      ]);

    // Investment current value mirrors the AI snapshot: live currentPrice
    // when present and positive, otherwise the buy price.
    let investmentTotal = 0;
    for (const inv of investments) {
      const price =
        typeof inv.currentPrice === 'number' && inv.currentPrice > 0
          ? inv.currentPrice
          : inv.buyPrice;
      const qty = typeof inv.quantity === 'number' ? inv.quantity : 0;
      investmentTotal += qty * price;
    }

    let liabilityTotal = 0;
    for (const l of liabilities) {
      if (typeof l.amount === 'number' && Number.isFinite(l.amount)) {
        liabilityTotal += l.amount;
      }
    }

    res.json({
      investmentTotal: roundTo2dp(investmentTotal),
      investmentCount: investments.length,
      billsDueSoonCount,
      goalsCount: goals.length,
      firstGoalName: goals.length > 0 ? goals[0].name ?? null : null,
      liabilityTotal: roundTo2dp(liabilityTotal),
      hasAssets: assetCount > 0,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getSummary };
