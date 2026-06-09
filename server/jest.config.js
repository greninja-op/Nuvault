/**
 * Jest configuration for the Nuvault backend.
 *
 * - Uses the Node test environment (no DOM).
 * - Runs every file under `tests/` ending in `.test.js`.
 * - Co-located tests next to source files (e.g. `models/User.test.js`) are also picked up.
 * - `--runInBand` is set in the npm script so `mongodb-memory-server` can boot a single instance per run.
 */
module.exports = {
  testEnvironment: "node",
  testMatch: [
    "**/tests/**/*.test.js",
    "**/?(*.)+(spec|test).js"
  ],
  testPathIgnorePatterns: [
    "/node_modules/"
  ],
  collectCoverageFrom: [
    "controllers/**/*.js",
    "middleware/**/*.js",
    "models/**/*.js",
    "routes/**/*.js",
    "utils/**/*.js",
    "config/**/*.js"
  ],
  coverageDirectory: "coverage",
  verbose: true,
  // Property tests can take longer than the default 5s, especially on first MongoMemoryServer boot.
  testTimeout: 30000
};
