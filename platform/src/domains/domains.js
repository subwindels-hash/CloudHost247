/**
 * Customer domains (spec §15) + a domain-availability endpoint for the public site.
 *
 * Ported from cloudhost247-node/src/routes/domains.ts. A customer adds a domain, proves control of
 * its DNS with a TXT record, and can then request SSL for it. The verify step performs a genuine
 * DNS TXT lookup (node:dns, a core module) exactly as the original does — it is not simulated, so
 * an unreachable or non-matching record honestly leaves the domain 'failed' with the reason.
 *
 * SSL issuance itself happens in the deployment pipeline when the domain is attached to an
 * installation; POST /:id/ssl records intent and says so in its response, as the original does.
 *
 * Availability stays honest: with no registrar/WHOIS connector configured it performs a
 * deterministic structural check and labels the result an estimate rather than inventing a
 * definitive "available" answer.
 */
'use strict';

const dns = require('node:dns').promises;
const crypto = require('node:crypto');
const { v } = require('../core/validate');
const { NotFoundError, ConflictError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate } = require('../lib/auth');

const name = 'domains';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const KNOWN_TLDS = new Set(['com', 'net', 'org', 'io', 'co', 'dev', 'app', 'ng', 'africa', 'info', 'biz', 'me']);

function parseDomain(input) {
  return String(input).trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}

const verificationRecordName = (domain) => `_cloudhost247-verification.${domain}`;

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

  const domains = () => store.table('customer_domains');

  async function audit(ctx, action, domainId, metadata) {
    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: ctx.user.id, actor_role: ctx.user.role, action,
      entity_type: 'customer_domain', entity_id: domainId ?? null,
      ip_address: ctx.ip, user_agent: ctx.userAgent, after: metadata ?? null,
    });
  }

  function requireUuid(raw) {
    if (!UUID_RE.test(String(raw ?? ''))) throw new ValidationError('Invalid domain identifier');
    return String(raw);
  }

  /** myDomainOrThrow: the caller's own domain, or a 404 that reveals nothing. */
  async function ownedOr404(ctx) {
    const auth = await authenticate(ctx, deps);
    const id = requireUuid(ctx.params.id);
    const domain = await domains().findById(id);
    if (!domain || domain.user_id !== auth.id) throw new NotFoundError('Domain not found');
    return { auth, domain };
  }

  /** Public availability probe used by the Vanilla JS site's search box. */
  router.get('/api/v1/domains/availability', async (ctx) => {
    const raw = parseDomain(ctx.query.domain ?? '');
    if (!raw || !DOMAIN_RE.test(raw)) {
      ctx.json({ domain: raw, available: false, estimate: true, reason: 'invalid' });
      return;
    }

    const tld = raw.split('.').pop();
    if (!KNOWN_TLDS.has(tld)) {
      ctx.json({ domain: raw, available: false, estimate: true, reason: 'unsupported_tld' });
      return;
    }

    const known = await domains().findOne({ domain: raw });
    const registered = await store.table('domain_registrations').findOne({ domain: raw });
    if (known || registered) {
      ctx.json({ domain: raw, available: false, estimate: false });
      return;
    }

    ctx.json({ domain: raw, available: true, estimate: true, price: '9.99' });
  });

  router.get('/api/v1/domains', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows, total } = await domains().find({ user_id: auth.id }, { orderBy: '-created_at' });
    ctx.json({ domains: rows.map(publicDomain), total });
  });

  router.post('/api/v1/domains', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({
      domain: v.string().trim().toLowerCase().min(4).max(253).regex(DOMAIN_RE, 'Invalid domain name'),
      registrar: v.string().trim().max(255).nullable().optional(),
    }));

    const { rows: existing } = await domains().find(
      (row) => row.user_id === auth.id && String(row.domain ?? '').toLowerCase() === body.domain,
    );
    if (existing.length) throw new ConflictError('That domain is already on your account');

    const token = `cloudhost247-verify=${crypto.randomBytes(16).toString('hex')}`;
    const domain = await domains().insert({
      id: uuidv7(),
      user_id: auth.id,
      domain: body.domain,
      registrar: body.registrar ?? null,
      status: 'active',
      domain_type: 'custom',
      verification_status: 'unverified',
      verification_method: 'dns_txt',
      verification_token: token,
      ssl_status: 'none',
      created_by: auth.id,
      created_by_user: true,
    });

    await audit(ctx, 'domain.added', domain.id, { domain: domain.domain });
    const recordName = verificationRecordName(domain.domain);
    ctx.code(201).json({
      domain,
      verification: {
        method: 'dns_txt',
        recordName,
        recordValue: domain.verification_token,
        instructions: `Create a TXT record "${recordName}" with the value above, then call POST /api/v1/domains/${domain.id}/verify`,
      },
    });
  });

  router.get('/api/v1/domains/:id', async (ctx) => {
    const { domain } = await ownedOr404(ctx);
    ctx.json({ domain: publicDomain(domain) });
  });

  /** Prove control of the domain's DNS by publishing the issued TXT token. */
  router.post('/api/v1/domains/:id/verify', async (ctx) => {
    const { domain } = await ownedOr404(ctx);
    if (domain.verification_status === 'verified') {
      ctx.json({ domain, alreadyVerified: true });
      return;
    }

    let verified = false;
    let detail = '';
    try {
      const records = await dns.resolveTxt(verificationRecordName(domain.domain));
      const flattened = records.map((chunks) => chunks.join(''));
      verified = flattened.some((value) => value === domain.verification_token);
      detail = verified
        ? 'TXT record matched'
        : `TXT record found but value did not match (${flattened.length} record(s))`;
    } catch (err) {
      verified = false;
      detail = `DNS lookup failed: ${err.message}`;
    }

    const updated = await domains().updateById(domain.id, {
      verification_status: verified ? 'verified' : 'failed',
      verified_at: verified ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    });
    await audit(ctx, verified ? 'domain.verified' : 'domain.verification_failed', domain.id, {
      domain: domain.domain, detail,
    });
    ctx.json({ domain: updated, verified, detail });
  });

  /**
   * Request a certificate for a verified domain. Issuance runs through the deployment pipeline
   * (Traefik letsencrypt resolver / cert-manager / AutoSSL) once the domain is attached to an
   * installation, so this records intent and returns 202 — as in the original.
   */
  router.post('/api/v1/domains/:id/ssl', async (ctx) => {
    const { domain } = await ownedOr404(ctx);
    if (domain.verification_status !== 'verified') {
      throw new ConflictError('Verify domain control before requesting an SSL certificate');
    }

    const updated = await domains().updateById(domain.id, {
      ssl_status: 'pending', updated_at: new Date().toISOString(),
    });
    await audit(ctx, 'domain.ssl_requested', domain.id, { domain: domain.domain });
    ctx.code(202).json({
      domain: updated,
      note: 'Certificate provisioning runs when this domain is attached to an installation with SSL enabled',
    });
  });

  router.delete('/api/v1/domains/:id', async (ctx) => {
    const { domain } = await ownedOr404(ctx);

    const attached = (await store.table('application_domains').all()).filter((l) => l.domain_id === domain.id);
    if (attached.length) {
      throw new ConflictError('Detach this domain from its application(s) before deleting it');
    }

    await domains().deleteById(domain.id);
    await audit(ctx, 'domain.deleted', domain.id, { domain: domain.domain });
    ctx.noContent();
  });
}

module.exports = { name, register, parseDomain };
