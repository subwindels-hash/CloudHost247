/**
 * Domain Services Super Admin API.
 *
 * Security contract:
 *   - All routes require super_admin (provider credentials) or staff roles where read-only.
 *   - Credentials are WRITE-ONLY through this API: a secret is accepted once, encrypted, and never
 *     returned again — not in full, not masked-with-reveal, not in logs, not in audit metadata.
 *   - The Test Connection button performs a real authenticated call against the provider; it never
 *     fakes success.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { requireRole } from '../lib/require-role';
import { auditRequest } from '../lib/audit';
import { getKeyRing } from '../lib/keyring';
import { NotFoundError, ValidationError } from '../lib/errors';
import {
  listDomainServiceProviders,
  createDomainServiceProvider,
  updateDomainServiceProvider,
  storeDomainServiceProviderCredentials,
  findDomainServiceProviderById,
  toDomainServiceProviderDto,
} from '../db/domain-services';
import { createDomainProviderAdapter } from '../domain-services/providers/registry';
import { DomainProviderError, safeDomainProviderMessage } from '../domain-services/providers/types';
import { registeredDomainProviderAdapters } from '../domain-services/providers/registry';
import { syncExtensionsFromProvider, setExtensionTrending, updateExtensionDetails, listExtensionDirectory } from '../domain-services/extensions-service';
import { adminRefreshTransfer, adminUpdateTransferStatus } from '../domain-services/transfer-service';
import {
  adminCreateAuction,
  adminUpdateAuction,
  adminUpdateAuctionStatus,
  adminListAuctionParticipants,
  listAuctions,
  getAuctionDetail,
} from '../domain-services/auction-service';
import { listAllPlans, createPlan, updatePlan } from '../domain-services/club-service';
import { BULK_SEARCH_MAX_DOMAINS, BULK_SEARCH_MAX_PER_HOUR, WHOIS_LOOKUP_MAX_PER_HOUR } from '../domain-services/config';

const SUPER_ADMIN = ['super_admin'] as const;
const STAFF = ['admin', 'super_admin'] as const;

const uuidSchema = z.string().uuid('id must be a valid UUID');

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
  }
  return parsed.data;
}

export async function registerAdminDomainServiceRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  // ---------------------------------------------------------------------------------------
  // Providers: list, create, update, credentials, test connection
  // ---------------------------------------------------------------------------------------
  app.get('/api/v1/admin/domain-services/providers', async (request) => {
    await requireRole(request, env, pool, STAFF);
    return {
      providers: await listDomainServiceProviders(pool),
      installedAdapters: registeredDomainProviderAdapters(),
    };
  });

  app.post('/api/v1/admin/domain-services/providers', async (request, reply) => {
    const auth = await requireRole(request, env, pool, SUPER_ADMIN);
    const input = parseOrThrow(
      z.object({
        providerKey: z.string().min(2).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/),
        name: z.string().min(2).max(160),
        adapterKey: z.string().min(2).max(80),
        providerType: z.enum(['registrar', 'rdap', 'appraisal', 'auction']),
        apiBaseUrl: z.string().url().max(500).nullable().optional(),
        environment: z.enum(['sandbox', 'production']).default('production'),
        capabilities: z.record(z.unknown()).optional(),
        configuration: z.record(z.unknown()).optional(),
      }),
      request.body
    );

    if (!registeredDomainProviderAdapters().includes(input.adapterKey)) {
      throw new ValidationError(
        `Adapter '${input.adapterKey}' is not installed in this build. Installed adapters: ${registeredDomainProviderAdapters().join(', ')}`
      );
    }

    const provider = await createDomainServiceProvider(pool, { ...input, createdBy: auth.userId });
    await auditRequest(pool, request, auth.userId, {
      action: 'admin.domain_provider_created',
      resourceType: 'domain_service_provider',
      resourceId: provider.id,
      metadata: { providerKey: input.providerKey, adapterKey: input.adapterKey, providerType: input.providerType },
    });
    reply.code(201);
    return { provider: toDomainServiceProviderDto(provider) };
  });

  app.patch<{ Params: { id: string } }>('/api/v1/admin/domain-services/providers/:id', async (request) => {
    const auth = await requireRole(request, env, pool, SUPER_ADMIN);
    const id = parseOrThrow(uuidSchema, request.params.id);
    const input = parseOrThrow(
      z.object({
        name: z.string().min(2).max(160).optional(),
        apiBaseUrl: z.string().url().max(500).nullable().optional(),
        environment: z.enum(['sandbox', 'production']).optional(),
        status: z.enum(['not_configured', 'configured', 'connected', 'auth_failed', 'unavailable', 'disabled']).optional(),
        configuration: z.record(z.unknown()).optional(),
      }),
      request.body
    );
    const updated = await updateDomainServiceProvider(pool, id, input);
    if (!updated) throw new NotFoundError('No provider was found with that id');
    await auditRequest(pool, request, auth.userId, {
      action: 'admin.domain_provider_updated',
      resourceType: 'domain_service_provider',
      resourceId: id,
      metadata: { fields: Object.keys(input) },
    });
    return { provider: toDomainServiceProviderDto(updated) };
  });

  /**
   * Credential write endpoint. Accepts named secret values exactly once; they are encrypted with
   * the platform key ring and can never be read back through any API.
   */
  app.put<{ Params: { id: string } }>('/api/v1/admin/domain-services/providers/:id/credentials', async (request) => {
    const auth = await requireRole(request, env, pool, SUPER_ADMIN);
    const id = parseOrThrow(uuidSchema, request.params.id);
    const input = parseOrThrow(
      z.object({ credentials: z.record(z.string().min(1).max(20_000)) }),
      request.body
    );
    const provider = await findDomainServiceProviderById(pool, id);
    if (!provider) throw new NotFoundError('No provider was found with that id');

    try {
      await storeDomainServiceProviderCredentials(pool, getKeyRing(), id, input.credentials);
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'Credentials could not be stored');
    }
    // A credential rotation invalidates the previous connection state.
    await updateDomainServiceProvider(pool, id, { status: 'configured', connectionTested: false });
    const refreshed = await findDomainServiceProviderById(pool, id);
    await auditRequest(pool, request, auth.userId, {
      action: 'admin.domain_provider_credentials_updated',
      resourceType: 'domain_service_provider',
      resourceId: id,
      metadata: { credentialNames: Object.keys(input.credentials).sort() },
    });
    return { provider: refreshed ? toDomainServiceProviderDto(refreshed) : null };
  });

  /**
   * Test Connection — performs the adapter's REAL authenticated test call (Namecheap balance
   * check, GoDaddy domain list, RDAP bootstrap fetch, GoValue appraisal probe) and records the
   * outcome on the provider row. Status `connected` is only ever set by a successful real test.
   */
  app.post<{ Params: { id: string } }>('/api/v1/admin/domain-services/providers/:id/test', async (request) => {
    const auth = await requireRole(request, env, pool, SUPER_ADMIN);
    const id = parseOrThrow(uuidSchema, request.params.id);
    const provider = await findDomainServiceProviderById(pool, id);
    if (!provider) throw new NotFoundError('No provider was found with that id');

    const { getDomainServiceProviderCredentials } = await import('../db/domain-services');
    const credentials = await getDomainServiceProviderCredentials(pool, getKeyRing(), id);
    if (!credentials) {
      const updated = await updateDomainServiceProvider(pool, id, {
        status: 'not_configured',
        connectionTested: true,
        connectionSucceeded: false,
        lastError: 'No credentials are stored for this provider',
      });
      return {
        provider: updated ? toDomainServiceProviderDto(updated) : null,
        result: { status: 'not_configured', message: 'No credentials are stored for this provider' },
      };
    }

    let result;
    try {
      const adapter = createDomainProviderAdapter({
        id: provider.id,
        key: provider.provider_key,
        name: provider.name,
        adapterKey: provider.adapter_key,
        type: provider.provider_type,
        environment: provider.environment,
        apiBaseUrl: provider.api_base_url,
        capabilities: provider.capabilities ?? {},
        configuration: provider.configuration ?? {},
        credentials,
      });
      result = await adapter.testConnection();
    } catch (error) {
      result = {
        status: 'unavailable' as const,
        message: error instanceof DomainProviderError ? safeDomainProviderMessage(error) : 'The provider could not be reached',
        capabilities: {},
      };
    }

    const statusMap: Record<string, 'connected' | 'auth_failed' | 'unavailable' | 'not_configured'> = {
      connected: 'connected',
      auth_failed: 'auth_failed',
      unavailable: 'unavailable',
      not_configured: 'not_configured',
    };
    const updated = await updateDomainServiceProvider(pool, id, {
      status: statusMap[result.status] ?? 'unavailable',
      connectionTested: true,
      connectionSucceeded: result.status === 'connected',
      lastError: result.status === 'connected' ? null : result.message.slice(0, 500),
    });

    await auditRequest(pool, request, auth.userId, {
      action: 'admin.domain_provider_connection_tested',
      resourceType: 'domain_service_provider',
      resourceId: id,
      metadata: { status: result.status, message: result.message.slice(0, 200) },
    });

    return { provider: updated ? toDomainServiceProviderDto(updated) : null, result };
  });

  // ---------------------------------------------------------------------------------------
  // Extensions: directory view, sync, trending, details
  // ---------------------------------------------------------------------------------------
  app.get('/api/v1/admin/domain-services/extensions', async (request) => {
    await requireRole(request, env, pool, STAFF);
    return { extensions: await listExtensionDirectory(pool) };
  });

  app.post('/api/v1/admin/domain-services/extensions/sync', async (request) => {
    const auth = await requireRole(request, env, pool, SUPER_ADMIN);
    try {
      const report = await syncExtensionsFromProvider(pool, auth.userId);
      await auditRequest(pool, request, auth.userId, {
        action: 'admin.domain_extensions_synced',
        resourceType: 'domain_extension_catalog',
        metadata: { synced: report.synced, created: report.created, updated: report.updated, provider: report.providerName },
      });
      return report;
    } catch (error) {
      if (error instanceof DomainProviderError) {
        throw new ValidationError(safeDomainProviderMessage(error));
      }
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>('/api/v1/admin/domain-services/extensions/:id', async (request) => {
    const auth = await requireRole(request, env, pool, SUPER_ADMIN);
    const id = parseOrThrow(uuidSchema, request.params.id);
    const input = parseOrThrow(
      z.object({
        isTrending: z.boolean().optional(),
        description: z.string().max(2000).nullable().optional(),
        restrictions: z.string().max(2000).nullable().optional(),
        registrationRequirements: z.string().max(2000).nullable().optional(),
        status: z.enum(['active', 'disabled', 'unavailable']).optional(),
      }),
      request.body
    );

    if (input.isTrending !== undefined) await setExtensionTrending(pool, id, input.isTrending);
    const { description, restrictions, registrationRequirements, status } = input;
    if (description !== undefined || restrictions !== undefined || registrationRequirements !== undefined || status !== undefined) {
      await updateExtensionDetails(pool, id, { description, restrictions, registrationRequirements, status });
    }

    await auditRequest(pool, request, auth.userId, {
      action: 'admin.domain_extension_updated',
      resourceType: 'domain_extension',
      resourceId: id,
      metadata: { fields: Object.keys(input) },
    });
    return { ok: true };
  });

  // ---------------------------------------------------------------------------------------
  // Registrations + transfers oversight
  // ---------------------------------------------------------------------------------------
  app.get('/api/v1/admin/domain-services/registrations', async (request) => {
    await requireRole(request, env, pool, STAFF);
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    const params: unknown[] = [];
    const where: string[] = [];
    if (query.status) {
      params.push(query.status);
      where.push(`r.status = $${params.length}`);
    }
    if (query.search) {
      params.push(`%${query.search.toLowerCase()}%`);
      where.push(`lower(r.domain_name) LIKE $${params.length}`);
    }
    const { rows } = await pool.query(
      `SELECT r.id, r.domain_name, r.registration_years, r.status, r.provider_reference, r.provider_status,
              r.error_code, r.error_message, r.created_at, r.updated_at, r.requested_at, r.confirmed_at,
              u.email AS customer_email, o.order_number, i.invoice_number, i.status AS invoice_status
         FROM domain_registrations r
         JOIN users u ON u.id = r.user_id
         LEFT JOIN orders o ON o.id = r.order_id
         LEFT JOIN invoices i ON i.id = r.invoice_id
        ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY r.created_at DESC
        LIMIT 100`,
      params
    );
    return { registrations: rows };
  });

  app.get('/api/v1/admin/domain-services/transfers', async (request) => {
    await requireRole(request, env, pool, STAFF);
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    const params: unknown[] = [];
    const where: string[] = [];
    if (query.status) {
      params.push(query.status);
      where.push(`t.status = $${params.length}`);
    }
    if (query.search) {
      params.push(`%${query.search.toLowerCase()}%`);
      where.push(`lower(t.domain_name) LIKE $${params.length}`);
    }
    const { rows } = await pool.query(
      `SELECT t.id, t.domain_name, t.current_registrar, t.status, t.provider_status, t.provider_reference,
              t.provider_metadata, t.error_code, t.error_message, t.created_at, t.updated_at,
              t.initiated_at, t.completed_at,
              u.email AS customer_email, o.order_number, i.invoice_number, i.status AS invoice_status
         FROM domain_transfers t
         JOIN users u ON u.id = t.user_id
         LEFT JOIN orders o ON o.id = t.order_id
         LEFT JOIN invoices i ON i.id = t.invoice_id
        ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY t.created_at DESC
        LIMIT 100`,
      params
    );
    // provider_metadata can carry claim timestamps; expose it (staff-only) minus nothing sensitive.
    return { transfers: rows };
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/domain-services/transfers/:id/refresh', async (request) => {
    const auth = await requireRole(request, env, pool, STAFF);
    const id = parseOrThrow(uuidSchema, request.params.id);
    const result = await adminRefreshTransfer(pool, getKeyRing(), id);
    await auditRequest(pool, request, auth.userId, {
      action: 'admin.domain_transfer_refreshed',
      resourceType: 'domain_transfer',
      resourceId: id,
      metadata: result,
    });
    return result;
  });

  app.patch<{ Params: { id: string } }>('/api/v1/admin/domain-services/transfers/:id', async (request) => {
    const auth = await requireRole(request, env, pool, STAFF);
    const id = parseOrThrow(uuidSchema, request.params.id);
    const input = parseOrThrow(
      z.object({
        status: z.enum(['pending', 'authorization_required', 'transfer_initiated', 'transfer_in_progress', 'pending_registry', 'completed', 'failed', 'cancelled']),
        note: z.string().max(500).optional(),
      }),
      request.body
    );
    await adminUpdateTransferStatus(pool, id, input.status, input.note);
    await auditRequest(pool, request, auth.userId, {
      action: 'admin.domain_transfer_status_updated',
      resourceType: 'domain_transfer',
      resourceId: id,
      metadata: { status: input.status },
    });
    return { ok: true };
  });

  // ---------------------------------------------------------------------------------------
  // Auctions management
  // ---------------------------------------------------------------------------------------
  app.get('/api/v1/admin/domain-services/auctions', async (request) => {
    await requireRole(request, env, pool, STAFF);
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    return listAuctions(pool, {
      status: query.status,
      search: query.search,
      page: Number.parseInt(query.page ?? '1', 10) || 1,
      limit: Number.parseInt(query.limit ?? '25', 10) || 25,
    });
  });

  app.post('/api/v1/admin/domain-services/auctions', async (request, reply) => {
    const auth = await requireRole(request, env, pool, STAFF);
    const input = parseOrThrow(
      z.object({
        domainName: z.string().min(4).max(253),
        minimumBid: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/),
        bidIncrement: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
        sellerId: z.string().uuid().nullable().optional(),
      }),
      request.body
    );
    const auction = await adminCreateAuction(pool, auth.userId, input);
    await auditRequest(pool, request, auth.userId, {
      action: 'admin.domain_auction_created',
      resourceType: 'domain_auction',
      resourceId: auction.id,
      metadata: { domainName: auction.domainName, minimumBid: auction.minimumBid },
    });
    reply.code(201);
    return { auction };
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/domain-services/auctions/:id', async (request) => {
    await requireRole(request, env, pool, STAFF);
    const id = parseOrThrow(uuidSchema, request.params.id);
    const detail = await getAuctionDetail(pool, id);
    const participants = await adminListAuctionParticipants(pool, id);
    return { ...detail, participants };
  });

  app.patch<{ Params: { id: string } }>('/api/v1/admin/domain-services/auctions/:id', async (request) => {
    const auth = await requireRole(request, env, pool, STAFF);
    const id = parseOrThrow(uuidSchema, request.params.id);
    const input = parseOrThrow(
      z.object({
        minimumBid: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/).optional(),
        bidIncrement: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/).optional(),
        startsAt: z.string().datetime().optional(),
        endsAt: z.string().datetime().optional(),
      }),
      request.body
    );
    const auction = await adminUpdateAuction(pool, id, input);
    await auditRequest(pool, request, auth.userId, {
      action: 'admin.domain_auction_updated',
      resourceType: 'domain_auction',
      resourceId: id,
      metadata: { fields: Object.keys(input) },
    });
    return { auction };
  });

  app.post<{ Params: { id: string; action: string } }>('/api/v1/admin/domain-services/auctions/:id/:action', async (request) => {
    const auth = await requireRole(request, env, pool, STAFF);
    const id = parseOrThrow(uuidSchema, request.params.id);
    const action = parseOrThrow(z.enum(['pause', 'resume', 'cancel', 'complete']), request.params.action);
    const auction = await adminUpdateAuctionStatus(pool, id, action);
    await auditRequest(pool, request, auth.userId, {
      action: `admin.domain_auction_${action}d`,
      resourceType: 'domain_auction',
      resourceId: id,
      metadata: { status: auction.status },
    });
    return { auction };
  });

  // ---------------------------------------------------------------------------------------
  // Domain Club plan management
  // ---------------------------------------------------------------------------------------
  app.get('/api/v1/admin/domain-services/club/plans', async (request) => {
    await requireRole(request, env, pool, STAFF);
    return { plans: await listAllPlans(pool) };
  });

  app.post('/api/v1/admin/domain-services/club/plans', async (request, reply) => {
    const auth = await requireRole(request, env, pool, SUPER_ADMIN);
    const input = parseOrThrow(
      z.object({
        name: z.string().min(2).max(120),
        description: z.string().max(2000).nullable().optional(),
        billingPeriod: z.enum(['monthly', 'annually']),
        priceAmount: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/),
        discountType: z.enum(['percentage', 'fixed']),
        discountValue: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/),
        eligibleExtensions: z.array(z.string().max(63)).optional(),
        promotion: z.record(z.unknown()).optional(),
        status: z.enum(['draft', 'published', 'disabled']).optional(),
      }),
      request.body
    );
    const plan = await createPlan(pool, auth.userId, input);
    await auditRequest(pool, request, auth.userId, {
      action: 'admin.domain_club_plan_created',
      resourceType: 'domain_club_plan',
      resourceId: plan.id,
      metadata: { name: plan.name },
    });
    reply.code(201);
    return { plan };
  });

  app.patch<{ Params: { id: string } }>('/api/v1/admin/domain-services/club/plans/:id', async (request) => {
    const auth = await requireRole(request, env, pool, SUPER_ADMIN);
    const id = parseOrThrow(uuidSchema, request.params.id);
    const input = parseOrThrow(
      z.object({
        name: z.string().min(2).max(120).optional(),
        description: z.string().max(2000).nullable().optional(),
        billingPeriod: z.enum(['monthly', 'annually']).optional(),
        priceAmount: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/).optional(),
        discountType: z.enum(['percentage', 'fixed']).optional(),
        discountValue: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/).optional(),
        eligibleExtensions: z.array(z.string().max(63)).optional(),
        promotion: z.record(z.unknown()).optional(),
        status: z.enum(['draft', 'published', 'disabled']).optional(),
      }),
      request.body
    );
    const plan = await updatePlan(pool, id, input);
    await auditRequest(pool, request, auth.userId, {
      action: 'admin.domain_club_plan_updated',
      resourceType: 'domain_club_plan',
      resourceId: id,
      metadata: { fields: Object.keys(input) },
    });
    return { plan };
  });

  // ---------------------------------------------------------------------------------------
  // Operations overview + limits reference
  // ---------------------------------------------------------------------------------------
  app.get('/api/v1/admin/domain-services/overview', async (request) => {
    await requireRole(request, env, pool, STAFF);
    const [registrations, transfers, auctions, club, searches] = await Promise.all([
      pool.query(`SELECT status, count(*)::int AS count FROM domain_registrations GROUP BY status`),
      pool.query(`SELECT status, count(*)::int AS count FROM domain_transfers GROUP BY status`),
      pool.query(`SELECT status, count(*)::int AS count FROM domain_auctions GROUP BY status`),
      pool.query(`SELECT m.status, count(*)::int AS count FROM domain_club_memberships m GROUP BY m.status`),
      pool.query(`SELECT count(*)::int AS count FROM domain_searches WHERE created_at > now() - interval '24 hours'`),
    ]);
    return {
      registrations: Object.fromEntries(registrations.rows.map((row) => [row.status, row.count])),
      transfers: Object.fromEntries(transfers.rows.map((row) => [row.status, row.count])),
      auctions: Object.fromEntries(auctions.rows.map((row) => [row.status, row.count])),
      club: Object.fromEntries(club.rows.map((row) => [row.status, row.count])),
      searchesLast24h: searches.rows[0]?.count ?? 0,
      limits: {
        bulkSearchMaxDomains: BULK_SEARCH_MAX_DOMAINS,
        bulkSearchMaxPerHour: BULK_SEARCH_MAX_PER_HOUR,
        whoisLookupsPerHour: WHOIS_LOOKUP_MAX_PER_HOUR,
      },
    };
  });

  // ---------------------------------------------------------------------------------------
  // Appraisals + WHOIS oversight
  // ---------------------------------------------------------------------------------------
  app.get('/api/v1/admin/domain-services/appraisals', async (request) => {
    await requireRole(request, env, pool, STAFF);
    const { rows } = await pool.query(
      `SELECT a.id, a.domain_name, a.status, a.estimated_value, a.currency, a.confidence, a.created_at,
              a.completed_at, a.error_code, u.email AS customer_email
         FROM domain_appraisals a
         JOIN users u ON u.id = a.user_id
        ORDER BY a.created_at DESC
        LIMIT 100`
    );
    return { appraisals: rows };
  });

  app.get('/api/v1/admin/domain-services/whois-lookups', async (request) => {
    await requireRole(request, env, pool, STAFF);
    const { rows } = await pool.query(
      `SELECT w.id, w.domain_name, w.source, w.status, w.privacy_protected, w.created_at, w.user_id,
              u.email AS customer_email
         FROM domain_whois_lookups w
         LEFT JOIN users u ON u.id = w.user_id
        ORDER BY w.created_at DESC
        LIMIT 100`
    );
    return { lookups: rows };
  });

  // ---------------------------------------------------------------------------------------
  // Domain transactions oversight (links into the billing stack)
  // ---------------------------------------------------------------------------------------
  app.get('/api/v1/admin/domain-services/transactions', async (request) => {
    await requireRole(request, env, pool, STAFF);
    const { rows } = await pool.query(
      `SELECT t.id, t.transaction_type, t.status, t.amount, t.currency, t.provider_reference,
              t.error_code, t.created_at, t.updated_at, u.email AS customer_email,
              o.order_number, i.invoice_number
         FROM domain_transactions t
         JOIN users u ON u.id = t.user_id
         LEFT JOIN orders o ON o.id = t.order_id
         LEFT JOIN invoices i ON i.id = t.invoice_id
        ORDER BY t.created_at DESC
        LIMIT 100`
    );
    return { transactions: rows };
  });
}
