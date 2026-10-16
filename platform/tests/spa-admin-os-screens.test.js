'use strict';

/**
 * Admin OS / image-mapping / template screen contracts (AdminOsVersionsPage, AdminOsImagesPage,
 * AdminAvailabilityPage).
 *
 * Walks the exact HTTP sequences the three screens issue — OS registry + version lifecycle with
 * its activation guards, provider image mappings with real Test verdicts and the disable-before-
 * delete guard, and server templates that are created disabled and only enabled behind the
 * verified-image gate — over the real app. Pins the page sources to the response keys they
 * render. (Browser rendering itself is covered by `npm run smoke` in spa/.)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, jsonFetch, register } = require('./helpers');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'pages', name), 'utf8');
const OS_VERSIONS_SRC = read('AdminOsVersionsPage.jsx');
const OS_IMAGES_SRC = read('AdminOsImagesPage.jsx');
const AVAILABILITY_SRC = read('AdminAvailabilityPage.jsx');
const API_CLIENT_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'lib', 'api.js'), 'utf8');

test('admin OS registry, image mappings and templates: endpoint contracts', async (t) => {
  // ALLOW_MOCK_PROVIDER opts into the platform's development-only mock adapter (the same opt-in a
  // local deployment uses); it is what lets the Test button get a real answer from a configured
  // adapter in this sandbox.
  const harness = await startServer({ ALLOW_MOCK_PROVIDER: 'true' });
  const { base, app, close } = harness;

  try {
    await register(base, 'os-screen-admin@example.com');
    const adminUser = await app.store.table('users').findOne({ email: 'os-screen-admin@example.com' });
    await app.store.table('users').updateById(adminUser.id, { role: 'super_admin' });
    const admin = (await jsonFetch(base, {
      path: '/api/v1/auth/login', method: 'POST', body: { email: 'os-screen-admin@example.com', password: 'SuperSecret123!' },
    })).data.accessToken;
    const cust = await register(base, 'os-screen-cust@example.com');

    // ---------------------------------------------------------------- OS registry + versions
    const osRes = await jsonFetch(base, {
      method: 'POST', path: '/api/v1/admin/operating-systems',
      body: { name: 'ScreenOS', slug: 'screenos', vendor: 'Screen Vendor' },
    }, admin);
    assert.strictEqual(osRes.status, 201, JSON.stringify(osRes.data));
    const osId = osRes.data.operatingSystem.id;
    for (const key of ['id', 'slug', 'name', 'status', 'isVpsSupported']) {
      assert.ok(key in osRes.data.operatingSystem, `OS DTO carries ${key}`);
    }

    const osList = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/operating-systems' }, admin);
    assert.strictEqual(osList.status, 200);
    assert.ok(osList.data.operatingSystems.some((o) => o.id === osId), 'registry list shows the new OS');

    const verRes = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/admin/operating-systems/${osId}/versions`,
      body: { version: '1.0', displayName: 'ScreenOS 1.0', architectureSupport: ['x86_64'], status: 'DISABLED' },
    }, admin);
    assert.strictEqual(verRes.status, 201, JSON.stringify(verRes.data));
    const versionId = verRes.data.version.id;

    const verList = await jsonFetch(base, { method: 'GET', path: `/api/v1/admin/operating-systems/${osId}/versions` }, admin);
    assert.strictEqual(verList.status, 200);
    const verRow = verList.data.versions.find((v) => v.id === versionId);
    for (const key of ['provider_image_count', 'active_image_count', 'available_region_count']) {
      assert.ok(key in verRow, `version list carries ${key}`);
    }

    // Activation guard: the OS must be active first (refusal verbatim on the screen).
    await jsonFetch(base, { method: 'PATCH', path: `/api/v1/admin/operating-systems/${osId}`, body: { status: 'ARCHIVED' } }, admin);
    const refused = await jsonFetch(base, {
      method: 'PATCH', path: `/api/v1/admin/operating-system-versions/${versionId}`, body: { status: 'ACTIVE' },
    }, admin);
    assert.strictEqual(refused.status, 400);
    assert.match(String(refused.data?.message ?? ''), /must be active before a version can be activated/);

    await jsonFetch(base, { method: 'PATCH', path: `/api/v1/admin/operating-systems/${osId}`, body: { status: 'ACTIVE' } }, admin);
    const patched = await jsonFetch(base, {
      method: 'PATCH', path: `/api/v1/admin/operating-system-versions/${versionId}`,
      body: { status: 'ACTIVE', isDefault: true, isRecommended: true },
    }, admin);
    assert.strictEqual(patched.status, 200, JSON.stringify(patched.data));
    assert.strictEqual(patched.data.version.isDefault, true, 'version DTO carries isDefault');
    assert.strictEqual(patched.data.version.isRecommended, true, 'version DTO carries isRecommended');

    // OS delete guard: archive first.
    const deleteRefused = await jsonFetch(base, { method: 'DELETE', path: `/api/v1/admin/operating-systems/${osId}` }, admin);
    assert.strictEqual(deleteRefused.status, 409);
    assert.match(String(deleteRefused.data?.message ?? ''), /Archive the operating system before deleting it/);

    // ---------------------------------------------------------------- provider image mappings
    const provider = (await jsonFetch(base, {
      method: 'POST', path: '/api/v1/admin/providers',
      body: { name: 'Mock Provider', type: 'MOCK', adapter: 'mock' },
    }, admin)).data.provider.id;
    const activatedProvider = await jsonFetch(base, {
      method: 'PATCH', path: `/api/v1/admin/providers/${provider}`, body: { status: 'ACTIVE' },
    }, admin);
    assert.strictEqual(activatedProvider.status, 200, JSON.stringify(activatedProvider.data));
    const region = (await jsonFetch(base, {
      method: 'POST', path: '/api/v1/admin/regions',
      body: { name: 'Mock Region', code: 'mock1', providerId: provider },
    }, admin)).data.region.id;

    const imgRes = await jsonFetch(base, {
      method: 'POST', path: '/api/v1/admin/os-images',
      body: { osId, providerImageId: 'screen-image-1', regionId: region },
    }, admin);
    assert.strictEqual(imgRes.status, 201, JSON.stringify(imgRes.data));
    const imageId = imgRes.data.image.id;
    for (const key of ['id', 'osId', 'providerImageId', 'regionId', 'verifiedAt', 'active']) {
      assert.ok(key in imgRes.data.image, `image DTO carries ${key}`);
    }

    const imgList = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/os-images' }, admin);
    assert.strictEqual(imgList.status, 200);
    const imgRow = imgList.data.images.find((i) => i.id === imageId);
    for (const key of ['id', 'osId', 'providerImageId', 'regionId', 'verifiedAt', 'verificationError', 'active']) {
      assert.ok(key in imgRow, `image list row carries ${key}`);
    }

    // Test asks the provider for real. A configured adapter that answers is a verification; a
    // provider that cannot answer is a recorded refusal — never a success stamp.
    const verdict = await jsonFetch(base, { method: 'POST', path: `/api/v1/admin/os-images/${imageId}/test`, body: {} }, admin);
    assert.strictEqual(verdict.status, 200, JSON.stringify(verdict.data));
    assert.strictEqual(verdict.data.verified, true, 'a provider that answers for the image verifies it');
    assert.ok(verdict.data.image.verifiedAt, 'a passing test stamps verification on the row');

    // An unconfigured real provider (no credentials, unreachable) records the reason instead.
    const deadProvider = (await jsonFetch(base, {
      method: 'POST', path: '/api/v1/admin/providers',
      body: { name: 'Dead Provider', type: 'hetzner', config: { adapter: 'hetzner' } },
    }, admin)).data.provider.id;
    const deadRegion = (await jsonFetch(base, {
      method: 'POST', path: '/api/v1/admin/regions',
      body: { name: 'Dead Region', code: 'dead1', providerId: deadProvider },
    }, admin)).data.region.id;
    const deadImg = (await jsonFetch(base, {
      method: 'POST', path: '/api/v1/admin/os-images',
      body: { osId, providerImageId: 'screen-image-2', regionId: deadRegion },
    }, admin)).data.image.id;
    const deadVerdict = await jsonFetch(base, { method: 'POST', path: `/api/v1/admin/os-images/${deadImg}/test`, body: {} }, admin);
    assert.strictEqual(deadVerdict.status, 200, JSON.stringify(deadVerdict.data));
    assert.strictEqual(deadVerdict.data.verified, false, 'an unreachable/unconfigured provider is a verdict, not a verification');
    assert.ok(typeof deadVerdict.data.reason === 'string' && deadVerdict.data.reason.length > 0, 'the verdict carries its reason');
    assert.strictEqual(deadVerdict.data.image.verifiedAt, null, 'a failed test never stamps verification');

    const verifications = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/os-image-verifications' }, admin);
    assert.strictEqual(verifications.status, 200);
    assert.ok(verifications.data.images.some((i) => i.id === deadImg), 'unverified mappings appear in the stale list');

    // Re-stamp route: exactly what it promises — a refreshed stamp, outcome REVALIDATED.
    const revalidated = await jsonFetch(base, {
      method: 'POST', path: '/api/v1/admin/os-images/revalidate', body: { staleAfterDays: 0, limit: 200 },
    }, admin);
    assert.strictEqual(revalidated.status, 200, JSON.stringify(revalidated.data));
    assert.ok(revalidated.data.results.some((r) => r.id === deadImg && r.outcome === 'REVALIDATED'), 're-stamp covers stale mappings');

    // Delete guard: disable first.
    const imgDeleteRefused = await jsonFetch(base, { method: 'DELETE', path: `/api/v1/admin/os-images/${deadImg}` }, admin);
    assert.strictEqual(imgDeleteRefused.status, 409);
    assert.match(String(imgDeleteRefused.data?.message ?? ''), /disabled before deletion/);
    await jsonFetch(base, {
      method: 'PATCH', path: `/api/v1/admin/os-images/${deadImg}`, body: { active: false, status: 'disabled' },
    }, admin);
    const imgDeleted = await jsonFetch(base, { method: 'DELETE', path: `/api/v1/admin/os-images/${deadImg}` }, admin);
    assert.ok([200, 204].includes(imgDeleted.status), `disabled mapping deletes: ${imgDeleted.status}`);

    // ---------------------------------------------------------------- server templates
    const product = (await jsonFetch(base, {
      method: 'POST', path: '/api/v1/admin/catalog/products',
      body: { slug: 'screen-servers', name: 'Screen Servers', status: 'active' },
    }, admin)).data.product;
    const planRes = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/admin/catalog/products/${product.id}/plans`,
      body: { slug: 'screen-standard', name: 'Screen Standard', status: 'active' },
    }, admin);
    const planId = planRes.data.plan?.id ?? planRes.data.id;

    const activeRefused = await jsonFetch(base, {
      method: 'POST', path: '/api/v1/admin/server-product-configurations',
      body: {
        planId, providerId: provider, regionId: region, operatingSystemVersionId: versionId,
        architecture: 'x86_64', serverType: 'VPS', status: 'ACTIVE',
        metadata: { cpuCores: 2, memoryMb: 4096, storageMb: 80000, bandwidthGb: 2000, providerServerType: 'cx22' },
      },
    }, admin);
    assert.strictEqual(activeRefused.status, 400);
    assert.match(String(activeRefused.data?.message ?? ''), /Create the configuration disabled/);

    const cfgRes = await jsonFetch(base, {
      method: 'POST', path: '/api/v1/admin/server-product-configurations',
      body: {
        planId, providerId: provider, regionId: region, operatingSystemVersionId: versionId,
        architecture: 'x86_64', serverType: 'VPS', status: 'DISABLED',
        metadata: { cpuCores: 2, memoryMb: 4096, storageMb: 80000, bandwidthGb: 2000, providerServerType: 'cx22' },
      },
    }, admin);
    assert.strictEqual(cfgRes.status, 201, JSON.stringify(cfgRes.data));
    const cfgId = cfgRes.data.configuration.id;
    for (const key of ['id', 'planId', 'providerId', 'regionId', 'operatingSystemVersionId', 'architecture', 'serverType', 'status', 'metadata']) {
      assert.ok(key in cfgRes.data.configuration, `configuration DTO carries ${key}`);
    }

    // Enable gate: a template on an OS with no image mapping at all is refused by name.
    const os2 = (await jsonFetch(base, {
      method: 'POST', path: '/api/v1/admin/operating-systems', body: { name: 'BareOS', slug: 'bareos' },
    }, admin)).data.operatingSystem.id;
    const ver2 = (await jsonFetch(base, {
      method: 'POST', path: `/api/v1/admin/operating-systems/${os2}/versions`,
      body: { version: '1.0', displayName: 'BareOS 1.0', architectureSupport: ['x86_64'], status: 'ACTIVE' },
    }, admin)).data.version.id;
    const cfg2 = (await jsonFetch(base, {
      method: 'POST', path: '/api/v1/admin/server-product-configurations',
      body: {
        planId, providerId: provider, regionId: region, operatingSystemVersionId: ver2,
        architecture: 'x86_64', serverType: 'VPS', status: 'DISABLED',
        metadata: { cpuCores: 2, memoryMb: 4096, storageMb: 80000 },
      },
    }, admin)).data.configuration.id;
    const enableRefused = await jsonFetch(base, {
      method: 'PATCH', path: `/api/v1/admin/server-product-configurations/${cfg2}`, body: { status: 'ACTIVE' },
    }, admin);
    assert.strictEqual(enableRefused.status, 400);
    assert.match(String(enableRefused.data?.message ?? ''), /No verified active provider image supports this exact configuration/);

    // The mapped OS — its image was re-stamped above — enables cleanly: the gate reads real state.
    const enabled = await jsonFetch(base, {
      method: 'PATCH', path: `/api/v1/admin/server-product-configurations/${cfgId}`, body: { status: 'ACTIVE' },
    }, admin);
    assert.strictEqual(enabled.status, 200, JSON.stringify(enabled.data));
    assert.strictEqual(enabled.data.configuration.status, 'ACTIVE');

    const cfgList = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/server-product-configurations' }, admin);
    assert.strictEqual(cfgList.status, 200);
    assert.ok(cfgList.data.configurations.some((c) => c.id === cfgId), 'template list shows the new row');

    const adapters = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/provider-adapters' }, admin);
    assert.strictEqual(adapters.status, 200);
    assert.ok(Array.isArray(adapters.data.adapters), 'adapter capability panel reads adapters');

    // ---------------------------------------------------------------- staff gates
    for (const route of ['/api/v1/admin/operating-systems', '/api/v1/admin/os-images', '/api/v1/admin/server-product-configurations']) {
      const denied = await jsonFetch(base, { method: 'GET', path: route }, cust.data.accessToken);
      assert.strictEqual(denied.status, 403, `customer cannot read ${route}`);
    }

    // ---------------------------------------------------------------- page pins
    for (const key of ['active_image_count', 'available_region_count', 'Create disabled', 'endOfLifeDate']) {
      assert.ok(OS_VERSIONS_SRC.includes(key), `AdminOsVersionsPage renders '${key}'`);
    }
    for (const key of ['verificationError', 'verifiedAt', 'regionId']) {
      assert.ok(OS_IMAGES_SRC.includes(key), `AdminOsImagesPage renders '${key}'`);
    }
    assert.ok(OS_IMAGES_SRC.includes('describeError'), 'refusals (including the delete guard) are rendered verbatim from the server');
    for (const key of ['providerServerType', 'cpuCores', 'capabilities', 'Create disabled', 'metadata']) {
      assert.ok(AVAILABILITY_SRC.includes(key), `AdminAvailabilityPage renders '${key}'`);
    }
    for (const pathPart of [
      '/api/v1/admin/operating-systems', '/api/v1/admin/operating-system-versions/',
      '/api/v1/admin/os-images', '/os-image-verifications', '/api/v1/admin/server-product-configurations',
      '/api/v1/admin/provider-adapters',
    ]) {
      assert.ok(API_CLIENT_SRC.includes(pathPart), `adminApi covers ${pathPart}`);
    }
  } finally {
    await close();
  }
});
