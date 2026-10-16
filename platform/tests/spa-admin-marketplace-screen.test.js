'use strict';

/**
 * Admin marketplace screen contract (AdminMarketplacePage).
 *
 * Walks the exact HTTP sequence the screen issues — categories CRUD, the application catalogue
 * with its approval workflow (including the server's illegal-transition and
 * publish-without-a-version refusals), version transitions and the one-stable rule, the
 * customer-facing listing (price/active), and manifest validation/import controls — over the real
 * app. Asserts every response key the screen renders and pins the page source to the same keys.
 * (Browser rendering itself is covered by `npm run smoke` in spa/.)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, jsonFetch, register } = require('./helpers');

const PAGE_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'pages', 'AdminMarketplacePage.jsx'), 'utf8');
const API_CLIENT_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'lib', 'api.js'), 'utf8');
const SAMPLE_MANIFEST = fs.readFileSync(
  path.join(__dirname, '..', '..', 'cloudhost247-node', 'manifests', 'adminer', 'manifest.yaml'),
  'utf8',
);

async function adminToken(base, app, email = 'mkt-screen-admin@example.com') {
  await register(base, email, 'SuperSecret123!');
  const user = await app.store.table('users').findOne({ email });
  await app.store.table('users').updateById(user.id, { role: 'super_admin' });
  const login = await jsonFetch(base, {
    path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'SuperSecret123!' },
  });
  return login.data.accessToken;
}

test('admin marketplace screen: endpoint sequence and response contract', async (t) => {
  const harness = await startServer();
  const { base, app, close } = harness;

  try {
    const admin = await adminToken(base, app);

    // -- categories tab: create + list --
    const cat = await jsonFetch(base, {
      method: 'POST', path: '/api/v1/admin/app-categories',
      body: { name: 'Screen Cat', slug: 'screen-cat', description: 'screen fixture', sortOrder: 5, active: true },
    }, admin);
    assert.strictEqual(cat.status, 201, JSON.stringify(cat.data));
    assert.ok(cat.data.category && cat.data.category.id, 'create reads category.id');
    const cats = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/app-categories' }, admin);
    assert.strictEqual(cats.status, 200);
    assert.ok(Array.isArray(cats.data.categories) && cats.data.categories.length >= 1, 'categories tab reads categories');
    const catPatch = await jsonFetch(base, {
      method: 'PATCH', path: `/api/v1/admin/app-categories/${cat.data.category.id}`, body: { active: false },
    }, admin);
    assert.strictEqual(catPatch.status, 200);
    assert.strictEqual(catPatch.data.category.active, false);

    // -- catalogue tab: create (draft) + list + detail --
    const created = await jsonFetch(base, {
      method: 'POST', path: '/api/v1/admin/apps',
      body: {
        slug: 'screen-app', name: 'Screen App', categorySlug: 'screen-cat',
        description: 'A screen-contract fixture application.', supportedHostingTypes: ['docker'],
      },
    }, admin);
    assert.strictEqual(created.status, 201, JSON.stringify(created.data));
    const application = created.data.application;
    assert.strictEqual(application.status, 'draft', 'a new application starts as draft');
    for (const key of ['id', 'slug', 'name', 'categoryId', 'deploymentType', 'supportedHostingTypes', 'status', 'featured']) {
      assert.ok(application[key] !== undefined, `catalogue row reads application.${key}`);
    }

    const list = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/apps' }, admin);
    assert.strictEqual(list.status, 200);
    assert.ok(Array.isArray(list.data.applications) && typeof list.data.total === 'number', 'catalogue reads applications + total');

    const detail = await jsonFetch(base, { method: 'GET', path: `/api/v1/admin/apps/${application.id}` }, admin);
    assert.strictEqual(detail.status, 200);
    for (const key of ['application', 'versions', 'installCount']) {
      assert.ok(detail.data[key] !== undefined, `detail reads ${key}`);
    }

    // -- workflow: illegal transition refused by name; publish refused without a version --
    const illegal = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/admin/apps/${application.id}/status`, body: { status: 'published' },
    }, admin);
    assert.strictEqual(illegal.status, 409, 'draft → published is illegal');
    assert.ok(illegal.data.message.includes('transition'), 'the refusal names the transition');

    const moved = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/admin/apps/${application.id}/status`, body: { status: 'testing' },
    }, admin);
    assert.strictEqual(moved.status, 200, JSON.stringify(moved.data));
    assert.strictEqual(moved.data.application.status, 'testing');

    const approved = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/admin/apps/${application.id}/status`, body: { status: 'approved' },
    }, admin);
    assert.strictEqual(approved.status, 200);

    // Publishing needs a published version first.
    const tooEarly = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/admin/apps/${application.id}/status`, body: { status: 'published' },
    }, admin);
    assert.strictEqual(tooEarly.status, 400, 'publish without a published version is refused');
    assert.ok(tooEarly.data.message.toLowerCase().includes('version'), 'the refusal names the fix');

    // -- versions: publish + mark stable (one-stable rule) --
    const version1 = await app.store.table('application_versions').insert({
      application_id: application.id, version: '1.0.0', status: 'draft', is_stable: false,
    });
    const version2 = await app.store.table('application_versions').insert({
      application_id: application.id, version: '0.9.0', status: 'published', is_stable: true,
    });
    const vPub = await jsonFetch(base, {
      method: 'PATCH', path: `/api/v1/admin/apps/${application.id}/versions/${version1.id}`, body: { status: 'published' },
    }, admin);
    assert.strictEqual(vPub.status, 200, JSON.stringify(vPub.data));
    assert.ok(vPub.data.version && 'isStable' in vPub.data.version && 'status' in vPub.data.version,
      'version rows read status + isStable');
    const vStable = await jsonFetch(base, {
      method: 'PATCH', path: `/api/v1/admin/apps/${application.id}/versions/${version1.id}`, body: { isStable: true },
    }, admin);
    assert.strictEqual(vStable.status, 200);
    assert.strictEqual(vStable.data.version.isStable, true);
    const v2 = await jsonFetch(base, { method: 'GET', path: `/api/v1/admin/apps/${application.id}` }, admin);
    const other = v2.data.versions.find((ver) => ver.id === version2.id);
    assert.strictEqual(other.isStable, false, 'marking one version stable demotes the others');

    // Now publishing the application is legal.
    const published = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/admin/apps/${application.id}/status`, body: { status: 'published' },
    }, admin);
    assert.strictEqual(published.status, 200);
    assert.strictEqual(published.data.application.status, 'published');

    // -- listing tab: price + active edits --
    const listing = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/marketplace/apps' }, admin);
    assert.strictEqual(listing.status, 200);
    const row = listing.data.apps.find((a) => a.id === application.id);
    for (const key of ['id', 'name', 'slug', 'version', 'priceCents', 'active']) {
      assert.ok(row[key] !== undefined, `listing row reads app.${key}`);
    }
    const priced = await jsonFetch(base, {
      method: 'PATCH', path: `/api/v1/admin/marketplace/apps/${application.id}`, body: { priceCents: 499, active: true },
    }, admin);
    assert.strictEqual(priced.status, 200);
    assert.strictEqual(priced.data.app.priceCents, 499);

    // -- manifests tab: validate a real manifest and an invalid one --
    const valid = await jsonFetch(base, {
      method: 'POST', path: '/api/v1/admin/manifests/validate', body: { manifestYaml: SAMPLE_MANIFEST },
    }, admin);
    assert.strictEqual(valid.status, 200);
    assert.strictEqual(valid.data.valid, true, 'a real manifest validates');
    const invalid = await jsonFetch(base, {
      method: 'POST', path: '/api/v1/admin/manifests/validate', body: { manifestYaml: 'id: [unclosed' },
    }, admin);
    assert.strictEqual(invalid.status, 200);
    assert.strictEqual(invalid.data.valid, false);
    assert.ok(Array.isArray(invalid.data.errors) && invalid.data.errors.length > 0, 'errors are rendered');

    const seeded = await jsonFetch(base, { method: 'POST', path: '/api/v1/admin/manifests/seed-categories' }, admin);
    assert.strictEqual(seeded.status, 200);
    assert.ok(Array.isArray(seeded.data.created), 'seed reports the created slugs');

    // -- delete refused while installations exist (super-admin path) --
    await app.store.table('application_installations').insert({
      id: '00000000-0000-7000-8000-0000000000e1', user_id: null, application_id: application.id, status: 'running',
    });
    const blocked = await jsonFetch(base, { method: 'DELETE', path: `/api/v1/admin/apps/${application.id}` }, admin);
    assert.strictEqual(blocked.status, 409);
    assert.ok(blocked.data.message.includes('deprecated'), 'the refusal names the honest path');

    // -- pin the page + client to this contract --
    for (const key of ['installCount', 'supportedHostingTypes', 'priceCents', 'isStable', 'manifestYaml']) {
      assert.ok(PAGE_SRC.includes(key), `AdminMarketplacePage renders response key '${key}'`);
    }
    assert.ok(API_CLIENT_SRC.includes('export const adminApi'), 'api client exports adminApi');
    for (const pathPart of ['/api/v1/admin/apps', '/api/v1/admin/marketplace/apps', '/api/v1/admin/app-categories', '/api/v1/admin/manifests/validate']) {
      assert.ok(API_CLIENT_SRC.includes(pathPart), `adminApi covers ${pathPart}`);
    }
  } finally {
    await close();
  }
});
