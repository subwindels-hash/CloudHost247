import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { getPool } from '../db/pool';
import { authenticate } from '../lib/require-auth';
import { NotFoundError, ValidationError } from '../lib/errors';
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

      const certificate = await createSslCertificate(pool, {
        userId: auth.userId,
        domainName: input.domainName,
        sans: input.sans,
        issuer: input.issuer ?? 'LETS_ENCRYPT',
        challengeType: input.challengeType ?? 'HTTP_01',
        certificatePem: input.certificatePem,
        status: input.certificatePem ? 'ISSUED' : 'PENDING',
        expiresAt: input.certificatePem ? new Date(Date.now() + 90 * 86400 * 1000).toISOString() : null,
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

      // Update expiry and mark valid
      const newExpiry = new Date(Date.now() + 90 * 86400 * 1000).toISOString();
      await pool.query(
        `UPDATE ssl_certificates SET status = 'ISSUED', expires_at = $1, updated_at = now() WHERE id = $2`,
        [newExpiry, id]
      );
      const updated = await findSslCertificateById(pool, id);

      await auditRequest(pool, request, auth.userId, {
        action: 'SSL_CERTIFICATE_RENEWED',
        resourceType: 'ssl_certificate',
        resourceId: id,
        metadata: { domain: cert.domain_name, newExpiry },
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
