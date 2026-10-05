/**
 * DNS zones and records (spec §dns).
 *
 * Ported from cloudhost247-node/src/routes/dns.ts. Zones are owned by a customer; records belong to
 * a zone. Both the flat /dns/records surface and the nested /dns/zones/:id/records surface are
 * provided, as in the original. Validation of record shapes happens here; actual propagation to a
 * provider (Cloudflare/Route53) is an integration concern that is deferred — records are stored as
 * the source of truth. Mutations are audited.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate } = require('../lib/auth');

const name = 'dns';

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA', 'PTR', 'SOA'];

const zoneSchema = v.object({ domain: v.string().trim().toLowerCase().min(4).max(253) });

// createDirectRecordSchema — zoneId in the body (flat surface).
const directRecordSchema = v.object({
  zoneId: v.string().min(1),
  name: v.string().trim().min(1).max(255),
  type: v.enum(RECORD_TYPES),
  content: v.string().trim().min(1).max(2000),
  ttl: v.coerce.number().int().min(60).max(86400).default(3600),
  priority: v.coerce.number().int().min(0).max(65535).nullable().optional(),
  proxied: v.boolean().optional(),
});
// createNestedRecordSchema — zoneId comes from the path.
const nestedRecordSchema = directRecordSchema.omit(['zoneId']);
const patchRecordSchema = nestedRecordSchema.partial();

function recordDto(r) {
  return { id: r.id, zoneId: r.zone_id, type: r.type, name: r.name, content: r.content, ttl: r.ttl, priority: r.priority ?? null, proxied: !!r.proxied };
}

async function requireZone(store, zoneId, userId) {
  const zone = await store.table('dns_zones').findById(zoneId);
  if (!zone || zone.user_id !== userId) throw new NotFoundError('DNS zone not found');
  return zone;
}

function register(router, deps) {
  const { store } = deps;

  // The original calls registerHandlers() for both '/api/v1' and the legacy '/api' prefix, so the
  // same handler instances are mounted twice. Only the routes the original dual-mounts go through
  // here; platform-specific extras stay on '/api/v1' alone.
  const dual = (method, path, handler) => {
    for (const prefix of ['/api/v1', '/api']) router[method](`${prefix}${path}`, handler);
  };


  async function audit(ctx, action, resourceType, resourceId, metadata) {
    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: ctx.user.id, actor_role: ctx.user.role, action,
      entity_type: resourceType, entity_id: resourceId ?? null,
      ip_address: ctx.ip, user_agent: ctx.userAgent, after: metadata ?? null,
    });
  }

  async function createRecord(ctx, zone, input) {
    if ((input.type === 'MX' || input.type === 'SRV') && (input.priority === undefined || input.priority === null)) {
      throw new ValidationError(`${input.type} records require a priority`);
    }
    const record = await store.table('dns_records').insert({
      id: uuidv7(), zone_id: zone.id, type: input.type, name: input.name, content: input.content,
      ttl: input.ttl ?? 3600, priority: input.priority ?? null, proxied: input.proxied ?? false,
    });
    await audit(ctx, 'DNS_RECORD_CREATED', 'dns_record', record.id, { zoneId: zone.id, name: record.name, type: record.type });
    return record;
  }

  // --- Zones ---------------------------------------------------------------------------------
  dual('get', '/dns/zones', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows, total } = await store.table('dns_zones').find({ user_id: auth.id }, { orderBy: 'domain' });
    ctx.json({ zones: rows.map((z) => ({ id: z.id, domain: z.domain, status: z.status })), total });
  });

  dual('post', '/dns/zones', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(zoneSchema);
    const existing = await store.table('dns_zones').find({ user_id: auth.id, domain: body.domain });
    if (existing.rows.length) throw new ValidationError('A DNS zone for that domain already exists');
    const zone = await store.table('dns_zones').insert({ id: uuidv7(), user_id: auth.id, domain: body.domain, status: 'active' });
    for (const content of ['ns1.cloudhost247.example', 'ns2.cloudhost247.example']) {
      await store.table('dns_records').insert({ id: uuidv7(), zone_id: zone.id, type: 'NS', name: '@', content, ttl: 3600 });
    }
    await audit(ctx, 'DNS_ZONE_CREATED', 'dns_zone', zone.id, { domain: zone.domain });
    ctx.code(201).json({ zone: { id: zone.id, domain: zone.domain, status: zone.status } });
  });

  dual('get', '/dns/zones/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const zone = await requireZone(store, ctx.params.id, auth.id);
    const { rows } = await store.table('dns_records').find({ zone_id: zone.id }, { orderBy: ['type', 'name'] });
    ctx.json({ zone: { id: zone.id, domain: zone.domain, status: zone.status }, records: rows.map(recordDto) });
  });

  dual('delete', '/dns/zones/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const zone = await requireZone(store, ctx.params.id, auth.id);
    const { rows } = await store.table('dns_records').find({ zone_id: zone.id });
    for (const r of rows) await store.table('dns_records').deleteById(r.id);
    await store.table('dns_zones').deleteById(zone.id);
    await audit(ctx, 'DNS_ZONE_DELETED', 'dns_zone', zone.id, { domain: zone.domain });
    ctx.noContent();
  });

  // --- Flat records surface ------------------------------------------------------------------
  dual('post', '/dns/records', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(directRecordSchema);
    const zone = await requireZone(store, body.zoneId, auth.id);
    const record = await createRecord(ctx, zone, body);
    ctx.code(201).json({ record: recordDto(record) });
  });

  dual('patch', '/dns/records/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const record = await store.table('dns_records').findById(ctx.params.id);
    if (!record) throw new NotFoundError('DNS record not found');
    const zone = await requireZone(store, record.zone_id, auth.id);
    const patch = await ctx.validate(patchRecordSchema);
    const fields = {};
    if (patch.name !== undefined) fields.name = patch.name;
    if (patch.type !== undefined) fields.type = patch.type;
    if (patch.content !== undefined) fields.content = patch.content;
    if (patch.ttl !== undefined) fields.ttl = patch.ttl;
    if (patch.priority !== undefined) fields.priority = patch.priority;
    if (patch.proxied !== undefined) fields.proxied = patch.proxied;
    const updated = await store.table('dns_records').updateById(record.id, fields);
    await audit(ctx, 'DNS_RECORD_UPDATED', 'dns_record', record.id, { zoneId: zone.id, changes: Object.keys(patch) });
    ctx.json({ record: recordDto(updated) });
  });

  dual('delete', '/dns/records/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const record = await store.table('dns_records').findById(ctx.params.id);
    if (!record) throw new NotFoundError('DNS record not found');
    await requireZone(store, record.zone_id, auth.id);
    await store.table('dns_records').deleteById(record.id);
    await audit(ctx, 'DNS_RECORD_DELETED', 'dns_record', record.id, { zoneId: record.zone_id, name: record.name, type: record.type });
    ctx.noContent();
  });

  // --- Nested records surface ----------------------------------------------------------------
  dual('get', '/dns/zones/:id/records', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const zone = await requireZone(store, ctx.params.id, auth.id);
    const { rows } = await store.table('dns_records').find({ zone_id: zone.id }, { orderBy: ['type', 'name'] });
    ctx.json({ records: rows.map(recordDto) });
  });

  dual('post', '/dns/zones/:id/records', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const zone = await requireZone(store, ctx.params.id, auth.id);
    const input = await ctx.validate(nestedRecordSchema);
    const record = await createRecord(ctx, zone, input);
    ctx.code(201).json({ record: recordDto(record) });
  });

  dual('patch', '/dns/zones/:id/records/:recordId', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const zone = await requireZone(store, ctx.params.id, auth.id);
    const record = await store.table('dns_records').findById(ctx.params.recordId);
    if (!record || record.zone_id !== zone.id) throw new NotFoundError('DNS record not found in this zone');
    const patch = await ctx.validate(patchRecordSchema);
    const fields = {};
    if (patch.name !== undefined) fields.name = patch.name;
    if (patch.type !== undefined) fields.type = patch.type;
    if (patch.content !== undefined) fields.content = patch.content;
    if (patch.ttl !== undefined) fields.ttl = patch.ttl;
    if (patch.priority !== undefined) fields.priority = patch.priority;
    if (patch.proxied !== undefined) fields.proxied = patch.proxied;
    const updated = await store.table('dns_records').updateById(record.id, fields);
    await audit(ctx, 'DNS_RECORD_UPDATED', 'dns_record', record.id, { zoneId: zone.id, changes: Object.keys(patch) });
    ctx.json({ record: recordDto(updated) });
  });

  dual('delete', '/dns/zones/:id/records/:recordId', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const zone = await requireZone(store, ctx.params.id, auth.id);
    const record = await store.table('dns_records').findById(ctx.params.recordId);
    if (!record || record.zone_id !== zone.id) throw new NotFoundError('DNS record not found in this zone');
    await store.table('dns_records').deleteById(record.id);
    await audit(ctx, 'DNS_RECORD_DELETED', 'dns_record', record.id, { zoneId: zone.id, name: record.name, type: record.type });
    ctx.noContent();
  });
}

module.exports = { name, register };
