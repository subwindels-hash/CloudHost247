import { X509Certificate } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { getPool } from '../db/pool';
import { authenticate } from '../lib/require-auth';
import { NotFoundError, ValidationError, ConflictError } from '../lib/errors';
import { auditRequest } from '../lib/audit';
import {
  listSslCertificatesForUser,
  findSslCertificateById,
  createSslCertificate,
  deleteSslCertificate,
} from '../db/ssl';

const idSchema = z.string().uuid();
const domainSchema = z
  .string()
  .min(3)
  .max(253)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i, 'Invalid domain name');

const createSslSchema = z.object({
  domainName: domainSchema,
  sans: z.array(domainSchema).optional(),
  issuer: z.enum(['LETS_ENCRYPT', 'ZERO_SSL', 'CUSTOM', 'SELF_SIGNED']).optional(),
  challengeType: z.enum(['HTTP_01', 'DNS_01', 'MANUAL']).optional(),
  certificatePem: z.string().optional(),
  autoRenew: z.boolean().optional(),
  serverId: z.string().uuid().optional(),
  domainId: z.string().uuid().optional(),
});

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError(result.error.issues.map((i) => i.message).join(', '));
  return result.data;
}

export async function registerSslRoutes(
  app: FastifyInstance,
  env: Env,
  overridePool?: Queryable
) {
  const pool = overridePool ?? getPool(env);

  const registerHandlers = (prefix: string) => {
    app.get(`${prefix}/ssl/certificates`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const certificates = await listSslCertificatesForUser(pool, auth.userId);
      return { certificates };
    });

    app.post(`${prefix}/ssl/certificates`, async (request, reply) => {
      const auth = await authenticate(request, env, pool);
      const input = parseOrThrow(createSslSchema, request.body);

      // Phase 8 honesty fix (F8-SSL-1): a pasted certificate is REAL material — parse it with the
      // platform X.509 parser so a malformed blob fails validation, and take the expiry from the
      // certificate itself instead of fabricating +90 days. A pasted cert is also provenance-CUSTOM
      // (it came from the customer, not from the default issuer) unless explicitly stated otherwise.
      let parsedExpiry: string | null = null;
      if (input.certificatePem) {
        try {
          const x509 = new X509Certificate(input.certificatePem);
          parsedExpiry = new Date(x509.validTo).toISOString();
        } catch {
          throw new ValidationError('certificatePem is not a parseable PEM-encoded X.509 certificate');
        }
      }

      const certificate = await createSslCertificate(pool, {
        userId: auth.userId,
        domainName: input.domainName,
        sans: input.sans,
        issuer: input.issuer ?? (input.certificatePem ? 'CUSTOM' : 'LETS_ENCRYPT'),
        challengeType: input.challengeType ?? 'HTTP_01',
        certificatePem: input.certificatePem,
        status: input.certificatePem ? 'ISSUED' : 'PENDING',
        expiresAt: parsedExpiry,
        autoRenew: input.autoRenew ?? true,
        serverId: input.serverId,
        domainId: input.domainId,
      });

      await auditRequest(pool, request, auth.userId, {
        action: 'SSL_CERTIFICATE_REQUESTED',
        resourceType: 'ssl_certificate',
        resourceId: certificate.id,
        metadata: { domain: certificate.domain_name, issuer: certificate.issuer },
      });

      reply.code(201);
      return { certificate };
    });

    app.get<{ Params: { id: string } }>(`${prefix}/ssl/certificates/:id`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const id = parseOrThrow(idSchema, request.params.id);
      const cert = await findSslCertificateById(pool, id);
      if (!cert || cert.user_id !== auth.userId) throw new NotFoundError('Certificate not found');
      return { certificate: cert };
    });

    app.post<{ Params: { id: string } }>(`${prefix}/ssl/certificates/:id/renew`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const id = parseOrThrow(idSchema, request.params.id);
      const cert = await findSslCertificateById(pool, id);
      if (!cert || cert.user_id !== auth.userId) throw new NotFoundError('Certificate not found');

      // Phase 8 honesty fix (F8-SSL-1): renewal cannot be FABRICATED. There is no CA/ACME
      // adapter wired yet, so this endpoint may only REQUEST a renewal — the truthful state is
      // VALIDATING (re-validation is now due), never ISSUED with a synthetic +90-day expiry.
      // An actual issuance job (once a CA adapter exists) moves the row PENDING→VALIDATING→ISSUED
      // with the certificate's own notAfter.
      if (!cert.certificate_pem || (cert.status !== 'ISSUED' && cert.status !== 'EXPIRED')) {
        throw new ConflictError('Only a certificate with issued material can be renewed; request issuance first');
      }
      await pool.query(
        `UPDATE ssl_certificates SET status = 'VALIDATING', updated_at = now() WHERE id = $1`,
        [id]
      );
      const updated = await findSslCertificateById(pool, id);

      await auditRequest(pool, request, auth.userId, {
        action: 'SSL_CERTIFICATE_RENEWAL_REQUESTED',
        resourceType: 'ssl_certificate',
        resourceId: id,
        metadata: { domain: cert.domain_name, expiresAt: cert.expires_at, note: 'CA/ACME adapter not yet connected; renewal marked VALIDATING until issuance completes' },
      });

      return { certificate: updated };
    });

    app.post<{ Params: { id: string } }>(`${prefix}/ssl/certificates/:id/revoke`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const id = parseOrThrow(idSchema, request.params.id);
      const cert = await findSslCertificateById(pool, id);
      if (!cert || cert.user_id !== auth.userId) throw new NotFoundError('Certificate not found');

      await pool.query(
        `UPDATE ssl_certificates SET status = 'REVOKED', updated_at = now() WHERE id = $1`,
        [id]
      );
      const updated = await findSslCertificateById(pool, id);

      await auditRequest(pool, request, auth.userId, {
        action: 'SSL_CERTIFICATE_REVOKED',
        resourceType: 'ssl_certificate',
        resourceId: id,
        metadata: { domain: cert.domain_name },
      });

      return { certificate: updated };
    });

    app.delete<{ Params: { id: string } }>(`${prefix}/ssl/certificates/:id`, async (request, reply) => {
      const auth = await authenticate(request, env, pool);
      const id = parseOrThrow(idSchema, request.params.id);
      const cert = await findSslCertificateById(pool, id);
      if (!cert || cert.user_id !== auth.userId) throw new NotFoundError('Certificate not found');

      await deleteSslCertificate(pool, id);
      await auditRequest(pool, request, auth.userId, {
        action: 'SSL_CERTIFICATE_DELETED',
        resourceType: 'ssl_certificate',
        resourceId: id,
        metadata: { domain: cert.domain_name },
      });

      reply.code(204);
      return null;
    });
  };

  registerHandlers('/api/v1');
  registerHandlers('/api');
}
