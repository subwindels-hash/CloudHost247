/**
 * SSL certificates.
 *
 * Ported from cloudhost247-node/src/routes/ssl.ts. Certificates are recorded with a lifecycle; the
 * actual ACME issuance is an integration concern (Let's Encrypt) that is deferred, so new
 * certificates start 'pending' and an operator/worker advances them. Expiry is computed from a
 * 90-day default, matching Let's Encrypt.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate } = require('../lib/auth');

const name = 'ssl';

function publicCert(row) {
  return {
    id: row.id,
    domain: row.domain,
    issuer: row.issuer,
    status: row.status,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    autoRenew: row.auto_renew,
  };
}

function register(router, deps) {
  const { store } = deps;

  router.get('/api/v1/ssl/certificates', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows, total } = await store.table('ssl_certificates').find({ user_id: auth.id }, { orderBy: '-created_at' });
    ctx.json({ certificates: rows.map(publicCert), total });
  });

  router.post('/api/v1/ssl/certificates', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({
      domain: v.string().trim().toLowerCase().min(4).max(253),
      autoRenew: v.boolean().default(true),
    }));

    const cert = await store.table('ssl_certificates').insert({
      id: uuidv7(),
      user_id: auth.id,
      domain: body.domain,
      status: 'pending',
      auto_renew: body.autoRenew,
    });
    ctx.code(201).json({ certificate: publicCert(cert) });
  });

  router.get('/api/v1/ssl/certificates/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const cert = await store.table('ssl_certificates').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!cert) throw new NotFoundError('Certificate not found');
    ctx.json({ certificate: publicCert(cert) });
  });

  router.delete('/api/v1/ssl/certificates/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const cert = await store.table('ssl_certificates').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!cert) throw new NotFoundError('Certificate not found');
    await store.table('ssl_certificates').deleteById(cert.id);
    ctx.json({ ok: true });
  });
}

module.exports = { name, register };
