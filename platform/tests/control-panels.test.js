/**
 * Integration tests for the control-panel marketplace and its admin management surface.
 *
 * The module is mounted twice in the original (`/api/v1` and `/api`), so both prefixes are
 * exercised — a regression that drops the legacy mount would otherwise pass unnoticed.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, jsonFetch, register } = require('./helpers');

async function adminToken(base, app, email = 'cp-admin@example.com') {
  await register(base, email, 'SuperSecret123!');
  const user = await app.store.table('users').findOne({ email });
  await app.store.table('users').updateById(user.id, { role: 'super_admin' });
  const login = await jsonFetch(base, {
    path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'SuperSecret123!' },
  });
  return login.data.accessToken;
}

test('integration: control panels', async (t) => {
  const { base, app, close } = await startServer();
  try {
    const admin = await adminToken(base, app);
    const customer = (await register(base, 'cp-customer@example.com')).data.accessToken;

    // ---- seeded catalogue ---------------------------------------------------
    await t.test('the migration-0043 catalogue is seeded', async () => {
      const res = await jsonFetch(base, { path: '/api/v1/control-panels' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.controlPanels.length, 18, 'eighteen panels seeded');

      const cpanel = res.data.controlPanels.find((p) => p.slug === 'cpanel');
      assert.ok(cpanel, 'cPanel present');
      assert.strictEqual(cpanel.startingPrice, 17.49, 'cheapest plan drives startingPrice');
      assert.ok(Array.isArray(cpanel.supportedOs) && cpanel.supportedOs.includes('ubuntu'));
      assert.strictEqual(cpanel.capabilities.email, true, 'capabilities parsed from JSONB');
      assert.strictEqual(cpanel.minimumRequirements.ramMb, 2048);
    });

    await t.test('the marketplace listing needs no authentication', async () => {
      for (const path of ['/api/v1/control-panels', '/api/control-panels', '/api/v1/control-panel-plans']) {
        const res = await jsonFetch(base, { path });
        assert.strictEqual(res.status, 200, `${path} is public`);
      }
    });

    await t.test('the legacy /api mount serves the same handlers', async () => {
      const v1 = await jsonFetch(base, { path: '/api/v1/control-panels' });
      const legacy = await jsonFetch(base, { path: '/api/control-panels' });
      assert.strictEqual(legacy.status, 200);
      assert.strictEqual(legacy.data.controlPanels.length, v1.data.controlPanels.length);
    });

    // ---- filtering ----------------------------------------------------------
    await t.test('multi-attribute filtering narrows the catalogue', async () => {
      const byCategory = await jsonFetch(base, { path: '/api/v1/control-panels?category=APPLICATION_DEPLOYMENT_PLATFORM' });
      assert.ok(byCategory.data.controlPanels.length > 0);
      assert.ok(byCategory.data.controlPanels.every((p) => p.category === 'APPLICATION_DEPLOYMENT_PLATFORM'));

      const free = await jsonFetch(base, { path: '/api/v1/control-panels?license=FREE' });
      assert.ok(free.data.controlPanels.every((p) => p.requiresLicense === false));

      const commercial = await jsonFetch(base, { path: '/api/v1/control-panels?license=COMMERCIAL' });
      assert.ok(commercial.data.controlPanels.every((p) => p.requiresLicense === true));

      const byOs = await jsonFetch(base, { path: '/api/v1/control-panels?os=debian' });
      assert.ok(byOs.data.controlPanels.every((p) => p.supportedOs.some((o) => o.includes('debian'))));

      const byMethod = await jsonFetch(base, { path: '/api/v1/control-panels?deploymentType=DOCKER' });
      assert.ok(byMethod.data.controlPanels.every((p) => p.installationMethod === 'DOCKER'));

      const bySearch = await jsonFetch(base, { path: '/api/v1/control-panels?search=cpanel' });
      assert.ok(bySearch.data.controlPanels.some((p) => p.slug === 'cpanel'));
    });

    // ---- detail -------------------------------------------------------------
    await t.test('a panel resolves by slug and by UUID, with ACTIVE plans only', async () => {
      const bySlug = await jsonFetch(base, { path: '/api/v1/control-panels/cpanel' });
      assert.strictEqual(bySlug.status, 200);
      assert.strictEqual(bySlug.data.controlPanel.plans.length, 3);

      const byId = await jsonFetch(base, { path: `/api/v1/control-panels/${bySlug.data.controlPanel.id}` });
      assert.strictEqual(byId.status, 200);
      assert.strictEqual(byId.data.controlPanel.slug, 'cpanel');

      const missing = await jsonFetch(base, { path: '/api/v1/control-panels/does-not-exist' });
      assert.strictEqual(missing.status, 404);
    });

    // ---- admin guard ---------------------------------------------------------
    await t.test('admin endpoints reject customers', async () => {
      const res = await jsonFetch(base, { path: '/api/v1/admin/control-panels' }, customer);
      assert.strictEqual(res.status, 403);
    });

    // ---- admin CRUD ----------------------------------------------------------
    let panelId;
    await t.test('admin creates a panel and the slug is immutable', async () => {
      const created = await jsonFetch(base, {
        path: '/api/v1/admin/control-panels', method: 'POST',
        body: { name: 'Test Panel', slug: 'test-panel', category: 'SERVER_MANAGEMENT', minimumRamMb: 512 },
      }, admin);
      assert.strictEqual(created.status, 201);
      panelId = created.data.controlPanel.id;
      assert.strictEqual(created.data.controlPanel.installation_method, 'SCRIPT', 'default applied');
      assert.strictEqual(created.data.controlPanel.sort_order, 100);

      const dup = await jsonFetch(base, {
        path: '/api/v1/admin/control-panels', method: 'POST', body: { name: 'Dup', slug: 'test-panel' },
      }, admin);
      assert.strictEqual(dup.status, 400, 'duplicate slug refused');

      const badSlug = await jsonFetch(base, {
        path: '/api/v1/admin/control-panels', method: 'POST', body: { name: 'Bad', slug: 'Bad Slug' },
      }, admin);
      assert.strictEqual(badSlug.status, 400, 'slug pattern enforced');

      const badRam = await jsonFetch(base, {
        path: '/api/v1/admin/control-panels', method: 'POST', body: { name: 'Bad', slug: 'bad-ram', minimumRamMb: 10 },
      }, admin);
      assert.strictEqual(badRam.status, 400, 'minimumRamMb lower bound enforced');

      const patched = await jsonFetch(base, {
        path: `/api/v1/admin/control-panels/${panelId}`, method: 'PATCH',
        body: { name: 'Renamed', slug: 'should-be-ignored' },
      }, admin);
      assert.strictEqual(patched.status, 200);
      assert.strictEqual(patched.data.controlPanel.name, 'Renamed');
      assert.strictEqual(patched.data.controlPanel.slug, 'test-panel', 'slug omitted from the patch schema');

      const nonUuid = await jsonFetch(base, { path: '/api/v1/admin/control-panels/not-a-uuid' }, admin);
      assert.strictEqual(nonUuid.status, 400, 'id must be a UUID');
    });

    await t.test('admin manages commercial plans for the panel', async () => {
      const created = await jsonFetch(base, {
        path: '/api/v1/admin/control-panel-plans', method: 'POST',
        body: { controlPanelId: panelId, name: 'Solo', price: 12.5, licenseType: 'SOLO' },
      }, admin);
      assert.strictEqual(created.status, 201);
      const planId = created.data.plan.id;
      assert.strictEqual(created.data.plan.billing_cycle, 'monthly');
      assert.strictEqual(created.data.plan.status, 'ACTIVE');

      const orphan = await jsonFetch(base, {
        path: '/api/v1/admin/control-panel-plans', method: 'POST',
        body: { controlPanelId: '00000000-0000-0000-0000-000000000099', name: 'x', price: 1 },
      }, admin);
      assert.strictEqual(orphan.status, 404, 'plan needs an existing panel');

      const noPrice = await jsonFetch(base, {
        path: '/api/v1/admin/control-panel-plans', method: 'POST', body: { controlPanelId: panelId, name: 'x' },
      }, admin);
      assert.strictEqual(noPrice.status, 400, 'price is required');

      const disabled = await jsonFetch(base, {
        path: `/api/v1/admin/control-panel-plans/${planId}`, method: 'PATCH', body: { status: 'DISABLED' },
      }, admin);
      assert.strictEqual(disabled.status, 200);
      assert.strictEqual(disabled.data.plan.status, 'DISABLED');

      const listing = await jsonFetch(base, { path: `/api/v1/control-panel-plans?panelId=${panelId}` });
      assert.strictEqual(listing.data.plans.length, 0, 'DISABLED plans are not listed publicly');

      const del = await jsonFetch(base, { path: `/api/v1/admin/control-panel-plans/${planId}`, method: 'DELETE' }, admin);
      assert.strictEqual(del.status, 204);
      const again = await jsonFetch(base, { path: `/api/v1/admin/control-panel-plans/${planId}`, method: 'DELETE' }, admin);
      assert.strictEqual(again.status, 404);
    });

    await t.test('admin deletes the panel', async () => {
      const del = await jsonFetch(base, { path: `/api/v1/admin/control-panels/${panelId}`, method: 'DELETE' }, admin);
      assert.strictEqual(del.status, 204);
      const gone = await jsonFetch(base, { path: '/api/v1/control-panels/test-panel' });
      assert.strictEqual(gone.status, 404);
    });

    await t.test('every mutation is audited', async () => {
      const { rows } = await app.store.table('audit_logs').find({});
      const actions = rows.filter((r) => String(r.action).startsWith('CONTROL_PANEL')).map((r) => r.action);
      for (const expected of [
        'CONTROL_PANEL_CREATED', 'CONTROL_PANEL_UPDATED', 'CONTROL_PANEL_DELETED',
        'CONTROL_PANEL_PLAN_CREATED', 'CONTROL_PANEL_PLAN_UPDATED', 'CONTROL_PANEL_PLAN_DELETED',
      ]) {
        assert.ok(actions.includes(expected), `${expected} recorded`);
      }
    });
  } finally {
    await close();
  }
});
