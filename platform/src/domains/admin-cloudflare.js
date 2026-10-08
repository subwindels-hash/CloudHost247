/**
 * Admin Cloudflare API (spec §3–§4, §28–§29, §49, §69).
 *
 * Ported from cloudhost247-node/src/routes/admin-cloudflare.ts. All routes require admin/super_admin.
 * Account API tokens are WRITE-ONLY: accepted on create/update, encrypted at rest (AES-256-GCM via
 * `lib/secret-box.js`), and never returned by any endpoint. Every manual override is audited.
 *
 * **Live egress lives here now.** Every provider-side behaviour in this module used to be reported as
 * unavailable rather than performed: "Test Connection" could only answer `unavailable`, provisioning
 * queued a durable job nobody executed, and a cache purge answered `{ purged: true }` for a purge that
 * never reached Cloudflare — the strongest possible form of a fake result. Through
 * `lib/cloudflare-client.js` the provider is now asked inside the request, and three rules hold:
 *
 *  1. **Nothing is queued that is not also done.** Each operation that has a provider equivalent runs
 *     against Cloudflare and *then* records a `cloudflare_jobs` row describing what happened, so the
 *     admin job list is a log of real work rather than a queue of intentions.
 *  2. **Local state is written after Cloudflare accepts, never before.** A rejected purge leaves the
 *     service exactly as it was; a rejected suspend does not mark a service suspended.
 *  3. **Cloudflare's own error text is logged, never returned.** The browser gets the platform's
 *     neutral sentence plus Cloudflare's stable numeric codes (`details.cloudflareErrorCodes`).
 *
 * What is still unproven: no call has been made to a real Cloudflare account from the environment
 * this was written in — see `lib/cloudflare-client.js` for the exact scope of that limit.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { asAdmin } = require('../lib/auth');
const { encryptSecret, describeSecret, PURPOSES } = require('../lib/secret-box');
const { syncServiceCache } = require('../lib/cloudflare-sync');
const { resolveAccountCredential, errorEvidence } = require('../lib/cloudflare-client');
const { clientForAccount, withServiceClient: withService } = require('../lib/cloudflare-service');

const name = 'admin-cloudflare';

const FEATURE_KEYS = ['dns', 'dnssec', 'analytics', 'ssl', 'firewall', 'speed', 'caching', 'cache_purge', 'development_mode', 'scrape_shield', 'plan_change'];
const TIER_DEFAULTS = {
  free: { dns: true, dnssec: true, analytics: true, ssl: true, caching: true, cache_purge: true, development_mode: true, scrape_shield: false, firewall: false, speed: false, plan_change: true },
  pro: { dns: true, dnssec: true, analytics: true, ssl: true, caching: true, cache_purge: true, development_mode: true, scrape_shield: true, firewall: true, speed: true, plan_change: true },
  business: { dns: true, dnssec: true, analytics: true, ssl: true, caching: true, cache_purge: true, development_mode: true, scrape_shield: true, firewall: true, speed: true, plan_change: true },
  enterprise: { dns: true, dnssec: true, analytics: true, ssl: true, caching: true, cache_purge: true, development_mode: true, scrape_shield: true, firewall: true, speed: true, plan_change: false },
};
const LIFECYCLE_ACTIONS = ['provision', 'sync', 'suspend', 'unsuspend', 'terminate'];

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

  /**
   * Run one provider operation and keep an honest record of it.
   *
   * The `cloudflare_jobs` row is written *before* the attempt (so a crash mid-call leaves evidence
   * that something was in flight) and settled from the outcome. A failure records the stable failure
   * code and the sanitized provider codes — never Cloudflare's message.
   */
  async function runJob(service, jobType, payload, attempt) {
    const job = await store.table('cloudflare_jobs').insert({
      id: uuidv7(),
      account_id: service.account_id ?? null,
      service_id: service.id,
      kind: jobType, type: jobType, status: 'running',
      payload: payload ?? {},
    });
    try {
      const result = await attempt();
      await store.table('cloudflare_jobs').updateById(job.id, {
        // `payload` is re-written with the outcome so the job row is self-describing evidence.
        payload: { ...(payload ?? {}), outcome: result?.outcome ?? 'completed' },
        status: 'succeeded',
      });
      return { jobId: job.id, result };
    } catch (error) {
      const evidence = errorEvidence(error);
      await store.table('cloudflare_jobs').updateById(job.id, {
        payload: { ...(payload ?? {}), failure: evidence },
        status: 'failed',
      });
      throw error;
    }
  }

  /** Bound to this module's deps so call sites do not repeat them. */
  const withServiceClient = (service, fn, options) => withService(deps, service, fn, options);

  // Account DTO never includes the token (write-only). It DOES report whether the stored credential
  // is usable, which is the difference between "nobody has configured this" and "the token is
  // encrypted with a key this deployment no longer has" — two faults with different fixes.
  const accountDto = (a) => ({
    id: a.id, accountName: a.account_name, cloudflareAccountId: a.cloudflare_account_id ?? a.account_id ?? null,
    apiBaseUrl: a.api_base_url ?? deps.config?.CLOUDFLARE_API_BASE_URL ?? null,
    defaultZoneType: a.default_zone_type ?? null, defaultSslMode: a.default_ssl_mode ?? null,
    defaultProxied: a.default_proxied ?? null, status: a.status, hasToken: Boolean(a.encrypted_api_token || a.api_token),
    credentialState: describeSecret(secret, PURPOSES.cloudflareAccount, a.encrypted_api_token ?? null).state,
    createdAt: a.created_at,
  });
  const mappingDto = (m) => ({
    id: m.id, planId: m.plan_id ?? null, planName: m.plan_name ?? null, productName: m.product_name ?? null,
    cloudflarePlan: m.cloudflare_plan ?? null, entitlements: m.entitlements ?? {}, maxDomains: m.max_domains ?? null,
    provisioningMode: m.provisioning_mode ?? null, defaultSslMode: m.default_ssl_mode ?? null, defaultProxied: m.default_proxied ?? null,
  });
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
    const accounts = await store.table('cloudflare_accounts').all();
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
      // Two new counters that only mean something now that the credential can be read back: a token
      // that cannot be decrypted is a rotatable fault, and it would otherwise look like an outage.
      accounts_unreadable_credentials: accounts.filter((a) => describeSecret(secret, PURPOSES.cloudflareAccount, a.encrypted_api_token ?? null).state === 'unreadable').length,
      accounts_without_token: accounts.filter((a) => !a.encrypted_api_token && !a.api_token).length,
    };
    // Monthly revenue from paid invoices this month, grouped by currency (best-effort).
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const invoices = (await store.table('invoices').all()).filter((i) => i.status === 'paid' && new Date(i.created_at).getTime() >= monthStart.getTime());
    const monthly_revenue = {};
    for (const inv of invoices) { const c = inv.currency ?? 'USD'; monthly_revenue[c] = String(Number(monthly_revenue[c] ?? 0) + Number(inv.amount ?? 0)); }
    const planDistribution = {};
    for (const s of live) { const p = s.cloudflare_plan ?? 'unknown'; planDistribution[p] = (planDistribution[p] ?? 0) + 1; }
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
      account_id: body.cloudflareAccountId,
      encrypted_api_token: encryptSecret(secret, PURPOSES.cloudflareAccount, body.apiToken),
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
    if (body.apiToken) patch.encrypted_api_token = encryptSecret(secret, PURPOSES.cloudflareAccount, body.apiToken);
    if (body.status !== undefined) patch.status = body.status;
    if (body.defaultZoneType !== undefined) patch.default_zone_type = body.defaultZoneType;
    if (body.defaultSslMode !== undefined) patch.default_ssl_mode = body.defaultSslMode;
    if (body.defaultProxied !== undefined) patch.default_proxied = body.defaultProxied;
    const account = await store.table('cloudflare_accounts').updateById(id, patch);
    await audit(ctx, 'cloudflare.account_updated', 'cloudflare_account', id, { tokenRotated: Boolean(body.apiToken), status: body.status ?? null });
    ctx.json({ account: accountDto(account) });
  });

  /**
   * "Test Connection" — a real `GET /user/tokens/verify`.
   *
   * The verdict vocabulary is deliberate: `not_configured` (no token stored) and
   * `credential_unreadable` (a token is stored but cannot be decrypted) are *configuration* answers
   * and make no request at all, while `connected` / `authentication_failed` / `unavailable` are
   * provider answers. The old code could only ever return the middle one, which is why nobody could
   * tell a wrong token from a broken integration.
   */
  router.post('/api/v1/admin/cloudflare/accounts/:id/test', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const id = ctx.params.id;
    const account = await store.table('cloudflare_accounts').findById(id);
    if (!account) throw new NotFoundError('No Cloudflare account was found with that id');

    const credential = resolveAccountCredential(secret, account);
    if (!credential.token) {
      const state = describeSecret(secret, PURPOSES.cloudflareAccount, account.encrypted_api_token ?? null).state;
      const result = state === 'unreadable'
        ? { status: 'credential_unreadable', attempted: false, credentialState: state, message: `The stored Cloudflare API token could not be decrypted — ${credential.reason}.` }
        : { status: 'not_configured', attempted: false, credentialState: state, message: 'No API token is stored for this account' };
      await audit(ctx, 'cloudflare.connection_tested', 'cloudflare_account', id, { status: result.status, attempted: false });
      return ctx.json(result);
    }

    const client = clientForAccount(deps, account);
    try {
      const verdict = await client.verifyToken();
      const result = verdict.active
        ? { status: 'connected', attempted: true, tokenStatus: verdict.status, tokenId: verdict.tokenId, message: 'Cloudflare accepted the API token.' }
        : { status: 'authentication_failed', attempted: true, tokenStatus: verdict.status, tokenId: null, message: `Cloudflare reports this API token as ${verdict.status ?? 'not active'}.` };
      await audit(ctx, 'cloudflare.connection_tested', 'cloudflare_account', id, { status: result.status, attempted: true });
      return ctx.json(result);
    } catch (error) {
      const evidence = errorEvidence(error);
      // The status is a real provider verdict, so it is reported rather than thrown: an operator
      // pressing "Test Connection" wants the diagnosis, not a 502.
      const status = evidence.code === 'CLOUDFLARE_AUTHENTICATION_FAILED' ? 'authentication_failed'
        : evidence.code === 'CLOUDFLARE_NOT_CONFIGURED' ? 'not_configured'
          : 'unavailable';
      await audit(ctx, 'cloudflare.connection_tested', 'cloudflare_account', id, { status, failure: evidence });
      return ctx.json({ status, attempted: true, failureCode: evidence.code, providerCodes: evidence.providerCodes, message: 'Cloudflare could not be contacted with this token.' });
    }
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
      services: rows.slice(start, start + query.limit).map((s) => ({ id: s.id, userId: s.user_id, zoneName: s.zone_name, cloudflarePlan: s.cloudflare_plan ?? null, status: s.status, activationStatus: s.activation_status ?? null, zoneId: s.zone_id ?? null, accountId: s.account_id ?? null, lastSyncedAt: s.last_synced_at ?? null })),
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
    const account = service.account_id ? await store.table('cloudflare_accounts').findById(service.account_id) : null;
    ctx.json({
      service: { id: service.id, userId: service.user_id, zoneName: service.zone_name, cloudflarePlan: service.cloudflare_plan ?? null, status: service.status, activationStatus: service.activation_status ?? null, zoneId: service.zone_id ?? null, sslMode: service.ssl_mode ?? null, accountId: service.account_id ?? null, lastSyncedAt: service.last_synced_at ?? null },
      entitlements,
      // Whether the provider can actually be reached for this service, computed on read so it can
      // never go stale the way a stored "last tested ok" flag does.
      providerReadiness: {
        accountConfigured: Boolean(account),
        credentialState: account ? describeSecret(secret, PURPOSES.cloudflareAccount, account.encrypted_api_token ?? null).state : 'none',
        zoneProvisioned: Boolean(service.zone_id),
      },
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
      if (!service.zone_name) throw new ValidationError('This service has no zone name, so no Cloudflare zone can be created for it');

      await store.table('cloudflare_services').updateById(service.id, { status: 'provisioning' });
      try {
        const { result } = await withServiceClient(service, async (client, account) => runJob(service, 'provision_zone', { zoneName: service.zone_name, accountId: account.cloudflare_account_id ?? account.account_id ?? null }, async () => {
          // Idempotent: a retried provision must never create a second zone for the same name.
          let zone = await client.findZoneByName(service.zone_name);
          let created = false;
          if (!zone) {
            zone = await client.createZone({
              name: service.zone_name,
              accountId: account.cloudflare_account_id ?? account.account_id,
              type: account.default_zone_type ?? 'full',
            });
            created = true;
          }
          if (!zone.id) throw new ValidationError('Cloudflare accepted the zone request but returned no zone id');
          return { zone, created, outcome: created ? 'zone_created' : 'zone_already_existed' };
        }));
        const zone = result.zone;
        await store.table('cloudflare_services').updateById(service.id, {
          zone_id: zone.id,
          name_server_1: zone.nameServers[0] ?? null,
          name_server_2: zone.nameServers[1] ?? null,
          activation_status: zone.activationStatus,
          status: 'active',
          last_synced_at: new Date().toISOString(),
        });
        await audit(ctx, 'cloudflare.provisioned', 'cloudflare_service', service.id, { zoneId: zone.id, created: result.created });
        return ctx.json({ provisioned: true, created: result.created, zoneId: zone.id, nameservers: zone.nameServers, activationStatus: zone.activationStatus });
      } catch (error) {
        await store.table('cloudflare_services').updateById(service.id, { status: 'provisioning_failed' });
        await audit(ctx, 'cloudflare.provision_failed', 'cloudflare_service', service.id, { failureCode: error?.details?.failureCode ?? error?.code ?? null });
        throw error;
      }
    }

    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet — provision it first');

    if (action === 'sync') {
      const { jobId, result } = await withServiceClient(service, (client) => runJob(service, 'sync_zone', { zoneId: service.zone_id }, async () => {
        const summary = await syncServiceCache({ store, client, service });
        return { ...summary, outcome: 'zone_synchronized' };
      }));
      await audit(ctx, 'cloudflare.sync_requested', 'cloudflare_service', service.id, result.records);
      return ctx.json({ synced: true, jobId, zone: result.zone, records: result.records, settings: result.settings });
    }

    if (action === 'terminate') {
      const { result } = await withServiceClient(service, (client) => runJob(service, 'terminate_zone', { zoneId: service.zone_id }, async () => {
        const outcome = await client.deleteZone(service.zone_id);
        if (!outcome.deleted) throw new ValidationError('Cloudflare accepted the delete but confirmed no zone id, so the zone is not reported as removed');
        return { ...outcome, outcome: 'zone_deleted' };
      }));
      // Local state moves only now, because now Cloudflare has really removed the zone. A local
      // change to `terminated` before that would leave a live zone nobody was billing for.
      await store.table('cloudflare_services').updateById(service.id, { status: 'terminated', activation_status: 'terminated' });
      await audit(ctx, 'cloudflare.terminate_requested', 'cloudflare_service', service.id, { zoneId: result.id, deleted: true });
      return ctx.json({ terminated: true, zoneId: result.id });
    }

    // suspend / unsuspend: Cloudflare's own zone pause. A zone type Cloudflare will not pause is
    // reported by Cloudflare and the local status is left alone — the platform does not have a
    // second, local-only notion of "suspended" that would disagree with what DNS is really doing.
    const targetStatus = action === 'suspend' ? 'suspended' : 'active';
    const paused = action === 'suspend';
    const { result } = await withServiceClient(service, (client) => runJob(service, `${action}_zone`, { zoneId: service.zone_id, paused }, async () => {
      const zone = await client.setZonePaused(service.zone_id, paused);
      return { zone, outcome: `zone_paused_${zone.paused}` };
    }));
    await store.table('cloudflare_services').updateById(service.id, { status: targetStatus });
    await audit(ctx, `cloudflare.${action}_requested`, 'cloudflare_service', service.id, { paused: result.zone.paused });
    ctx.code(202).json({ [action === 'suspend' ? 'suspended' : 'unsuspended']: true, zonePaused: result.zone.paused });
  });

  router.post('/api/v1/admin/cloudflare/services/:id/purge-cache', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const id = ctx.params.id;
    const service = await store.table('cloudflare_services').findById(id);
    if (!service) throw new NotFoundError('No Cloudflare service was found with that id');
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    const body = await ctx.validate(v.object({
      everything: v.boolean().optional(),
      files: v.array(v.string().max(2048)).optional(),
      tags: v.array(v.string().max(255)).optional(),
      hosts: v.array(v.string().max(255)).optional(),
    }).default({ everything: true }));
    const target = { everything: body.everything ?? (body.files || body.tags || body.hosts ? false : true), files: body.files, tags: body.tags, hosts: body.hosts };

    const { result } = await withServiceClient(service, (client) => runJob(service, 'purge_cache', { zoneId: service.zone_id, ...target }, async () => {
      const outcome = await client.purgeCache(service.zone_id, target);
      return { ...outcome, outcome: 'cache_purged' };
    }));
    await audit(ctx, 'cloudflare.cache_purged_admin', 'cloudflare_service', service.id, { everything: target.everything === true, files: target.files?.length ?? 0 });
    ctx.json({ purged: true, purgeId: result.id });
  });

  // ------------------------------------------------------------- jobs & logs
  router.get('/api/v1/admin/cloudflare/jobs', async (ctx) => {
    await asAdmin(ctx, deps);
    const query = await ctx.validateQuery(v.object({ page: v.coerce.number().int().min(1).default(1), limit: v.coerce.number().int().min(1).max(100).default(25), status: v.enum(['queued', 'running', 'succeeded', 'failed']).optional(), serviceId: v.string().optional() }));
    let rows = await store.table('cloudflare_jobs').find({}, { orderBy: '-created_at' }).then((r) => r.rows);
    if (query.status) rows = rows.filter((j) => j.status === query.status);
    if (query.serviceId) rows = rows.filter((j) => j.service_id === query.serviceId);
    const start = (query.page - 1) * query.limit;
    ctx.json({ items: rows.slice(start, start + query.limit).map((j) => ({ id: j.id, serviceId: j.service_id ?? null, type: j.type ?? j.kind, status: j.status, outcome: j.payload?.outcome ?? null, failure: j.payload?.failure ?? null, createdAt: j.created_at })), page: query.page, limit: query.limit, total: rows.length });
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
