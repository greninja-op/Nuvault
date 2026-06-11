'use strict';

/**
 * backup.js — dump every collection in the database to a single timestamped
 * JSON file under server/data/.
 *
 * Run:  node server/backup.js   (or, from server/: node backup.js)
 *
 * - Connects using MONGO_URI from server/.env (no hardcoded connection string).
 * - Reads ALL documents from EVERY collection that actually exists (dynamic —
 *   so it captures users, transactions, budgets, assets, liabilities,
 *   investments, goals, bills, portfolioitems, and anything else present).
 * - Writes server/data/backup_YYYY-MM-DD_HH-MM-SS.json with the shape:
 *     { "timestamp": "...", "collections": { "<name>": [ ...docs ] } }
 * - Uses EJSON (extended JSON) so ObjectIds and Dates are preserved exactly,
 *   which keeps user references intact and login working after a restore.
 *   Passwords are copied as-is (already bcrypt hashed) — never re-hashed.
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const mongoose = require('mongoose');
const { EJSON } = require('bson');

const DATA_DIR = path.join(__dirname, 'data');

/** Build a filesystem-safe timestamp: YYYY-MM-DD_HH-MM-SS (local time). */
function fileTimestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
  );
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set in server/.env');
  }

  // Ensure the output folder exists.
  fs.mkdirSync(DATA_DIR, { recursive: true });

  await mongoose.connect(uri);
  console.log('Connected to MongoDB.');

  const db = mongoose.connection.db;
  const collectionInfos = await db.listCollections().toArray();

  const payload = {
    timestamp: new Date().toISOString(),
    collections: {},
  };

  for (const info of collectionInfos) {
    const name = info.name;
    if (name.startsWith('system.')) continue; // skip internal collections
    const docs = await db.collection(name).find({}).toArray();
    payload.collections[name] = docs;
    console.log(`✓ Backed up ${name}: ${docs.length} documents`);
  }

  const outFile = path.join(DATA_DIR, `backup_${fileTimestamp()}.json`);
  // relaxed:false → canonical EJSON, so $oid / $date type markers are kept.
  fs.writeFileSync(outFile, EJSON.stringify(payload, null, 2, { relaxed: false }));

  console.log(`\nBackup written to: ${outFile}`);
}

main()
  .catch((err) => {
    console.error('✗ Backup failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
    console.log('Disconnected.');
  });
