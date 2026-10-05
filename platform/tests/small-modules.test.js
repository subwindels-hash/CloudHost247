/**
 * Integration tests for the agent health report (agent.ts POST /agent/health) and the two
 * ai-support routes that were still missing (ai-support.ts).
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, jsonFetch, register } = require('./helpers');

const AGENT_TOKEN = 'agent-test-token-0123456789';

test('integration: agent health report', async (t) => {
  const { base, app, close } = await startServer({ AGENT_TOKEN });
  try {
    const agentHeaders = { Authorization: `Bearer ${AGENT_TOKEN}` };

    await t.test('the route requires the agent token', async () => {
      const res = await jsonFetch(base, {
        path: '/api/v1/agent/health', method: 'POST',
        body: { project: 'customer-abc-install1', healthy: true },
      });
      assert.strictEqual(res.status, 401);
    });

    // Regression guard: these two routes read the Authorization header through ctx.request, which
    // does not exist on this framework's context, so every agent route threw a TypeError and
    // answered 500 — including with a perfectly valid token.
    await t.test('the pre-existing ping and report routes accept the token', async () => {
      const ping = await jsonFetch(base, { path: '/api/v1/agent/ping' }, AGENT_TOKEN);
      assert.strictEqual(ping.status, 200);
      assert.strictEqual(ping.data.ok, true);

      const noToken = await jsonFetch(base, { path: '/api/v1/agent/ping' });
      assert.strictEqual(noToken.status, 401, 'still rejected without a token');

      const server = await app.store.table('servers').insert({
        user_id: null, name: 'report-host', hostname: 'report-host.example', status: 'active',
      });
      const report = await jsonFetch(base, {
        path: '/api/v1/agent/report', method: 'POST',
        body: { serverId: server.id, cpuPercent: 12.5 },
      }, AGENT_TOKEN);
      assert.strictEqual(report.status, 200);
      assert.strictEqual(report.data.ok, true);
    });

    await t.test('an unknown project is a 404', async () => {
      const res = await jsonFetch(base, {
        path: '/api/v1/agent/health', method: 'POST',
        body: { project: 'customer-nobody-nope', healthy: true },
      }, AGENT_TOKEN);
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.data.error, 'NOT_FOUND');
      assert.match(res.data.message, /No installation found for that project/);
    });

    await t.test('a reported health check lands on the installation', async () => {
      const server = await app.store.table('servers').insert({ user_id: null, name: 'agent-host', hostname: 'agent-host.example', status: 'active' });
      const installation = await app.store.table('application_installations').insert({
        user_id: null,
        application_id: '00000000-0000-0000-0000-000000000010',
        server_id: server.id,
        name: 'WordPress',
        status: 'running',
        container_project: 'customer-abc-install1',
      });
      assert.strictEqual(installation.health_status, 'unknown', 'starts unknown');

      const healthy = await jsonFetch(base, {
        path: '/api/v1/agent/health', method: 'POST',
        body: { project: 'customer-abc-install1', healthy: true, serverId: server.id },
      }, AGENT_TOKEN);
      assert.strictEqual(healthy.status, 200);
      assert.strictEqual(healthy.data.ok, true);
      assert.strictEqual(healthy.data.status, 'healthy');

      const stored = await app.store.table('application_installations').findById(installation.id);
      assert.strictEqual(stored.health_status, 'healthy');
      assert.ok(stored.last_health_check_at, 'the check is timestamped');

      const unhealthy = await jsonFetch(base, {
        path: '/api/v1/agent/health', method: 'POST',
        body: { project: 'customer-abc-install1', healthy: false, detail: 'container exited', serverId: server.id },
      }, AGENT_TOKEN);
      assert.strictEqual(unhealthy.data.status, 'unhealthy');
      assert.strictEqual((await app.store.table('application_installations').findById(installation.id)).health_status, 'unhealthy');
    });

    await t.test('the body is validated', async () => {
      const noHealthy = await jsonFetch(base, {
        path: '/api/v1/agent/health', method: 'POST', body: { project: 'x' },
      }, AGENT_TOKEN);
      assert.strictEqual(noHealthy.status, 400);

      const emptyProject = await jsonFetch(base, {
        path: '/api/v1/agent/health', method: 'POST', body: { project: '', healthy: true },
      }, AGENT_TOKEN);
      assert.strictEqual(emptyProject.status, 400);
    });
  } finally {
    await close();
  }
});

test('integration: ai-support availability and contact details', async (t) => {
  const { base, app, close } = await startServer();
  try {
    await t.test('availability is public and OFFLINE with no presence rows', async () => {
      const res = await jsonFetch(base, { path: '/api/v1/ai-support/availability' });
      assert.strictEqual(res.status, 200, 'no auth required');
      assert.strictEqual(res.data.status, 'OFFLINE');
    });

    await t.test('an online staff member with spare capacity is ONLINE', async () => {
      const staffUser = await app.store.table('users').insert({
        email: 'agent@example.com', full_name: 'Support Agent', role: 'staff', status: 'active',
        password_hash: 'x',
      });
      const presence = await app.store.table('support_agent_presence').insert({
        user_id: staffUser.id, status: 'ONLINE', capacity: 3,
      });

      let res = await jsonFetch(base, { path: '/api/v1/ai-support/availability' });
      assert.strictEqual(res.data.status, 'ONLINE');

      // At capacity — every slot taken by an open conversation.
      for (let i = 0; i < 3; i += 1) {
        await app.store.table('ai_support_conversations').insert({
          id: `00000000-0000-0000-0000-00000000000${i}`,
          subject: `t${i}`, status: 'IN_PROGRESS', assigned_agent_id: staffUser.id,
        });
      }
      res = await jsonFetch(base, { path: '/api/v1/ai-support/availability' });
      assert.strictEqual(res.data.status, 'BUSY', 'online but at capacity is BUSY');

      await app.store.table('support_agent_presence').updateById(presence.id, { status: 'BUSY' });
      res = await jsonFetch(base, { path: '/api/v1/ai-support/availability' });
      assert.strictEqual(res.data.status, 'BUSY');

      await app.store.table('support_agent_presence').updateById(presence.id, { status: 'OFFLINE' });
      res = await jsonFetch(base, { path: '/api/v1/ai-support/availability' });
      assert.strictEqual(res.data.status, 'OFFLINE', 'an offline agent does not count');
    });

    const owner = (await register(base, 'ai-owner@example.com')).data.accessToken;
    const other = (await register(base, 'ai-other@example.com')).data.accessToken;
    const conv = await jsonFetch(base, {
      path: '/api/v1/ai-support/conversations', method: 'POST',
      body: { subject: 'Cannot reach my site' },
    }, owner);
    assert.strictEqual(conv.status, 201);
    const convId = conv.data.conversation.id;

    await t.test('PATCH /conversations/:id/contact stores the details', async () => {
      const res = await jsonFetch(base, {
        path: `/api/v1/ai-support/conversations/${convId}/contact`, method: 'PATCH',
        body: { name: 'Ada Lovelace', email: 'ADA@example.com' },
      }, owner);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.saved, true);

      const stored = await app.store.table('ai_support_conversations').findById(convId);
      assert.strictEqual(stored.visitor_name, 'Ada Lovelace');
      assert.strictEqual(stored.visitor_email, 'ada@example.com', 'the email is lowercased');
    });

    await t.test('the contact body is validated', async () => {
      const shortName = await jsonFetch(base, {
        path: `/api/v1/ai-support/conversations/${convId}/contact`, method: 'PATCH',
        body: { name: 'A', email: 'a@example.com' },
      }, owner);
      assert.strictEqual(shortName.status, 400);

      const badEmail = await jsonFetch(base, {
        path: `/api/v1/ai-support/conversations/${convId}/contact`, method: 'PATCH',
        body: { name: 'Ada Lovelace', email: 'not-an-email' },
      }, owner);
      assert.strictEqual(badEmail.status, 400);
    });

    await t.test("another customer's conversation is a 404", async () => {
      const res = await jsonFetch(base, {
        path: `/api/v1/ai-support/conversations/${convId}/contact`, method: 'PATCH',
        body: { name: 'Mallory', email: 'mallory@example.com' },
      }, other);
      assert.strictEqual(res.status, 404);
    });

    await t.test('an anonymous visitor can set details on an unowned conversation', async () => {
      const anon = await app.store.table('ai_support_conversations').insert({
        subject: 'Anonymous question', status: 'AI_ACTIVE', user_id: null,
      });
      const res = await jsonFetch(base, {
        path: `/api/v1/ai-support/conversations/${anon.id}/contact`, method: 'PATCH',
        body: { name: 'Anonymous Visitor', email: 'anon@example.com' },
      });
      assert.strictEqual(res.status, 200, 'pre-sign-in visitors are supported');
      assert.strictEqual(res.data.saved, true);
    });
  } finally {
    await close();
  }
});

test('integration: marketplace app categories', async (t) => {
  const { base, app, close } = await startServer();
  try {
    await app.store.table('app_categories').insert({ name: 'E-commerce', slug: 'ecommerce', sort_order: 2, active: true });
    await app.store.table('app_categories').insert({ name: 'Blogging', slug: 'blogging', sort_order: 1, active: true });
    await app.store.table('app_categories').insert({ name: 'Retired', slug: 'retired', sort_order: 0, active: false });

    await t.test('GET /app-categories is public, active-only and sorted', async () => {
      const res = await jsonFetch(base, { path: '/api/v1/app-categories' });
      assert.strictEqual(res.status, 200, 'no auth required');
      assert.deepStrictEqual(
        res.data.categories.map((c) => c.slug),
        ['blogging', 'ecommerce'],
        'sort_order first, inactive excluded',
      );
      assert.deepStrictEqual(Object.keys(res.data.categories[0]).sort(), ['description', 'name', 'slug']);
    });
  } finally {
    await close();
  }
});
