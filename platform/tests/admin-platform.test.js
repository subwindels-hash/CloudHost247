/**
 * Integration tests for the five routes that were still missing from admin-platform.ts:
 * GET /admin/audit, GET /admin/deployments/:id, POST /admin/subscriptions/:id/activate, and the
 * customer-facing POST /billing/subscriptions/:id/{cancel,change-plan}.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, jsonFetch, register } = require('./helpers');

async function adminToken(base, app, email = 'plat-admin@example.com') {
  await register(base, email, 'SuperSecret123!');
  const user = await app.store.table('users').findOne({ email });
  await app.store.table('users').updateById(user.id, { role: 'super_admin' });
  const login = await jsonFetch(base, {
    path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'SuperSecret123!' },
  });
  return login.data.accessToken;
}

test('integration: admin audit view', async (t) => {
  const { base, app, close } = await startServer();
  try {
    const admin = await adminToken(base, app);
    const adminUser = await app.store.table('users').findOne({ email: 'plat-admin@example.com' });
    const customer = (await register(base, 'audit-cust@example.com')).data.accessToken;
    const customerUser = await app.store.table('users').findOne({ email: 'audit-cust@example.com' });

    await app.store.table('audit_logs').insert({
      actor_id: adminUser.id, actor_role: 'super_admin', action: 'subscription.activated',
      entity_type: 'subscription', entity_id: '00000000-0000-0000-0000-0000000000aa',
    });
    await app.store.table('audit_logs').insert({
      actor_id: customerUser.id, actor_role: 'customer', action: 'subscription.cancelled',
      entity_type: 'subscription', entity_id: '00000000-0000-0000-0000-0000000000bb',
    });
    await app.store.table('audit_logs').insert({
      actor_id: adminUser.id, actor_role: 'super_admin', action: 'subscription.activated_extra',
      entity_type: 'other', entity_id: '00000000-0000-0000-0000-0000000000cc',
    });

    await t.test('the view is staff-only', async () => {
      assert.strictEqual((await jsonFetch(base, { path: '/api/v1/admin/audit' }, customer)).status, 403);
    });

    await t.test('entries carry the actor identity and a total', async () => {
      const res = await jsonFetch(base, { path: '/api/v1/admin/audit' }, admin);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.total, 3);
      const first = res.data.entries[0];
      assert.ok('actor_email' in first && 'actor_name' in first, 'the actor is joined on');
      assert.ok(first.created_at, 'newest first');
    });

    await t.test('action is an exact match, not a substring', async () => {
      const res = await jsonFetch(base, { path: '/api/v1/admin/audit?action=subscription.activated' }, admin);
      assert.strictEqual(res.data.total, 1, 'subscription.activated_extra must not match');
      assert.strictEqual(res.data.entries[0].action, 'subscription.activated');
      assert.strictEqual(res.data.entries[0].actor_email, 'plat-admin@example.com');
    });

    await t.test('actor, resource and paging filters apply', async () => {
      const byActor = await jsonFetch(base, { path: `/api/v1/admin/audit?actorId=${adminUser.id}` }, admin);
      assert.strictEqual(byActor.data.total, 2);

      const byResource = await jsonFetch(base, {
        path: '/api/v1/admin/audit?resourceType=subscription&resourceId=00000000-0000-0000-0000-0000000000bb',
      }, admin);
      assert.strictEqual(byResource.data.total, 1);
      assert.strictEqual(byResource.data.entries[0].action, 'subscription.cancelled');

      const paged = await jsonFetch(base, { path: '/api/v1/admin/audit?limit=1&offset=1' }, admin);
      assert.strictEqual(paged.data.entries.length, 1);
      assert.strictEqual(paged.data.total, 3, 'total is the untruncated match count');
    });

    await t.test('the query is validated', async () => {
      assert.strictEqual((await jsonFetch(base, { path: '/api/v1/admin/audit?limit=501' }, admin)).status, 400);
      assert.strictEqual((await jsonFetch(base, { path: '/api/v1/admin/audit?actorId=nope' }, admin)).status, 400);
    });
  } finally {
    await close();
  }
});

test('integration: admin deployment detail and subscription activation', async (t) => {
  const { base, app, close } = await startServer();
  try {
    const admin = await adminToken(base, app, 'dep-admin@example.com');
    const customer = (await register(base, 'dep-cust@example.com')).data.accessToken;
    const customerUser = await app.store.table('users').findOne({ email: 'dep-cust@example.com' });

    const deployment = await app.store.table('deployments').insert({
      user_id: customerUser.id, status: 'running', source: 'test',
    });
    await app.store.table('deployment_steps').insert({
      deployment_id: deployment.id, step_order: 1, name: 'pull-image', status: 'succeeded',
    });
    await app.store.table('deployment_steps').insert({
      deployment_id: deployment.id, step_order: 2, name: 'start-container', status: 'running',
    });
    await app.store.table('deployment_events').insert({
      deployment_id: deployment.id, level: 'info', message: 'started',
    });

    await t.test('GET /admin/deployments/:id returns steps and events', async () => {
      const res = await jsonFetch(base, { path: `/api/v1/admin/deployments/${deployment.id}` }, admin);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.deployment.id, deployment.id);
      assert.deepStrictEqual(res.data.steps.map((s) => s.name), ['pull-image', 'start-container'], 'steps are ordered');
      assert.strictEqual(res.data.events.length, 1);
      assert.strictEqual(res.data.events[0].message, 'started');
    });

    await t.test('the detail is staff-only and validates the id', async () => {
      assert.strictEqual((await jsonFetch(base, { path: `/api/v1/admin/deployments/${deployment.id}` }, customer)).status, 403);
      assert.strictEqual((await jsonFetch(base, { path: '/api/v1/admin/deployments/not-a-uuid' }, admin)).status, 400);

      const unknown = await jsonFetch(base, {
        path: '/api/v1/admin/deployments/00000000-0000-0000-0000-000000000099',
      }, admin);
      assert.strictEqual(unknown.status, 404);
      assert.match(unknown.data.message, /No deployment was found with that id/);
    });

    const pastDue = await app.store.table('subscriptions').insert({
      user_id: customerUser.id, status: 'past_due',
      past_due_since: new Date().toISOString(), suspended_at: new Date().toISOString(),
    });

    await t.test('POST /admin/subscriptions/:id/activate clears the overdue state', async () => {
      const res = await jsonFetch(base, {
        path: `/api/v1/admin/subscriptions/${pastDue.id}/activate`, method: 'POST', body: {},
      }, admin);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.subscription.status, 'active');
      assert.strictEqual(res.data.subscription.customer_id, customerUser.id, 'customer_id is exposed');
      assert.strictEqual(res.data.subscription.past_due_since, null);
      assert.strictEqual(res.data.subscription.suspended_at, null);

      const stored = await app.store.table('subscriptions').findById(pastDue.id);
      assert.strictEqual(stored.status, 'active');
      assert.strictEqual(stored.past_due_since, null);

      const auditRow = await app.store.table('audit_logs').findOne({ action: 'subscription.activated', entity_id: pastDue.id });
      assert.ok(auditRow, 'the activation is audited');
      assert.strictEqual(auditRow.after.from, 'past_due', 'the previous status is recorded');
    });

    await t.test('activation is staff-only and validates the id', async () => {
      assert.strictEqual(
        (await jsonFetch(base, { path: `/api/v1/admin/subscriptions/${pastDue.id}/activate`, method: 'POST', body: {} }, customer)).status,
        403,
      );
      assert.strictEqual(
        (await jsonFetch(base, { path: '/api/v1/admin/subscriptions/not-a-uuid/activate', method: 'POST', body: {} }, admin)).status,
        400,
      );
      const unknown = await jsonFetch(base, {
        path: '/api/v1/admin/subscriptions/00000000-0000-0000-0000-000000000099/activate', method: 'POST', body: {},
      }, admin);
      assert.strictEqual(unknown.status, 404);
      assert.match(unknown.data.message, /No subscription was found with that id/);
    });
  } finally {
    await close();
  }
});

test('integration: customer subscription cancellation and plan change', async (t) => {
  const { base, app, close } = await startServer();
  try {
    const owner = (await register(base, 'sub-owner@example.com')).data.accessToken;
    const other = (await register(base, 'sub-other@example.com')).data.accessToken;
    const ownerUser = await app.store.table('users').findOne({ email: 'sub-owner@example.com' });

    const plan = await app.store.table('catalog_product_plans').insert({
      slug: 'premium', name: 'Premium', status: 'active',
    });
    const retired = await app.store.table('catalog_product_plans').insert({
      slug: 'retired', name: 'Retired', status: 'archived',
    });

    const active = await app.store.table('subscriptions').insert({
      user_id: ownerUser.id, status: 'active', plan_id: plan.id,
    });

    await t.test('an inactive plan cannot be selected', async () => {
      const res = await jsonFetch(base, {
        path: `/api/v1/billing/subscriptions/${active.id}/change-plan`, method: 'POST', body: { planId: retired.id },
      }, owner);
      assert.strictEqual(res.status, 404);
      assert.match(res.data.message, /No purchasable plan was found with that id/);
    });

    await t.test('a plan change is recorded as a request, not applied', async () => {
      const res = await jsonFetch(base, {
        path: `/api/v1/billing/subscriptions/${active.id}/change-plan`, method: 'POST', body: { planId: plan.id },
      }, owner);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.pendingPlanId, plan.id);
      assert.strictEqual(res.data.subscription.id, active.id);

      const auditRow = await app.store.table('audit_logs').findOne({
        action: 'subscription.plan_change_requested', entity_id: active.id,
      });
      assert.ok(auditRow, 'the request is audited');
      assert.strictEqual(auditRow.after.toPlan, plan.id);
    });

    await t.test('the subscription and plan are owner-scoped and validated', async () => {
      assert.strictEqual(
        (await jsonFetch(base, { path: `/api/v1/billing/subscriptions/${active.id}/change-plan`, method: 'POST', body: { planId: plan.id } }, other)).status,
        404,
        'never a 403',
      );
      assert.strictEqual(
        (await jsonFetch(base, { path: '/api/v1/billing/subscriptions/not-a-uuid/change-plan', method: 'POST', body: { planId: plan.id } }, owner)).status,
        400,
      );
      assert.strictEqual(
        (await jsonFetch(base, { path: `/api/v1/billing/subscriptions/${active.id}/change-plan`, method: 'POST', body: { planId: 'not-a-uuid' } }, owner)).status,
        400,
      );
    });

    await t.test('cancelling sets cancel_at_period_end', async () => {
      const res = await jsonFetch(base, {
        path: `/api/v1/billing/subscriptions/${active.id}/cancel`, method: 'POST', body: {},
      }, owner);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.subscription.status, 'cancelled');
      assert.strictEqual(res.data.subscription.cancel_at_period_end, true, 'the period is honoured');
      assert.ok(res.data.subscription.cancelled_at, 'the cancellation is timestamped');
      assert.strictEqual(res.data.subscription.customer_id, ownerUser.id);
    });

    await t.test('cancelling again is idempotent, not an error', async () => {
      const res = await jsonFetch(base, {
        path: `/api/v1/billing/subscriptions/${active.id}/cancel`, method: 'POST', body: {},
      }, owner);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.alreadyCancelled, true);
    });

    await t.test('a cancelled subscription cannot change plan', async () => {
      const res = await jsonFetch(base, {
        path: `/api/v1/billing/subscriptions/${active.id}/change-plan`, method: 'POST', body: { planId: plan.id },
      }, owner);
      assert.strictEqual(res.status, 400);
      assert.match(res.data.message, /Only active subscriptions can change plan/);
    });

    await t.test("another customer's subscription is a 404", async () => {
      const res = await jsonFetch(base, {
        path: `/api/v1/billing/subscriptions/${active.id}/cancel`, method: 'POST', body: {},
      }, other);
      assert.strictEqual(res.status, 404);
    });
  } finally {
    await close();
  }
});
