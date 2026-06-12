'use strict';

/**
 * restore.js — restore the database from the most recent backup JSON in
 * server/data/.
 *
 * Run:  node server/restore.js   (or, from server/: node restore.js)
 *
 * - Connects using MONGO_URI from server/.env (no hardcoded connection string).
 * - Finds all backup_*.json files in server/data/ and picks the most recent
 *   by the timestamp embedded in the filename.
 * - Clears every existing collection, then re-inserts every document exactly
 *   as stored — via the native driver (NOT through models), so _id values,
 *   dates, and already-hashed passwords are preserved untouched and login
 *   keeps working.
 * - Uses EJSON so ObjectIds / Dates deserialize back to real BSON types.
 */

const path = require('path');
const fs = require('fs');
const dns = require('dns');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const mongoose = require('mongoose');
const { EJSON } = require('bson');

// Atlas SRV URIs need DNS resolvers that return SRV records; many ISP
// resolvers don't. Route Node DNS through public resolvers when the URI
// is mongodb+srv://. Local URIs are left alone.
if (typeof process.env.MONGO_URI === 'string' && process.env.MONGO_URI.startsWith('mongodb+srv://')) {
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
}

const DATA_DIR = path.join(__dirname, 'data');

/**
 * Return the path to the most recent backup file. Filenames look like
 * `backup_YYYY-MM-DD_HH-MM-SS.json`; that format sorts chronologically as a
 * plain string, so the lexicographically largest name is the newest.
 */
function findLatestBackup() {
  if (!fs.existsSync(DATA_DIR)) {
    throw new Error(`No data directory found at ${DATA_DIR}. Run a backup first.`);
  }
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => /^backup_.*\.json$/.test(f))
    .sort();
  if (files.length === 0) {
    throw new Error(`No backup_*.json files found in ${DATA_DIR}. Run a backup first.`);
  }
  return path.join(DATA_DIR, files[files.length - 1]);
}

async function clearAllCollections(db) {
  const collections = await db.collections();
  for (const col of collections) {
    await col.deleteMany({});
  }
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set in server/.env');
  }

  const backupFile = findLatestBackup();
  const raw = fs.readFileSync(backupFile, 'utf8');
  // relaxed:false matches how backup.js wrote it; EJSON.parse restores
  // ObjectId / Date instances from their $oid / $date markers.
  const payload = EJSON.parse(raw, { relaxed: false });
  const collections = payload.collections || {};

  await mongoose.connect(uri);
  console.log('Connected to MongoDB.');

  const db = mongoose.connection.db;
  await clearAllCollections(db);
  console.log('Cleared all existing collections.');

  for (const [name, docs] of Object.entries(collections)) {
    if (!Array.isArray(docs) || docs.length === 0) {
      console.log(`✓ Restored ${name}: 0 documents`);
      continue;
    }
    await db.collection(name).insertMany(docs);
    console.log(`✓ Restored ${name}: ${docs.length} documents`);
  }

  console.log(`\nRestored from backup: ${backupFile}`);
}

main()
  .catch((err) => {
    console.error('✗ Restore failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
    console.log('Disconnected.');
  });
