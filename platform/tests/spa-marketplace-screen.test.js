'use strict';

/**
 * Customer marketplace + My Apps screen contract (MarketplacePage + MyAppsPage + marketplaceApi/appsApi).
 *
 * Seeds an admin-managed catalogue in the store, then walks the exact HTTP sequence the screens
 * issue: categories, browse with search/category filters, app detail, install (free app →
 * immediate deployment), installations list, lifecycle action, uninstall. Asserts every response
 * key the screens render and pins the page sources to the same keys.
 * (Browser rendering itself is covered by `npm run smoke` in spa/.)
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, jsonFetch, register } = require('./helpers');

const MARKET_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'pages', 'MarketplacePage.jsx'), 'utf8');
const APPS_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'pages', 'MyAppsPage.jsx'), 'utf8');
const API_CLIENT_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'lib', 'api.js'), 'utf8');

test('customer marketplace screens: endpoint sequence and response contract', async (t) => {
  const harness = await startServer({
    seed: async ({ store }) => {
      const category = await store.table('application_categories').insert({
        id: 'cat-cms', name: 'Content management', slug: 'cms', description: 'Publishing tools', active: true, sort_order: 1,
      });
      await store.table('applications').insert({
        id: 'app-ghost', name: 'Ghost', slug: 'ghost', description: 'Publishing platform',
        category_id: category.id, version: '5.0', icon: null, price_cents: 0, active: true,
      });
      await store.table('applications').insert({
        id: 'app-paid', name: 'PaidCRM', slug: 'paid-crm', description: 'Customer records',
        category_id: category.id, version: '1.2', icon: null, price_cents: 999, active: true,
      });
      await store.table('applications').insert({
        id: 'app-off', name: 'RetiredApp', slug: 'retired', description: 'Not listed',
        category_id: category.id, version: '0.1', icon: null, price_cents: 0, active: false,
      });
    },
  });
  const { base, close } = harness;

  try {
    const reg = await register(base, 'market-screen@example.com');
    const token = reg.data.accessToken;

    // -- categories (MarketplacePage filter) --
    const cats = await jsonFetch(base, { method: 'GET', path: '/api/v1/marketplace/categories' }, token);
    assert.strictEqual(cats.status, 200);
    assert.ok(Array.isArray(cats.data.categories) && cats.data.categories.length >= 1, 'filter reads categories');

    // -- browse: active apps only --
    const browse = await jsonFetch(base, { method: 'GET', path: '/api/v1/marketplace/apps' }, token);
    assert.strictEqual(browse.status, 200);
    assert.ok(Array.isArray(browse.data.apps), 'grid reads apps');
    assert.strictEqual(browse.data.apps.length, 2, 'inactive apps are not listed');
    const ghost = browse.data.apps.find((a) => a.slug === 'ghost');
    for (const key of ['id', 'name', 'slug', 'description', 'free', 'priceCents', 'version']) {
      assert.ok(ghost[key] !== undefined, `app card reads app.${key}`);
    }

    // -- search + category filters the screen sends --
    const searched = await jsonFetch(base, { method: 'GET', path: '/api/v1/marketplace/apps?search=CRM' }, token);
    assert.strictEqual(searched.data.apps.length, 1);
    assert.strictEqual(searched.data.apps[0].slug, 'paid-crm');
    const byCat = await jsonFetch(base, { method: 'GET', path: '/api/v1/marketplace/apps?category=cms' }, token);
    assert.strictEqual(byCat.data.apps.length, 2);

    // -- app detail (install form) --
    const detail = await jsonFetch(base, { method: 'GET', path: `/api/v1/marketplace/apps/${ghost.id}` }, token);
    assert.strictEqual(detail.status, 200);
    assert.ok(detail.data.app, 'install form reads app detail');

    // -- install free app: paymentRequired false and deployment queued --
    const installed = await jsonFetch(base, {
      method: 'POST',
      path: '/api/v1/app-installations',
      body: { applicationId: ghost.id, name: 'My blog', domain: 'blog.example.com', backupEnabled: true },
    }, token);
    assert.strictEqual(installed.status, 201, JSON.stringify(installed.data));
    assert.strictEqual(installed.data.paymentRequired, false, 'free install reports no payment required');
    assert.ok(installed.data.installationId, 'screen reads installationId');
    assert.ok(installed.data.message, 'screen shows the server message');

    // -- install paid app: paymentRequired true + invoice the screen links to Billing --
    const paid = await jsonFetch(base, {
      method: 'POST', path: '/api/v1/app-installations', body: { applicationId: 'app-paid' },
    }, token);
    assert.strictEqual(paid.status, 201);
    assert.strictEqual(paid.data.paymentRequired, true);
    assert.ok(paid.data.invoiceNumber, 'screen reads invoiceNumber');
    assert.strictEqual(paid.data.totalAmount, 9.99, 'screen reads totalAmount');

    // -- installations list (MyAppsPage) --
    const list = await jsonFetch(base, { method: 'GET', path: '/api/v1/app-installations' }, token);
    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.data.installations.length, 2);
    const inst = list.data.installations.find((i) => i.name === 'My blog');
    for (const key of ['id', 'name', 'status', 'domain', 'url', 'backupEnabled']) {
      assert.ok(inst[key] !== undefined, `installation row reads installation.${key}`);
    }

    // -- lifecycle action (buttons keyed to ACTION_STATUSES) --
    const action = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/app-installations/${inst.id}/restart`, body: {},
    }, token);
    assert.ok([200, 202].includes(action.status), `restart answered ${action.status}`);
    assert.ok(action.data.deploymentId, 'action result reads deploymentId');
    assert.ok(action.data.status, 'action result reads status');

    // -- uninstall --
    const removed = await jsonFetch(base, { method: 'DELETE', path: `/api/v1/app-installations/${inst.id}` }, token);
    assert.ok([202, 204].includes(removed.status));

    // -- pin the screens + client to this contract --
    for (const key of ['paymentRequired', 'invoiceNumber', 'totalAmount']) {
      assert.ok(MARKET_SRC.includes(key), `MarketplacePage renders response key '${key}'`);
    }
    for (const key of ['installations', 'deploymentId']) {
      assert.ok(APPS_SRC.includes(key), `MyAppsPage renders response key '${key}'`);
    }
    assert.ok(API_CLIENT_SRC.includes('export const marketplaceApi') && API_CLIENT_SRC.includes('export const appsApi'),
      'api client exports marketplaceApi + appsApi');
    for (const pathPart of ['/api/v1/marketplace/apps', '/api/v1/app-installations']) {
      assert.ok(API_CLIENT_SRC.includes(pathPart), `client covers ${pathPart}`);
    }
  } finally {
    await close();
  }
});
