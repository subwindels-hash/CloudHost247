'use strict';

/**
 * Admin AI-support and free-tools screen contracts (AdminAiSupportPage, AdminToolsPage).
 *
 * Walks the exact HTTP sequences the two screens issue — overview/conversations/agents/knowledge/
 * newsletter panels, conversation detail with reply + status/priority/assignment + hand-back,
 * presence updates, tool reports/monitors moderation and the MRZ settings with its mandatory
 * privacy locks — over the real app. A conversation is seeded through the public widget API so
 * the assistant's own reply metadata (intent/confidence/sources) is real. Pins the page sources
 * to the response keys they render. (Browser rendering itself is covered by `npm run smoke`.)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, jsonFetch, register } = require('./helpers');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'pages', name), 'utf8');
const AI_SRC = read('AdminAiSupportPage.jsx');
const TOOLS_SRC = read('AdminToolsPage.jsx');
const API_CLIENT_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'lib', 'api.js'), 'utf8');

test('admin AI support and tools screens: endpoint contracts', async (t) => {
  const harness = await startServer();
  const { base, app, close } = harness;

  try {
    await register(base, 'ai-screen-admin@example.com');
    const adminUser = await app.store.table('users').findOne({ email: 'ai-screen-admin@example.com' });
    await app.store.table('users').updateById(adminUser.id, { role: 'super_admin' });
    const admin = (await jsonFetch(base, {
      path: '/api/v1/auth/login', method: 'POST', body: { email: 'ai-screen-admin@example.com', password: 'SuperSecret123!' },
    })).data.accessToken;
    const cust = await register(base, 'ai-screen-cust@example.com');

    // -- seed a real conversation through the public widget --
    const conv = await jsonFetch(base, {
      method: 'POST', path: '/api/v1/ai-support/conversations', body: { subject: 'Screen test conversation' },
    }, cust.data.accessToken);
    assert.strictEqual(conv.status, 201, JSON.stringify(conv.data));
    const convId = conv.data.conversation.id;
    const msg = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/ai-support/conversations/${convId}/messages`, body: { content: 'What are your VPS prices?' },
    }, cust.data.accessToken);
    assert.ok([200, 201].includes(msg.status), `widget message answered: ${JSON.stringify(msg.data)}`);

    // -- overview + panels --
    const overview = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/ai-support/overview' }, admin);
    assert.strictEqual(overview.status, 200);
    for (const key of ['counts', 'newsletterSubscriptions', 'aiHandledConversations', 'humanHandledConversations', 'humanEscalations', 'byReason']) {
      assert.ok(key in overview.data, `overview reads ${key}`);
    }

    const agents = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/ai-support/agents' }, admin);
    assert.strictEqual(agents.status, 200);
    assert.ok(Array.isArray(agents.data.agents), 'agents panel reads agents');
    const self = agents.data.agents.find((a) => a.id === adminUser.id);
    for (const key of ['id', 'fullName', 'email', 'role', 'presenceStatus', 'capacity']) {
      assert.ok(self && key in self, `agent row reads ${key}`);
    }

    const knowledge = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/ai-support/knowledge' }, admin);
    assert.strictEqual(knowledge.status, 200);
    assert.strictEqual(knowledge.data.editable, false, 'the catalogue is code-owned and read-only');
    assert.ok(typeof knowledge.data.note === 'string' && knowledge.data.note.length > 0, 'the API states its own review policy');
    assert.ok(Array.isArray(knowledge.data.knowledge) && knowledge.data.knowledge.length > 0, 'catalogue panel reads entries');

    const subs = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/newsletter-subscriptions' }, admin);
    assert.strictEqual(subs.status, 200);
    assert.ok(Array.isArray(subs.data.subscriptions), 'newsletter panel reads subscriptions');

    // -- conversation list + detail --
    const list = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/ai-support/conversations' }, admin);
    assert.strictEqual(list.status, 200);
    const row = list.data.conversations.find((c) => c.id === convId);
    for (const key of ['id', 'visitorName', 'status', 'priority', 'assignedAgentId', 'escalationReason', 'updatedAt']) {
      assert.ok(row && key in row, `conversation row reads ${key}`);
    }

    // Every status the screen's filter offers is accepted by the server enum. (A fresh widget
    // conversation can carry the legacy 'open' status; the filter dropdown never sends it.)
    for (const s of ['AI_ACTIVE', 'WAITING_FOR_HUMAN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED']) {
      const filtered = await jsonFetch(base, {
        method: 'GET', path: `/api/v1/admin/ai-support/conversations?status=${s}`,
      }, admin);
      assert.strictEqual(filtered.status, 200, `status filter '${s}' is accepted`);
      assert.ok(filtered.data.conversations.every((c) => c.status === s), `status filter '${s}' applied`);
    }

    const detail = await jsonFetch(base, { method: 'GET', path: `/api/v1/admin/ai-support/conversations/${convId}` }, admin);
    assert.strictEqual(detail.status, 200);
    assert.ok(Array.isArray(detail.data.messages) && detail.data.messages.length >= 1, 'detail reads messages');
    const assistantMsg = detail.data.messages.find((m) => m.senderType !== 'user' && m.senderType !== 'USER');
    if (assistantMsg && assistantMsg.intent) {
      for (const key of ['intent', 'confidence', 'sources']) {
        assert.ok(key in assistantMsg, `assistant message exposes ${key}`);
      }
    }

    // -- agent reply + management --
    const reply = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/admin/ai-support/conversations/${convId}/reply`, body: { message: 'A human agent is here.' },
    }, admin);
    assert.strictEqual(reply.status, 200, JSON.stringify(reply.data));
    assert.ok(reply.data.message, 'reply result reads message');

    const assigned = await jsonFetch(base, {
      method: 'PATCH', path: `/api/v1/admin/ai-support/conversations/${convId}`,
      body: { priority: 'high', assignedAgentId: adminUser.id },
    }, admin);
    assert.strictEqual(assigned.status, 200, JSON.stringify(assigned.data));
    assert.strictEqual(assigned.data.conversation.priority, 'high', 'patch result reads conversation');

    const handedBack = await jsonFetch(base, {
      method: 'PATCH', path: `/api/v1/admin/ai-support/conversations/${convId}`, body: { status: 'AI_ACTIVE' },
    }, admin);
    assert.strictEqual(handedBack.status, 200);

    const resolved = await jsonFetch(base, {
      method: 'PATCH', path: `/api/v1/admin/ai-support/conversations/${convId}`, body: { status: 'RESOLVED' },
    }, admin);
    assert.strictEqual(resolved.status, 200);

    // Reply to a closed conversation is refused by name.
    const replyRefused = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/admin/ai-support/conversations/${convId}/reply`, body: { message: 'Too late.' },
    }, admin);
    assert.strictEqual(replyRefused.status, 404);
    assert.match(String(replyRefused.data?.message ?? ''), /already closed/);

    // -- presence --
    const presence = await jsonFetch(base, {
      method: 'PUT', path: '/api/v1/admin/ai-support/presence', body: { status: 'ONLINE', capacity: 5 },
    }, admin);
    assert.strictEqual(presence.status, 200);
    assert.strictEqual(presence.data.status, 'ONLINE', 'presence result reads status');
    assert.strictEqual(presence.data.capacity, 5, 'presence result reads capacity');

    // -- tools moderation --
    await app.store.table('tools_reports').insert({
      id: '11111111-1111-4111-8111-111111111111', user_id: adminUser.id,
      tool_slug: 'mrz', title: 'Screen report', created_at: new Date().toISOString(),
    });
    await app.store.table('tools_monitors').insert({
      id: '22222222-2222-4222-8222-222222222222', user_id: adminUser.id,
      url: 'https://example.com', status: 'up', created_at: new Date().toISOString(),
    });

    const reports = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/tools/reports' }, admin);
    assert.strictEqual(reports.status, 200);
    const reportRow = reports.data.reports.find((r) => r.toolSlug === 'mrz');
    for (const key of ['id', 'userId', 'toolSlug', 'title', 'createdAt']) {
      assert.ok(reportRow && key in reportRow, `report row reads ${key}`);
    }
    const monitors = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/tools/monitors' }, admin);
    assert.strictEqual(monitors.status, 200);
    const monitorRow = monitors.data.monitors.find((m) => m.url === 'https://example.com');
    for (const key of ['id', 'userId', 'url', 'status']) {
      assert.ok(monitorRow && key in monitorRow, `monitor row reads ${key}`);
    }
    const deleted = await jsonFetch(base, {
      method: 'DELETE', path: `/api/v1/admin/tools/reports/${reportRow.id}`,
    }, admin);
    assert.strictEqual(deleted.status, 200);
    assert.strictEqual(deleted.data.ok, true, 'delete result reads ok');

    // -- MRZ settings + mandatory privacy locks --
    const settings = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/tools/mrz/settings' }, admin);
    assert.strictEqual(settings.status, 200);
    for (const key of ['calculatorEnabled', 'parserEnabled', 'testDataEnabled', 'rateLimitPerMinute', 'loggingLevel', 'availability', 'privacyProtectionLocked', 'persistSubmittedData', 'logSensitiveMrzData']) {
      assert.ok(key in settings.data.settings, `MRZ settings read ${key}`);
    }
    assert.strictEqual(settings.data.settings.privacyProtectionLocked, true, 'privacy protection is locked');

    const unlockRefused = await jsonFetch(base, {
      method: 'PUT', path: '/api/v1/admin/tools/mrz/settings', body: { privacyProtectionLocked: false },
    }, admin);
    assert.strictEqual(unlockRefused.status, 400);
    assert.match(String(unlockRefused.data?.message ?? ''), /mandatory and cannot be disabled/);

    const updated = await jsonFetch(base, {
      method: 'PUT', path: '/api/v1/admin/tools/mrz/settings', body: { rateLimitPerMinute: 30 },
    }, admin);
    assert.ok([200, 204].includes(updated.status), `settings update answers: ${updated.status}`);
    const after = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/tools/mrz/settings' }, admin);
    assert.strictEqual(Number(after.data.settings.rateLimitPerMinute), 30, 'rate limit persisted');

    // -- staff gates --
    for (const route of ['/api/v1/admin/ai-support/overview', '/api/v1/admin/tools/reports', '/api/v1/admin/tools/mrz/settings']) {
      const denied = await jsonFetch(base, { method: 'GET', path: route }, cust.data.accessToken);
      assert.ok(denied.status === 401 || denied.status === 403, `customer cannot read ${route} (got ${denied.status})`);
    }

    // -- page pins --
    for (const key of ['aiHandledConversations', 'humanEscalations', 'byReason', 'intent', 'confidence', 'sources', 'editable']) {
      assert.ok(AI_SRC.includes(key), `AdminAiSupportPage renders '${key}'`);
    }
    for (const key of ['toolSlug', 'rateLimitPerMinute', 'privacyProtectionLocked', 'mandatory and cannot be disabled', 'logSensitiveMrzData']) {
      assert.ok(TOOLS_SRC.includes(key), `AdminToolsPage renders '${key}'`);
    }
    for (const pathPart of [
      '/api/v1/admin/ai-support/overview', '/api/v1/admin/ai-support/conversations',
      '/api/v1/admin/ai-support/presence', '/api/v1/admin/newsletter-subscriptions',
      '/api/v1/admin/tools/reports', '/api/v1/admin/tools/monitors', '/api/v1/admin/tools/mrz/settings',
    ]) {
      assert.ok(API_CLIENT_SRC.includes(pathPart), `adminApi covers ${pathPart}`);
    }
  } finally {
    await close();
  }
});
