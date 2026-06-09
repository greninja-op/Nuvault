'use strict';

/**
 * Unit tests for `createApp` — verifies the middleware pipeline is wired
 * in the order required by the design (CORS → Helmet → rate limit →
 * JSON → routers → terminal error handler) and that the factory rejects
 * incomplete configuration up front.
 *
 * These tests do not exhaustively validate per-middleware behavior;
 * dedicated CORS, security-header, and rate-limit tests are the optional
 * tasks 3.5, 3.6, and 3.7.
 */

const request = require('supertest');

const { createApp } = require('./app');
const { publicRouter, protectedRouter } = require('./routes');

const VALID_CONFIG = Object.freeze({
  clientOrigin: 'https://app.nuvault.test',
  nodeEnv: 'test',
});

describe('createApp', () => {
  test('throws when config is missing', () => {
    expect(() => createApp()).toThrow(/clientOrigin/);
    expect(() => createApp({})).toThrow(/clientOrigin/);
  });

  test('throws when clientOrigin is empty or non-string', () => {
    expect(() => createApp({ config: { clientOrigin: '' } })).toThrow(
      /clientOrigin/
    );
    expect(() => createApp({ config: { clientOrigin: '   ' } })).toThrow(
      /clientOrigin/
    );
    expect(() => createApp({ config: { clientOrigin: 42 } })).toThrow(
      /clientOrigin/
    );
  });

  test('returns a callable Express app', () => {
    const app = createApp({ config: VALID_CONFIG });
    expect(typeof app).toBe('function');
    expect(typeof app.listen).toBe('function');
    expect(typeof app.use).toBe('function');
  });

  test('parses JSON request bodies (express.json wired)', async () => {
    const app = createApp({ config: VALID_CONFIG });
    publicRouter.post('/__test/echo', (req, res) => {
      res.json({ received: req.body });
    });

    try {
      const response = await request(app)
        .post('/api/__test/echo')
        .set('Origin', VALID_CONFIG.clientOrigin)
        .send({ hello: 'world', n: 7 });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: { hello: 'world', n: 7 } });
    } finally {
      cleanupTestRoutes(publicRouter);
    }
  });

  test('emits the required security headers on responses', async () => {
    const app = createApp({ config: VALID_CONFIG });
    publicRouter.get('/__test/headers', (_req, res) => {
      res.json({ ok: true });
    });

    try {
      const response = await request(app)
        .get('/api/__test/headers')
        .set('Origin', VALID_CONFIG.clientOrigin);

      expect(response.status).toBe(200);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBeDefined();
      expect(response.headers['strict-transport-security']).toBeDefined();
    } finally {
      cleanupTestRoutes(publicRouter);
    }
  });

  test('routes thrown errors through the uniform error handler', async () => {
    const app = createApp({ config: VALID_CONFIG });
    publicRouter.get('/__test/boom', (_req, _res, next) => {
      const err = new Error('kaboom');
      err.statusCode = 418;
      next(err);
    });

    try {
      const response = await request(app)
        .get('/api/__test/boom')
        .set('Origin', VALID_CONFIG.clientOrigin);

      expect(response.status).toBe(418);
      expect(response.body).toMatchObject({ message: 'kaboom' });
    } finally {
      cleanupTestRoutes(publicRouter);
    }
  });

  test('mounts both the public and protected aggregator routers at /api', async () => {
    const app = createApp({ config: VALID_CONFIG });
    publicRouter.get('/__test/public', (_req, res) => res.json({ tier: 'public' }));
    protectedRouter.get('/__test/protected', (_req, res) =>
      res.json({ tier: 'protected' })
    );

    try {
      const publicResp = await request(app)
        .get('/api/__test/public')
        .set('Origin', VALID_CONFIG.clientOrigin);
      const protectedResp = await request(app)
        .get('/api/__test/protected')
        .set('Origin', VALID_CONFIG.clientOrigin);

      expect(publicResp.status).toBe(200);
      expect(publicResp.body).toEqual({ tier: 'public' });

      // Task 5.3: the protected aggregator is now gated by `protect`. A
      // request without a Bearer token never reaches the test handler;
      // the middleware short-circuits to 401 (R4.1, R4.3).
      expect(protectedResp.status).toBe(401);
    } finally {
      cleanupTestRoutes(publicRouter);
      cleanupTestRoutes(protectedRouter);
    }
  });
});

/**
 * Remove any route registered against the given router whose path starts
 * with `/__test`. The aggregator routers are module-level singletons, so
 * test routes must be cleaned up between cases to avoid bleed-through.
 *
 * @param {import('express').Router} router
 */
function cleanupTestRoutes(router) {
  if (!router || !Array.isArray(router.stack)) {
    return;
  }
  router.stack = router.stack.filter((layer) => {
    if (!layer || !layer.route || typeof layer.route.path !== 'string') {
      return true;
    }
    return !layer.route.path.startsWith('/__test');
  });
}
