/**
 * SSL certificates.
 *
 * Ported from cloudhost247-node/src/routes/ssl.ts, which mounts every handler under both '/api/v1'
 * and the legacy '/api' prefix.
 *
 * Responses return the stored rows verbatim, as the original does — no camelCase DTO. Actual ACME
 * issuance is an integration concern that is deferred: supplying a certificatePem records the
 * certificate as ISSUED with a 90-day expiry (Let's Encrypt's lifetime), otherwise it starts
 * PENDING for an operator or worker to advance.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate } = require('../lib/auth');

const name = 'ssl';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A dotted hostname: at least two labels, each starting/ending alphanumeric.
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const ISSUERS = ['LETS_ENCRYPT', 'ZERO_SSL', 'CUSTOM', 'SELF_SIGNED'];
const CHALLENGE_TYPES = ['HTTP_01', 'DNS_01', 'MANUAL'];
const NINETY_DAYS_MS = 90 * 86400 * 1000;

const domainSchema = v.string().min(3).max(253).regex(DOMAIN_RE, 'Invalid domain name');

const createSslSchema = v.object({
  domainName: domainSchema,
  sans: v.array(domainSchema).optional(),
  issuer: v.enum(ISSUERS).optional(),
  challengeType: v.enum(CHALLENGE_TYPES).optional(),
  certificatePem: v.string().optional(),
  autoRenew: v.boolean().optional(),
  serverId: v.string().regex(UUID_RE, 'serverId must be a valid UUID').optional(),
  domainId: v.string().regex(UUID_RE, 'domainId must be a valid UUID').optional(),
});

function register(router, deps) {
  const { store } = deps;

  const certs = () => store.table('ssl_certificates');

  async function audit(ctx, action, certId, metadata) {
    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: ctx.user.id, actor_role: ctx.user.role, action,
      entity_type: 'ssl_certificate', entity_id: certId ?? null,
      ip_address: ctx.ip, user_agent: ctx.userAgent, after: metadata ?? null,
    });
  }

  function requireUuid(raw) {
    if (!UUID_RE.test(String(raw ?? ''))) throw new ValidationError('Invalid certificate identifier');
    return String(raw);
  }

  /** Fetch a certificate the caller owns, or 404 — the original never reveals other users' certs. */
  async function ownedOr404(ctx) {
    const auth = await authenticate(ctx, deps);
    const id = requireUuid(ctx.params.id);
    const cert = await certs().findById(id);
    if (!cert || cert.user_id !== auth.id) throw new NotFoundError('Certificate not found');
    return { auth, cert };
  }

  const listCertificates = async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows } = await certs().find({ user_id: auth.id }, { orderBy: '-created_at' });
    ctx.json({ certificates: rows });
  };

  const createCertificate = async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const input = await ctx.validate(createSslSchema);

    const issued = Boolean(input.certificatePem);
    const certificate = await certs().insert({
      id: uuidv7(),
      user_id: auth.id,
      server_id: input.serverId ?? null,
      domain_id: input.domainId ?? null,
      domain_name: input.domainName,
      sans: input.sans ?? [],
      issuer: input.issuer ?? 'LETS_ENCRYPT',
      certificate_pem: input.certificatePem ?? null,
      status: issued ? 'ISSUED' : 'PENDING',
      challenge_type: input.challengeType ?? 'HTTP_01',
      expires_at: issued ? new Date(Date.now() + NINETY_DAYS_MS).toISOString() : null,
      auto_renew: input.autoRenew ?? true,
    });

    await audit(ctx, 'SSL_CERTIFICATE_REQUESTED', certificate.id, {
      domain: certificate.domain_name, issuer: certificate.issuer,
    });
    ctx.code(201).json({ certificate });
  };

  const getCertificate = async (ctx) => {
    const { cert } = await ownedOr404(ctx);
    ctx.json({ certificate: cert });
  };

  const renewCertificate = async (ctx) => {
    const { cert } = await ownedOr404(ctx);

    // The original simply stamps a fresh 90-day expiry and marks the certificate valid; the ACME
    // round-trip itself is the deferred integration.
    const newExpiry = new Date(Date.now() + NINETY_DAYS_MS).toISOString();
    const updated = await certs().updateById(cert.id, {
      status: 'ISSUED', expires_at: newExpiry, updated_at: new Date().toISOString(),
    });

    await audit(ctx, 'SSL_CERTIFICATE_RENEWED', cert.id, { domain: cert.domain_name, newExpiry });
    ctx.json({ certificate: updated });
  };

  const revokeCertificate = async (ctx) => {
    const { cert } = await ownedOr404(ctx);
    const updated = await certs().updateById(cert.id, {
      status: 'REVOKED', updated_at: new Date().toISOString(),
    });

    await audit(ctx, 'SSL_CERTIFICATE_REVOKED', cert.id, { domain: cert.domain_name });
    ctx.json({ certificate: updated });
  };

  const deleteCertificate = async (ctx) => {
    const { cert } = await ownedOr404(ctx);
    await certs().deleteById(cert.id);
    await audit(ctx, 'SSL_CERTIFICATE_DELETED', cert.id, { domain: cert.domain_name });
    ctx.noContent();
  };

  const registerHandlers = (prefix) => {
    router.get(`${prefix}/ssl/certificates`, listCertificates);
    router.post(`${prefix}/ssl/certificates`, createCertificate);
    router.get(`${prefix}/ssl/certificates/:id`, getCertificate);
    router.post(`${prefix}/ssl/certificates/:id/renew`, renewCertificate);
    router.post(`${prefix}/ssl/certificates/:id/revoke`, revokeCertificate);
    router.delete(`${prefix}/ssl/certificates/:id`, deleteCertificate);
  };

  registerHandlers('/api/v1');
  registerHandlers('/api');
}

module.exports = { name, register };
