'use strict';

/**
 * Net-worth snapshot recorder.
 *
 * `recordSnapshot(userId)` computes the user's current net worth from their
 * assets and liabilities and persists one snapshot per day (upserting the
 * current day's row). It is designed to be called fire-and-forget from
 * controllers, so it never throws — any failure is logged and swallowed.
 */
const Asset = require('../models/Asset');
const Liability = require('../models/Liability');
const NetWorthSnapshot = require('../models/NetWorthSnapshot');
const { roundTo2dp } = require('./currency');

/** Start of the current local day (00:00:00.000). */
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Compute and persist today's net-worth snapshot for a user.
 *
 * @param {string | import('mongoose').Types.ObjectId | { _id: any }} userId
 * @returns {Promise<object | null>} the snapshot doc, or null on failure / no user
 */
async function recordSnapshot(userId) {
  try {
    // Accept a raw id, an ObjectId, or a user document.
    const uid = userId && userId._id ? userId._id : userId;
    if (!uid) return null;

    const [assets, liabilities] = await Promise.all([
      Asset.find({ user: uid }).select('value').lean(),
      Liability.find({ user: uid }).select('amount').lean(),
    ]);

    const totalAssets = roundTo2dp(
      assets.reduce((sum, a) => sum + (Number.isFinite(a.value) ? a.value : 0), 0),
    );
    const totalLiabilities = roundTo2dp(
      liabilities.reduce((sum, l) => sum + (Number.isFinite(l.amount) ? l.amount : 0), 0),
    );
    const netWorth = roundTo2dp(totalAssets - totalLiabilities);

    // One snapshot per day: update today's if present, else create.
    const existing = await NetWorthSnapshot.findOne({
      user: uid,
      date: { $gte: startOfToday() },
    }).sort({ date: -1 });

    if (existing) {
      existing.assets = totalAssets;
      existing.liabilities = totalLiabilities;
      existing.netWorth = netWorth;
      existing.date = new Date();
      return await existing.save();
    }

    return await NetWorthSnapshot.create({
      user: uid,
      assets: totalAssets,
      liabilities: totalLiabilities,
      netWorth,
    });
  } catch (err) {
    // Fire-and-forget: never propagate. Log for visibility.
    // eslint-disable-next-line no-console
    console.error('[snapshot] recordSnapshot failed:', err && err.message);
    return null;
  }
}

module.exports = { recordSnapshot };
