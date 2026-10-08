/**
 * Customer Cloudflare API (spec §12–§27, §46, §48, §71).
 *
 * Ported from cloudhost247-node/src/routes/cloudflare.ts. Every endpoint:
 *   authenticate → load the service by OUR id → verify the caller owns it → verify service state →
 *   verify the plan entitlement → only then act. Zone/record identifiers supplied by the browser
 *   only ever select rows already scoped to the caller's service — never passed through unverified.
 *   "Missing" and "not yours" return the same 404 (no resource enumeration).
 *
 * **Live egress.** Writes now go to Cloudflare inside the request through `lib/cloudflare-client.js`
 * and the local `cloudflare_*` tables are a *cache filled from Cloudflare's own answers*, refreshed
 * by Sync (`lib/cloudflare-sync.js`) and updated from each write's response. The previous design
 * stored a fabricated `cf-rec-<uuid>` as the provider record id, so no local row could ever be
 * matched to a real record and Sync could not have been implemented on top of it.
 *
 * Reads (`GET .../dns`, the settings-backed tabs) still answer from the cache, which is why every one
 * of them says so and reports `lastSyncedAt` — but a customer-initiated write is never answered from
 * the cache: it is sent to Cloudflare, and the local row is written from what Cloudflare returned.
 * The provider's own error text is logged server-side and never returned; the browser gets a neutral
 * sentence plus Cloudflare's stable numeric codes.
 */
'use strict';

const { isIP } = require('node:net');
const { v } = require('../core/validate');
const { NotFoundError, ValidationError, ForbiddenError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate } = require('../lib/auth');
const { withServiceClient } = require('../lib/cloudflare-service');
const { syncServiceCache } = require('../lib/cloudflare-sync');
const { recordPendingAction, applyPlanChange } = require('../lib/cloudflare-fulfilment');

const name = 'cloudflare';

const FEATURE_KEYS = ['dns', 'dnssec', 'analytics', 'ssl', 'firewall', 'speed', 'caching', 'cache_purge', 'development_mode', 'scrape_shield', 'plan_change'];
const TIER_DEFAULTS = {
  free: { dns: true, dnssec: true, analytics: true, ssl: true, caching: true, cache_purge: true, development_mode: true, scrape_shield: false, firewall: false, speed: false, plan_change: true },
  pro: { dns: true, dnssec: true, analytics: true, ssl: true, caching: true, cache_purge: true, development_mode: true, scrape_shield: true, firewall: true, speed: true, plan_change: true },
  business: { dns: true, dnssec: true, analytics: true, ssl: true, caching: true, cache_purge: true, development_mode: true, scrape_shield: true, firewall: true, speed: true, plan_change: true },
  enterprise: { dns: true, dnssec: true, analytics: true, ssl: true, caching: true, cache_purge: true, development_mode: true, scrape_shield: true, firewall: true, speed: true, plan_change: false },
};
const SUPPORTED_DNS_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA'];
const ACCESS_RULE_MODES = ['block', 'challenge', 'whitelist', 'js_challenge', 'managed_challenge'];
const CIDR_RE = /^([0-9a-fA-F:.]+)\/(\d{1,3})$/;

const SECTIONS = {
  ssl: { feature: 'ssl', ids: ['ssl', 'min_tls_version', 'tls_1_3', 'always_use_https', 'automatic_https_rewrites'], schema: () => v.object({ ssl: v.enum(['off', 'flexible', 'full', 'strict']).optional(), min_tls_version: v.enum(['1.0', '1.1', '1.2', '1.3']).optional(), tls_1_3: v.enum(['on', 'off']).optional(), always_use_https: v.enum(['on', 'off']).optional(), automatic_https_rewrites: v.enum(['on', 'off']).optional() }) },
  firewall: { feature: 'firewall', ids: ['security_level', 'browser_check', 'challenge_ttl'], schema: () => v.object({ security_level: v.enum(['essentially_off', 'low', 'medium', 'high', 'under_attack']).optional(), browser_check: v.enum(['on', 'off']).optional(), challenge_ttl: v.coerce.number().int().min(300).max(31536000).optional() }) },
  speed: { feature: 'speed', ids: ['rocket_loader', 'brotli', 'http3', 'early_hints', 'ip_geolocation'], schema: () => v.object({ rocket_loader: v.enum(['on', 'off']).optional(), brotli: v.enum(['on', 'off']).optional(), http3: v.enum(['on', 'off']).optional(), early_hints: v.enum(['on', 'off']).optional(), ip_geolocation: v.enum(['on', 'off']).optional() }) },
  caching: { feature: 'caching', ids: ['cache_level', 'browser_cache_ttl', 'development_mode'], schema: () => v.object({ cache_level: v.enum(['aggressive', 'basic', 'simplified']).optional(), browser_cache_ttl: v.coerce.number().int().min(0).max(31536000).optional(), development_mode: v.enum(['on', 'off']).optional() }) },
  'scrape-shield': { feature: 'scrape_shield', ids: ['email_obfuscation', 'server_side_exclude', 'hotlink_protection'], schema: () => v.object({ email_obfuscation: v.enum(['on', 'off']).optional(), server_side_exclude: v.enum(['on', 'off']).optional(), hotlink_protection: v.enum(['on', 'off']).optional() }) },
};

function capabilitiesForPlan(tier) {
  return {
    supportsDns: true, supportsDnssec: true, supportsAnalytics: true, supportsSsl: true,
    supportsFirewall: true, supportsSpeed: true, supportsCaching: true, supportsCachePurge: true,
    supportsDevelopmentMode: true, supportsScrapeShield: true, supportsPlanChange: tier !== 'enterprise',
    sslModes: ['off', 'flexible', 'full', 'strict'],
  };
}
function resolveEntitlements(mapping, tier) {
  const defaults = TIER_DEFAULTS[tier] || TIER_DEFAULTS.free;
  const caps = capabilitiesForPlan(tier);
  const out = {};
  for (const key of FEATURE_KEYS) {
    const admin = mapping?.entitlements?.[key];
    const entitled = admin !== undefined ? admin : (defaults[key] ?? false);
    const supported = key === 'plan_change' ? caps.supportsPlanChange : key === 'dnssec' ? caps.supportsDnssec : true;
    out[key] = Boolean(entitled && supported);
  }
  return out;
}
function validateIpOrCidr(value) {
  if (isIP(value)) return 'ip';
  const m = CIDR_RE.exec(value);
  if (m && m[1] && isIP(m[1])) {
    const prefix = Number(m[2]);
    const max = isIP(m[1]) === 6 ? 128 : 32;
    if (prefix >= 0 && prefix <= max) return 'ip_range';
  }
  throw new ValidationError('A valid IP address or CIDR range is required');
}

function register(router, deps) {
  const { store } = deps;

  /** Provider calls for one service: account resolved, failures translated, every call logged. */
  const withProvider = (service, fn) => withServiceClient(deps, service, fn);

  async function audit(ctx, action, resourceType, resourceId, metadata) {
    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: ctx.user.id, actor_role: ctx.user.role, action,
      entity_type: resourceType, entity_id: resourceId ?? null,
      ip_address: ctx.ip, user_agent: ctx.userAgent, after: metadata ?? null,
    });
  }

  async function authorize(ctx, id, feature) {
    const service = await store.table('cloudflare_services').findById(id);
    // Same response for "missing" and "not yours" — no resource enumeration.
    if (!service || service.user_id !== ctx.user.id) throw new NotFoundError('No Cloudflare service was found with that id');
    const mapping = service.plan_id ? await store.table('cloudflare_plan_mappings').findOne({ plan_id: service.plan_id }) : null;
    const tier = service.cloudflare_plan || 'free';
    const entitlements = resolveEntitlements(mapping, tier);
    if (feature) {
      if (service.status !== 'active') throw new ValidationError(`This Cloudflare service is ${String(service.status).replace(/_/g, ' ')} — feature access requires an active service`);
      if (!entitlements[feature]) throw new ForbiddenError('FEATURE_NOT_SUPPORTED: your Cloudflare plan does not include this feature');
    }
    return { service, entitlements, mapping };
  }

  const dnsRecordBody = () => v.object({
    type: v.enum(SUPPORTED_DNS_TYPES),
    name: v.string().min(1).max(255),
    content: v.string().min(1).max(2048),
    ttl: v.coerce.number().int().refine((n) => n === 1 || (n >= 60 && n <= 86400), 'ttl must be 1 (auto) or 60–86400'),
    proxied: v.boolean().optional(),
    priority: v.coerce.number().int().min(0).max(65535).optional(),
    comment: v.string().max(500).nullable().optional(),
  });

  async function getSettings(serviceId) {
    const row = await store.table('cloudflare_zone_settings').findOne({ service_id: serviceId });
    return row?.settings ?? {};
  }
  async function putSettings(serviceId, patch) {
    const row = await store.table('cloudflare_zone_settings').findOne({ service_id: serviceId });
    const merged = { ...(row?.settings ?? {}), ...patch };
    if (row) await store.table('cloudflare_zone_settings').updateById(row.id, { settings: merged });
    else await store.table('cloudflare_zone_settings').insert({ id: uuidv7(), service_id: serviceId, settings: merged });
    return merged;
  }
  const recordDto = (r) => ({ id: r.cloudflare_record_id ?? r.id, type: r.type, name: r.name, content: r.content, ttl: r.ttl, proxied: r.proxied, priority: r.priority ?? null, comment: r.comment ?? null, ownership: r.ownership });

  // ------------------------------------------------------------ catalog & purchase
  router.get('/api/v1/cloudflare/catalog', async (ctx) => {
    await authenticate(ctx, deps);
    const mappings = (await store.table('cloudflare_plan_mappings').all()).filter((m) => (m.plan_status ?? 'active') === 'active');
    const plans = [];
    for (const m of mappings) {
      const pricing = m.plan_id ? (await store.table('catalog_plan_pricing').all()).filter((p) => p.plan_id === m.plan_id && p.is_active && p.price != null) : [];
      plans.push({
        planId: m.plan_id ?? m.id, planName: m.plan_name, productName: m.product_name ?? null,
        cloudflarePlan: m.cloudflare_plan, entitlements: resolveEntitlements(m, m.cloudflare_plan || 'free'),
        pricing: pricing.map((p) => ({ billingPeriod: p.billing_cycle, amount: p.price, currency: p.currency })),
      });
    }
    ctx.json({ plans });
  });

  router.post('/api/v1/cloudflare/orders', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({
      planId: v.string().min(1),
      billingPeriod: v.enum(['one_time', 'monthly', 'quarterly', 'semi_annually', 'annually']),
      domainName: v.string().min(3).max(253).optional(),
      customerDomainId: v.string().optional(),
      hostingServiceId: v.string().optional(),
    }));
    if (!body.domainName && !body.customerDomainId) throw new ValidationError('Provide a domainName or customerDomainId');
    const mapping = await store.table('cloudflare_plan_mappings').findOne({ plan_id: body.planId }) ?? await store.table('cloudflare_plan_mappings').findById(body.planId);
    if (!mapping) throw new NotFoundError('No Cloudflare plan was found with that id');
    const pricing = (await store.table('catalog_plan_pricing').all()).find((p) => p.plan_id === (mapping.plan_id ?? mapping.id) && p.billing_cycle === body.billingPeriod && p.is_active);
    const amount = pricing?.price ?? 0;
    const currency = pricing?.currency ?? 'USD';
    const orderId = uuidv7();
    const reference = `CF-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;
    // Column names matter here: `orders` carries `reference`/`subtotal`/`total`, and an order written
    // with `order_number`/`total_amount` silently stores **no amount at all** — which is how this
    // route used to produce a zero-value invoice for a paid Cloudflare plan.
    await store.table('orders').insert({ id: orderId, user_id: auth.id, reference, currency, subtotal: amount, total: amount, status: 'pending' });
    const invoiceId = uuidv7();
    const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;
    await store.table('invoices').insert({
      id: invoiceId, user_id: auth.id, order_id: orderId, number: invoiceNumber, currency,
      subtotal: amount, total: amount, status: 'unpaid',
      due_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
    });
    // The opening ledger charge is what makes the invoice payable and reconcilable; the canonical
    // checkout writes it (`domains/commerce.js`) and the financial-invariant sweep reads it.
    await store.table('billing_ledger').insert({
      id: uuidv7(), user_id: auth.id, invoice_id: invoiceId, entry_type: 'charge',
      amount, currency, description: `Order ${reference}`, idempotency_key: `charge:${orderId}`,
    });

    // The order is what "will be provisioned automatically" hangs on, so the intent is itemised now:
    // an `awaiting_payment` job naming the zone, its owner and the account. `billing-apply` fulfils it
    // the moment the payment lands (see `lib/cloudflare-fulfilment.js`). Before this, the sentence was
    // true of no code path at all.
    const zoneName = body.domainName ?? (body.customerDomainId ? (await store.table('customer_domains').findById(body.customerDomainId))?.domain_name ?? null : null);
    if (zoneName) {
      const account = (await store.table('cloudflare_accounts').all())
        .filter((a) => (a.status ?? 'active') === 'active')
        .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))[0] ?? null;
      await recordPendingAction(store, {
        kind: 'provision_zone',
        orderId,
        accountId: account?.id ?? null,
        payload: { zoneName, userId: auth.id, planId: mapping.plan_id ?? mapping.id, billingPeriod: body.billingPeriod },
      });
    }
    await audit(ctx, 'cloudflare.order_created', 'order', orderId, { zoneName, planId: mapping.plan_id ?? mapping.id });
    ctx.code(201).json({
      order: { id: orderId, reference, totalAmount: amount, currency },
      invoice: { id: invoiceId, invoiceNumber, amount, currency },
      zoneName,
      message: zoneName
        ? 'Order created. The Cloudflare zone is created automatically once the payment is confirmed.'
        : 'Order created. No zone name was supplied, so an administrator will need to attach a zone after payment.',
    });
  });

  // ------------------------------------------------------------------ services
  router.get('/api/v1/cloudflare/services', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rows = (await store.table('cloudflare_services').all()).filter((s) => s.user_id === auth.id);
    ctx.json({ services: rows.map((s) => ({ id: s.id, zoneName: s.zone_name, status: s.status, cloudflarePlan: s.cloudflare_plan ?? null, planId: s.plan_id ?? null, zoneId: s.zone_id ?? null, createdAt: s.created_at })) });
  });

  router.get('/api/v1/cloudflare/services/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { service, entitlements } = await authorize(ctx, ctx.params.id, null);
    ctx.json({
      service: { id: service.id, zoneName: service.zone_name, status: service.status, cloudflarePlan: service.cloudflare_plan ?? null, sslMode: service.ssl_mode ?? null, zoneId: service.zone_id ?? null },
      entitlements,
      capabilities: capabilitiesForPlan(service.cloudflare_plan || 'free'),
      nameservers: [service.name_server_1, service.name_server_2].filter(Boolean),
      nameserverNotice: 'Your domain must use these nameservers before Cloudflare can serve DNS traffic. Activation is confirmed by Cloudflare, not by this panel.',
    });
  });

  /**
   * Refresh the local cache from Cloudflare.
   *
   * This used to insert a "queued" job row and answer `202` — a job nothing executed, so the customer
   * waited for a sync that never happened. It now performs the reconciliation and answers with what
   * changed. The `cloudflare_jobs` row is still written, as a record of work done rather than a
   * promise of work to come.
   */
  router.post('/api/v1/cloudflare/services/:id/sync', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { service } = await authorize(ctx, ctx.params.id, null);
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');

    const job = await store.table('cloudflare_jobs').insert({
      id: uuidv7(), account_id: service.account_id ?? null, service_id: service.id,
      kind: 'sync_zone', type: 'sync_zone', status: 'running', payload: { zoneId: service.zone_id },
    });
    try {
      const summary = await withProvider(service, (client) => syncServiceCache({ store, client, service }));
      await store.table('cloudflare_jobs').updateById(job.id, { status: 'succeeded', payload: { zoneId: service.zone_id, outcome: 'zone_synchronized', ...summary.records } });
      await audit(ctx, 'cloudflare.sync_completed', 'cloudflare_service', service.id, { ...summary.records, settingsApplied: summary.settings.applied });
      ctx.json({ synced: true, jobId: job.id, ...summary });
    } catch (error) {
      await store.table('cloudflare_jobs').updateById(job.id, { status: 'failed', payload: { zoneId: service.zone_id, failure: { code: error?.details?.failureCode ?? error?.code ?? null } } });
      throw error;
    }
  });

  router.get('/api/v1/cloudflare/services/:id/activity', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    await authorize(ctx, ctx.params.id, null);
    const rows = (await store.table('audit_logs').all()).filter((a) => ['cloudflare_service', 'cloudflare_dns'].includes(a.entity_type) && a.entity_id === ctx.params.id);
    ctx.json({ activity: rows.slice(-100).reverse().map((a) => ({ action: a.action, created_at: a.created_at, metadata: a.after ?? null })) });
  });

  // ----------------------------------------------------------------------- DNS
  router.get('/api/v1/cloudflare/services/:id/dns', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { service } = await authorize(ctx, ctx.params.id, 'dns');
    const records = (await store.table('cloudflare_dns_records').all()).filter((r) => r.service_id === service.id);
    ctx.json({
      records: records.map(recordDto),
      note: 'Records are a synchronized view of the zone; Cloudflare is the source of truth. Use Sync to refresh.',
      lastSyncedAt: service.last_synced_at ?? null,
    });
  });

  /**
   * A customer-added record is created at Cloudflare first and cached from what Cloudflare returned.
   *
   * The local row is keyed by Cloudflare's own record id — the field Sync matches on. The previous
   * implementation wrote `cf-rec-<uuid>` into that column, which named nothing.
   */
  router.post('/api/v1/cloudflare/services/:id/dns', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(dnsRecordBody());
    const { service } = await authorize(ctx, ctx.params.id, 'dns');
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');

    const created = await withProvider(service, (client) => client.createDnsRecord(service.zone_id, body));
    if (!created.id) throw new ValidationError('Cloudflare accepted the record but returned no record id, so it is not reported as created');

    const cached = await store.table('cloudflare_dns_records').insert({
      id: uuidv7(), service_id: service.id, cloudflare_record_id: created.id, type: created.type, name: created.name,
      content: created.content, ttl: created.ttl ?? body.ttl ?? 1, proxied: created.proxied === true,
      priority: created.priority ?? null, comment: created.comment ?? null, ownership: created.ownership,
    });
    await audit(ctx, 'cloudflare.dns_record_created', 'cloudflare_dns', service.id, { recordId: created.id, type: created.type, name: created.name });
    ctx.code(201).json({ record: recordDto(cached) });
  });

  router.patch('/api/v1/cloudflare/services/:id/dns/:recordId', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(dnsRecordBody().partial());
    const { service } = await authorize(ctx, ctx.params.id, 'dns');
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    const cached = (await store.table('cloudflare_dns_records').all()).find((r) => r.service_id === service.id && (r.cloudflare_record_id === ctx.params.recordId || r.id === ctx.params.recordId));
    if (!cached) throw new NotFoundError('No DNS record was found with that id');
    if (cached.ownership === 'SYSTEM_MANAGED') throw new ValidationError('This record is managed by CloudHost247 hosting automation and cannot be edited here');
    // A record written before provider ids were stored cannot be addressed at Cloudflare. Refusing by
    // name is the only honest option; sending a fabricated id would 404 upstream and read as an outage.
    if (!cached.cloudflare_record_id) {
      throw new ValidationError('This record has no Cloudflare record id (it predates live synchronisation) — run Sync, then edit the record Cloudflare lists');
    }
    const patch = {};
    for (const k of ['type', 'name', 'content', 'ttl', 'proxied', 'priority', 'comment']) if (body[k] !== undefined) patch[k] = body[k];
    if (Object.keys(patch).length === 0) throw new ValidationError('No changes were supplied');

    const refreshed = await withProvider(service, (client) => client.updateDnsRecord(service.zone_id, cached.cloudflare_record_id, patch));
    const row = await store.table('cloudflare_dns_records').updateById(cached.id, {
      type: refreshed.type, name: refreshed.name, content: refreshed.content,
      ttl: refreshed.ttl ?? cached.ttl, proxied: refreshed.proxied === true,
      priority: refreshed.priority ?? null, comment: refreshed.comment ?? null,
      ownership: refreshed.ownership ?? cached.ownership,
    });
    await audit(ctx, 'cloudflare.dns_record_updated', 'cloudflare_dns', service.id, { recordId: cached.cloudflare_record_id, fields: Object.keys(patch) });
    ctx.json({ record: recordDto(row) });
  });

  router.delete('/api/v1/cloudflare/services/:id/dns/:recordId', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { service } = await authorize(ctx, ctx.params.id, 'dns');
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    const cached = (await store.table('cloudflare_dns_records').all()).find((r) => r.service_id === service.id && (r.cloudflare_record_id === ctx.params.recordId || r.id === ctx.params.recordId));
    if (!cached) throw new NotFoundError('No DNS record was found with that id');
    if (cached.ownership === 'SYSTEM_MANAGED') throw new ValidationError('This record is managed by CloudHost247 hosting automation and cannot be deleted here');
    if (!cached.cloudflare_record_id) {
      throw new ValidationError('This record has no Cloudflare record id (it predates live synchronisation) — run Sync, then delete the record Cloudflare lists');
    }

    const outcome = await withProvider(service, (client) => client.deleteDnsRecord(service.zone_id, cached.cloudflare_record_id));
    // The local row survives a delete Cloudflare did not confirm, so the cache never claims a record
    // is gone while it is still serving traffic.
    if (!outcome.deleted) throw new ValidationError('Cloudflare did not confirm the deletion, so the record is still shown');
    await store.table('cloudflare_dns_records').deleteById(cached.id);
    await audit(ctx, 'cloudflare.dns_record_deleted', 'cloudflare_dns', service.id, { recordId: cached.cloudflare_record_id, type: cached.type, name: cached.name });
    ctx.json({ deleted: true });
  });

  // -------------------------------------------------------------------- DNSSEC
  /**
   * Live DNSSEC state, including the **DS record**.
   *
   * The DS record is the whole point of this endpoint: it is what the customer must publish at their
   * registrar for the chain of trust to exist, and it was previously hardcoded to `null` while the
   * local `__dnssec` flag was flipped as if DNSSEC had been configured.
   */
  router.get('/api/v1/cloudflare/services/:id/dnssec', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { service } = await authorize(ctx, ctx.params.id, 'dnssec');
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    const dnssec = await withProvider(service, (client) => client.getDnssec(service.zone_id));
    await putSettings(service.id, { __dnssec: dnssec.status });
    ctx.json({
      dnssec: {
        status: dnssec.status,
        dsRecord: dnssec.ds,
        keyTag: dnssec.keyTag,
        algorithm: dnssec.algorithm,
        digestAlgorithm: dnssec.digestAlgorithm,
        modifiedOn: dnssec.modifiedOn,
      },
      registrarNotice: dnssec.ds
        ? 'Add this DS record at your registrar to complete the DNSSEC chain of trust. Cloudflare cannot do it for you.'
        : null,
    });
  });

  router.post('/api/v1/cloudflare/services/:id/dnssec/:action', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const action = ctx.params.action;
    if (!['enable', 'disable'].includes(action)) throw new NotFoundError('No Cloudflare service was found with that id');
    const { service } = await authorize(ctx, ctx.params.id, 'dnssec');
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    const dnssec = await withProvider(service, (client) => (action === 'enable' ? client.enableDnssec(service.zone_id) : client.disableDnssec(service.zone_id)));
    await putSettings(service.id, { __dnssec: dnssec.status });
    await audit(ctx, `cloudflare.dnssec_${action}d`, 'cloudflare_service', service.id, { status: dnssec.status });
    ctx.json({ dnssec: { status: dnssec.status, dsRecord: dnssec.ds } });
  });

  // ------------------------------------------------------------------- analytics
  /**
   * Zone traffic from Cloudflare's GraphQL analytics.
   *
   * `dataStatus` is kept in the response because consumers already branch on it: it reads `LIVE` when
   * Cloudflare answered, and a metric Cloudflare has no datapoints for stays `null` with the day
   * counted in `missingDays` rather than being zero-filled — "no traffic recorded" and "zero requests"
   * are different facts.
   */
  router.get('/api/v1/cloudflare/services/:id/analytics', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const query = await ctx.validateQuery(v.object({ range: v.coerce.number().int().min(1).max(30).default(7) }));
    const { service } = await authorize(ctx, ctx.params.id, 'analytics');
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    const analytics = await withProvider(service, (client) => client.zoneAnalytics(service.zone_id, { days: query.range }));
    ctx.json({
      analytics: { totals: analytics.totals, timeseries: analytics.timeseries },
      dataStatus: 'LIVE',
      range: analytics.days,
      missingDays: analytics.missingDays,
    });
  });

  // ------------------------------------------------- settings-backed sections
  router.get('/api/v1/cloudflare/services/:id/:tab', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const section = SECTIONS[ctx.params.tab];
    if (!section) throw new NotFoundError('No Cloudflare service was found with that id');
    const { service } = await authorize(ctx, ctx.params.id, section.feature);
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    const all = await getSettings(service.id);
    const settings = {};
    for (const id of section.ids) settings[id] = all[id] ?? null;
    if (ctx.params.tab === 'firewall') {
      const rules = (await store.table('cloudflare_access_rules').all()).filter((r) => r.service_id === service.id);
      return ctx.json({ settings, rules: rules.map((r) => ({ id: r.cloudflare_rule_id ?? r.id, target: r.target, value: r.value, mode: r.mode, notes: r.notes ?? null })), modes: ACCESS_RULE_MODES });
    }
    ctx.json({ settings });
  });

  router.patch('/api/v1/cloudflare/services/:id/:tab', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const section = SECTIONS[ctx.params.tab];
    if (!section) throw new NotFoundError('No Cloudflare service was found with that id');
    const body = await ctx.validate(section.schema());
    const entries = Object.entries(body).filter(([, val]) => val !== undefined);
    if (entries.length === 0) throw new ValidationError('No settings supplied');
    const { service } = await authorize(ctx, ctx.params.id, section.feature);
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');

    // Every setting id in SECTIONS is a real Cloudflare zone-setting id, so each one is written at
    // Cloudflare. The provider is patched *first*: a setting Cloudflare rejects must not appear
    // applied in the local document the customer is shown.
    const applied = {};
    for (const [settingId, value] of entries) {
      const result = await withProvider(service, (client) => client.patchZoneSetting(service.zone_id, settingId, value));
      applied[settingId] = result.value ?? value;
    }
    await putSettings(service.id, applied);
    if (ctx.params.tab === 'ssl' && typeof body.ssl === 'string') await store.table('cloudflare_services').updateById(service.id, { ssl_mode: body.ssl });
    if (ctx.params.tab === 'caching' && typeof body.development_mode === 'string') {
      await store.table('cloudflare_services').updateById(service.id, { development_mode_until: body.development_mode === 'on' ? new Date(Date.now() + 3 * 3600000).toISOString() : null });
    }
    await audit(ctx, `cloudflare.${section.feature}_updated`, 'cloudflare_service', service.id, { settings: Object.keys(applied) });
    ctx.json({ settings: applied });
  });

  // ------------------------------------------------------------ firewall rules
  router.post('/api/v1/cloudflare/services/:id/firewall/rules', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({ value: v.string().min(1).max(64), mode: v.enum(ACCESS_RULE_MODES), notes: v.string().max(500).optional() }));
    const target = validateIpOrCidr(body.value);
    const { service } = await authorize(ctx, ctx.params.id, 'firewall');
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    const created = await withProvider(service, (client) => client.createAccessRule(service.zone_id, { mode: body.mode, notes: body.notes, target, value: body.value }));
    if (!created.id) throw new ValidationError('Cloudflare accepted the rule but returned no rule id, so it is not reported as created');
    const rule = await store.table('cloudflare_access_rules').insert({
      id: uuidv7(), service_id: service.id, cloudflare_rule_id: created.id,
      target: created.target ?? target, value: created.value ?? body.value, mode: created.mode ?? body.mode, notes: created.notes ?? null,
    });
    await audit(ctx, 'cloudflare.firewall_rule_created', 'cloudflare_service', service.id, { ruleId: created.id, mode: rule.mode, value: rule.value });
    ctx.code(201).json({ rule: { id: rule.cloudflare_rule_id, target: rule.target, value: rule.value, mode: rule.mode, notes: rule.notes ?? null } });
  });

  router.patch('/api/v1/cloudflare/services/:id/firewall/rules/:ruleId', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({ mode: v.enum(ACCESS_RULE_MODES).optional(), notes: v.string().max(500).optional() }));
    const { service } = await authorize(ctx, ctx.params.id, 'firewall');
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    const rule = (await store.table('cloudflare_access_rules').all()).find((r) => r.service_id === service.id && (r.cloudflare_rule_id === ctx.params.ruleId || r.id === ctx.params.ruleId));
    if (!rule) throw new NotFoundError('No firewall rule was found with that id');
    if (!rule.cloudflare_rule_id) {
      throw new ValidationError('This rule has no Cloudflare rule id (it predates live synchronisation) — delete it and re-add the rule to manage it here');
    }
    const patch = {};
    if (body.mode !== undefined) patch.mode = body.mode;
    if (body.notes !== undefined) patch.notes = body.notes;
    if (Object.keys(patch).length === 0) throw new ValidationError('No changes were supplied');

    const refreshed = await withProvider(service, (client) => client.updateAccessRule(service.zone_id, rule.cloudflare_rule_id, patch));
    const updated = await store.table('cloudflare_access_rules').updateById(rule.id, {
      mode: refreshed.mode ?? rule.mode, notes: refreshed.notes ?? rule.notes ?? null,
    });
    await audit(ctx, 'cloudflare.firewall_rule_updated', 'cloudflare_service', service.id, { ruleId: rule.cloudflare_rule_id, fields: Object.keys(patch) });
    ctx.json({ rule: { id: updated.cloudflare_rule_id ?? updated.id, target: updated.target, value: updated.value, mode: updated.mode, notes: updated.notes ?? null } });
  });

  router.delete('/api/v1/cloudflare/services/:id/firewall/rules/:ruleId', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { service } = await authorize(ctx, ctx.params.id, 'firewall');
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    const rule = (await store.table('cloudflare_access_rules').all()).find((r) => r.service_id === service.id && (r.cloudflare_rule_id === ctx.params.ruleId || r.id === ctx.params.ruleId));
    if (!rule) throw new NotFoundError('No firewall rule was found with that id');
    if (!rule.cloudflare_rule_id) {
      throw new ValidationError('This rule has no Cloudflare rule id (it predates live synchronisation) — Sync from the zone, then delete the rule Cloudflare lists');
    }
    const outcome = await withProvider(service, (client) => client.deleteAccessRule(service.zone_id, rule.cloudflare_rule_id));
    if (!outcome.deleted) throw new ValidationError('Cloudflare did not confirm the deletion, so the rule is still shown');
    await store.table('cloudflare_access_rules').deleteById(rule.id);
    await audit(ctx, 'cloudflare.firewall_rule_deleted', 'cloudflare_service', service.id, { ruleId: rule.cloudflare_rule_id });
    ctx.json({ deleted: true });
  });

  // ------------------------------------------------------------- cache purge
  router.post('/api/v1/cloudflare/services/:id/caching/purge', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({ everything: v.boolean().optional(), files: v.array(v.string().max(2048)).optional() }));
    if (body.everything !== true && !(body.files && body.files.length > 0)) throw new ValidationError('Choose purge everything or provide URLs');
    if (body.files && body.files.length > 30) throw new ValidationError('At most 30 URLs per purge');
    const { service } = await authorize(ctx, ctx.params.id, 'cache_purge');
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    if (body.files) {
      for (const url of body.files) {
        let host;
        try { host = new URL(url).hostname.toLowerCase(); } catch { throw new ValidationError(`Invalid URL: ${url}`); }
        if (host !== service.zone_name && !host.endsWith(`.${service.zone_name}`)) throw new ValidationError(`URL host ${host} does not belong to ${service.zone_name}`);
      }
    }
    // A real purge, inside the request. Reporting `{ purged: true }` for a queued job nothing ran was
    // the most misleading answer in this module: a customer would re-request the purge, get the same
    // answer, and never learn that their cached pages were never dropped.
    const job = await store.table('cloudflare_jobs').insert({
      id: uuidv7(), account_id: service.account_id ?? null, service_id: service.id,
      kind: 'purge_cache', type: 'purge_cache', status: 'running',
      payload: { everything: body.everything ?? false, files: body.files ?? [] },
    });
    try {
      const outcome = await withProvider(service, (client) => client.purgeCache(service.zone_id, { everything: body.everything ?? false, files: body.files ?? [] }));
      await store.table('cloudflare_jobs').updateById(job.id, { status: 'succeeded', payload: { everything: body.everything ?? false, files: body.files?.length ?? 0, outcome: 'cache_purged' } });
      await audit(ctx, 'cloudflare.cache_purged', 'cloudflare_service', service.id, { everything: body.everything ?? false, files: body.files?.length ?? 0 });
      ctx.json({ purged: true, purgeId: outcome.id, everything: body.everything ?? false, files: body.files?.length ?? 0 });
    } catch (error) {
      await store.table('cloudflare_jobs').updateById(job.id, { status: 'failed', payload: { everything: body.everything ?? false, failure: { code: error?.details?.failureCode ?? error?.code ?? null } } });
      throw error;
    }
  });

  // ---------------------------------------------------------------------- plan
  router.get('/api/v1/cloudflare/services/:id/plan', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { service, entitlements } = await authorize(ctx, ctx.params.id, null);
    const mappings = (await store.table('cloudflare_plan_mappings').all()).filter((m) => (m.plan_status ?? 'active') === 'active' && (m.plan_id ?? m.id) !== service.plan_id);
    const options = [];
    for (const m of mappings) {
      const pricing = (await store.table('catalog_plan_pricing').all()).filter((p) => p.plan_id === (m.plan_id ?? m.id) && p.is_active && p.price != null);
      options.push({ planId: m.plan_id ?? m.id, planName: m.plan_name, cloudflarePlan: m.cloudflare_plan, pricing: pricing.map((p) => ({ billingPeriod: p.billing_cycle, amount: p.price, currency: p.currency })) });
    }
    ctx.json({
      current: { planId: service.plan_id ?? null, planName: service.plan_name ?? null, cloudflarePlan: service.cloudflare_plan ?? null },
      planChangeAllowed: Boolean(entitlements.plan_change && service.status === 'active'),
      options,
    });
  });

  router.post('/api/v1/cloudflare/services/:id/plan/change', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({ newPlanId: v.string().min(1), billingPeriod: v.enum(['one_time', 'monthly', 'quarterly', 'semi_annually', 'annually']) }));
    const { service, entitlements } = await authorize(ctx, ctx.params.id, null);
    if (!entitlements.plan_change) throw new ForbiddenError('FEATURE_NOT_SUPPORTED: your Cloudflare plan does not allow changes');
    if (service.status !== 'active') throw new ValidationError('Plan changes require an active service');
    const target = await store.table('cloudflare_plan_mappings').findOne({ plan_id: body.newPlanId }) ?? await store.table('cloudflare_plan_mappings').findById(body.newPlanId);
    if (!target) throw new NotFoundError('No Cloudflare plan was found with that id');
    const pricing = (await store.table('catalog_plan_pricing').all()).find((p) => p.plan_id === (target.plan_id ?? target.id) && p.billing_cycle === body.billingPeriod && p.is_active);
    // A priced upgrade is billed first and applied on settlement; a free/downgrade change has nothing
    // to bill, so it is applied now. The previous version queued the free path as a durable job that
    // no worker read — the customer was told "applied shortly" and nothing ever was.
    const priced = pricing && pricing.price > 0;
    const result = { applied: false, newPlanId: body.newPlanId, newPlanName: target.plan_name ?? null };

    if (priced) {
      const orderId = uuidv7();
      const currency = pricing.currency ?? 'USD';
      const reference = `CFPC-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;
      await store.table('orders').insert({
        id: orderId, user_id: auth.id, reference,
        currency, subtotal: pricing.price, total: pricing.price, status: 'pending',
      });
      const invoiceId = uuidv7();
      const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;
      await store.table('invoices').insert({
        id: invoiceId, user_id: auth.id, order_id: orderId, number: invoiceNumber,
        subtotal: pricing.price, total: pricing.price, currency, status: 'unpaid',
        due_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
      });
      await store.table('billing_ledger').insert({
        id: uuidv7(), user_id: auth.id, invoice_id: invoiceId, entry_type: 'charge',
        amount: pricing.price, currency, description: `Order ${reference}`, idempotency_key: `charge:${orderId}`,
      });
      await recordPendingAction(store, {
        kind: 'plan_change', orderId, serviceId: service.id, accountId: service.account_id ?? null,
        payload: { planId: target.plan_id ?? target.id, billingPeriod: body.billingPeriod, newPlanName: target.plan_name ?? null },
      });
      result.orderId = orderId;
      result.invoiceId = invoiceId;
    } else {
      const change = await applyPlanChange(store, service, target);
      result.applied = true;
      result.plan = change.after;
    }
    await audit(ctx, 'cloudflare.plan_change_requested', 'cloudflare_service', service.id, { newPlanId: body.newPlanId, priced, applied: result.applied });
    ctx.code(priced ? 202 : 200).json({
      ...result,
      message: priced
        ? 'An invoice has been issued for the plan change. The plan is applied automatically once the payment is confirmed.'
        : 'The plan change has been applied.',
    });
  });
}

module.exports = { name, register };
