/**
 * Customer domains + a domain-availability endpoint for the public site.
 *
 * Ported from cloudhost247-node/src/routes/domains.ts. Availability is intentionally honest: with
 * no registrar/WHOIS connector configured it performs a deterministic structural check and labels
 * the result as an estimate, rather than fabricating a definitive "available" answer. When a
 * domain-services provider is configured, that provider is the source of truth (see
 * domain-services.js).
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate } = require('../lib/auth');

const name = 'domains';

const KNOWN_TLDS = new Set(['com', 'net', 'org', 'io', 'co', 'dev', 'app', 'ng', 'africa', 'info', 'biz', 'me']);

function parseDomain(input) {
  const cleaned = String(input).trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  return cleaned;
}

function publicDomain(row) {
  return {
    id: row.id,
    domain: row.domain,
    registrar: row.registrar,
    status: row.status,
    registeredAt: row.registered_at,
    expiresAt: row.expires_at,
    autoRenew: row.auto_renew,
    nameservers: row.nameservers ?? [],
  };
}

function register(router, deps) {
  const { store } = deps;

  /** Public availability probe used by the Vanilla JS site's search box. */
  router.get('/api/v1/domains/availability', async (ctx) => {
    const raw = parseDomain(ctx.query.domain ?? '');
    if (!raw || !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(raw)) {
      ctx.json({ domain: raw, available: false, estimate: true, reason: 'invalid' });
      return;
    }

    const tld = raw.split('.').pop();
    if (!KNOWN_TLDS.has(tld)) {
      ctx.json({ domain: raw, available: false, estimate: true, reason: 'unsupported_tld' });
      return;
    }

    // If we already manage or have registered this domain, it is not available.
    const known = await store.table('customer_domains').findOne({ domain: raw });
    const registered = await store.table('domain_registrations').findOne({ domain: raw });
    if (known || registered) {
      ctx.json({ domain: raw, available: false, estimate: false });
      return;
    }

    // Structural estimate only — a real answer requires a registrar lookup (domain-services).
    ctx.json({ domain: raw, available: true, estimate: true, price: '9.99' });
  });

  router.get('/api/v1/domains', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows, total } = await store.table('customer_domains').find({ user_id: auth.id }, { orderBy: '-created_at' });
    ctx.json({ domains: rows.map(publicDomain), total });
  });

  router.post('/api/v1/domains', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({
      domain: v.string().trim().toLowerCase().min(4).max(253),
      registrar: v.string().trim().max(60).optional(),
      autoRenew: v.boolean().default(false),
    }));

    const domain = await store.table('customer_domains').insert({
      id: uuidv7(),
      user_id: auth.id,
      domain: body.domain,
      registrar: body.registrar ?? null,
      status: 'pending',
      auto_renew: body.autoRenew,
    });
    ctx.code(201).json({ domain: publicDomain(domain) });
  });

  router.get('/api/v1/domains/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const domain = await store.table('customer_domains').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!domain) throw new NotFoundError('Domain not found');
    ctx.json({ domain: publicDomain(domain) });
  });
}

module.exports = { name, register, parseDomain };
