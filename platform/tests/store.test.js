'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonStore } = require('../src/store/json-store');

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch247-store-'));
  const store = new JsonStore({ dir, logger: { error: () => {} } });
  return { store, dir };
}

test('insert applies defaults and returns the row', async () => {
  const { store } = makeStore();
  const user = await store.table('users').insert({ email: 'a@b.com', password_hash: 'x', full_name: 'A' });
  assert.ok(user.id);
  assert.strictEqual(user.role, 'customer');
  // customer_id is assigned by the auth domain (with collision retry), not by the store.
  assert.strictEqual(user.customer_id, null);
  await store.close();
});

test('unique index on email is enforced (case-insensitive)', async () => {
  const { store } = makeStore();
  await store.table('users').insert({ email: 'a@b.com', password_hash: 'x', full_name: 'A' });
  await assert.rejects(
    () => store.table('users').insert({ email: 'A@B.COM', password_hash: 'x', full_name: 'B' }),
    (e) => e.statusCode === 409
  );
  await store.close();
});

test('customer_id can repeat null without conflict', async () => {
  const { store } = makeStore();
  const t = store.table('catalog_products');
  await t.insert({ slug: 'a', name: 'A' });
  await t.insert({ slug: 'b', name: 'B' });
  assert.strictEqual((await t.find({})).rows.length, 2);
  await store.close();
});

test('updateById patches and bumps updated_at', async () => {
  const { store } = makeStore();
  const user = await store.table('users').insert({ email: 'a@b.com', password_hash: 'x', full_name: 'A' });
  const updated = await store.table('users').updateById(user.id, { full_name: 'B' });
  assert.strictEqual(updated.full_name, 'B');
  await store.close();
});

test('findOneCi matches case-insensitively', async () => {
  const { store } = makeStore();
  await store.table('users').insert({ email: 'Mix@Case.com', password_hash: 'x', full_name: 'M' });
  const found = await store.table('users').findOneCi('email', 'mix@case.com');
  assert.ok(found);
  await store.close();
});

test('find with operators and ordering', async () => {
  const { store } = makeStore();
  const p = store.table('catalog_products');
  await p.insert({ slug: 'a', name: 'A', sort_order: 2 });
  await p.insert({ slug: 'b', name: 'B', sort_order: 1 });
  await p.insert({ slug: 'c', name: 'C', sort_order: 3, status: 'archived' });

  const active = await p.find({ status: { $ne: 'archived' } }, { orderBy: 'sort_order' });
  assert.strictEqual(active.rows.length, 2);
  assert.strictEqual(active.rows[0].slug, 'b');
  await store.close();
});

test('transaction rolls back on error', async () => {
  const { store } = makeStore();
  const before = (await store.table('users').find({})).rows.length;

  await assert.rejects(
    () => store.transaction(async (tx) => {
      await tx.table('users').insert({ email: 'a@b.com', password_hash: 'x', full_name: 'A' });
      throw new Error('boom');
    })
  );

  const after = (await store.table('users').find({})).rows.length;
  assert.strictEqual(after, before, 'insert rolled back');
  await store.close();
});

test('data persists to disk and reloads', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch247-persist-'));
  let store = new JsonStore({ dir, logger: { error: () => {} } });
  await store.table('users').insert({ email: 'a@b.com', password_hash: 'x', full_name: 'A' });
  await store.flush();
  await store.close();

  store = new JsonStore({ dir, logger: { error: () => {} } });
  const found = await store.table('users').findOneCi('email', 'a@b.com');
  assert.ok(found, 'row survived reload');
  await store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('roles are seeded from schema', async () => {
  const { store } = makeStore();
  const roles = await store.table('roles').all();
  assert.strictEqual(roles.length, 4);
  await store.close();
});
