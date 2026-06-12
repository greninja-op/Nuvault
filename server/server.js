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

const dns = require('dns');
const mongoose = require('mongoose');

const { loadConfig } = require('./config/env');
const { createApp } = require('./app');

/**
 * When an Atlas-style `mongodb+srv://` URI is in use, point Node's DNS
 * resolver at Google + Cloudflare so SRV record lookups work even when
 * the host's default resolver (often an ISP DNS) doesn't return SRV
 * records. Local `mongodb://` URIs are left alone so dev environments
 * that depend on internal DNS (corporate VPN, etc.) are unaffected.
 *
 * Node's mongodb driver uses `dns.resolveSrv`, which honors the result
 * of `dns.setServers()` — so this single call fixes the
 * `querySrv ECONNREFUSED` / SOA-only response failure mode.
 *
 * @param {string} mongoUri
 * @returns {void}
 */
function applyAtlasDnsOverride(mongoUri) {
  if (typeof mongoUri !== 'string' || !mongoUri.startsWith('mongodb+srv://')) {
    return;
  }
  // Public DNS servers known to support SRV record queries.
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
}

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

  // For Atlas SRV URIs, route Node's DNS through public resolvers that
  // support SRV records — bypasses ISP DNS that only returns SOA.
  applyAtlasDnsOverride(config.mongoUri);

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
      // Surface the actual cluster host so post-deploy logs confirm
      // we're hitting the right database (R22.1 visibility).
      const host = (() => {
        try {
          return new URL(config.mongoUri.replace('mongodb+srv://', 'https://').replace('mongodb://', 'https://')).hostname;
        } catch (_e) { return 'unknown'; }
      })();
      // eslint-disable-next-line no-console
      console.log(`[nuvault] MongoDB Connected: ${host}`);
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
