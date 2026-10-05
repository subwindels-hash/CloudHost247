/**
 * Operating-system availability: what the customer catalogue offers versus what can be built.
 *
 * The catalogue used to return every ACTIVE operating system and every non-retired version whatever
 * the infrastructure behind them looked like, so a customer could pick an OS whose image mapping had
 * never been verified — and the provisioning worker would refuse to build it. These tests drive the
 * real routes over the real HTTP pipeline and assert both directions: a fully mapped version is
 * offered, and every way of being unmapped produces its own named reason rather than a shorter list
 * with no explanation.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { startServer, jsonFetch, register } = require('./helpers');

const now = () => new Date().toISOString();
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('integration: operating-system availability', async (t) => {
  const { base, app, close } = await startServer({});
  try {
    await register(base, 'os-admin@example.com', 'SuperSecret123!');
    const adminUser = await app.store.table('users').findOne({ email: 'os-admin@example.com' });
    await app.store.table('users').updateById(adminUser.id, { role: 'super_admin' });
    const admin = (await jsonFetch(base, {
      path: '/api/v1/auth/login', method: 'POST', body: { email: 'os-admin@example.com', password: 'SuperSecret123!' },
    })).data.accessToken;

    await register(base, 'os-customer@example.com', 'SuperSecret123!');
    const customer = (await jsonFetch(base, {
      path: '/api/v1/auth/login', method: 'POST', body: { email: 'os-customer@example.com', password: 'SuperSecret123!' },
    })).data.accessToken;

    // One provider, two regions — the second exists so "verified in one region, not the other" can
    // be exercised rather than assumed.
    const provider = (await jsonFetch(base, {
      path: '/api/v1/admin/providers', method: 'POST',
      body: { name: 'Hetzner OS', type: 'hetzner', config: { adapter: 'hetzner' } },
    }, admin)).data.provider.id;
    await jsonFetch(base, { path: `/api/v1/admin/providers/${provider}`, method: 'PATCH', body: { status: 'ACTIVE' } }, admin);
    const regionA = (await jsonFetch(base, {
      path: '/api/v1/admin/regions', method: 'POST', body: { name: 'Falkenstein', code: 'fsn1', providerId: provider },
    }, admin)).data.region.id;
    const regionB = (await jsonFetch(base, {
      path: '/api/v1/admin/regions', method: 'POST', body: { name: 'Helsinki', code: 'hel1', providerId: provider },
    }, admin)).data.region.id;

    const planId = uuid(1);
    await app.store.table('server_plans').insert({
      id: planId, name: 'CX22', slug: 'cx22', active: true, spec: { providerServerType: 'cx22' }, created_at: now(),
    });

    // Ubuntu: one fully mapped version, one with a config but an unverified image.
    const ubuntuId = uuid(10);
    await app.store.table('operating_systems').insert({
      id: ubuntuId, slug: 'ubuntu', name: 'Ubuntu', family: 'debian', vendor: 'Canonical',
      status: 'ACTIVE', is_vps_supported: true, is_dedicated_supported: true,
      created_at: now(), updated_at: now(),
    });
    const ubuntu2404 = uuid(11);
    const ubuntu2204 = uuid(12);
    await app.store.table('operating_system_versions').insert({
      id: ubuntu2404, operating_system_id: ubuntuId, version: '24.04', display_name: 'Ubuntu 24.04 LTS',
      architecture_support: ['x86_64'], status: 'ACTIVE', is_lts: true, is_default: true,
      created_at: now(), updated_at: now(),
    });
    await app.store.table('operating_system_versions').insert({
      id: ubuntu2204, operating_system_id: ubuntuId, version: '22.04', display_name: 'Ubuntu 22.04 LTS',
      architecture_support: ['x86_64'], status: 'ACTIVE', is_lts: true, is_default: false,
      created_at: now(), updated_at: now(),
    });

    // Debian: active OS, but its only version has no configuration at all.
    const debianId = uuid(20);
    await app.store.table('operating_systems').insert({
      id: debianId, slug: 'debian', name: 'Debian', family: 'debian', vendor: 'Debian Project',
      status: 'ACTIVE', is_vps_supported: true, created_at: now(), updated_at: now(),
    });
    const debian12 = uuid(21);
    await app.store.table('operating_system_versions').insert({
      id: debian12, operating_system_id: debianId, version: '12', display_name: 'Debian 12',
      architecture_support: ['x86_64'], status: 'ACTIVE', created_at: now(), updated_at: now(),
    });

    // A disabled OS that *is* fully mapped: it must still be excluded, because status is a separate
    // question from availability and the old route answered neither.
    const legacyId = uuid(30);
    await app.store.table('operating_systems').insert({
      id: legacyId, slug: 'centos', name: 'CentOS', family: 'rhel', vendor: 'CentOS',
      status: 'DISABLED', is_vps_supported: true, created_at: now(), updated_at: now(),
    });
    const centos7 = uuid(31);
    await app.store.table('operating_system_versions').insert({
      id: centos7, operating_system_id: legacyId, version: '7', display_name: 'CentOS 7',
      architecture_support: ['x86_64'], status: 'EOL', created_at: now(), updated_at: now(),
    });

    // Images: 24.04 verified in region A; 22.04 mapped but never verified; CentOS 7 verified.
    await app.store.table('os_images').insert({
      id: uuid(40), os_id: ubuntuId, version: '24.04', provider_image_id: 'ubuntu-24.04', region_id: regionA,
      arch: 'x86_64', status: 'active', active: true, verified_at: now(), verified_by: adminUser.id,
      created_at: now(), updated_at: now(),
    });
    await app.store.table('os_images').insert({
      id: uuid(41), os_id: ubuntuId, version: '22.04', provider_image_id: 'ubuntu-22.04', region_id: regionA,
      arch: 'x86_64', status: 'active', active: true, verified_at: null,
      created_at: now(), updated_at: now(),
    });
    await app.store.table('os_images').insert({
      id: uuid(42), os_id: legacyId, version: '7', provider_image_id: 'centos-7', region_id: regionA,
      arch: 'x86_64', status: 'active', active: true, verified_at: now(), verified_by: adminUser.id,
      created_at: now(), updated_at: now(),
    });

    // Configurations: 24.04 active; 22.04 active (image is the missing half); CentOS 7 active.
    const mkConfig = (id, versionId, status, regionId = regionA, architecture = 'x86_64') => app.store.table('server_product_configurations').insert({
      id, plan_id: planId, provider_id: provider, region_id: regionId,
      operating_system_version_id: versionId, architecture, server_type: 'VPS', status,
      created_at: now(), updated_at: now(),
    });
    await mkConfig(uuid(50), ubuntu2404, 'ACTIVE');
    await mkConfig(uuid(51), ubuntu2204, 'ACTIVE');
    await mkConfig(uuid(52), centos7, 'ACTIVE');

    await t.test('the versions route offers only what can be built, and says what it hid', async () => {
      const res = await jsonFetch(base, { path: `/api/v1/operating-systems/${ubuntuId}/versions` }, customer);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.versions.length, 1);
      assert.strictEqual(res.data.versions[0].version, '24.04');
      assert.strictEqual(res.data.versions[0].availability.orderable, true);
      assert.strictEqual(res.data.hidden, 1, 'the caller is told something was withheld, not left guessing');
    });

    await t.test('staff can see the withheld versions with the reason attached', async () => {
      const res = await jsonFetch(base, {
        path: `/api/v1/operating-systems/${ubuntuId}/versions?includeUnavailable=true`,
      }, admin);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.versions.length, 2);
      assert.strictEqual(res.data.hidden, 0);
      const withheld = res.data.versions.find((v) => v.version === '22.04');
      assert.strictEqual(withheld.availability.orderable, false);
      assert.match(withheld.availability.reason, /not been verified against the provider/,
        'the reason names the actual gap, which is what an operator has to fix');
    });

    await t.test('a customer cannot ask for the unavailable list', async () => {
      const res = await jsonFetch(base, {
        path: `/api/v1/operating-systems/${ubuntuId}/versions?includeUnavailable=true`,
      }, customer);
      assert.strictEqual(res.status, 403, 'the unfiltered catalogue is staff-only');
    });

    await t.test('each way of being unmapped gets its own reason', async () => {
      const res = await jsonFetch(base, {
        path: `/api/v1/operating-systems/${debianId}/versions?includeUnavailable=true`,
      }, admin);
      const debian = res.data.versions[0];
      assert.match(debian.availability.reason, /No product configuration/, 'no configuration at all');

      // A configuration that exists but is switched off is a different fix from having none.
      await app.store.table('server_product_configurations').insert({
        id: uuid(60), plan_id: planId, provider_id: provider, region_id: regionA,
        operating_system_version_id: debian12, architecture: 'x86_64', server_type: 'VPS',
        status: 'DISABLED', created_at: now(), updated_at: now(),
      });
      const disabled = await jsonFetch(base, {
        path: `/api/v1/operating-systems/${debianId}/versions?includeUnavailable=true`,
      }, admin);
      assert.match(disabled.data.versions[0].availability.reason, /none of them is active/);
    });

    await t.test('a configuration using an unsupported architecture is refused', async () => {
      const armVersion = uuid(70);
      await app.store.table('operating_system_versions').insert({
        id: armVersion, operating_system_id: debianId, version: '12-arm', display_name: 'Debian 12 (x86 only build)',
        architecture_support: ['x86_64'], status: 'ACTIVE', created_at: now(), updated_at: now(),
      });
      await mkConfig(uuid(71), armVersion, 'ACTIVE', regionA, 'arm64');
      const res = await jsonFetch(base, {
        path: `/api/v1/operating-systems/${debianId}/versions?includeUnavailable=true`,
      }, admin);
      const row = res.data.versions.find((v) => v.id === armVersion);
      assert.match(row.availability.reason, /architecture this version does not support/);
    });

    await t.test('a version verified in one region is orderable even if another region has no image', async () => {
      // The same 24.04 gets a second configuration in region B, where no image mapping exists. The
      // region-A mapping still makes it orderable — availability is "any region can build it".
      await mkConfig(uuid(80), ubuntu2404, 'ACTIVE', regionB);
      const res = await jsonFetch(base, { path: `/api/v1/operating-systems/${ubuntuId}/versions` }, customer);
      assert.strictEqual(res.data.versions.length, 1);
      assert.strictEqual(res.data.versions[0].version, '24.04');
      assert.strictEqual(res.data.versions[0].availability.orderable, true);
      assert.strictEqual(res.data.versions[0].availability.regionId, regionA, 'and it names the region that can build it');
    });

    await t.test('the OS list offers only ACTIVE systems with an orderable version', async () => {
      const res = await jsonFetch(base, { path: '/api/v1/operating-systems' }, customer);
      assert.strictEqual(res.status, 200);
      const slugs = res.data.operatingSystems.map((o) => o.slug);
      assert.deepStrictEqual(slugs, ['ubuntu'], 'Debian has no orderable version and CentOS is disabled');
      assert.strictEqual(res.data.operatingSystems[0].orderableVersions, 1);
    });

    await t.test('verifying the outstanding image makes the version appear for customers', async () => {
      await app.store.table('os_images').updateById(uuid(41), { verified_at: now(), verified_by: adminUser.id });
      const versions = await jsonFetch(base, { path: `/api/v1/operating-systems/${ubuntuId}/versions` }, customer);
      assert.strictEqual(versions.data.versions.length, 2, 'the gap was closed, so the option appears');
      assert.strictEqual(versions.data.hidden, 0);
      const list = await jsonFetch(base, { path: '/api/v1/operating-systems' }, customer);
      assert.strictEqual(list.data.operatingSystems[0].orderableVersions, 2);
    });
  } finally {
    await close();
  }
});
