/**
 * Integration tests for the ported domains. Boots the real app over HTTP (see helpers.js) and
 * exercises a representative slice of each newly ported module end-to-end: routing, validation,
 * auth/ownership, the store, and the commerce -> payment -> ledger flow.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { startServer, jsonFetch, register } = require('./helpers');

const WEBHOOK_SECRET = 'test-sandbox-webhook-secret-0123456789';

/** Seed a minimal published catalogue so the cart -> order flow has something to buy. */
async function seedCatalog(store) {
  const product = await store.table('catalog_products').insert({
    slug: 'web-hosting', name: 'Web Hosting', category: 'hosting', status: 'active',
  });
  const plan = await store.table('catalog_product_plans').insert({
    product_id: product.id, slug: 'starter', name: 'Starter', status: 'active',
  });
  await store.table('catalog_plan_pricing').insert({
    plan_id: plan.id, currency: 'USD', billing_cycle: 'monthly',
    price: 9.99, setup_fee: 0, is_active: true,
  });
  return { product, plan };
}

async function adminToken(base, app, email = 'admin@example.com') {
  await register(base, email, 'SuperSecret123!');
  const user = await app.store.table('users').findOne({ email });
  await app.store.table('users').updateById(user.id, { role: 'super_admin' });
  const login = await jsonFetch(base, {
    path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'SuperSecret123!' },
  });
  return login.data.accessToken;
}

test('integration: ported domains over real HTTP', async (t) => {
  const { base, app, close } = await startServer({
    SANDBOX_GATEWAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    SANDBOX_PAYMENTS: 'true',
  });
  await seedCatalog(app.store);

  const reg = await register(base, 'customer@example.com');
  const token = reg.data.accessToken;
  assert.ok(token, 'customer registered');

  // ---- commerce -> order -> invoice --------------------------------------
  let invoiceId;
  await t.test('cart add + checkout creates order and invoice', async () => {
    const add = await jsonFetch(base, {
      path: '/api/v1/cart/items', method: 'POST',
      body: { planSlug: 'starter', billingCycle: 'monthly', quantity: 1 },
    }, token);
    assert.strictEqual(add.status, 201);

    const order = await jsonFetch(base, { path: '/api/v1/orders', method: 'POST', body: {} }, token);
    assert.strictEqual(order.status, 201);
    assert.ok(order.data.orderId);
    invoiceId = order.data.invoiceId;
    assert.ok(invoiceId);
  });

  await t.test('billing lists the invoice with a balance due', async () => {
    const inv = await jsonFetch(base, { path: '/api/v1/invoices' }, token);
    assert.strictEqual(inv.status, 200);
    const found = inv.data.invoices.find((i) => i.id === invoiceId);
    assert.ok(found, 'invoice present');
    assert.strictEqual(found.status, 'unpaid');
  });

  // ---- payments -> webhook -> ledger -------------------------------------
  await t.test('sandbox payment completes through the signed webhook and marks the invoice paid', async () => {
    const initiate = await jsonFetch(base, {
      path: '/api/v1/payments', method: 'POST', body: { invoiceId, gateway: 'sandbox' },
    }, token);
    assert.strictEqual(initiate.status, 201);
    assert.ok(initiate.data.paymentId);

    const complete = await jsonFetch(base, {
      path: `/api/v1/payments/${initiate.data.paymentId}/sandbox/complete`, method: 'POST', body: {},
    }, token);
    assert.strictEqual(complete.status, 200);
    assert.strictEqual(complete.data.applied, true);

    const after = await jsonFetch(base, { path: '/api/v1/invoices' }, token);
    const paid = after.data.invoices.find((i) => i.id === invoiceId);
    assert.strictEqual(paid.status, 'paid');
  });

  await t.test('paying an already-paid invoice is rejected', async () => {
    const again = await jsonFetch(base, {
      path: '/api/v1/payments', method: 'POST', body: { invoiceId, gateway: 'sandbox' },
    }, token);
    assert.strictEqual(again.status, 400);
  });

  // ---- domains / dns / ssl ------------------------------------------------
  await t.test('domain availability is honest about being an estimate', async () => {
    const avail = await jsonFetch(base, { path: '/api/v1/domains/availability?domain=example.com' }, token);
    assert.strictEqual(avail.status, 200);
    assert.strictEqual(typeof avail.data.available, 'boolean');
    // A structural answer must be flagged as an estimate until a registrar connector exists.
    assert.strictEqual(avail.data.estimate, true);
  });

  let zoneId;
  await t.test('create domain, dns zone + record, ssl cert', async () => {
    const dom = await jsonFetch(base, { path: '/api/v1/domains', method: 'POST', body: { domain: 'example.com' } }, token);
    assert.strictEqual(dom.status, 201);

    const zone = await jsonFetch(base, { path: '/api/v1/dns/zones', method: 'POST', body: { domain: 'example.com' } }, token);
    assert.strictEqual(zone.status, 201);
    zoneId = zone.data.id;

    const rec = await jsonFetch(base, {
      path: '/api/v1/dns/records', method: 'POST',
      body: { zoneId, type: 'A', name: '@', content: '203.0.113.10', ttl: 3600 },
    }, token);
    assert.strictEqual(rec.status, 201);

    const ssl = await jsonFetch(base, { path: '/api/v1/ssl/certificates', method: 'POST', body: { domain: 'example.com' } }, token);
    assert.strictEqual(ssl.status, 201);
    assert.strictEqual(ssl.data.certificate.status, 'pending');
  });

  await t.test('dns record on a zone you do not own is refused', async () => {
    const other = await register(base, 'other@example.com');
    const rec = await jsonFetch(base, {
      path: '/api/v1/dns/records', method: 'POST',
      body: { zoneId, type: 'A', name: '@', content: '203.0.113.11' },
    }, other.data.accessToken);
    assert.ok(rec.status === 404 || rec.status === 403, `expected refusal, got ${rec.status}`);
  });

  // ---- firewall -----------------------------------------------------------
  await t.test('firewall is per-server and honestly refuses (no provider/agent)', async () => {
    const srv = await jsonFetch(base, { path: '/api/v1/servers', method: 'POST', body: { name: 'fw-vps' } }, token);
    const sid = srv.data.server.id;

    const list = await jsonFetch(base, { path: `/api/v1/servers/${sid}/firewall` }, token);
    assert.strictEqual(list.status, 400, 'managed firewall refuses without a provider/agent');
    assert.match(list.data.message, /Managed firewall is unavailable/);

    // A server you do not own is a 404, not a 400.
    const other = await register(base, 'fw-intruder@example.com');
    const denied = await jsonFetch(base, { path: `/api/v1/servers/${sid}/firewall` }, other.data.accessToken);
    assert.strictEqual(denied.status, 404);
  });

  // ---- servers / deployments / licenses ----------------------------------
  await t.test('server, deployment, license creation', async () => {
    const srv = await jsonFetch(base, { path: '/api/v1/servers', method: 'POST', body: { name: 'my-vps' } }, token);
    assert.strictEqual(srv.status, 201);

    const dep = await jsonFetch(base, { path: '/api/v1/deployments', method: 'POST', body: { source: 'github', ref: 'main' } }, token);
    assert.strictEqual(dep.status, 201);

    const lic = await jsonFetch(base, { path: '/api/v1/licenses', method: 'POST', body: { product: 'Panel' } }, token);
    assert.strictEqual(lic.status, 201);
    assert.ok(lic.data.license.licenseKey);
  });

  // ---- tools + mrz --------------------------------------------------------
  await t.test('tools run, history, and MRZ round-trip', async () => {
    const run = await jsonFetch(base, { path: '/api/v1/tools/json-format', method: 'POST', body: { text: '{"a":1}' } }, token);
    assert.strictEqual(run.status, 200);
    assert.ok(run.data.result.includes('"a"'));

    const hist = await jsonFetch(base, { path: '/api/v1/tools/history' }, token);
    assert.strictEqual(hist.status, 200);
    assert.ok(hist.data.history.length >= 1);

    const gen = await jsonFetch(base, { path: '/api/tools/mrz/generate', method: 'POST', body: { surname: 'DOE', givenNames: 'JOHN', documentNumber: 'X1234567' } });
    assert.strictEqual(gen.status, 200);
    const val = await jsonFetch(base, { path: '/api/v1/tools/mrz/validate', method: 'POST', body: { mrz: gen.data.mrz } });
    assert.strictEqual(val.data.valid, true, 'generated MRZ must validate');
    const parsed = await jsonFetch(base, { path: '/api/v1/tools/mrz/parse', method: 'POST', body: { mrz: gen.data.mrz } });
    assert.strictEqual(parsed.data.surname, 'DOE');
  });

  // ---- server lifecycle actions (queued provisioning jobs) ---------------
  await t.test('server actions queue jobs and reads return stored state', async () => {
    const created = await jsonFetch(base, { path: '/api/v1/servers', method: 'POST', body: { name: 'action-vps' } }, token);
    assert.strictEqual(created.status, 201);
    const sid = created.data.server.id;

    const reboot = await jsonFetch(base, { path: `/api/v1/servers/${sid}/reboot`, method: 'POST', body: {} }, token);
    assert.strictEqual(reboot.status, 202);
    assert.ok(reboot.data.jobId);

    const snap = await jsonFetch(base, { path: `/api/v1/servers/${sid}/snapshots`, method: 'POST', body: { description: 'pre-upgrade' } }, token);
    assert.strictEqual(snap.status, 202);

    const status = await jsonFetch(base, { path: `/api/v1/servers/${sid}/status` }, token);
    assert.strictEqual(status.status, 200);

    const prov = await jsonFetch(base, { path: `/api/v1/servers/${sid}/provisioning-status` }, token);
    assert.strictEqual(prov.status, 200);
    assert.ok(prov.data.latestJob, 'a provisioning job was recorded');

    const health = await jsonFetch(base, { path: `/api/v1/servers/${sid}/health` }, token);
    assert.strictEqual(health.status, 200);

    // Another customer cannot touch this server.
    const other = await register(base, 'intruder@example.com');
    const denied = await jsonFetch(base, { path: `/api/v1/servers/${sid}/reboot`, method: 'POST', body: {} }, other.data.accessToken);
    assert.strictEqual(denied.status, 404);
  });

  // ---- marketplace (exercises ctx.validateQuery) -------------------------
  await t.test('marketplace browse validates the query string', async () => {
    const apps = await jsonFetch(base, { path: '/api/v1/marketplace/apps' }, token);
    assert.strictEqual(apps.status, 200);
    assert.ok(Array.isArray(apps.data.apps));

    const searched = await jsonFetch(base, { path: '/api/v1/marketplace/apps?search=host&category=hosting' }, token);
    assert.strictEqual(searched.status, 200);

    const cats = await jsonFetch(base, { path: '/api/v1/marketplace/categories' }, token);
    assert.strictEqual(cats.status, 200);
  });

  // ---- brokerage + ai support --------------------------------------------
  await t.test('brokerage case + ai-support conversation with canned reply', async () => {
    const kase = await jsonFetch(base, { path: '/api/v1/brokerage', method: 'POST', body: { domainName: 'taken.com' } }, token);
    assert.strictEqual(kase.status, 201);

    const conv = await jsonFetch(base, { path: '/api/v1/ai-support/conversations', method: 'POST', body: { subject: 'Help' } }, token);
    assert.strictEqual(conv.status, 201);
    const msg = await jsonFetch(base, {
      path: `/api/v1/ai-support/conversations/${conv.data.conversation.id}/messages`, method: 'POST', body: { content: 'Hello there' },
    }, token);
    assert.strictEqual(msg.status, 201);
    assert.ok(msg.data.reply.content.length > 0);
  });

  // ---- admin surface ------------------------------------------------------
  await t.test('admin endpoints require elevation and return data', async () => {
    const forbidden = await jsonFetch(base, { path: '/api/v1/admin/ai/overview' }, token);
    assert.strictEqual(forbidden.status, 403);

    const admin = await adminToken(base, app);
    const overview = await jsonFetch(base, { path: '/api/v1/admin/ai/overview' }, admin);
    assert.strictEqual(overview.status, 200);

    const rg = await jsonFetch(base, { path: '/api/v1/revenue-guardian/dashboard' }, admin);
    assert.strictEqual(rg.status, 200);
    assert.ok(typeof rg.data.outstandingCents === 'number');

    const users = await jsonFetch(base, { path: '/api/v1/admin/users' }, admin);
    assert.strictEqual(users.status, 200);
  });

  await close();
});
