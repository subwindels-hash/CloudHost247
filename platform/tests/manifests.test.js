/**
 * Integration tests for the marketplace manifest surface (marketplace-admin.ts): validate,
 * import and seed-categories.
 *
 * The importer is the only way a catalog application enters the database, so the interesting
 * behaviour is what it refuses: a document that will not parse, a manifest whose id disagrees with
 * its directory, and a catalog directory containing even one invalid file.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, jsonFetch, register } = require('./helpers');

async function adminToken(base, app, email = 'manifests-admin@example.com') {
  await register(base, email, 'SuperSecret123!');
  const user = await app.store.table('users').findOne({ email });
  await app.store.table('users').updateById(user.id, { role: 'super_admin' });
  const login = await jsonFetch(base, {
    path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'SuperSecret123!' },
  });
  return login.data.accessToken;
}

/** A minimal valid manifest, as YAML text and as the object the importer should store. */
function manifestYaml(slug, { category = 'productivity', version = '1.0.0', engine = 'docker-compose' } = {}) {
  return `id: ${slug}
name: ${slug} app
category: ${category}
description: A small application used to exercise the manifest importer.
featured: true
popularity: 42
deployment:
  engine: ${engine}
supportedHostingTypes:
- docker
- vps
requirements:
  cpu: 2
  memory: 1024
  storage: 8192
  recommended:
    cpu: 4
services:
  app:
    image: example/${slug}:latest
    port: 8080
    environment:
      APP_ENV: production
  db:
    image: postgres:16
    internal: true
    database: postgres
environment:
  required:
  - key: SECRET_KEY
    description: Signing key
    secret: true
    generate: random_32
  optional: []
healthcheck:
  type: http
  path: /health
  interval: 30s
versions:
- version: ${version}
  image: example/${slug}:${version}
  stable: true
`;
}

function writeCatalog(dir, files) {
  for (const [slug, contents] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, slug), { recursive: true });
    fs.writeFileSync(path.join(dir, slug, 'manifest.yaml'), contents);
  }
}

test('integration: marketplace manifests', async (t) => {
  const catalogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch247-manifests-'));
  writeCatalog(catalogDir, {
    'alpha-app': manifestYaml('alpha-app'),
    // A category that is not in the canonical list exercises the manifest-driven branch.
    'beta-app': manifestYaml('beta-app', { category: 'custom-niche', version: '2.1.0' }),
  });

  const { base, app, close } = await startServer({ MARKETPLACE_MANIFESTS_DIR: catalogDir });
  try {
    const admin = await adminToken(base, app);
    const customer = (await register(base, 'manifests-customer@example.com')).data.accessToken;

    await t.test('validation reports every problem, and never imports', async () => {
      const ok = await jsonFetch(base, {
        path: '/api/v1/admin/manifests/validate', method: 'POST', body: { manifestYaml: manifestYaml('solo-app') },
      }, admin);
      assert.strictEqual(ok.status, 200);
      assert.deepStrictEqual(ok.data, { valid: true, errors: [] });
      assert.strictEqual((await app.store.table('applications').findOne({ slug: 'solo-app' })), null, 'validating is not importing');

      const bad = await jsonFetch(base, {
        path: '/api/v1/admin/manifests/validate', method: 'POST',
        body: { manifestYaml: 'id: Bad Slug\nname: x\ncategory: x\ndescription: short\nservices: {}\nversions: []\n' },
      }, admin);
      assert.strictEqual(bad.data.valid, false);
      assert.ok(bad.data.errors.some((e) => e.startsWith('id:')), 'the id problem is reported');
      assert.ok(bad.data.errors.some((e) => e.startsWith('services:')), 'every issue is reported at once, not just the first');
      assert.ok(bad.data.errors.some((e) => e.startsWith('versions:')), 'including the versions array');

      const unsupported = await jsonFetch(base, {
        path: '/api/v1/admin/manifests/validate', method: 'POST',
        body: { manifestYaml: 'base: &anchor 1\nid: anchored\n' },
      }, admin);
      assert.strictEqual(unsupported.data.valid, false);
      assert.match(unsupported.data.errors[0], /YAML parse error.*anchors and aliases/s, 'an unsupported construct is refused by name, not guessed');

      const appPort = await jsonFetch(base, {
        path: '/api/v1/admin/manifests/validate', method: 'POST',
        body: { manifestYaml: manifestYaml('no-port').replace('    port: 8080\n', '') },
      }, admin);
      assert.ok(appPort.data.errors.some((e) => e.includes('services.app.port is required')));

      const cpanel = await jsonFetch(base, {
        path: '/api/v1/admin/manifests/validate', method: 'POST',
        body: { manifestYaml: manifestYaml('cpanel-app', { engine: 'cpanel' }) },
      }, admin);
      assert.ok(cpanel.data.errors.some((e) => e.includes('must list "cpanel"')));

      assert.strictEqual((await jsonFetch(base, { path: '/api/v1/admin/manifests/validate', method: 'POST', body: { manifestYaml: 'x' } })).status, 401);
      assert.strictEqual((await jsonFetch(base, { path: '/api/v1/admin/manifests/validate', method: 'POST', body: { manifestYaml: 'x' } }, customer)).status, 403);
      assert.strictEqual((await jsonFetch(base, { path: '/api/v1/admin/manifests/validate', method: 'POST', body: {} }, admin)).status, 400);
    });

    await t.test('every shipped manifest validates through the API', async () => {
      const shipped = path.join(__dirname, '..', '..', 'cloudhost247-node', 'manifests');
      if (!fs.existsSync(shipped)) return; // the reference implementation is not part of every checkout
      const slugs = fs.readdirSync(shipped).filter((slug) => fs.existsSync(path.join(shipped, slug, 'manifest.yaml')));
      assert.ok(slugs.length > 40, `the catalog ships ${slugs.length} manifests`);
      for (const slug of slugs) {
        const body = fs.readFileSync(path.join(shipped, slug, 'manifest.yaml'), 'utf8');
        const res = await jsonFetch(base, { path: '/api/v1/admin/manifests/validate', method: 'POST', body: { manifestYaml: body } }, admin);
        assert.strictEqual(res.status, 200, slug);
        assert.strictEqual(res.data.valid, true, `${slug}: ${JSON.stringify(res.data.errors)}`);
      }
    });

    await t.test('the canonical category tree is seeded once', async () => {
      const first = await jsonFetch(base, { path: '/api/v1/admin/manifests/seed-categories', method: 'POST', body: {} }, admin);
      assert.strictEqual(first.status, 200);
      assert.ok(first.data.created.includes('ai'));
      assert.ok(first.data.created.includes('web-hosting'));
      assert.strictEqual(first.data.created.length, 24);

      const second = await jsonFetch(base, { path: '/api/v1/admin/manifests/seed-categories', method: 'POST', body: {} }, admin);
      assert.deepStrictEqual(second.data.created, [], 'seeding never duplicates or overwrites admin edits');
    });

    await t.test('importing the catalog creates draft applications and their versions', async () => {
      const res = await jsonFetch(base, { path: '/api/v1/admin/manifests/import', method: 'POST', body: {} }, admin);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.imported, 2);
      assert.deepStrictEqual(res.data.report.applicationsCreated.sort(), ['alpha-app', 'beta-app']);
      assert.strictEqual(res.data.report.versionsUpserted, 2);
      assert.ok(res.data.report.categoriesCreated.includes('custom-niche'), 'a category the manifest needs but the tree lacks is created');
      const niche = await app.store.table('application_categories').findOne({ slug: 'custom-niche' });
      assert.strictEqual(niche.sort_order, 500, 'a non-canonical category sorts after the canonical tree');
      assert.strictEqual(niche.name, 'custom-niche', 'and has no display name to borrow');

      const alpha = await app.store.table('applications').findOne({ slug: 'alpha-app' });
      assert.strictEqual(alpha.status, 'draft', 'the importer never publishes — approval does that');
      assert.strictEqual(alpha.deployment_type, 'docker_compose');
      assert.strictEqual(alpha.min_cpu, 2);
      assert.strictEqual(alpha.min_memory_mb, 1024);
      assert.strictEqual(alpha.recommended_cpu, 4, 'the nested recommended block the shipped catalog uses is honoured');
      assert.strictEqual(alpha.recommended_memory_mb, 1024);
      assert.strictEqual(alpha.featured, true);
      assert.strictEqual(alpha.popularity, 42);
      assert.deepStrictEqual(alpha.supported_hosting_types, ['docker', 'vps']);
      const category = await app.store.table('application_categories').findById(alpha.category_id);
      assert.strictEqual(category.slug, 'productivity');

      const versions = await app.store.table('application_versions').find({ application_id: alpha.id });
      assert.strictEqual(versions.rows.length, 1);
      assert.strictEqual(versions.rows[0].version, '1.0.0');
      assert.strictEqual(versions.rows[0].status, 'draft');
      assert.strictEqual(versions.rows[0].is_stable, true);
      assert.strictEqual(versions.rows[0].manifest.services.app.port, 8080, 'the validated document is stored whole');
      assert.strictEqual(versions.rows[0].manifest.environment.required[0].generate, 'random_32');

      const audit = await app.store.table('audit_logs').findOne({ action: 'marketplace.imported' });
      assert.ok(audit, 'the import is audited');
      assert.strictEqual(audit.entity_type, 'marketplace');
    });

    await t.test('re-importing updates in place instead of duplicating', async () => {
      const res = await jsonFetch(base, { path: '/api/v1/admin/manifests/import', method: 'POST', body: {} }, admin);
      assert.strictEqual(res.data.report.applicationsCreated.length, 0);
      assert.deepStrictEqual(res.data.report.applicationsUpdated.sort(), ['alpha-app', 'beta-app']);
      assert.strictEqual((await app.store.table('applications').all()).filter((a) => a.slug === 'alpha-app').length, 1);
      const alpha = await app.store.table('applications').findOne({ slug: 'alpha-app' });
      const beta = await app.store.table('applications').findOne({ slug: 'beta-app' });
      const versions = await app.store.table('application_versions').all();
      assert.strictEqual(versions.filter((v) => v.application_id === alpha.id).length, 1, 'one version row per application, not per import');
      assert.strictEqual(versions.filter((v) => v.application_id === beta.id).length, 1);
      assert.strictEqual(versions.length, 2);
    });

    await t.test('one invalid file in the catalog blocks the whole import', async () => {
      writeCatalog(catalogDir, { 'broken-app': 'id: broken-app\nname: Broken\n' });
      const res = await jsonFetch(base, { path: '/api/v1/admin/manifests/import', method: 'POST', body: {} }, admin);
      assert.strictEqual(res.status, 400);
      assert.match(res.data.message, /Refusing to import: 1 invalid manifest/);
      assert.match(res.data.message, /broken-app\/manifest\.yaml/);
      fs.rmSync(path.join(catalogDir, 'broken-app'), { recursive: true, force: true });
    });

    await t.test('a manifest whose id disagrees with its directory is refused', async () => {
      writeCatalog(catalogDir, { 'mismatched-app': manifestYaml('something-else') });
      const res = await jsonFetch(base, { path: '/api/v1/admin/manifests/import', method: 'POST', body: {} }, admin);
      assert.strictEqual(res.status, 400);
      assert.match(res.data.message, /does not match directory name/);
      fs.rmSync(path.join(catalogDir, 'mismatched-app'), { recursive: true, force: true });
    });

    await t.test('an empty directory is reported rather than silently succeeding', async () => {
      const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ch247-empty-'));
      const { base: otherBase, app: otherApp, close: closeOther } = await startServer({ MARKETPLACE_MANIFESTS_DIR: empty });
      try {
        const otherAdmin = await adminToken(otherBase, otherApp, 'empty-admin@example.com');
        const res = await jsonFetch(otherBase, { path: '/api/v1/admin/manifests/import', method: 'POST', body: {} }, otherAdmin);
        assert.strictEqual(res.status, 400);
        assert.match(res.data.message, /No manifests found/);
      } finally {
        await closeOther();
        fs.rmSync(empty, { recursive: true, force: true });
      }
    });
    await t.test('the catalog the platform ships with imports through the default directory', async () => {
      const { base: ownBase, app: ownApp, close: closeOwn } = await startServer();
      try {
        const ownAdmin = await adminToken(ownBase, ownApp, 'own-admin@example.com');
        const res = await jsonFetch(ownBase, { path: '/api/v1/admin/manifests/import', method: 'POST', body: {} }, ownAdmin);
        assert.strictEqual(res.status, 200);
        assert.ok(res.data.imported >= 50, `the shipped catalog imported ${res.data.imported} manifests`);
        assert.strictEqual(res.data.report.applicationsCreated.length, res.data.imported);
        // A handful of manifests publish more than one version, so this is a floor, not equality.
        assert.ok(res.data.report.versionsUpserted >= res.data.imported);
      } finally {
        await closeOwn();
      }
    });
  } finally {
    await close();
    fs.rmSync(catalogDir, { recursive: true, force: true });
  }
});
