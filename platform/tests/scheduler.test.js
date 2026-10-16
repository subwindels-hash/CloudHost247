'use strict';

/**
 * Scheduler tick (`src/lib/scheduler.js` + `src/worker/cron.js`).
 *
 * Closes the §7 scheduling gap: the sweeps existed as admin-only routes that ran on operator
 * action; this asserts one tick drives them all — a queued provisioning job, a queued deployment,
 * a paid order with a pending installation, and in-flight domain transfers (polled against the
 * loopback registrar fake, plus one that cannot resolve a registrar and is counted `failed` while
 * the tick continues). Also runs the actual crontab entry point as a child process to prove the
 * wiring boots, reports and exits cleanly.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { startServer, jsonFetch, register } = require('./helpers');
const { runDueSweeps, IN_FLIGHT_TRANSFER_STATUSES } = require('../src/lib/scheduler');
const { startFakeRegistrar } = require('./fixtures/fake-registrar');

test('scheduler: one tick drives provisioning, deployments, orders and transfer refresh', async (t) => {
  const harness = await startServer();
  const { base, app, close } = harness;

  try {
    await register(base, 'sched-admin@example.com');
    const adminUser = await app.store.table('users').findOne({ email: 'sched-admin@example.com' });
    await app.store.table('users').updateById(adminUser.id, { role: 'super_admin' });
    const admin = (await jsonFetch(base, {
      path: '/api/v1/auth/login', method: 'POST', body: { email: 'sched-admin@example.com', password: 'SuperSecret123!' },
    })).data.accessToken;

    // -- a real queued provisioning job (customer creates a server) --
    const cust = await register(base, 'sched-cust@example.com');
    const server = await jsonFetch(base, {
      method: 'POST', path: '/api/v1/servers', body: { name: 'schedbox', hostname: 'schedbox.example.com' },
    }, cust.data.accessToken);
    assert.strictEqual(server.status, 201, JSON.stringify(server.data));

    // -- a real queued deployment (customer requests one) --
    const deployment = await jsonFetch(base, {
      method: 'POST', path: '/api/v1/deployments', body: { source: 'git', ref: 'main', action: 'install' },
    }, cust.data.accessToken);
    assert.strictEqual(deployment.status, 201, JSON.stringify(deployment.data));

    // -- a paid order with a pending application installation --
    const custUser = await app.store.table('users').findOne({ email: 'sched-cust@example.com' });
    const order = await app.store.table('orders').insert({
      id: '33333333-3333-4333-8333-333333333333', user_id: custUser.id,
      status: 'paid', total_cents: 1000, created_at: new Date().toISOString(),
    });
    const installation = await app.store.table('application_installations').insert({
      id: '44444444-4444-4444-8444-444444444444', user_id: custUser.id, order_id: order.id,
      name: 'sched-app', status: 'pending', created_at: new Date().toISOString(),
    });

    // -- in-flight transfers: one held by the loopback registrar fake, one that cannot resolve --
    const fake = startFakeRegistrar();
    await fake.listen();
    try {
      const provider = (await jsonFetch(base, {
        method: 'POST', path: '/api/v1/admin/domain-services/providers',
        body: {
          providerKey: 'sched-namecheap', name: 'Sched Registrar', adapterKey: 'namecheap',
          providerType: 'registrar', apiBaseUrl: fake.endpoint(), environment: 'sandbox',
        },
      }, admin)).data.provider;
      await jsonFetch(base, {
        method: 'PUT', path: `/api/v1/admin/domain-services/providers/${provider.id}/credentials`,
        body: { credentials: { apiKey: 'sched-key', apiUser: 'sched-user', userName: 'sched-user', clientIp: '127.0.0.1' } },
      }, admin);

      const resolvable = await app.store.table('domain_transfers').insert({
        id: '55555555-5555-4555-8555-555555555555', user_id: custUser.id,
        domain_name: 'resolvable.example', status: 'transfer_in_progress',
        provider_id: provider.id, provider_reference: 'TR-1',
        created_at: new Date().toISOString(),
      });
      const unresolvable = await app.store.table('domain_transfers').insert({
        id: '66666666-6666-4666-8666-666666666666', user_id: custUser.id,
        domain_name: 'orphan.example', status: 'pending',
        provider_id: null, created_at: new Date().toISOString(),
      });

      // ---- the tick ----
      const report = await runDueSweeps(app.deps);

      assert.ok(report.ranAt && report.finishedAt, 'report timestamps its run');
      assert.deepEqual(report.errors, [], 'no sweep failed to run');
      for (const key of ['provisioning', 'deployments', 'orders', 'transfers']) {
        assert.ok(report.sweeps[key], `sweep '${key}' ran`);
      }

      // provisioning: the queued CREATE job was claimed and executed (the raw worker cycle's
      // report keys — `dead_lettered`; the admin route renames it for its own wrapper)
      assert.ok(report.sweeps.provisioning.claimed >= 1, 'the queued provisioning job was claimed');
      for (const key of ['claimed', 'completed', 'failed', 'requeued', 'dead_lettered', 'results']) {
        assert.ok(key in report.sweeps.provisioning, `provisioning report reads ${key}`);
      }

      // deployments: the queued deployment was claimed (its outcome depends on the action)
      assert.ok(report.sweeps.deployments.claimed >= 1, 'the queued deployment was claimed');
      for (const key of ['workerId', 'scanned', 'claimed', 'succeeded', 'failed']) {
        assert.ok(key in report.sweeps.deployments, `deployment report reads ${key}`);
      }

      // orders: the paid order's pending installation was provisioned
      assert.strictEqual(report.sweeps.orders.sweptOrders, 1, 'the paid order was swept');
      assert.ok(report.sweeps.orders.provisionedCount >= 1, 'its installation was provisioned');
      const instAfter = await app.store.table('application_installations').findById(installation.id);
      assert.notStrictEqual(installation.status, instAfter.status, 'the installation left pending/queued');

      // transfers: both in-flight rows were polled; the unresolvable one counts as failed and the
      // tick continued to the resolvable one
      const tr = report.sweeps.transfers;
      assert.strictEqual(tr.due, 2, 'both in-flight transfers were due');
      assert.strictEqual(tr.polled, 2, 'both were polled');
      assert.ok(tr.failed >= 1, 'the unregistrarable transfer counted as failed');
      for (const key of ['due', 'polled', 'completed', 'failed']) {
        assert.ok(key in tr, `transfer report reads ${key}`);
      }
      const resolvableAfter = await app.store.table('domain_transfers').findById(resolvable.id);
      const unresolvableAfter = await app.store.table('domain_transfers').findById(unresolvable.id);
      assert.notStrictEqual(resolvableAfter.updated_at, resolvable.updated_at, 'the polled transfer was written');
      // A poll that could not even resolve a registrar tells us nothing about the transfer's
      // progress, so its status stays exactly where it was.
      assert.strictEqual(unresolvableAfter.status, unresolvable.status, 'the unresolvable transfer keeps its status');
    } finally {
      await fake.close();
    }
  } finally {
    await close();
  }
});

test('scheduler: a broken sweep does not stop the others', async (t) => {
  const harness = await startServer();
  const { app, close } = harness;
  try {
    // A transfer that forces refreshTransfer to throw is already covered as a counted failure;
    // here the transfers sweep itself is broken by removing the table out from under it.
    const original = app.store.table;
    app.store.table = (name) => {
      if (name === 'domain_transfers') throw new Error('transfers store unavailable');
      return original.call(app.store, name);
    };
    try {
      const report = await runDueSweeps(app.deps);
      assert.ok(report.errors.some((e) => e.sweep === 'transfers'), 'the broken sweep is named');
      assert.ok(report.sweeps.provisioning && !report.sweeps.provisioning.error, 'the other sweeps still ran');
    } finally {
      app.store.table = original;
    }
  } finally {
    await close();
  }
});

test('scheduler: the crontab entry point boots, reports and exits cleanly', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch247-cron-'));
  try {
    const stdout = execFileSync(process.execPath, ['src/worker/cron.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        DATA_DIR: dataDir,
      },
      encoding: 'utf8',
      timeout: 60000,
    });
    const report = JSON.parse(stdout);
    for (const key of ['ranAt', 'finishedAt', 'sweeps', 'errors']) {
      assert.ok(key in report, `CLI report reads ${key}`);
    }
    for (const key of ['provisioning', 'deployments', 'orders', 'transfers']) {
      assert.ok(report.sweeps[key], `CLI ran sweep '${key}'`);
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('scheduler: the transfer status set matches the workflow enum', () => {
  // The admin transfer PATCH enum is the workflow's own vocabulary; a status added there that
  // represents an unfinished transfer must also be polled by the timer.
  const workflow = ['pending', 'authorization_required', 'transfer_initiated', 'transfer_in_progress', 'pending_registry', 'completed', 'failed', 'cancelled'];
  for (const status of workflow) {
    const inFlight = IN_FLIGHT_TRANSFER_STATUSES.includes(status);
    const terminal = ['completed', 'failed', 'cancelled'].includes(status);
    assert.strictEqual(inFlight, !terminal, `status '${status}' classification`);
  }
});
