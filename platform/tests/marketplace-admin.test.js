/**
 * Integration tests for the app-category admin surface (marketplace-admin.ts):
 * GET/POST /admin/app-categories and PATCH /admin/app-categories/:id.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, jsonFetch, register } = require('./helpers');

async function adminToken(base, app, email = 'cat-admin@example.com') {
  await register(base, email, 'SuperSecret123!');
  const user = await app.store.table('users').findOne({ email });
  await app.store.table('users').updateById(user.id, { role: 'super_admin' });
  const login = await jsonFetch(base, {
    path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'SuperSecret123!' },
  });
  return login.data.accessToken;
}

test('integration: admin app categories', async (t) => {
  const { base, app, close } = await startServer();
  try {
    const admin = await adminToken(base, app);
    const customer = (await register(base, 'cat-cust@example.com')).data.accessToken;

    await t.test('the surface is staff-only', async () => {
      assert.strictEqual((await jsonFetch(base, { path: '/api/v1/admin/app-categories' }, customer)).status, 403);
      assert.strictEqual(
        (await jsonFetch(base, { path: '/api/v1/admin/app-categories', method: 'POST', body: { name: 'X', slug: 'x' } }, customer)).status,
        403,
      );
    });

    let categoryId;
    await t.test('POST creates a category and audits it', async () => {
      const res = await jsonFetch(base, {
        path: '/api/v1/admin/app-categories', method: 'POST',
        body: { name: 'E-commerce', slug: 'ecommerce', description: 'Shops', sortOrder: 5 },
      }, admin);
      assert.strictEqual(res.status, 201);
      categoryId = res.data.category.id;
      assert.strictEqual(res.data.category.name, 'E-commerce');
      assert.strictEqual(res.data.category.slug, 'ecommerce');
      assert.strictEqual(res.data.category.sort_order, 5);
      assert.strictEqual(res.data.category.active, true, 'active defaults to true');
      assert.ok(res.data.category.created_at);

      const auditRow = await app.store.table('audit_logs').findOne({ action: 'app_category.created', entity_id: categoryId });
      assert.ok(auditRow, 'creation is audited');
      assert.strictEqual(auditRow.entity_type, 'application_category');
      assert.strictEqual(auditRow.after.slug, 'ecommerce');
    });

    await t.test('the slug is validated and unique', async () => {
      const upper = await jsonFetch(base, {
        path: '/api/v1/admin/app-categories', method: 'POST', body: { name: 'Bad', slug: 'Not-Slugged' },
      }, admin);
      assert.strictEqual(upper.status, 400, 'slugs are lowercase with single hyphens');

      const spaced = await jsonFetch(base, {
        path: '/api/v1/admin/app-categories', method: 'POST', body: { name: 'Bad', slug: 'two  spaces' },
      }, admin);
      assert.strictEqual(spaced.status, 400);

      const dupe = await jsonFetch(base, {
        path: '/api/v1/admin/app-categories', method: 'POST', body: { name: 'Again', slug: 'ecommerce' },
      }, admin);
      assert.strictEqual(dupe.status, 409);
      assert.match(dupe.data.message, /Category "ecommerce" already exists/);

      const badUrl = await jsonFetch(base, {
        path: '/api/v1/admin/app-categories', method: 'POST', body: { name: 'X', slug: 'x', iconUrl: 'not-a-url' },
      }, admin);
      assert.strictEqual(badUrl.status, 400, 'iconUrl must be a URL');
    });

    await t.test('GET lists every category, ordered sort_order then name', async () => {
      await jsonFetch(base, {
        path: '/api/v1/admin/app-categories', method: 'POST', body: { name: 'Blogging', slug: 'blogging', sortOrder: 1 },
      }, admin);
      await jsonFetch(base, {
        path: '/api/v1/admin/app-categories', method: 'POST', body: { name: 'Hidden', slug: 'hidden', sortOrder: 2, active: false },
      }, admin);

      const res = await jsonFetch(base, { path: '/api/v1/admin/app-categories' }, admin);
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(res.data.categories.map((c) => c.slug), ['blogging', 'hidden', 'ecommerce'],
        'sort_order first; inactive included on the admin surface');
    });

    await t.test('the public listing hides inactive categories', async () => {
      const res = await jsonFetch(base, { path: '/api/v1/app-categories' });
      assert.deepStrictEqual(res.data.categories.map((c) => c.slug), ['blogging', 'ecommerce']);
    });

    await t.test('PATCH applies a partial update', async () => {
      const res = await jsonFetch(base, {
        path: `/api/v1/admin/app-categories/${categoryId}`, method: 'PATCH',
        body: { description: 'Online shops', sortOrder: 0, active: false },
      }, admin);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.category.description, 'Online shops');
      assert.strictEqual(res.data.category.sort_order, 0);
      assert.strictEqual(res.data.category.active, false);
      assert.strictEqual(res.data.category.name, 'E-commerce', 'untouched fields survive');

      const auditRow = await app.store.table('audit_logs').findOne({ action: 'app_category.updated', entity_id: categoryId });
      assert.ok(auditRow, 'the update is audited');
    });

    await t.test('PATCH validates the id and a slug clash', async () => {
      assert.strictEqual(
        (await jsonFetch(base, { path: '/api/v1/admin/app-categories/not-a-uuid', method: 'PATCH', body: { name: 'X' } }, admin)).status,
        400,
      );
      const unknown = await jsonFetch(base, {
        path: '/api/v1/admin/app-categories/00000000-0000-0000-0000-000000000099', method: 'PATCH', body: { name: 'X' },
      }, admin);
      assert.strictEqual(unknown.status, 404);
      assert.match(unknown.data.message, /No category was found with that id/);

      const clash = await jsonFetch(base, {
        path: `/api/v1/admin/app-categories/${categoryId}`, method: 'PATCH', body: { slug: 'blogging' },
      }, admin);
      assert.strictEqual(clash.status, 409, 'another category already owns that slug');

      const ownSlug = await jsonFetch(base, {
        path: `/api/v1/admin/app-categories/${categoryId}`, method: 'PATCH', body: { slug: 'ecommerce' },
      }, admin);
      assert.strictEqual(ownSlug.status, 200, 'keeping its own slug is not a clash');
    });
  } finally {
    await close();
  }
});
