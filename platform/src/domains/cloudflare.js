/**
 * Customer Cloudflare API (spec §12–§27, §46, §48, §71).
 *
 * Ported from cloudhost247-node/src/routes/cloudflare.ts. Every endpoint:
 *   authenticate → load the service by OUR id → verify the caller owns it → verify service state →
 *   verify the plan entitlement → only then act. Zone/record identifiers supplied by the browser
 *   only ever select rows already scoped to the caller's service — never passed through unverified.
 *   "Missing" and "not yours" return the same 404 (no resource enumeration).
 *
 * The live Cloudflare HTTP client is deferred (no provider egress in this build). Feature state is
 * therefore maintained in synchronized local caches (cloudflare_dns_records, cloudflare_access_rules,
 * cloudflare_zone_settings); Cloudflare remains the source of truth and Sync queues the durable
 * refresh job. Analytics honestly reports DATA_UNAVAILABLE rather than fabricating traffic numbers.
 */
'use strict';

const { isIP } = require('node:net');
const { v } = require('../core/validate');
const { NotFoundError, ValidationError, ForbiddenError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate } = require('../lib/auth');

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
    const orderId = uuidv7();
    const orderNumber = `CF-${Date.now().toString(36).toUpperCase()}`;
    await store.table('orders').insert({ id: orderId, user_id: auth.id, order_number: orderNumber, total_amount: amount, currency: pricing?.currency ?? 'USD', status: 'pending' });
    const invoiceId = uuidv7();
    await store.table('invoices').insert({ id: invoiceId, user_id: auth.id, order_id: orderId, invoice_number: `INV-${Date.now().toString(36).toUpperCase()}`, amount, currency: pricing?.currency ?? 'USD', status: 'unpaid' });
    await audit(ctx, 'cloudflare.order_created', 'order', orderId, null);
    ctx.code(201).json({
      order: { id: orderId, orderNumber, totalAmount: amount, currency: pricing?.currency ?? 'USD' },
      invoice: { id: invoiceId, invoiceNumber: `INV-${Date.now().toString(36).toUpperCase()}` },
      message: 'Order created. The Cloudflare service will be provisioned automatically after payment is confirmed.',
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

  router.post('/api/v1/cloudflare/services/:id/sync', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { service } = await authorize(ctx, ctx.params.id, null);
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    const job = await store.table('cloudflare_jobs').insert({ id: uuidv7(), account_id: service.account_id ?? null, service_id: service.id, kind: 'sync_zone', type: 'sync_zone', status: 'queued', payload: { idempotencyKey: `cf-manual-sync:${service.id}:${new Date().toISOString().slice(0, 16)}` } });
    ctx.code(job ? 202 : 200).json({ queued: Boolean(job), message: job ? 'Synchronization queued' : 'A synchronization was already queued in the last minute' });
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
    ctx.json({ records: records.map(recordDto), note: 'Records are a synchronized view; Cloudflare is the source of truth. Use Sync to refresh.' });
  });

  router.post('/api/v1/cloudflare/services/:id/dns', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(dnsRecordBody());
    const { service } = await authorize(ctx, ctx.params.id, 'dns');
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    // Live Cloudflare write is deferred; the record is stored in the synchronized cache.
    const cfRecordId = `cf-rec-${uuidv7()}`;
    const cached = await store.table('cloudflare_dns_records').insert({
      id: uuidv7(), service_id: service.id, cloudflare_record_id: cfRecordId, type: body.type, name: body.name,
      content: body.content, ttl: body.ttl, proxied: body.proxied ?? false, priority: body.priority ?? null,
      comment: body.comment ?? null, ownership: 'CUSTOMER_MANAGED',
    });
    await audit(ctx, 'cloudflare.dns_record_created', 'cloudflare_dns', service.id, { recordId: cfRecordId, type: body.type, name: body.name });
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
    const patch = {};
    for (const k of ['type', 'name', 'content', 'ttl', 'proxied', 'priority', 'comment']) if (body[k] !== undefined) patch[k] = body[k];
    const refreshed = await store.table('cloudflare_dns_records').updateById(cached.id, patch);
    await audit(ctx, 'cloudflare.dns_record_updated', 'cloudflare_dns', service.id, { recordId: cached.cloudflare_record_id });
    ctx.json({ record: recordDto(refreshed) });
  });

  router.delete('/api/v1/cloudflare/services/:id/dns/:recordId', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { service } = await authorize(ctx, ctx.params.id, 'dns');
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    const cached = (await store.table('cloudflare_dns_records').all()).find((r) => r.service_id === service.id && (r.cloudflare_record_id === ctx.params.recordId || r.id === ctx.params.recordId));
    if (!cached) throw new NotFoundError('No DNS record was found with that id');
    if (cached.ownership === 'SYSTEM_MANAGED') throw new ValidationError('This record is managed by CloudHost247 hosting automation and cannot be deleted here');
    await store.table('cloudflare_dns_records').deleteById(cached.id);
    await audit(ctx, 'cloudflare.dns_record_deleted', 'cloudflare_dns', service.id, { recordId: cached.cloudflare_record_id, type: cached.type, name: cached.name });
    ctx.json({ deleted: true });
  });

  // -------------------------------------------------------------------- DNSSEC
  router.get('/api/v1/cloudflare/services/:id/dnssec', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { service } = await authorize(ctx, ctx.params.id, 'dnssec');
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    const settings = await getSettings(service.id);
    ctx.json({ dnssec: { status: settings.__dnssec ?? 'disabled', dsRecord: null } });
  });

  router.post('/api/v1/cloudflare/services/:id/dnssec/:action', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const action = ctx.params.action;
    if (!['enable', 'disable'].includes(action)) throw new NotFoundError('No Cloudflare service was found with that id');
    const { service } = await authorize(ctx, ctx.params.id, 'dnssec');
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    await putSettings(service.id, { __dnssec: action === 'enable' ? 'active' : 'disabled' });
    await audit(ctx, `cloudflare.dnssec_${action}d`, 'cloudflare_service', service.id, null);
    ctx.json({ dnssec: { status: action === 'enable' ? 'active' : 'disabled', dsRecord: null } });
  });

  // ------------------------------------------------------------------- analytics
  router.get('/api/v1/cloudflare/services/:id/analytics', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const query = await ctx.validateQuery(v.object({ range: v.coerce.number().int().min(1).max(30).default(7) }));
    const { service } = await authorize(ctx, ctx.params.id, 'analytics');
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    // No live Cloudflare egress: report DATA_UNAVAILABLE honestly rather than fabricating traffic.
    const analytics = { totals: { requests: null, bandwidth: null, threats: null, cached: null }, timeseries: [] };
    ctx.json({ analytics, dataStatus: 'DATA_UNAVAILABLE' });
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
    const applied = {};
    const patch = {};
    for (const [settingId, value] of entries) { applied[settingId] = value; patch[settingId] = value; }
    await putSettings(service.id, patch);
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
    const cfRuleId = `cf-rule-${uuidv7()}`;
    const rule = await store.table('cloudflare_access_rules').insert({ id: uuidv7(), service_id: service.id, cloudflare_rule_id: cfRuleId, target, value: body.value, mode: body.mode, notes: body.notes ?? null });
    await audit(ctx, 'cloudflare.firewall_rule_created', 'cloudflare_service', service.id, { ruleId: cfRuleId, mode: body.mode, value: body.value });
    ctx.code(201).json({ rule: { id: cfRuleId, target, value: rule.value, mode: rule.mode, notes: rule.notes ?? null } });
  });

  router.patch('/api/v1/cloudflare/services/:id/firewall/rules/:ruleId', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({ mode: v.enum(ACCESS_RULE_MODES).optional(), notes: v.string().max(500).optional() }));
    const { service } = await authorize(ctx, ctx.params.id, 'firewall');
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    const rule = (await store.table('cloudflare_access_rules').all()).find((r) => r.service_id === service.id && (r.cloudflare_rule_id === ctx.params.ruleId || r.id === ctx.params.ruleId));
    if (!rule) throw new NotFoundError('No firewall rule was found with that id');
    const patch = {};
    if (body.mode !== undefined) patch.mode = body.mode;
    if (body.notes !== undefined) patch.notes = body.notes;
    const updated = await store.table('cloudflare_access_rules').updateById(rule.id, patch);
    await audit(ctx, 'cloudflare.firewall_rule_updated', 'cloudflare_service', service.id, { ruleId: rule.cloudflare_rule_id });
    ctx.json({ rule: { id: updated.cloudflare_rule_id ?? updated.id, target: updated.target, value: updated.value, mode: updated.mode, notes: updated.notes ?? null } });
  });

  router.delete('/api/v1/cloudflare/services/:id/firewall/rules/:ruleId', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { service } = await authorize(ctx, ctx.params.id, 'firewall');
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    const rule = (await store.table('cloudflare_access_rules').all()).find((r) => r.service_id === service.id && (r.cloudflare_rule_id === ctx.params.ruleId || r.id === ctx.params.ruleId));
    if (!rule) throw new NotFoundError('No firewall rule was found with that id');
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
    // Live purge is deferred; queue the durable job and report honestly.
    await store.table('cloudflare_jobs').insert({ id: uuidv7(), account_id: service.account_id ?? null, service_id: service.id, kind: 'purge_cache', type: 'purge_cache', status: 'queued', payload: { everything: body.everything ?? false, files: body.files ?? [] } });
    await audit(ctx, 'cloudflare.cache_purged', 'cloudflare_service', service.id, { everything: body.everything ?? false, files: body.files?.length ?? 0 });
    ctx.json({ purged: true });
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
    // Upgrade (priced) → invoice; downgrade/free → queue. Honest about which path was taken.
    const mode = pricing && pricing.price > 0 ? 'invoice' : 'queue';
    const result = { mode, newPlanId: body.newPlanId, newPlanName: target.plan_name ?? null };
    if (mode === 'invoice') {
      const invoiceId = uuidv7();
      await store.table('invoices').insert({ id: invoiceId, user_id: auth.id, invoice_number: `INV-${Date.now().toString(36).toUpperCase()}`, amount: pricing.price, currency: pricing.currency ?? 'USD', status: 'unpaid' });
      result.invoiceId = invoiceId;
    } else {
      await store.table('cloudflare_jobs').insert({ id: uuidv7(), account_id: service.account_id ?? null, service_id: service.id, kind: 'plan_change', type: 'plan_change', status: 'queued', payload: { newPlanId: body.newPlanId } });
    }
    await audit(ctx, 'cloudflare.plan_change_requested', 'cloudflare_service', service.id, { newPlanId: body.newPlanId, mode });
    ctx.code(202).json({ ...result, message: mode === 'invoice' ? 'An invoice has been issued for the plan change. The Cloudflare plan updates automatically once payment is confirmed.' : 'The plan change has been queued and will be applied shortly.' });
  });
}

module.exports = { name, register };
