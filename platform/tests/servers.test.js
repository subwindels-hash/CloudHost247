/**
 * Integration tests for admin server registration (servers.ts POST /admin/servers).
 *
 * A server with no user_id is a platform deployment target rather than a customer's machine, and
 * the agent/WHM secrets attached to it are write-only: the generated agent secret is shown exactly
 * once, at creation, and is never returned again.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, jsonFetch, register } = require('./helpers');

async function adminToken(base, app, email = 'srv-admin@example.com') {
  await register(base, email, 'SuperSecret123!');
  const user = await app.store.table('users').findOne({ email });
  await app.store.table('users').updateById(user.id, { role: 'super_admin' });
  const login = await jsonFetch(base, {
    path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'SuperSecret123!' },
  });
  return login.data.accessToken;
}

const VALID = {
  name: 'Frankfurt target',
  hostname: 'de-fra-01.example.com',
  ipAddress: '203.0.113.10',
  serverType: 'VPS',
  provider: 'hetzner',
  region: 'fra1',
  cpuCores: 4,
  memoryMb: 8192,
  storageMb: 163840,
};

test('integration: admin server registration', async (t) => {
  const { base, app, close } = await startServer();
  try {
    const admin = await adminToken(base, app);
    const customer = (await register(base, 'srv-cust@example.com')).data.accessToken;

    await t.test('only staff may register a server', async () => {
      assert.strictEqual(
        (await jsonFetch(base, { path: '/api/v1/admin/servers', method: 'POST', body: VALID })).status,
        401,
      );
      assert.strictEqual(
        (await jsonFetch(base, { path: '/api/v1/admin/servers', method: 'POST', body: VALID }, customer)).status,
        403,
      );
    });

    let serverId;
    await t.test('a target is created with no owner and a stored audit entry', async () => {
      const res = await jsonFetch(base, { path: '/api/v1/admin/servers', method: 'POST', body: VALID }, admin);
      assert.strictEqual(res.status, 201);
      serverId = res.data.server.id;

      assert.strictEqual(res.data.server.userId, null, 'platform targets have no owner');
      assert.strictEqual(res.data.server.name, 'Frankfurt target');
      assert.strictEqual(res.data.server.hostname, 'de-fra-01.example.com');
      assert.strictEqual(res.data.server.ip, '203.0.113.10');
      assert.strictEqual(res.data.server.status, 'active');
      assert.strictEqual(res.data.agentId, undefined, 'no agent URL, no agent identity');
      assert.strictEqual(res.data.agentSecret, undefined);

      const stored = await app.store.table('servers').findById(serverId);
      assert.strictEqual(stored.server_type, 'VPS');
      assert.strictEqual(stored.cpu_cores, 4);
      assert.strictEqual(stored.memory_mb, 8192);
      assert.strictEqual(stored.storage_mb, 163840);
      assert.strictEqual(stored.docker_enabled, false, 'feature flags default to false');
      assert.strictEqual(stored.agent_id, null);

      const auditRow = await app.store.table('audit_logs').findOne({ action: 'server.registered', entity_id: serverId });
      assert.ok(auditRow, 'registration is audited');
      assert.strictEqual(auditRow.entity_type, 'server');
      assert.strictEqual(auditRow.after.name, 'Frankfurt target');
    });

    await t.test('the created target appears in the admin list and, as a target, in the public list', async () => {
      const adminList = await jsonFetch(base, { path: '/api/v1/admin/servers' }, admin);
      assert.ok(adminList.data.servers.some((s) => s.id === serverId));

      // The customer-facing list exposes unowned targets as scheduling metadata.
      const publicList = await jsonFetch(base, { path: '/api/v1/servers' });
      assert.strictEqual(publicList.status, 200);
      const target = publicList.data.deploymentTargets.find((s) => s.id === serverId);
      assert.ok(target, 'the target is offered as a deployment target');
    });

    await t.test('an agent URL registers an identity and reveals the secret once', async () => {
      const res = await jsonFetch(base, {
        path: '/api/v1/admin/servers', method: 'POST',
        body: { ...VALID, hostname: 'de-fra-02.example.com', agentUrl: 'https://agent.example.com' },
      }, admin);
      assert.strictEqual(res.status, 201);
      assert.match(res.data.agentId, /^agent-[0-9a-f]{8}$/);
      assert.ok(res.data.agentSecret, 'a generated secret is shown once so the agent can be configured');

      // Stored for verification, never returned again.
      const creds = await app.store.table('server_credentials').find({ server_id: res.data.server.id, kind: 'agent_secret' });
      assert.strictEqual(creds.rows.length, 1);
      assert.strictEqual(creds.rows[0].secret, res.data.agentSecret);

      const reread = await jsonFetch(base, { path: `/api/v1/admin/servers/${res.data.server.id}` }, admin);
      assert.strictEqual(reread.data.server.agentSecret, undefined, 'never exposed on reads');
      assert.strictEqual(JSON.stringify(reread.data).includes(res.data.agentSecret), false);
    });

    await t.test('a caller-supplied secret is stored but never echoed back', async () => {
      const supplied = 'z'.repeat(32);
      const res = await jsonFetch(base, {
        path: '/api/v1/admin/servers', method: 'POST',
        body: { ...VALID, hostname: 'de-fra-03.example.com', agentSecret: supplied, cpanelEnabled: true },
      }, admin);
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.agentSecret, undefined, 'a secret we were given is not echoed');
      assert.match(res.data.agentId, /^agent-[0-9a-f]{8}$/);
      assert.strictEqual(res.data.server.panel, 'cpanel');

      const creds = await app.store.table('server_credentials').find({ server_id: res.data.server.id, kind: 'agent_secret' });
      assert.strictEqual(creds.rows[0].secret, supplied);
    });

    await t.test('WHM details land in metadata and the API token is write-only', async () => {
      const token = 'whm-token-0123456789';
      const res = await jsonFetch(base, {
        path: '/api/v1/admin/servers', method: 'POST',
        body: {
          ...VALID, hostname: 'de-fra-04.example.com', serverType: 'CPANEL', cpanelEnabled: true,
          whmUrl: 'https://whm.example.com', whmUser: 'admin', whmApiToken: token,
        },
      }, admin);
      assert.strictEqual(res.status, 201);

      const stored = await app.store.table('servers').findById(res.data.server.id);
      assert.deepStrictEqual(stored.metadata, { whm_url: 'https://whm.example.com', whm_user: 'admin' });

      const creds = await app.store.table('server_credentials').find({ server_id: res.data.server.id, kind: 'whm_api_token' });
      assert.strictEqual(creds.rows[0].secret, token);
      assert.strictEqual(JSON.stringify(res.data).includes(token), false, 'the token never appears in the response');
    });

    await t.test('the body is validated', async () => {
      const cases = [
        [{ ...VALID, serverType: 'TOASTER' }, 'serverType is an enum'],
        [{ ...VALID, name: '' }, 'name is required'],
        [{ ...VALID, cpuCores: 0 }, 'cpuCores has a floor'],
        [{ ...VALID, memoryMb: 1 }, 'memoryMb has a floor'],
        [{ ...VALID, storageMb: 10 }, 'storageMb has a floor'],
        [{ ...VALID, agentUrl: 'not-a-url' }, 'agentUrl must be a URL'],
        [{ ...VALID, agentSecret: 'too-short' }, 'agentSecret has a length floor'],
        [(() => { const c = { ...VALID }; delete c.hostname; return c; })(), 'hostname is required'],
      ];
      for (const [body, why] of cases) {
        const res = await jsonFetch(base, { path: '/api/v1/admin/servers', method: 'POST', body }, admin);
        assert.strictEqual(res.status, 400, why);
      }
    });

    await t.test('a duplicate hostname is refused by the unique index', async () => {
      const res = await jsonFetch(base, { path: '/api/v1/admin/servers', method: 'POST', body: VALID }, admin);
      assert.strictEqual(res.status, 409, 'hostnames are unique identifiers for a server');
    });
  } finally {
    await close();
  }
});
