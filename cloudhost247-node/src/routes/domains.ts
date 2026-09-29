/**
 * Phase 6 — customer domain management API (spec §26, §15, §34): add a domain, prove control
 * via DNS TXT verification, request SSL, delete. Domains created here are the Phase 6
 * operational kind (created_by_user) on the same customer_domains table staff records live in.
 *
 * DNS verification is real but deliberately honest: when no DNS provider API is configured, the
 * TXT record is checked over standard DNS resolution (dns.resolveTxt) against the record the
 * customer was told to create — no provider integration is pretended to exist.
 */
import { randomUUID } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { authenticate } from '../lib/require-auth';
import { ValidationError, NotFoundError, ConflictError } from '../lib/errors';
import { auditRequest } from '../lib/audit';
import { generateSecret } from '../lib/crypto';
import {
  createCustomerDomain,
  findDomainById,
  listDomainsForUser,
  setDomainSslStatus,
  setDomainVerification,
} from '../db/customer-domains';
import { listInstallationsForCustomer } from '../db/application-installations';

const idSchema = z.string().uuid('id must be a valid UUID');
const domainNameSchema = z
  .string()
  .min(4)
  .max(253)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i, 'must be a valid domain name');

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
  }
  return parsed.data;
}

async function myDomainOrThrow(pool: Queryable, userId: string, domainId: string) {
  const domain = await findDomainById(pool, domainId);
  if (!domain || domain.user_id !== userId) {
    throw new NotFoundError('No domain was found with that id');
  }
  return domain;
}

export async function registerDomainRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  app.get('/api/v1/domains', async (request) => {
    const auth = await authenticate(request, env, pool);
    return { domains: await listDomainsForUser(pool, auth.userId) };
  });

  app.post('/api/v1/domains', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const input = parseOrThrow(
      z.object({
        domain: domainNameSchema,
        registrar: z.string().max(255).nullable().optional(),
      }),
      request.body
    );
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM customer_domains WHERE user_id = $1 AND lower(domain_name) = lower($2)`,
      [auth.userId, input.domain]
    );
    if (existing.rows[0]) {
      throw new ConflictError('That domain is already on your account');
    }
    const domain = await createCustomerDomain(pool, {
      id: randomUUID(),
      userId: auth.userId,
      domainName: input.domain.toLowerCase(),
      registrar: input.registrar ?? null,
      createdBy: auth.userId,
      createdByUser: true,
      domainType: 'custom',
      verificationToken: `cloudhost247-verify=${generateSecret(16)}`,
    });
    await auditRequest(pool, request, auth.userId, {
      action: 'domain.added',
      resourceType: 'customer_domain',
      resourceId: domain.id,
      metadata: { domain: domain.domain_name },
    });
    reply.code(201);
    return {
      domain,
      verification: {
        method: 'dns_txt',
        recordName: `_cloudhost247-verification.${domain.domain_name}`,
        recordValue: domain.verification_token,
        instructions: `Create a TXT record "${'_cloudhost247-verification.' + domain.domain_name}" with the value above, then call POST /api/v1/domains/${domain.id}/verify`,
      },
    };
  });

  app.get<{ Params: { id: string } }>('/api/v1/domains/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    const domain = await myDomainOrThrow(pool, auth.userId, id);
    const installations = await listInstallationsForCustomer(pool, auth.userId);
    return {
      domain,
      verification: {
        method: 'dns_txt',
        recordName: `_cloudhost247-verification.${domain.domain_name}`,
        recordValue: domain.verification_token,
      },
    };
  });

  app.post<{ Params: { id: string } }>('/api/v1/domains/:id/verify', async (request) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    const domain = await myDomainOrThrow(pool, auth.userId, id);
    if (domain.verification_status === 'verified') {
      return { domain, alreadyVerified: true };
    }

    // Real DNS TXT lookup: the customer must actually control the domain's DNS.
    let verified = false;
    let detail = '';
    try {
      const records = await resolveTxt(`_cloudhost247-verification.${domain.domain_name}`);
      const flattened = records.map((chunks) => chunks.join(''));
      verified = flattened.some((value) => value === domain.verification_token);
      detail = verified ? 'TXT record matched' : `TXT record found but value did not match (${flattened.length} record(s))`;
    } catch (err) {
      verified = false;
      detail = `DNS lookup failed: ${(err as Error).message}`;
    }

    const updated = await setDomainVerification(pool, id, verified ? 'verified' : 'failed');
    await auditRequest(pool, request, auth.userId, {
      action: verified ? 'domain.verified' : 'domain.verification_failed',
      resourceType: 'customer_domain',
      resourceId: id,
      metadata: { domain: domain.domain_name, detail },
    });
    return { domain: updated, verified, detail };
  });

  app.post<{ Params: { id: string } }>('/api/v1/domains/:id/ssl', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    const domain = await myDomainOrThrow(pool, auth.userId, id);
    if (domain.verification_status !== 'verified') {
      throw new ConflictError('Verify domain control before requesting an SSL certificate');
    }
    // Certificate issuance itself happens through the deployment pipeline (Traefik letsencrypt
    // resolver / cert-manager / AutoSSL) when the domain is attached to an installation; this
    // endpoint marks intent and is honest about it.
    const updated = await setDomainSslStatus(pool, id, 'pending');
    await auditRequest(pool, request, auth.userId, {
      action: 'domain.ssl_requested',
      resourceType: 'customer_domain',
      resourceId: id,
      metadata: { domain: domain.domain_name },
    });
    reply.code(202);
    return {
      domain: updated,
      note: 'Certificate provisioning runs when this domain is attached to an installation with SSL enabled',
    };
  });

  app.delete<{ Params: { id: string } }>('/api/v1/domains/:id', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    const domain = await myDomainOrThrow(pool, auth.userId, id);

    const attached = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM application_domains WHERE domain_id = $1`,
      [id]
    );
    if ((attached.rows[0]?.count ?? '0') !== '0') {
      throw new ConflictError('Detach this domain from its application(s) before deleting it');
    }
    await pool.query(`DELETE FROM customer_domains WHERE id = $1`, [id]);
    await auditRequest(pool, request, auth.userId, {
      action: 'domain.deleted',
      resourceType: 'customer_domain',
      resourceId: id,
      metadata: { domain: domain.domain_name },
    });
    reply.code(204);
    return null;
  });
}
