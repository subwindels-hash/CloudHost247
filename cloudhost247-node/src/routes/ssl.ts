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
import {
  SSL_ISSUANCE_NOT_CONFIGURED,
  orderedDnsNames,
  revokeAtCa,
  startOrResumeIssuance,
} from '../ssl/ssl-issuance-service';
import { AcmeError } from '../ssl/acme-client';
import { daysUntilExpiry, isCurrentlyValid } from '../ssl/certificate';

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

      // Status is reported from the certificate itself where one exists. `daysRemaining` and
      // `currentlyValid` are derived from its own validity window, never from `status` alone.
      const metadata = (cert.metadata ?? {}) as { validFrom?: string; issuanceError?: string };
      const currentlyValid =
        metadata.validFrom && cert.expires_at
          ? isCurrentlyValid(metadata.validFrom, cert.expires_at)
          : null;

      return {
        certificate: {
          ...cert,
          daysRemaining: daysUntilExpiry(cert.expires_at),
          currentlyValid,
          issuanceError: metadata.issuanceError ?? null,
          orderedNames: orderedDnsNames(cert),
        },
      };
    });

    /**
     * Starts — or resumes — real certificate issuance against the configured ACME CA.
     *
     * Idempotent by design: the first call creates an order and returns the challenges that must
     * be satisfied; calling it again after they are satisfied finalizes and stores the certificate.
     * With no CA configured this answers 503 and touches nothing, which is the honest answer for a
     * deployment that has not chosen a CA yet.
     */
    app.post<{ Params: { id: string } }>(`${prefix}/ssl/certificates/:id/issue`, async (request, reply) => {
      const auth = await authenticate(request, env, pool);
      const id = parseOrThrow(idSchema, request.params.id);
      const cert = await findSslCertificateById(pool, id);
      if (!cert || cert.user_id !== auth.userId) throw new NotFoundError('Certificate not found');

      if (cert.status === 'REVOKED') {
        throw new ConflictError('A revoked certificate cannot be re-issued; request a new certificate');
      }
      if (cert.certificate_pem && cert.status === 'ISSUED') {
        throw new ConflictError('This certificate is already issued; use renew to replace it');
      }
      // A pasted CUSTOM certificate is already real material — issuing would overwrite it.
      if (cert.issuer === 'CUSTOM' && cert.certificate_pem) {
        throw new ConflictError('This certificate was uploaded, not requested from a CA; there is nothing to issue');
      }

      try {
        const result = await startOrResumeIssuance({ env, pool }, cert);

        await auditRequest(pool, request, auth.userId, {
          action: 'SSL_CERTIFICATE_ISSUANCE_ATTEMPTED',
          resourceType: 'ssl_certificate',
          resourceId: cert.id,
          metadata: {
            domain: cert.domain_name,
            names: orderedDnsNames(cert),
            outcome: result.status,
            ...(result.failureReason ? { failure: result.failureReason } : {}),
          },
        });

        reply.code(result.status === 'ISSUED' ? 200 : 202);
        return {
          status: result.status,
          certificate: await findSslCertificateById(pool, cert.id),
          // What the caller must do next, verbatim, when the CA is waiting on them.
          challenges: result.pendingChallenges,
          failureReason: result.failureReason,
        };
      } catch (err) {
        if (err instanceof Error && (err as { code?: string }).code === SSL_ISSUANCE_NOT_CONFIGURED) {
          reply.code(503);
          return { error: SSL_ISSUANCE_NOT_CONFIGURED, message: err.message, configurationRequired: true };
        }
        if (err instanceof AcmeError) {
          reply.code(err.status && err.status >= 400 && err.status < 500 ? 502 : 502);
          return { error: err.code, message: err.message, retryable: err.retryable };
        }
        throw err;
      }
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

      // Renewal is a fresh issuance, not a status change. The previous certificate stays valid and
      // readable until the CA issues its replacement, so a failed renewal never leaves the customer
      // without a working certificate.
      if (env.ACME_DIRECTORY_URL) {
        // Clear the challenge rows from the previous issuance so the new order gets fresh tokens.
        await pool.query('DELETE FROM acme_challenges WHERE certificate_id = $1', [id]);
        const renewalTarget = { ...cert, certificate_pem: null };
        const result = await startOrResumeIssuance({ env, pool }, renewalTarget);

        await auditRequest(pool, request, auth.userId, {
          action: 'SSL_CERTIFICATE_RENEWAL_REQUESTED',
          resourceType: 'ssl_certificate',
          resourceId: id,
          metadata: {
            domain: cert.domain_name,
            previousExpiresAt: cert.expires_at,
            outcome: result.status,
            ...(result.failureReason ? { failure: result.failureReason } : {}),
          },
        });

        return {
          certificate: await findSslCertificateById(pool, id),
          status: result.status,
          challenges: result.pendingChallenges,
          failureReason: result.failureReason,
        };
      }

      // No CA configured. Renewal cannot be FABRICATED: the truthful state is VALIDATING (a renewal
      // is outstanding), never ISSUED with a synthetic expiry. This branch exists so a deployment
      // without a CA still records the request instead of silently doing nothing.
      await pool.query(
        `UPDATE ssl_certificates SET status = 'VALIDATING', updated_at = now() WHERE id = $1`,
        [id]
      );
      const updated = await findSslCertificateById(pool, id);

      await auditRequest(pool, request, auth.userId, {
        action: 'SSL_CERTIFICATE_RENEWAL_REQUESTED',
        resourceType: 'ssl_certificate',
        resourceId: id,
        metadata: {
          domain: cert.domain_name,
          expiresAt: cert.expires_at,
          note: SSL_ISSUANCE_NOT_CONFIGURED,
        },
      });

      return {
        certificate: updated,
        status: 'VALIDATING',
        challenges: [],
        failureReason: null,
      };
    });

    app.post<{ Params: { id: string } }>(`${prefix}/ssl/certificates/:id/revoke`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const id = parseOrThrow(idSchema, request.params.id);
      const cert = await findSslCertificateById(pool, id);
      if (!cert || cert.user_id !== auth.userId) throw new NotFoundError('Certificate not found');

      // Revocation is two facts, not one: the CA stopped trusting it, and this platform recorded
      // that. The row is marked REVOKED either way, but the response reports whether the CA was
      // actually contacted — a local-only revocation of a publicly trusted certificate would leave
      // the certificate valid in the outside world, and claiming otherwise would be a lie.
      const ca = await revokeAtCa({ env, pool }, cert);

      await pool.query(
        `UPDATE ssl_certificates
            SET status = 'REVOKED',
                metadata = COALESCE(metadata,'{}'::jsonb) || $2::jsonb,
                updated_at = now()
          WHERE id = $1`,
        [
          id,
          JSON.stringify({
            revokedAt: new Date().toISOString(),
            revokedAtCa: ca.revokedAtCa,
            ...(ca.reason ? { revocationNote: ca.reason } : {}),
          }),
        ]
      );
      const updated = await findSslCertificateById(pool, id);

      await auditRequest(pool, request, auth.userId, {
        action: 'SSL_CERTIFICATE_REVOKED',
        resourceType: 'ssl_certificate',
        resourceId: id,
        metadata: { domain: cert.domain_name, revokedAtCa: ca.revokedAtCa, reason: ca.reason },
      });

      return {
        certificate: updated,
        revokedAtCa: ca.revokedAtCa,
        // Plainly states what the customer should do when the CA was not contacted.
        message: ca.revokedAtCa
          ? 'The certificate was revoked at the certificate authority and recorded here.'
          : `Recorded as revoked here, but the certificate authority was not contacted${ca.reason ? ` (${ca.reason})` : ''}. The certificate may still be trusted outside this platform.`,
      };
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
