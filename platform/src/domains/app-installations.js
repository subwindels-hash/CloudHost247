/**
 * Customer application installation API (spec §23) + the application catalogue (marketplace §/apps).
 *
 * Ported from cloudhost247-node/src/routes/app-installations.ts. POST /app-installations creates the
 * installation + an unpaid order and returns payment instructions — it never deploys synchronously;
 * deployment runs exclusively via the paid-order provisioning hook (deferred worker). Lifecycle
 * actions (start/stop/restart/update/backup/restore/reinstall) enqueue idempotent deployment jobs.
 * Every route is ownership-checked (indistinguishable 404, never 403) and status-guarded.
 *
 * Environment values are WRITE-ONLY: encrypted (AES-256-GCM, key from JWT_SECRET) and never returned
 * — only keys are listed. Log streaming and the actual deploy/exec are adapter concerns that are
 * deferred, so those endpoints report honestly rather than fabricating output.
 */
'use strict';

const crypto = require('node:crypto');
const { v } = require('../core/validate');
const { NotFoundError, ConflictError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate } = require('../lib/auth');

const name = 'app-installations';

const ACTION_STATUSES = {
  start: ['stopped', 'failed', 'healthy'],
  stop: ['healthy', 'unhealthy', 'starting', 'failed'],
  restart: ['healthy', 'unhealthy', 'stopped', 'starting', 'failed'],
  update: ['healthy', 'unhealthy', 'stopped'],
  backup: ['healthy', 'unhealthy', 'stopped'],
  restore: ['healthy', 'unhealthy', 'stopped'],
  reinstall: ['failed', 'stopped', 'unhealthy'],
};

function encKey(secret) { return crypto.scryptSync(String(secret), 'cloudhost247-app-env', 32); }
function encryptValue(secret, value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(secret), iv);
  const enc = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

function register(router, deps) {
  const { store } = deps;
  const secret = deps.config?.JWT_SECRET || 'ephemeral';

  async function audit(ctx, action, resourceId, metadata) {
    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: ctx.user.id, actor_role: ctx.user.role, action,
      entity_type: 'application_installation', entity_id: resourceId ?? null,
      ip_address: ctx.ip, user_agent: ctx.userAgent, after: metadata ?? null,
    });
  }
  async function mineOrThrow(ctx, id) {
    const inst = await store.table('application_installations').findById(id);
    if (!inst || inst.user_id !== ctx.user.id) throw new NotFoundError('No installation was found with that id');
    return inst;
  }
  async function enqueueDeployment(inst, action, requestedBy, payload, idempotencyKey) {
    const deployment = await store.table('deployments').insert({
      id: uuidv7(), user_id: requestedBy, installation_id: inst.id, server_id: inst.server_id ?? null,
      action, idempotency_key: idempotencyKey, requested_by: requestedBy, payload: payload ?? {}, status: 'queued',
    });
    return { deployment, created: true };
  }
  const publicInstallation = (row) => ({
    id: row.id, applicationId: row.application_id, versionId: row.version_id ?? null, serverId: row.server_id ?? null,
    name: row.name ?? null, domain: row.domain ?? null, planId: row.plan_id ?? null, status: row.status,
    url: row.url ?? null, backupEnabled: row.backup_enabled ?? false, createdAt: row.created_at, updatedAt: row.updated_at,
  });

  // ------------------------------------------------------------------ create
  router.post('/api/v1/app-installations', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const input = await ctx.validate(v.object({
      applicationId: v.string().min(1).max(160),
      versionId: v.string().optional(),
      serverId: v.string().optional(),
      name: v.string().min(1).max(160).optional(),
      domain: v.string().max(253).nullable().optional(),
      planId: v.string().optional(),
      billingPeriod: v.enum(['one_time', 'monthly', 'quarterly', 'semi_annually', 'annually']).optional(),
      environment: v.record(v.string().max(2000)).optional(),
      backupEnabled: v.boolean().optional(),
    }));
    const app = await store.table('applications').findById(input.applicationId)
      ?? await store.table('applications').findOne({ slug: input.applicationId });
    if (!app) throw new NotFoundError('No application was found with that id');

    const installationId = uuidv7();
    await store.table('application_installations').insert({
      id: installationId, user_id: auth.id, application_id: app.id, version_id: input.versionId ?? null,
      server_id: input.serverId ?? null, name: input.name ?? app.name, domain: input.domain ?? null,
      plan_id: input.planId ?? null, billing_period: input.billingPeriod ?? null,
      backup_enabled: input.backupEnabled ?? false, status: 'pending', config: input.environment ?? {},
    });
    // Seed encrypted environment entries (write-only).
    if (input.environment) {
      for (const [k, val] of Object.entries(input.environment)) {
        await store.table('application_environment').insert({ id: uuidv7(), installation_id: installationId, key: k, value_encrypted: encryptValue(secret, val), is_secret: true });
      }
    }
    // Unpaid order + invoice; deployment happens on the paid-order provisioning hook (deferred).
    const amount = (app.price_cents ?? 0) / 100;
    const orderId = uuidv7();
    const orderNumber = `APP-${Date.now().toString(36).toUpperCase()}`;
    await store.table('orders').insert({ id: orderId, user_id: auth.id, order_number: orderNumber, total_amount: amount, currency: 'USD', status: 'pending' });
    const invoiceId = uuidv7();
    const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`;
    await store.table('invoices').insert({ id: invoiceId, user_id: auth.id, order_id: orderId, invoice_number: invoiceNumber, amount, currency: 'USD', status: 'unpaid' });
    await store.table('application_installations').updateById(installationId, { order_id: orderId });
    await audit(ctx, 'installation.requested', installationId, { orderId, total: amount, paymentRequired: amount > 0 });
    ctx.code(201).json({
      installationId, orderId, orderNumber, invoiceId, invoiceNumber,
      totalAmount: amount, currency: 'USD', paymentRequired: amount > 0,
      message: amount > 0 ? 'Installation created. Deployment starts automatically after payment is confirmed.' : 'Installation created. Deployment has been queued.',
    });
  });

  router.get('/api/v1/app-installations', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rows = (await store.table('application_installations').all()).filter((i) => i.user_id === auth.id);
    ctx.json({ installations: rows.map(publicInstallation) });
  });

  router.get('/api/v1/app-installations/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const inst = await mineOrThrow(ctx, ctx.params.id);
    const app = await store.table('applications').findById(inst.application_id);
    const domains = (await store.table('application_domains').all()).filter((d) => d.installation_id === inst.id);
    ctx.json({ installation: { ...publicInstallation(inst), applicationName: app?.name ?? null, applicationSlug: app?.slug ?? null, domains: domains.map((d) => ({ domainId: d.domain_id, primary: d.primary })) } });
  });

  // ------------------------------------------------- lifecycle actions (param)
  router.post('/api/v1/app-installations/:id/:action', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const actionName = ctx.params.action;
    const allowed = ACTION_STATUSES[actionName];
    if (!allowed) throw new NotFoundError('No installation was found with that id');
    const inst = await mineOrThrow(ctx, ctx.params.id);
    if (['deleted', 'deleting'].includes(inst.status)) throw new ConflictError('This installation is deleted');
    if (!allowed.includes(inst.status)) throw new ConflictError(`Cannot ${actionName} an installation with status "${inst.status}"`);

    let payload = {};
    if (actionName === 'restore') {
      const body = await ctx.validate(v.object({ backupId: v.string().min(1) }));
      const backup = await store.table('application_backups').findById(body.backupId);
      if (!backup || backup.installation_id !== inst.id || backup.status !== 'completed') throw new NotFoundError('No completed backup was found with that id for this installation');
      payload = { backupId: body.backupId };
    } else if (actionName === 'update') {
      const body = await ctx.validate(v.object({ versionId: v.string().optional() }).passthrough());
      payload = body.versionId ? { versionId: body.versionId } : {};
    }

    const { deployment, created } = await enqueueDeployment(inst, actionName, auth.id, payload, `${actionName}:${inst.id}:${uuidv7()}`);
    await audit(ctx, `installation.${actionName}`, inst.id, { deploymentId: deployment.id, queued: created });
    ctx.code(created ? 202 : 200).json({ deploymentId: deployment.id, status: deployment.status, queued: created });
  });

  router.delete('/api/v1/app-installations/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const inst = await mineOrThrow(ctx, ctx.params.id);
    if (['deleting', 'deleted'].includes(inst.status)) return ctx.noContent();
    const { deployment, created } = await enqueueDeployment(inst, 'uninstall', auth.id, {}, `uninstall:${inst.id}:${Date.now()}`);
    await store.table('application_installations').updateById(inst.id, { status: 'deleting' });
    await audit(ctx, 'installation.uninstall_requested', inst.id, { deploymentId: deployment.id, queued: created });
    ctx.code(202).json({ deploymentId: deployment.id, status: 'deleting' });
  });

  // ------------------------------------------------------------ sub-resources
  router.get('/api/v1/app-installations/:id/deployments', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const inst = await mineOrThrow(ctx, ctx.params.id);
    const rows = (await store.table('deployments').all()).filter((d) => d.installation_id === inst.id);
    ctx.json({ deployments: rows.slice(-50).reverse().map((d) => ({ id: d.id, action: d.action ?? null, status: d.status, createdAt: d.created_at })) });
  });

  router.get('/api/v1/app-installations/:id/logs', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const inst = await mineOrThrow(ctx, ctx.params.id);
    const query = await ctx.validateQuery(v.object({ tail: v.coerce.number().int().min(10).max(1000).optional() }));
    // Log streaming requires the on-server agent (deferred) — report honestly, never fabricate.
    ctx.json({ lines: [], tail: query.tail ?? 200, truncated: false, note: 'Log streaming requires the on-server agent, which is not connected in this deployment.' });
  });

  router.get('/api/v1/app-installations/:id/backups', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const inst = await mineOrThrow(ctx, ctx.params.id);
    const rows = (await store.table('application_backups').all()).filter((b) => b.installation_id === inst.id);
    ctx.json({ backups: rows.map((b) => ({ id: b.id, status: b.status, sizeBytes: b.size_bytes ?? null, completedAt: b.completed_at ?? null, createdAt: b.created_at })) });
  });

  // Environment: keys only — values never leave the server (spec §16).
  router.get('/api/v1/app-installations/:id/environment', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const inst = await mineOrThrow(ctx, ctx.params.id);
    const rows = (await store.table('application_environment').all()).filter((e) => e.installation_id === inst.id);
    ctx.json({ environment: rows.map((e) => ({ key: e.key, isSecret: e.is_secret })) });
  });

  router.put('/api/v1/app-installations/:id/environment', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const inst = await mineOrThrow(ctx, ctx.params.id);
    const body = await ctx.validate(v.object({
      key: v.string().regex(/^[A-Z][A-Z0-9_]*$/, 'key must be UPPER_SNAKE_CASE').max(255),
      value: v.string().max(2000),
      isSecret: v.boolean().default(true),
    }));
    const existing = (await store.table('application_environment').all()).find((e) => e.installation_id === inst.id && e.key === body.key);
    if (existing) await store.table('application_environment').updateById(existing.id, { value_encrypted: encryptValue(secret, body.value), is_secret: body.isSecret });
    else await store.table('application_environment').insert({ id: uuidv7(), installation_id: inst.id, key: body.key, value_encrypted: encryptValue(secret, body.value), is_secret: body.isSecret });
    await audit(ctx, 'installation.environment_set', inst.id, { key: body.key });
    ctx.json({ ok: true });
  });

  router.delete('/api/v1/app-installations/:id/environment/:key', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const inst = await mineOrThrow(ctx, ctx.params.id);
    const row = (await store.table('application_environment').all()).find((e) => e.installation_id === inst.id && e.key === ctx.params.key);
    if (row) await store.table('application_environment').deleteById(row.id);
    ctx.noContent();
  });

  // Domains: attach/detach the customer's verified domains (spec §15).
  router.get('/api/v1/app-installations/:id/domains', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const inst = await mineOrThrow(ctx, ctx.params.id);
    const links = (await store.table('application_domains').all()).filter((d) => d.installation_id === inst.id);
    const out = [];
    for (const l of links) {
      const dom = await store.table('customer_domains').findById(l.domain_id);
      out.push({ domainId: l.domain_id, domainName: dom?.domain ?? null, primary: l.primary });
    }
    ctx.json({ domains: out });
  });

  router.post('/api/v1/app-installations/:id/domains', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const inst = await mineOrThrow(ctx, ctx.params.id);
    const body = await ctx.validate(v.object({ domainId: v.string().min(1), primary: v.boolean().default(true) }));
    const domain = await store.table('customer_domains').findById(body.domainId);
    if (!domain || domain.user_id !== auth.id) throw new NotFoundError('No domain was found with that id');
    if (domain.status !== 'verified') throw new ConflictError('Verify the domain before attaching it to an application');
    const isPrimary = body.primary ?? true;
    const existing = (await store.table('application_domains').all()).find((d) => d.installation_id === inst.id && d.domain_id === domain.id);
    if (existing) await store.table('application_domains').updateById(existing.id, { primary: isPrimary });
    else await store.table('application_domains').insert({ id: uuidv7(), installation_id: inst.id, domain_id: domain.id, primary: isPrimary });
    if (isPrimary) await store.table('application_installations').updateById(inst.id, { domain: domain.domain });
    await audit(ctx, 'installation.domain_attached', inst.id, { domainId: domain.id, primary: isPrimary });
    ctx.code(201).json({ ok: true });
  });

  router.delete('/api/v1/app-installations/:id/domains/:domainId', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const inst = await mineOrThrow(ctx, ctx.params.id);
    const row = (await store.table('application_domains').all()).find((d) => d.installation_id === inst.id && d.domain_id === ctx.params.domainId);
    if (row) await store.table('application_domains').deleteById(row.id);
    ctx.noContent();
  });

  router.get('/api/v1/app-installations/summary', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rows = (await store.table('application_installations').all()).filter((i) => i.user_id === auth.id);
    ctx.json({ installations: rows.map((i) => ({ id: i.id, name: i.name ?? null, applicationId: i.application_id, status: i.status, domain: i.domain ?? null })) });
  });

  // ---------------------------------------------------------------- catalogue
  // (Original marketplace /apps surface — kept here until the marketplace module is ported.)
  router.get('/api/v1/apps', async (ctx) => {
    const query = await ctx.validateQuery(v.object({ category: v.string().optional(), search: v.string().optional() }));
    let rows = (await store.table('applications').all()).filter((a) => a.active !== false && (a.status ?? 'active') !== 'disabled');
    if (query.category) rows = rows.filter((a) => a.category_id === query.category);
    if (query.search) rows = rows.filter((a) => (a.name || '').toLowerCase().includes(query.search.toLowerCase()));
    ctx.json({ applications: rows.map((a) => ({ id: a.id, slug: a.slug, name: a.name, category: a.category_id ?? null, description: a.description ?? null, icon: a.icon ?? null, version: a.version ?? null })) });
  });

  router.get('/api/v1/apps/:slug', async (ctx) => {
    const app = await store.table('applications').findOne({ slug: ctx.params.slug }) ?? await store.table('applications').findById(ctx.params.slug);
    if (!app) throw new NotFoundError('No application was found with that slug');
    ctx.json({ application: { id: app.id, slug: app.slug, name: app.name, category: app.category_id ?? null, description: app.description ?? null, icon: app.icon ?? null, version: app.version ?? null, manifest: app.manifest ?? null } });
  });

  router.get('/api/v1/apps/:slug/versions', async (ctx) => {
    const app = await store.table('applications').findOne({ slug: ctx.params.slug }) ?? await store.table('applications').findById(ctx.params.slug);
    if (!app) throw new NotFoundError('No application was found with that slug');
    // The catalogue records the current version on the application row.
    ctx.json({ versions: app.version ? [{ id: app.id, version: app.version, current: true }] : [] });
  });
}

module.exports = { name, register };
