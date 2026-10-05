'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Router } = require('../src/core/router');

test('router matches static routes', () => {
  const router = new Router();
  router.get('/health', () => {});
  const { route } = router.resolve('GET', '/health');
  assert.strictEqual(route.pattern, '/health');
});

test('router captures a single param at its correct segment', () => {
  const router = new Router();
  router.get('/api/v1/catalog/products/:slug', () => {});
  const { params } = router.resolve('GET', '/api/v1/catalog/products/web-hosting');
  assert.strictEqual(params.slug, 'web-hosting');
});

test('router captures multiple params in order', () => {
  const router = new Router();
  router.get('/users/:userId/tickets/:ticketId', () => {});
  const { params } = router.resolve('GET', '/users/abc/tickets/xyz');
  assert.deepStrictEqual(params, { userId: 'abc', ticketId: 'xyz' });
});

test('router wildcard captures remainder', () => {
  const router = new Router();
  router.get('/files/*', () => {});
  const { params } = router.resolve('GET', '/files/a/b/c.txt');
  assert.strictEqual(params['*'], 'a/b/c.txt');
});

test('router ignores trailing slash', () => {
  const router = new Router();
  router.get('/users', () => {});
  const { route } = router.resolve('GET', '/users/');
  assert.strictEqual(route.pattern, '/users');
});

test('router throws 404 for unknown path', () => {
  const router = new Router();
  router.get('/known', () => {});
  assert.throws(() => router.resolve('GET', '/unknown'), (e) => e.statusCode === 404);
});

test('router throws 405 with Allow list for known path wrong method', () => {
  const router = new Router();
  router.get('/thing', () => {});
  router.post('/thing', () => {});
  assert.throws(
    () => router.resolve('DELETE', '/thing'),
    (e) => e.statusCode === 405 && e.details.allow.includes('GET') && e.details.allow.includes('POST')
  );
});

test('HEAD falls back to GET', () => {
  const router = new Router();
  router.get('/page', () => {});
  const { route } = router.resolve('HEAD', '/page');
  assert.strictEqual(route.method, 'GET');
});

test('router group prefixes routes', () => {
  const router = new Router();
  router.group('/api/v1', (r) => {
    r.get('/widgets/:id', () => {});
  });
  const { route, params } = router.resolve('GET', '/api/v1/widgets/42');
  assert.strictEqual(route.pattern, '/api/v1/widgets/:id');
  assert.strictEqual(params.id, '42');
});

test('router prefers a literal segment over an earlier-registered param', () => {
  const router = new Router();
  // Registered in the "wrong" order on purpose: the catch-all comes first.
  router.get('/api/v1/tools/:slug', () => {});
  router.get('/api/v1/tools/history', () => {});
  router.get('/api/v1/tools/catalog', () => {});

  assert.strictEqual(router.resolve('GET', '/api/v1/tools/history').route.pattern, '/api/v1/tools/history');
  assert.strictEqual(router.resolve('GET', '/api/v1/tools/catalog').route.pattern, '/api/v1/tools/catalog');
  // A genuinely dynamic slug still falls through to the param route.
  assert.strictEqual(router.resolve('GET', '/api/v1/tools/json-format').route.pattern, '/api/v1/tools/:slug');
});

test('router ranks wildcard below param below static', () => {
  const router = new Router();
  router.get('/a/*', () => {});
  router.get('/a/:id', () => {});
  router.get('/a/literal', () => {});

  assert.strictEqual(router.resolve('GET', '/a/literal').route.pattern, '/a/literal');
  assert.strictEqual(router.resolve('GET', '/a/other').route.pattern, '/a/:id');
  assert.strictEqual(router.resolve('GET', '/a/x/y').route.pattern, '/a/*');
});

test('router keeps registration order for equally-specific routes', () => {
  const router = new Router();
  router.get('/p/:a', () => 'first');
  router.get('/p/:b', () => 'second');
  // Same specificity: the first registered wins (stable sort).
  assert.strictEqual(router.resolve('GET', '/p/x').route.pattern, '/p/:a');
});
