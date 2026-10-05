/**
 * Integration tests for the deployment API (spec §24), including the SSE event stream.
 *
 * The stream is exercised over a real socket because the two things most likely to regress — the
 * router appending its own 204 after the handler returns, and the ?token= auth path — only show up
 * on the wire.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, jsonFetch, register } = require('./helpers');

async function readStream(response, { stopOn = 'event: done', timeoutMs = 8000 } = {}) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const next = await Promise.race([
        reader.read(),
        new Promise((resolve) => setTimeout(() => resolve({ done: true }), 3000)),
      ]);
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      if (buffer.includes(stopOn)) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return buffer;
}

test('integration: deployments', async (t) => {
  const { base, app, close } = await startServer();
  try {
    const owner = (await register(base, 'dep-owner@example.com')).data.accessToken;
    const other = (await register(base, 'dep-other@example.com')).data.accessToken;

    const created = await jsonFetch(base, {
      path: '/api/v1/deployments', method: 'POST', body: { source: 'github', ref: 'main', action: 'install' },
    }, owner);
    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.data.deployment.status, 'queued');
    const id = created.data.deployment.id;

    await t.test('the list is scoped to the caller', async () => {
      const mine = await jsonFetch(base, { path: '/api/v1/deployments' }, owner);
      assert.ok(mine.data.deployments.some((d) => d.id === id));

      const theirs = await jsonFetch(base, { path: '/api/v1/deployments' }, other);
      assert.ok(!theirs.data.deployments.some((d) => d.id === id), "another customer's deployment is hidden");

      const filtered = await jsonFetch(base, { path: '/api/v1/deployments?status=queued' }, owner);
      assert.ok(filtered.data.deployments.every((d) => d.status === 'queued'));

      const bad = await jsonFetch(base, { path: '/api/v1/deployments?installationId=nope' }, owner);
      assert.strictEqual(bad.status, 400, 'installationId must be a UUID');
    });

    await t.test('detail returns the step pipeline and event log', async () => {
      const detail = await jsonFetch(base, { path: `/api/v1/deployments/${id}` }, owner);
      assert.strictEqual(detail.status, 200);
      assert.ok(Array.isArray(detail.data.steps));
      assert.strictEqual(detail.data.events.length, 1, 'the queued event is recorded');

      assert.strictEqual((await jsonFetch(base, { path: `/api/v1/deployments/${id}` }, other)).status, 404);
      assert.strictEqual((await jsonFetch(base, { path: '/api/v1/deployments/not-a-uuid' }, owner)).status, 400);
      assert.strictEqual(
        (await jsonFetch(base, { path: '/api/v1/deployments/00000000-0000-0000-0000-000000000099' }, owner)).status,
        404,
      );
    });

    await t.test('logs honour the since cursor', async () => {
      const logs = await jsonFetch(base, { path: `/api/v1/deployments/${id}/logs` }, owner);
      assert.strictEqual(logs.status, 200);
      assert.strictEqual(logs.data.events.length, 1);

      const since = encodeURIComponent(logs.data.events[0].created_at);
      const after = await jsonFetch(base, { path: `/api/v1/deployments/${id}/logs?since=${since}` }, owner);
      assert.strictEqual(after.data.events.length, 0, 'nothing newer than the cursor');

      const bad = await jsonFetch(base, { path: `/api/v1/deployments/${id}/logs?since=notadate` }, owner);
      assert.strictEqual(bad.status, 400, 'since must be an ISO datetime');
      assert.strictEqual((await jsonFetch(base, { path: `/api/v1/deployments/${id}/logs` }, other)).status, 404);
    });

    await t.test('only a queued deployment can be cancelled', async () => {
      const cancel = await jsonFetch(base, { path: `/api/v1/deployments/${id}/cancel`, method: 'POST' }, owner);
      assert.strictEqual(cancel.status, 200);
      assert.strictEqual(cancel.data.deployment.status, 'cancelled');
      assert.ok(cancel.data.deployment.completed_at, 'completion stamped');

      const again = await jsonFetch(base, { path: `/api/v1/deployments/${id}/cancel`, method: 'POST' }, owner);
      assert.strictEqual(again.status, 409, 'a cancelled deployment cannot be cancelled again');

      const logs = await jsonFetch(base, { path: `/api/v1/deployments/${id}/logs` }, owner);
      assert.strictEqual(logs.data.events.length, 2, 'cancellation is appended to the log');
    });

    await t.test('the SSE stream replays state and closes on a terminal status', async () => {
      const response = await fetch(`${base}/api/v1/deployments/${id}/events?token=${encodeURIComponent(owner)}`);
      assert.strictEqual(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);

      const body = await readStream(response);
      assert.match(body, /event: state/, 'a state frame is pushed');
      assert.match(body, /event: done/, 'the stream closes with done');
      assert.match(body, /"status":"cancelled"/, 'the terminal status is reported');

      assert.strictEqual((await fetch(`${base}/api/v1/deployments/${id}/events`)).status, 401, 'no token');
      assert.strictEqual((await fetch(`${base}/api/v1/deployments/${id}/events?token=garbage`)).status, 401);
      assert.strictEqual(
        (await fetch(`${base}/api/v1/deployments/${id}/events?token=${encodeURIComponent(other)}`)).status,
        404,
        'a non-owner cannot stream it',
      );
    });

    await t.test('steps written by a worker surface in order', async () => {
      await app.store.table('deployment_steps').insert({ deployment_id: id, step_order: 2, name: 'Configure domain', status: 'pending' });
      await app.store.table('deployment_steps').insert({ deployment_id: id, step_order: 1, name: 'Pull image', status: 'succeeded' });
      const detail = await jsonFetch(base, { path: `/api/v1/deployments/${id}` }, owner);
      assert.deepEqual(detail.data.steps.map((s) => s.name), ['Pull image', 'Configure domain'], 'ordered by step_order');
    });
  } finally {
    await close();
  }
});
