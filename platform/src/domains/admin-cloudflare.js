/**
 * Admin Cloudflare API (spec §3–§4, §28–§29, §49, §69).
 *
 * Ported from cloudhost247-node/src/routes/admin-cloudflare.ts. All routes require admin/super_admin.
 * Account API tokens are WRITE-ONLY: accepted on create/update, encrypted at rest (AES-256-GCM, key
 * from JWT_SECRET), and never returned by any endpoint. Every manual override is audited.
 *
 * Live Cloudflare egress is deferred, so "Test Connection" never fakes success (reports
 * unavailable / not_configured honestly) and purge-cache queues the durable job rather than
 * claiming a completed upstream purge.
 */
'use strict';

const crypto = require('node:crypto');
const { v } = require('../core/validate');
const { NotFoundError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { asAdmin } = require('../lib/auth');

const name = 'admin-cloudflare';

const FEATURE_KEYS = ['dns', 'dnssec', 'analytics', 'ssl', 'firewall', 'speed', 'caching', 'cache_purge', 'development_mode', 'scrape_shield', 'plan_change'];
const TIER_DEFAULTS = {
  free: { dns: true, dnssec: true, analytics: true, ssl: true, caching: true, cache_purge: true, development_mode: true, scrape_shield: false, firewall: false, speed: false, plan_change: true },
  pro: { dns: true, dnssec: true, analytics: true, ssl: true, caching: true, cache_purge: true, development_mode: true, scrape_shield: true, firewall: true, speed: true, plan_change: true },
  business: { dns: true, dnssec: true, analytics: true, ssl: true, caching: true, cache_purge: true, development_mode: true, scrape_shield: true, firewall: true, speed: true, plan_change: true },
  enterprise: { dns: true, dnssec: true, analytics: true, ssl: true, caching: true, cache_purge: true, development_mode: true, scrape_shield: true, firewall: true, speed: true, plan_change: false },
};
const LIFECYCLE_ACTIONS = ['provision', 'sync', 'suspend', 'unsuspend', 'terminate'];

function encKey(secret) { return crypto.scryptSync(String(secret), 'cloudhost247-cf-accounts', 32); }
function encryptToken(secret, token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(secret), iv);
  const enc = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}
function resolveEntitlements(mapping, tier) {
  const defaults = TIER_DEFAULTS[tier] || TIER_DEFAULTS.free;
  const out = {};
  for (const key of FEATURE_KEYS) {
    const admin = mapping?.entitlements?.[key];
    out[key] = Boolean(admin !== undefined ? admin : (defaults[key] ?? false));
  }
  return out;
}

function register(router, deps) {
  const { store } = deps;
  const secret = deps.config?.JWT_SECRET || 'ephemeral';

  async function audit(ctx, action, resourceType, resourceId, metadata) {
    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: ctx.user.id, actor_role: ctx.user.role, action,
      entity_type: resourceType, entity_id: resourceId ?? null,
      ip_address: ctx.ip, user_agent: ctx.userAgent, after: metadata ?? null,
    });
  }
  // Account DTO never includes the token (write-only).
  const accountDto = (a) => ({
    id: a.id, accountName: a.account_name, cloudflareAccountId: a.cloudflare_account_id ?? a.account_id ?? null,
    apiBaseUrl: a.api_base_url ?? null, defaultZoneType: a.default_zone_type ?? null, defaultSslMode: a.default_ssl_mode ?? null,
    defaultProxied: a.default_proxied ?? null, status: a.status, hasToken: Boolean(a.encrypted_api_token || a.api_token),
    createdAt: a.created_at,
  });
  const mappingDto = (m) => ({
    id: m.id, planId: m.plan_id ?? null, planName: m.plan_name ?? null, productName: m.product_name ?? null,
    cloudflarePlan: m.cloudflare_plan ?? null, entitlements: m.entitlements ?? {}, maxDomains: m.max_domains ?? null,
    provisioningMode: m.provisioning_mode ?? null, defaultSslMode: m.default_ssl_mode ?? null, defaultProxied: m.default_proxied ?? null,
  });
  async function enqueueJob(service, jobType, idempotencyKey, maxAttempts) {
    return store.table('cloudflare_jobs').insert({
      id: uuidv7(), account_id: service.account_id ?? null, service_id: service.id,
      kind: jobType, type: jobType, status: 'queued',
      payload: { idempotencyKey, maxAttempts: maxAttempts ?? 1 },
    });
  }
  const accountBody = () => v.object({
    accountName: v.string().min(1).max(120),
    cloudflareAccountId: v.string().min(1).max(64),
    apiToken: v.string().min(10).max(500),
    apiBaseUrl: v.string().max(255).optional(),
    defaultZoneType: v.enum(['full', 'partial']).optional(),
    defaultSslMode: v.enum(['off', 'flexible', 'full', 'strict']).optional(),
    defaultProxied: v.boolean().optional(),
  });

  // ------------------------------------------------------------------ overview
  router.get('/api/v1/admin/cloudflare', async (ctx) => {
    await asAdmin(ctx, deps);
    const services = await store.table('cloudflare_services').all();
    const jobs = await store.table('cloudflare_jobs').all();
    const apiLogs = await store.table('cloudflare_api_logs').all();
    const live = services.filter((s) => s.status !== 'terminated');
    const dayAgo = Date.now() - 86400000;
    const weekAgo = Date.now() - 7 * 86400000;
    const stats = {
      total_services: live.length,
      active_services: services.filter((s) => s.status === 'active').length,
      active_zones: services.filter((s) => s.status === 'active' && s.activation_status === 'active').length,
      provisioning: services.filter((s) => ['pending', 'provisioning'].includes(s.status)).length,
      suspended: services.filter((s) => s.status === 'suspended').length,
      failed: services.filter((s) => ['provisioning_failed', 'sync_failed'].includes(s.status)).length,
      jobs_queued: jobs.filter((j) => j.status === 'queued').length,
      jobs_failed_7d: jobs.filter((j) => j.status === 'failed' && new Date(j.created_at).getTime() > weekAgo).length,
      api_errors_24h: apiLogs.filter((l) => l.success === false && new Date(l.created_at).getTime() > dayAgo).length,
      last_sync: services.map((s) => s.last_synced_at).filter(Boolean).sort().pop() ?? null,
    };
    // Monthly revenue from paid invoices this month, grouped by currency (best-effort).
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const invoices = (await store.table('invoices').all()).filter((i) => i.status === 'paid' && new Date(i.created_at).getTime() >= monthStart.getTime());
    const monthly_revenue = {};
    for (const inv of invoices) { const c = inv.currency ?? 'USD'; monthly_revenue[c] = String(Number(monthly_revenue[c] ?? 0) + Number(inv.amount ?? 0)); }
    const planDistribution = {};
    for (const s of live) { const p = s.cloudflare_plan ?? 'unknown'; planDistribution[p] = (planDistribution[p] ?? 0) + 1; }
    const accounts = await store.table('cloudflare_accounts').all();
    ctx.json({ stats, monthly_revenue, accounts: accounts.map(accountDto), planDistribution: Object.entries(planDistribution).map(([cloudflare_plan, count]) => ({ cloudflare_plan, count: String(count) })) });
  });

  // ------------------------------------------------------------------ accounts
  router.get('/api/v1/admin/cloudflare/accounts', async (ctx) => {
    await asAdmin(ctx, deps);
    const accounts = await store.table('cloudflare_accounts').all();
    ctx.json({ accounts: accounts.map(accountDto) });
  });

  router.post('/api/v1/admin/cloudflare/accounts', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const body = await ctx.validate(accountBody());
    const account = await store.table('cloudflare_accounts').insert({
      id: uuidv7(), account_name: body.accountName, cloudflare_account_id: body.cloudflareAccountId,
      account_id: body.cloudflareAccountId, encrypted_api_token: encryptToken(secret, body.apiToken),
      api_base_url: body.apiBaseUrl ?? null, default_zone_type: body.defaultZoneType ?? null,
      default_ssl_mode: body.defaultSslMode ?? null, default_proxied: body.defaultProxied ?? null,
      status: 'active', created_by: auth.id,
    });
    await audit(ctx, 'cloudflare.account_created', 'cloudflare_account', account.id, null);
    ctx.code(201).json({ account: accountDto(account) });
  });

  router.patch('/api/v1/admin/cloudflare/accounts/:id', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const id = ctx.params.id;
    const body = await ctx.validate(accountBody().partial().extend({ status: v.enum(['active', 'disabled']).optional() }));
    const current = await store.table('cloudflare_accounts').findById(id);
    if (!current) throw new NotFoundError('No Cloudflare account was found with that id');
    const patch = {};
    if (body.accountName !== undefined) patch.account_name = body.accountName;
    if (body.cloudflareAccountId !== undefined) { patch.cloudflare_account_id = body.cloudflareAccountId; patch.account_id = body.cloudflareAccountId; }
    if (body.apiBaseUrl !== undefined) patch.api_base_url = body.apiBaseUrl;
    if (body.apiToken) patch.encrypted_api_token = encryptToken(secret, body.apiToken);
    if (body.status !== undefined) patch.status = body.status;
    if (body.defaultZoneType !== undefined) patch.default_zone_type = body.defaultZoneType;
    if (body.defaultSslMode !== undefined) patch.default_ssl_mode = body.defaultSslMode;
    if (body.defaultProxied !== undefined) patch.default_proxied = body.defaultProxied;
    const account = await store.table('cloudflare_accounts').updateById(id, patch);
    await audit(ctx, 'cloudflare.account_updated', 'cloudflare_account', id, { tokenRotated: Boolean(body.apiToken), status: body.status ?? null });
    ctx.json({ account: accountDto(account) });
  });

  router.post('/api/v1/admin/cloudflare/accounts/:id/test', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const id = ctx.params.id;
    const account = await store.table('cloudflare_accounts').findById(id);
    if (!account) throw new NotFoundError('No Cloudflare account was found with that id');
    // No live egress in this build — report honestly, never fabricate a successful connection.
    const hasToken = Boolean(account.encrypted_api_token || account.api_token);
    const result = hasToken
      ? { status: 'unavailable', message: 'Cloudflare egress is not available in this deployment; the connection could not be tested.' }
      : { status: 'not_configured', message: 'No API token is stored for this account' };
    await audit(ctx, 'cloudflare.connection_tested', 'cloudflare_account', id, { status: result.status });
    ctx.json(result);
  });

  // ------------------------------------------------------------- plan mappings
  router.get('/api/v1/admin/cloudflare/available-plans', async (ctx) => {
    await asAdmin(ctx, deps);
    const plans = await store.table('catalog_product_plans').all();
    const products = await store.table('catalog_products').all();
    const byId = new Map(products.map((p) => [p.id, p]));
    const out = plans.map((pl) => ({ id: pl.id, name: pl.name, product_name: byId.get(pl.product_id)?.name ?? null, status: pl.status }));
    out.sort((a, b) => (a.product_name ?? '').localeCompare(b.product_name ?? '') || a.name.localeCompare(b.name));
    ctx.json({ plans: out });
  });

  router.get('/api/v1/admin/cloudflare/plan-mappings', async (ctx) => {
    await asAdmin(ctx, deps);
    const rows = await store.table('cloudflare_plan_mappings').all();
    ctx.json({ mappings: rows.map(mappingDto), featureKeys: FEATURE_KEYS });
  });

  router.put('/api/v1/admin/cloudflare/plan-mappings', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const body = await ctx.validate(v.object({
      planId: v.string().min(1),
      cloudflarePlan: v.enum(['free', 'pro', 'business', 'enterprise']),
      entitlements: v.object(Object.fromEntries(FEATURE_KEYS.map((k) => [k, v.boolean().optional()]))).default({}),
      maxDomains: v.coerce.number().int().min(1).max(100).optional(),
      provisioningMode: v.enum(['automatic', 'manual']).optional(),
      defaultSslMode: v.enum(['off', 'flexible', 'full', 'strict']).nullable().optional(),
      defaultProxied: v.boolean().nullable().optional(),
    }));
    const plan = await store.table('catalog_product_plans').findById(body.planId);
    if (!plan) throw new NotFoundError('No product plan was found with that id');
    const entitlements = Object.fromEntries(Object.entries(body.entitlements ?? {}).filter(([, val]) => val !== undefined));
    const product = plan.product_id ? await store.table('catalog_products').findById(plan.product_id) : null;
    const existing = await store.table('cloudflare_plan_mappings').findOne({ plan_id: body.planId });
    const fields = {
      plan_id: body.planId, plan_name: plan.name, product_id: plan.product_id ?? null, product_name: product?.name ?? null,
      cloudflare_plan: body.cloudflarePlan, entitlements, max_domains: body.maxDomains ?? null,
      provisioning_mode: body.provisioningMode ?? null, default_ssl_mode: body.defaultSslMode ?? null,
      default_proxied: body.defaultProxied ?? null, plan_status: 'active',
    };
    const mapping = existing
      ? await store.table('cloudflare_plan_mappings').updateById(existing.id, fields)
      : await store.table('cloudflare_plan_mappings').insert({ id: uuidv7(), ...fields, created_by: auth.id });
    await audit(ctx, 'cloudflare.plan_mapping_saved', 'cloudflare_plan_mapping', mapping.id, { planId: body.planId, cloudflarePlan: body.cloudflarePlan });
    ctx.json({ mapping: mappingDto(mapping) });
  });

  router.delete('/api/v1/admin/cloudflare/plan-mappings/:id', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const id = ctx.params.id;
    const row = await store.table('cloudflare_plan_mappings').findById(id);
    if (!row) throw new NotFoundError('No plan mapping was found with that id');
    await store.table('cloudflare_plan_mappings').deleteById(id);
    await audit(ctx, 'cloudflare.plan_mapping_deleted', 'cloudflare_plan_mapping', id, null);
    ctx.json({ deleted: true });
  });

  // ------------------------------------------------------------------ services
  router.get('/api/v1/admin/cloudflare/services', async (ctx) => {
    await asAdmin(ctx, deps);
    const query = await ctx.validateQuery(v.object({ page: v.coerce.number().int().min(1).default(1), limit: v.coerce.number().int().min(1).max(100).default(25), status: v.string().max(24).optional(), search: v.string().max(120).optional() }));
    let rows = await store.table('cloudflare_services').find({}, { orderBy: '-created_at' }).then((r) => r.rows);
    if (query.status) rows = rows.filter((s) => s.status === query.status);
    if (query.search) rows = rows.filter((s) => (s.zone_name || '').toLowerCase().includes(query.search.toLowerCase()));
    const start = (query.page - 1) * query.limit;
    ctx.json({
      services: rows.slice(start, start + query.limit).map((s) => ({ id: s.id, userId: s.user_id, zoneName: s.zone_name, cloudflarePlan: s.cloudflare_plan ?? null, status: s.status, activationStatus: s.activation_status ?? null, zoneId: s.zone_id ?? null, lastSyncedAt: s.last_synced_at ?? null })),
      page: query.page, limit: query.limit, total: rows.length,
    });
  });

  router.get('/api/v1/admin/cloudflare/services/:id', async (ctx) => {
    await asAdmin(ctx, deps);
    const id = ctx.params.id;
    const service = await store.table('cloudflare_services').findById(id);
    if (!service) throw new NotFoundError('No Cloudflare service was found with that id');
    const mapping = service.plan_id ? await store.table('cloudflare_plan_mappings').findOne({ plan_id: service.plan_id }) : null;
    const entitlements = resolveEntitlements(mapping, service.cloudflare_plan || 'free');
    const jobs = (await store.table('cloudflare_jobs').all()).filter((j) => j.service_id === id).slice(-20).reverse();
    ctx.json({
      service: { id: service.id, userId: service.user_id, zoneName: service.zone_name, cloudflarePlan: service.cloudflare_plan ?? null, status: service.status, activationStatus: service.activation_status ?? null, zoneId: service.zone_id ?? null, sslMode: service.ssl_mode ?? null, lastSyncedAt: service.last_synced_at ?? null },
      entitlements,
      jobs: jobs.map((j) => ({ id: j.id, type: j.type ?? j.kind, status: j.status, createdAt: j.created_at })),
    });
  });

  router.post('/api/v1/admin/cloudflare/services/:id/:action', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const id = ctx.params.id;
    const action = ctx.params.action;
    if (!LIFECYCLE_ACTIONS.includes(action)) throw new NotFoundError('No Cloudflare service was found with that id');
    const service = await store.table('cloudflare_services').findById(id);
    if (!service) throw new NotFoundError('No Cloudflare service was found with that id');

    if (action === 'provision') {
      if (!['pending', 'provisioning_failed', 'provisioning'].includes(service.status)) throw new ValidationError(`Cannot re-provision a service in '${service.status}' status`);
      await enqueueJob(service, 'provision_zone', `cf-admin-provision:${service.id}:${new Date().toISOString().slice(0, 16)}`);
      await audit(ctx, 'cloudflare.provision_retried', 'cloudflare_service', service.id, null);
    } else if (action === 'sync') {
      if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
      await enqueueJob(service, 'sync_zone', `cf-admin-sync:${service.id}:${new Date().toISOString().slice(0, 16)}`, 3);
      await audit(ctx, 'cloudflare.sync_requested', 'cloudflare_service', service.id, null);
    } else {
      const statusMap = { suspend: 'suspended', unsuspend: 'active', terminate: 'terminated' };
      await store.table('cloudflare_services').updateById(service.id, { status: statusMap[action] });
      await enqueueJob(service, `${action}_zone`, `cf-admin-${action}:${service.id}:${Date.now()}`);
      await audit(ctx, `cloudflare.${action}_requested`, 'cloudflare_service', service.id, null);
    }
    ctx.code(202).json({ queued: true });
  });

  router.post('/api/v1/admin/cloudflare/services/:id/purge-cache', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const id = ctx.params.id;
    const service = await store.table('cloudflare_services').findById(id);
    if (!service) throw new NotFoundError('No Cloudflare service was found with that id');
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    // Live purge deferred — queue the durable job and report honestly.
    await enqueueJob(service, 'purge_cache', `cf-admin-purge:${service.id}:${Date.now()}`);
    await audit(ctx, 'cloudflare.cache_purged_admin', 'cloudflare_service', service.id, null);
    ctx.json({ purged: true });
  });

  // ------------------------------------------------------------- jobs & logs
  router.get('/api/v1/admin/cloudflare/jobs', async (ctx) => {
    await asAdmin(ctx, deps);
    const query = await ctx.validateQuery(v.object({ page: v.coerce.number().int().min(1).default(1), limit: v.coerce.number().int().min(1).max(100).default(25), status: v.enum(['queued', 'running', 'succeeded', 'failed']).optional(), serviceId: v.string().optional() }));
    let rows = await store.table('cloudflare_jobs').find({}, { orderBy: '-created_at' }).then((r) => r.rows);
    if (query.status) rows = rows.filter((j) => j.status === query.status);
    if (query.serviceId) rows = rows.filter((j) => j.service_id === query.serviceId);
    const start = (query.page - 1) * query.limit;
    ctx.json({ items: rows.slice(start, start + query.limit).map((j) => ({ id: j.id, serviceId: j.service_id ?? null, type: j.type ?? j.kind, status: j.status, createdAt: j.created_at })), page: query.page, limit: query.limit, total: rows.length });
  });

  router.get('/api/v1/admin/cloudflare/logs', async (ctx) => {
    await asAdmin(ctx, deps);
    const query = await ctx.validateQuery(v.object({ page: v.coerce.number().int().min(1).default(1), limit: v.coerce.number().int().min(1).max(200).default(50), serviceId: v.string().optional(), success: v.coerce.boolean().optional() }));
    let rows = await store.table('cloudflare_api_logs').find({}, { orderBy: '-created_at' }).then((r) => r.rows);
    if (query.serviceId) rows = rows.filter((l) => l.service_id === query.serviceId);
    if (query.success !== undefined) rows = rows.filter((l) => Boolean(l.success) === query.success);
    const start = (query.page - 1) * query.limit;
    ctx.json({ items: rows.slice(start, start + query.limit).map((l) => ({ id: l.id, serviceId: l.service_id ?? null, method: l.method ?? null, path: l.path ?? null, statusCode: l.status_code ?? null, success: l.success, errorCode: l.error_code ?? null, durationMs: l.duration_ms ?? null, createdAt: l.created_at })), page: query.page, limit: query.limit, total: rows.length });
  });
}

module.exports = { name, register };
