'use strict';

/**
 * Nuvault API server bootstrap.
 *
 * Responsibilities:
 *   1. Load runtime configuration via {@link loadConfig}, which enforces
 *      the required-secret startup guard (R22.1, R22.2). If any required
 *      secret is missing, `loadConfig` halts the process before this
 *      module ever calls `mongoose.connect` or binds a port — ensuring
 *      no request is served from a misconfigured boot.
 *   2. Connect to MongoDB using the loaded `MONGO_URI`.
 *   3. Build the Express app via {@link createApp} and listen on the
 *      configured port.
 *
 * The bootstrap is `require`-safe: `start()` only runs when the file is
 * executed directly (`node server.js`), so test files can require
 * `app.js` without booting the database or a network listener.
 */

const mongoose = require('mongoose');

const { loadConfig } = require('./config/env');
const { createApp } = require('./app');

/**
 * Boot the API server.
 *
 * @param {object} [options]
 * @param {ReturnType<typeof loadConfig>} [options.config]
 *   Pre-loaded config. When omitted, `loadConfig()` runs and applies the
 *   required-secret startup guard.
 * @returns {Promise<import('http').Server>} Resolves with the listening
 *   HTTP server once the port is bound.
 */
async function start(options = {}) {
  const config = options.config || loadConfig();

  // Connect to MongoDB before binding the port so the API never accepts
  // a request while the database is still unavailable.
  await mongoose.connect(config.mongoUri);

  const app = createApp({ config });

  return new Promise((resolve) => {
    const httpServer = app.listen(config.port, () => {
      // eslint-disable-next-line no-console
      console.log(
        `[nuvault] API listening on port ${config.port} (${config.nodeEnv})`
      );
      resolve(httpServer);
    });
  });
}

if (require.main === module) {
  start().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[nuvault] Server failed to start:', err);
    process.exit(1);
  });
}

module.exports = { start };
