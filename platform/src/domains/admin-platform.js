/**
 * Admin platform: settings, and cross-cutting read views (deployments, installations,
 * subscriptions).
 *
 * Ported from cloudhost247-node/src/routes/admin-platform.ts. Platform settings are a typed
 * key/value store in platform_settings; writes are super_admin and audited.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { asAdmin, asSuperAdmin, asStaff } = require('../lib/auth');

const { subscriptionRow } = require('../lib/subscription-dto');

const name = 'admin-platform';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function register(router, deps) {
  const { store } = deps;

  router.get('/api/v1/admin/settings', async (ctx) => {
    await asAdmin(ctx, deps);
    const rows = await store.table('platform_settings').all();
    ctx.json({ settings: rows.map((r) => ({ key: r.key, value: r.value, updatedAt: r.updated_at })) });
  });

  router.put('/api/v1/admin/settings/:key', async (ctx) => {
    const auth = await asSuperAdmin(ctx, deps);
    const body = await ctx.validate(v.object({ value: v.any() }));

    const existing = await store.table('platform_settings').findById(ctx.params.key);
    if (existing) {
      await store.table('platform_settings').updateById(ctx.params.key, {
        value: body.value, updated_by: auth.id,
      });
    } else {
      await store.table('platform_settings').insert({
        key: ctx.params.key, value: body.value, updated_by: auth.id,
      });
    }

    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: auth.id, actor_role: auth.role,
      action: 'platform_setting_update', entity_type: 'platform_settings', entity_id: ctx.params.key,
      ip_address: ctx.ip, user_agent: ctx.userAgent,
    });
    ctx.json({ ok: true, key: ctx.params.key });
  });

  /**
   * The platform-wide audit view (admin-platform.ts GET /admin/audit). Unlike audit.ts's
   * /admin/audit-logs, `action` here is an exact match, not a substring, and the response carries
   * the actor's email and name. resourceType/resourceId map onto this schema's
   * entity_type/entity_id.
   */
  router.get('/api/v1/admin/audit', async (ctx) => {
    await asAdmin(ctx, deps);
    const query = await ctx.validateQuery(v.object({
      actorId: v.string().uuid().optional(),
      action: v.string().max(96).optional(),
      resourceType: v.string().max(48).optional(),
      resourceId: v.string().max(64).optional(),
      limit: v.coerce.number().int().min(1).max(500).optional(),
      offset: v.coerce.number().int().min(0).max(100000).optional(),
    }));

    const matches = (row) => {
      if (query.actorId && row.actor_id !== query.actorId) return false;
      if (query.action && row.action !== query.action) return false;
      if (query.resourceType && row.entity_type !== query.resourceType) return false;
      if (query.resourceId && row.entity_id !== query.resourceId) return false;
      return true;
    };

    const { rows } = await store.table('audit_logs').find((row) => matches(row), { orderBy: '-created_at' });
    const total = rows.length;
    const offset = query.offset ?? 0;
    const page = rows.slice(offset, offset + (query.limit ?? 100));

    const entries = [];
    for (const row of page) {
      const actor = row.actor_id ? await store.table('users').findById(row.actor_id) : null;
      entries.push({ ...row, actor_email: actor?.email ?? null, actor_name: actor?.full_name ?? null });
    }
    ctx.json({ entries, total });
  });

  router.get('/api/v1/admin/deployments', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows, total } = await store.table('deployments').find({}, { orderBy: '-created_at', limit: 200 });
    ctx.json({ deployments: rows.map((d) => ({ id: d.id, userId: d.user_id, status: d.status, source: d.source, createdAt: d.created_at })), total });
  });

  /** Staff deployment detail: the row plus its steps and event timeline. */
  router.get('/api/v1/admin/deployments/:id', async (ctx) => {
    await asStaff(ctx, deps);
    if (!UUID_RE.test(String(ctx.params.id ?? ''))) throw new ValidationError('id must be a valid UUID');
    const deployment = await store.table('deployments').findById(ctx.params.id);
    if (!deployment) throw new NotFoundError('No deployment was found with that id');

    const { rows: steps } = await store.table('deployment_steps').find({ deployment_id: deployment.id }, { orderBy: 'step_order' });
    const { rows: events } = await store.table('deployment_events').find({ deployment_id: deployment.id }, { orderBy: 'created_at' });
    ctx.json({ deployment, steps, events });
  });

  router.get('/api/v1/admin/installations', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows, total } = await store.table('application_installations').find({}, { orderBy: '-created_at', limit: 200 });
    ctx.json({ installations: rows.map((i) => ({ id: i.id, userId: i.user_id, applicationId: i.application_id, status: i.status })), total });
  });

  router.get('/api/v1/admin/subscriptions', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows, total } = await store.table('subscriptions').find({}, { orderBy: '-created_at', limit: 200 });
    ctx.json({ subscriptions: rows.map((s) => ({ id: s.id, userId: s.user_id, status: s.status, renewsAt: s.renews_at })), total });
  });

  /**
   * Staff reinstatement: clear the overdue/suspension state and put the subscription back to
   * active. The status it came from is recorded in the audit entry.
   */
  router.post('/api/v1/admin/subscriptions/:id/activate', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    if (!UUID_RE.test(String(ctx.params.id ?? ''))) throw new ValidationError('id must be a valid UUID');

    const subscription = await store.table('subscriptions').findById(ctx.params.id);
    if (!subscription) throw new NotFoundError('No subscription was found with that id');

    const updated = await store.table('subscriptions').updateById(subscription.id, {
      status: 'active',
      past_due_since: null,
      suspended_at: null,
    });

    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: auth.id, actor_role: auth.role,
      action: 'subscription.activated', entity_type: 'subscription', entity_id: subscription.id,
      ip_address: ctx.ip, user_agent: ctx.userAgent, after: { from: subscription.status },
    });
    ctx.json({ subscription: subscriptionRow(updated) });
  });
}

module.exports = { name, register };
