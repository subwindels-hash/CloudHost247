/**
 * Integration tests for the infrastructure catalog surface (infrastructure.ts):
 * provider adapters, provider/region/datacenter management, product configurations and the public
 * server-products catalog the order wizard reads.
 *
 * The point of these routes is that the catalog cannot promise something it cannot deliver, so the
 * interesting cases are the refusals: a template is created disabled, and enabling it requires a
 * verified provider image for that exact combination.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, jsonFetch, register } = require('./helpers');

async function adminToken(base, app, email = 'infra-admin@example.com') {
  await register(base, email, 'SuperSecret123!');
  const user = await app.store.table('users').findOne({ email });
  await app.store.table('users').updateById(user.id, { role: 'super_admin' });
  const login = await jsonFetch(base, {
    path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'SuperSecret123!' },
  });
  return login.data.accessToken;
}

test('integration: infrastructure catalog', async (t) => {
  // HETZNER_API_TOKEN is present so one provider can actually be activated; the others stay
  // unconfigured on purpose, to prove activation fails closed.
  const { base, app, close } = await startServer({ HETZNER_API_TOKEN: 'test-hetzner-token' });
  try {
    const admin = await adminToken(base, app);

    let product;
    let plan;
    let os;
    let version;
    let provider;
    let region;
    let datacenter;

    await t.test('the adapter registry describes what each provider needs', async () => {
      const res = await jsonFetch(base, { path: '/api/v1/admin/provider-adapters' }, admin);
      assert.strictEqual(res.status, 200);
      const kinds = res.data.adapters.map((a) => a.adapter);
      for (const kind of ['hetzner', 'digitalocean', 'vultr', 'aws', 'contabo', 'ovh', 'proxmox', 'virtualizor', 'solusvm', 'openstack', 'generic_http', 'mock']) {
        assert.ok(kinds.includes(kind), `${kind} is listed`);
      }
      const aws = res.data.adapters.find((a) => a.adapter === 'aws');
      assert.deepStrictEqual(aws.credentials.map((c) => c.name).slice(0, 3), ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION'], 'fallback names are the global ones');
      assert.strictEqual(res.data.adapters.find((a) => a.adapter === 'mock').developmentOnly, true);
      assert.strictEqual(res.data.adapters.find((a) => a.adapter === 'proxmox').apiBaseUrlRequired, true, 'self-hosted panels need an explicit URL');
    });

    await t.test('catalog prerequisites are created', async () => {
      const created = await jsonFetch(base, {
        path: '/api/v1/admin/providers', method: 'POST',
        body: { name: 'Hetzner FRA', type: 'hetzner', config: { adapter: 'hetzner' } },
      }, admin);
      assert.strictEqual(created.status, 201);
      provider = created.data.provider.id;

      const withPrefix = await jsonFetch(base, {
        path: '/api/v1/admin/providers', method: 'POST',
        body: { name: 'Unconfigured cloud', type: 'vultr', config: { adapter: 'vultr' } },
      }, admin);
      assert.strictEqual(withPrefix.status, 201);

      product = await app.store.table('catalog_products').insert({
        id: '11111111-1111-4111-8111-111111111111', slug: 'vps', name: 'VPS Hosting',
        category: 'compute', status: 'active', metadata: { visibility: 'public' },
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
      plan = await app.store.table('catalog_product_plans').insert({
        id: '22222222-2222-4222-8222-222222222222', product_id: product.id, slug: 'vps-2',
        name: 'VPS 2', description: 'Two cores', status: 'active',
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
      await app.store.table('catalog_plan_pricing').insert({
        id: '33333333-3333-4333-8333-333333333333', plan_id: plan.id, currency: 'USD',
        billing_cycle: 'monthly', price: 1200, setup_fee: 0, is_active: true,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
      os = await app.store.table('operating_systems').insert({
        id: '44444444-4444-4444-8444-444444444444', slug: 'ubuntu', name: 'Ubuntu', family: 'debian',
        vendor: 'Canonical', status: 'active', is_vps_supported: true, is_dedicated_supported: true,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
      version = await app.store.table('operating_system_versions').insert({
        id: '55555555-5555-4555-8555-555555555555', operating_system_id: os.id, version: '24.04',
        display_name: 'Ubuntu 24.04 LTS', architecture_support: ['x86_64'], status: 'ACTIVE',
        is_lts: true, is_default: true,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
      assert.ok(product.id && os.id && version.id);
    });

    await t.test('the configuration report names the missing variable, never a value', async () => {
      const res = await jsonFetch(base, { path: `/api/v1/admin/providers/${provider}/configuration` }, admin);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.configuration.adapter, 'hetzner');
      assert.strictEqual(res.data.configuration.ready, true, 'HETZNER_API_TOKEN is configured in this deployment');
      const token = res.data.configuration.credentials.find((c) => c.name === 'HETZNER_API_TOKEN');
      assert.strictEqual(token.present, true);
      assert.strictEqual(JSON.stringify(res.data).includes('test-hetzner-token'), false, 'the value never leaves the process');
      assert.strictEqual(res.data.images.total, 0);
      assert.strictEqual(
        (await jsonFetch(base, { path: '/api/v1/admin/providers/00000000-0000-4000-8000-000000000000/configuration' }, admin)).status,
        404,
      );
    });

    await t.test('activating a provider validates the adapter configuration first', async () => {
      const providers = await app.store.table('infra_providers').all();
      const unconfigured = providers.find((p) => p.name === 'Unconfigured cloud');
      const refused = await jsonFetch(base, {
        path: `/api/v1/admin/providers/${unconfigured.id}`, method: 'PATCH', body: { status: 'ACTIVE' },
      }, admin);
      assert.strictEqual(refused.status, 400);
      assert.match(refused.data.message, /VULTR_API_KEY/);

      const activated = await jsonFetch(base, {
        path: `/api/v1/admin/providers/${provider}`, method: 'PATCH',
        body: { status: 'ACTIVE', name: 'Hetzner Frankfurt' },
      }, admin);
      assert.strictEqual(activated.status, 200);
      assert.strictEqual(activated.data.provider.status, 'ACTIVE');
      assert.strictEqual(activated.data.provider.name, 'Hetzner Frankfurt');
      assert.strictEqual(activated.data.provider.active, true);
    });

    await t.test('a region cannot be activated ahead of its provider', async () => {
      const created = await jsonFetch(base, {
        path: '/api/v1/admin/regions', method: 'POST', body: { name: 'Frankfurt', code: 'fra1', providerId: provider },
      }, admin);
      assert.strictEqual(created.status, 201);
      region = created.data.region.id;

      const second = await jsonFetch(base, {
        path: '/api/v1/admin/regions', method: 'POST', body: { name: 'Helsinki', code: 'hel1', providerId: provider },
      }, admin);
      assert.strictEqual(second.status, 201);

      // Move the second region under the unconfigured provider and try to switch it on.
      const providers = await app.store.table('infra_providers').all();
      const unconfigured = providers.find((p) => p.name === 'Unconfigured cloud');
      await app.store.table('regions').updateById(second.data.region.id, { provider_id: unconfigured.id });
      const refused = await jsonFetch(base, {
        path: `/api/v1/admin/regions/${second.data.region.id}`, method: 'PATCH', body: { status: 'ACTIVE' },
      }, admin);
      assert.strictEqual(refused.status, 400);
      assert.match(refused.data.message, /Provider must be active/);

      const updated = await jsonFetch(base, {
        path: `/api/v1/admin/regions/${region}`, method: 'PATCH',
        body: { status: 'ACTIVE', countryCode: 'DE', metadata: { zone: 'eu-central' } },
      }, admin);
      assert.strictEqual(updated.status, 200);
      assert.strictEqual(updated.data.region.countryCode, 'DE');
      assert.strictEqual(updated.data.region.status, 'ACTIVE');
      assert.strictEqual((await jsonFetch(base, { path: `/api/v1/admin/regions/${region}`, method: 'PATCH', body: {} }, admin)).status, 200);
    });

    await t.test('datacenters hang off a region', async () => {
      const created = await jsonFetch(base, {
        path: '/api/v1/admin/datacenters', method: 'POST',
        body: { regionId: region, code: 'fra1-dc1', name: 'FRA1 DC1' },
      }, admin);
      assert.strictEqual(created.status, 201);
      datacenter = created.data.datacenter.id;
      assert.strictEqual(created.data.datacenter.providerId, provider, 'the provider is inherited from the region');

      const bad = await jsonFetch(base, {
        path: '/api/v1/admin/datacenters', method: 'POST',
        body: { regionId: '00000000-0000-4000-8000-000000000000', code: 'x', name: 'Nowhere' },
      }, admin);
      assert.strictEqual(bad.status, 400);
      assert.match(bad.data.message, /Region does not exist/);

      const updated = await jsonFetch(base, {
        path: `/api/v1/admin/datacenters/${datacenter}`, method: 'PATCH',
        body: { name: 'FRA1 Hall 2', status: 'DISABLED' },
      }, admin);
      assert.strictEqual(updated.status, 200);
      assert.strictEqual(updated.data.datacenter.name, 'FRA1 Hall 2');
      assert.strictEqual(updated.data.datacenter.status, 'DISABLED');

      const restored = await jsonFetch(base, {
        path: `/api/v1/admin/datacenters/${datacenter}`, method: 'PATCH', body: { status: 'ACTIVE' },
      }, admin);
      assert.strictEqual(restored.data.datacenter.status, 'ACTIVE', 'a datacenter can be brought back');
    });

    await t.test('a template is created disabled and enabled only against a verified image', async () => {
      const baseBody = {
        planId: plan.id, providerId: provider, regionId: region, datacenterId: datacenter,
        operatingSystemVersionId: version.id, architecture: 'x86_64', serverType: 'VPS',
        metadata: { cpuCores: 2, memoryMb: 4096, storageMb: 81920 },
      };

      const premature = await jsonFetch(base, {
        path: '/api/v1/admin/server-product-configurations', method: 'POST',
        body: { ...baseBody, status: 'ACTIVE' },
      }, admin);
      assert.strictEqual(premature.status, 400);
      assert.match(premature.data.message, /disabled/);

      const badMetadata = await jsonFetch(base, {
        path: '/api/v1/admin/server-product-configurations', method: 'POST',
        body: { ...baseBody, metadata: { cpuCores: 0 } },
      }, admin);
      assert.strictEqual(badMetadata.status, 400);
      assert.match(badMetadata.data.message, /cpuCores/);

      const badRegion = await jsonFetch(base, {
        path: '/api/v1/admin/server-product-configurations', method: 'POST',
        body: { ...baseBody, regionId: '00000000-0000-4000-8000-000000000000' },
      }, admin);
      assert.strictEqual(badRegion.status, 400);
      assert.match(badRegion.data.message, /Region does not belong/);

      const created = await jsonFetch(base, {
        path: '/api/v1/admin/server-product-configurations', method: 'POST', body: baseBody,
      }, admin);
      assert.strictEqual(created.status, 201);
      assert.strictEqual(created.data.configuration.status, 'DISABLED', 'the safe default');
      const configurationId = created.data.configuration.id;

      const noImage = await jsonFetch(base, {
        path: `/api/v1/admin/server-product-configurations/${configurationId}`, method: 'PATCH', body: { status: 'ACTIVE' },
      }, admin);
      assert.strictEqual(noImage.status, 400);
      assert.match(noImage.data.message, /verified active provider image/);

      await app.store.table('os_images').insert({
        id: '66666666-6666-4666-8666-666666666666', os_id: os.id, provider_image_id: 'img-ubuntu-2404',
        region_id: null, arch: 'x86_64', status: 'active', active: true,
        verified_at: new Date().toISOString(), verified_by: 'test',
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });

      const enabled = await jsonFetch(base, {
        path: `/api/v1/admin/server-product-configurations/${configurationId}`, method: 'PATCH', body: { status: 'ACTIVE' },
      }, admin);
      assert.strictEqual(enabled.status, 200);
      assert.strictEqual(enabled.data.configuration.status, 'ACTIVE');

      const listed = await jsonFetch(base, { path: `/api/v1/admin/server-product-configurations?planId=${plan.id}` }, admin);
      assert.strictEqual(listed.status, 200);
      assert.strictEqual(listed.data.configurations.length, 1);
      assert.strictEqual((await jsonFetch(base, { path: '/api/v1/admin/server-product-configurations' })).status, 401, 'the admin list is not public');
      assert.strictEqual((await jsonFetch(base, { path: '/api/v1/admin/server-product-configurations' }, admin)).status, 200);
    });

    await t.test('the public catalog offers only what can actually be deployed', async () => {
      const products = await jsonFetch(base, { path: '/api/v1/server-products' });
      assert.strictEqual(products.status, 200);
      const entry = products.data.plans.find((p) => p.id === plan.id);
      assert.ok(entry, 'the plan is listed once a configuration exists');
      assert.deepStrictEqual(entry.serverTypes, ['VPS']);
      assert.deepStrictEqual(entry.pricing, [{ billingPeriod: 'monthly', currency: 'USD', amount: 1200, setupFee: 0 }]);
      assert.strictEqual(entry.product.slug, 'vps');

      const configuration = await jsonFetch(base, { path: `/api/v1/server-products/${plan.id}/configuration` });
      assert.strictEqual(configuration.status, 200);
      assert.strictEqual(configuration.data.regions.length, 1);
      assert.strictEqual(configuration.data.regions[0].datacenters.length, 1, 'the datacenter is offered');
      assert.strictEqual(configuration.data.regions[0].regionWideAvailable, false);
      const offered = configuration.data.operatingSystems[0];
      assert.strictEqual(offered.slug, 'ubuntu');
      assert.strictEqual(offered.versions[0].displayName, 'Ubuntu 24.04 LTS');
      assert.deepStrictEqual(offered.versions[0].architectures, ['x86_64']);
      assert.strictEqual(offered.versions[0].lts, true);

      const systems = await jsonFetch(base, { path: `/api/v1/server-products/${plan.id}/operating-systems` });
      assert.strictEqual(systems.status, 200);
      assert.strictEqual(systems.data.operatingSystems.length, 1);

      assert.strictEqual((await jsonFetch(base, { path: `/api/v1/server-products/${plan.id}/configuration?serverType=DEDICATED` })).data.regions.length, 0, 'a filter narrows the offer');
      assert.strictEqual((await jsonFetch(base, { path: '/api/v1/server-products/00000000-0000-4000-8000-000000000000/configuration' })).status, 404);
    });

    await t.test('control panels are only offered where they are compatible', async () => {
      const panel = await app.store.table('control_panels').findOne({ slug: 'cpanel' });
      assert.ok(panel, 'the control panel catalog ships seeded');
      await app.store.table('control_panel_compatibility').insert({
        id: '88888888-8888-4888-8888-888888888888', control_panel_id: panel.id,
        operating_system_version_id: version.id, architecture: 'x86_64', status: 'ACTIVE',
        created_at: new Date().toISOString(),
      });
      const res = await jsonFetch(base, { path: `/api/v1/server-products/${plan.id}/configuration` });
      assert.deepStrictEqual(res.data.controlPanels.map((p) => p.slug), ['cpanel']);
      assert.deepStrictEqual(res.data.controlPanels[0].availability, [{ operatingSystemVersionId: version.id, architecture: 'x86_64' }]);
    });

    await t.test('an archived plan disappears from the catalog', async () => {
      await app.store.table('catalog_product_plans').updateById(plan.id, { status: 'archived' });
      const products = await jsonFetch(base, { path: '/api/v1/server-products' });
      assert.strictEqual(products.data.plans.some((p) => p.id === plan.id), false);
      assert.strictEqual((await jsonFetch(base, { path: `/api/v1/server-products/${plan.id}/configuration` })).status, 404);
      await app.store.table('catalog_product_plans').updateById(plan.id, { status: 'active' });
    });

    await t.test('every catalog route is admin-only where it should be', async () => {
      const customer = (await register(base, 'infra-customer@example.com')).data.accessToken;
      assert.strictEqual((await jsonFetch(base, { path: '/api/v1/admin/provider-adapters' })).status, 401);
      assert.strictEqual((await jsonFetch(base, { path: '/api/v1/admin/provider-adapters' }, customer)).status, 403);
      assert.strictEqual((await jsonFetch(base, { path: '/api/v1/server-products', method: 'POST', body: {} }, customer)).status, 405, 'the catalog is read-only');
    });
  } finally {
    await close();
  }
});
