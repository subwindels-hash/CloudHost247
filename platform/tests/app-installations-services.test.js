'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, jsonFetch, register } = require('./helpers');
const { applySuccessfulPayment } = require('../src/lib/billing-apply');
const { uuidv7 } = require('../src/lib/ids');

test('integration: app installations and services provisioning lifecycle', async (t) => {
  const harness = await startServer();
  const { base, app, close } = harness;

  let userToken;
  let adminToken;
  let userId;
  let adminId;
  let freeAppId;
  let paidAppId;
  let testServerId;

  try {
    // 1. Register customer
    const userReg = await register(base, 'app-owner@example.com');
    userToken = userReg.data.accessToken;
    userId = userReg.data.user.id;

    // 2. Register admin
    const adminReg = await register(base, 'admin-app@example.com');
    adminId = adminReg.data.user.id;
    await app.store.table('users').updateById(adminId, { role: 'admin' });
    adminToken = adminReg.data.accessToken;

    // 3. Seed server
    testServerId = uuidv7();
    await app.store.table('servers').insert({
      id: testServerId,
      user_id: userId,
      name: 'prod-server-01',
      hostname: 'prod.example.com',
      server_type: 'VPS',
      status: 'active',
      ip_address: '198.51.100.10',
    });

    // 4. Seed applications: one free, one paid
    freeAppId = uuidv7();
    await app.store.table('applications').insert({
      id: freeAppId,
      slug: 'wordpress',
      name: 'WordPress',
      price_cents: 0,
      active: true,
      status: 'active',
      version: '6.4.1',
    });

    paidAppId = uuidv7();
    await app.store.table('applications').insert({
      id: paidAppId,
      slug: 'gitlab-ee',
      name: 'GitLab EE',
      price_cents: 2900,
      active: true,
      status: 'active',
      version: '16.8.0',
    });

    let freeInstId;
    await t.test('POST /api/v1/app-installations for free app auto-provisions to running', async () => {
      const res = await jsonFetch(base, {
        method: 'POST',
        path: '/api/v1/app-installations',
        body: {
          applicationId: freeAppId,
          serverId: testServerId,
          name: 'My Free WordPress Blog',
          domain: 'blog.example.com',
        },
      }, userToken);

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.paymentRequired, false);
      assert.strictEqual(res.data.totalAmount, 0);
      freeInstId = res.data.installationId;

      // Check installation status in database: auto-executed to running
      const inst = await app.store.table('application_installations').findById(freeInstId);
      assert.ok(inst);
      assert.strictEqual(inst.status, 'running');
      assert.strictEqual(inst.health_status, 'healthy');

      // Order & invoice marked paid
      const order = await app.store.table('orders').findById(res.data.orderId);
      assert.strictEqual(order.status, 'paid');
      const invoice = await app.store.table('invoices').findById(res.data.invoiceId);
      assert.strictEqual(invoice.status, 'paid');
    });

    let paidInstId;
    let paidOrderId;
    let paidInvoiceId;
    await t.test('POST /api/v1/app-installations for paid app creates pending order and deploys upon payment', async () => {
      const res = await jsonFetch(base, {
        method: 'POST',
        path: '/api/v1/app-installations',
        body: {
          applicationId: paidAppId,
          serverId: testServerId,
          name: 'My Team GitLab',
          domain: 'git.example.com',
        },
      }, userToken);

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.paymentRequired, true);
      assert.strictEqual(res.data.totalAmount, 29);
      paidInstId = res.data.installationId;
      paidOrderId = res.data.orderId;
      paidInvoiceId = res.data.invoiceId;

      // Initially status is pending
      const instPending = await app.store.table('application_installations').findById(paidInstId);
      assert.strictEqual(instPending.status, 'pending');

      // Simulate payment settlement via applySuccessfulPayment
      const paymentId = uuidv7();
      await app.store.table('payments').insert({
        id: paymentId,
        user_id: userId,
        invoice_id: paidInvoiceId,
        amount: 29,
        currency: 'USD',
        gateway: 'stripe',
        status: 'pending',
      });

      const paymentOutcome = await applySuccessfulPayment(app.store, {
        paymentId,
        gatewayReference: 'ch_test_paid_order_123',
      });
      assert.strictEqual(paymentOutcome.applied, true);

      // Verify order and invoice are paid
      const orderPaid = await app.store.table('orders').findById(paidOrderId);
      assert.strictEqual(orderPaid.status, 'paid');

      // Verify installation was automatically deployed to running and healthy
      const instRunning = await app.store.table('application_installations').findById(paidInstId);
      assert.strictEqual(instRunning.status, 'running');
      assert.strictEqual(instRunning.health_status, 'healthy');
    });

    await t.test('GET /api/v1/app-installations/:id/logs streams real deployment events', async () => {
      const res = await jsonFetch(base, {
        method: 'GET',
        path: `/api/v1/app-installations/${freeInstId}/logs`,
      }, userToken);

      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.data.lines));
      assert.ok(res.data.lines.length > 0);
      assert.ok(typeof res.data.logs === 'string');
      assert.ok(res.data.logs.toLowerCase().includes('step'));
      assert.ok(res.data.lines[0].includes('[INFO]'));
    });

    await t.test('POST /api/v1/app-installations/:id/:action manages lifecycle (stop & start)', async () => {
      // Stop installation
      const stopRes = await jsonFetch(base, {
        method: 'POST',
        path: `/api/v1/app-installations/${freeInstId}/stop`,
      }, userToken);
      assert.ok([200, 202].includes(stopRes.status));

      const instStopped = await app.store.table('application_installations').findById(freeInstId);
      assert.strictEqual(instStopped.status, 'stopped');

      // Start installation
      const startRes = await jsonFetch(base, {
        method: 'POST',
        path: `/api/v1/app-installations/${freeInstId}/start`,
      }, userToken);
      assert.ok([200, 202].includes(startRes.status));

      const instStarted = await app.store.table('application_installations').findById(freeInstId);
      assert.strictEqual(instStarted.status, 'running');
    });

    await t.test('POST /api/v1/admin/app-installations/sweep sweeps pending paid orders', async () => {
      const res = await jsonFetch(base, {
        method: 'POST',
        path: '/api/v1/admin/app-installations/sweep',
      }, adminToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.ok, true);
      assert.ok(typeof res.data.sweptOrders === 'number');
    });

    await t.test('customer services provisioning triggers server job and activates', async () => {
      // Admin creates customer service
      const createRes = await jsonFetch(base, {
        method: 'POST',
        path: '/api/v1/services',
        body: {
          customerId: userId,
          serverId: testServerId,
          label: 'Managed WordPress Hosting',
          status: 'pending',
        },
      }, adminToken);

      assert.strictEqual(createRes.status, 201);
      const serviceId = createRes.data.service.id;
      assert.strictEqual(createRes.data.service.status, 'pending');

      // Trigger provisioning
      const provRes = await jsonFetch(base, {
        method: 'POST',
        path: `/api/v1/services/${serviceId}/provision`,
      }, adminToken);

      assert.strictEqual(provRes.status, 200);
      assert.strictEqual(provRes.data.service.status, 'provisioning');
      assert.ok(provRes.data.jobId);

      // Verify job in provisioning_jobs
      const job = await app.store.table('provisioning_jobs').findById(provRes.data.jobId);
      assert.ok(job);
      assert.strictEqual(job.server_id, testServerId);
      assert.strictEqual(job.service_id, serviceId);
      assert.strictEqual(job.status, 'queued');
    });
  } finally {
    await close();
  }
});
