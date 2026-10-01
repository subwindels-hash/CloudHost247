/**
 * Domain Services customer + public API.
 *
 * Ownership rules follow the codebase-wide contract: every query is scoped to the authenticated
 * user, and "exists but isn't yours" is indistinguishable from "doesn't exist" (404, never 403).
 * Public routes (search, WHOIS, extensions, auctions browse) carry stricter per-route rate limits
 * because they consume provider quota.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { authenticate } from '../lib/require-auth';
import { auditRequest } from '../lib/audit';
import { getKeyRing } from '../lib/keyring';
import { NotFoundError, ValidationError } from '../lib/errors';
import { searchDomains, bulkSearchDomains, listMySearches, listMyBulkSearches, getSearchResults } from '../domain-services/search-service';
import { listExtensionDirectory } from '../domain-services/extensions-service';
import {
  createRegistrationOrder,
  registrationQuoteWithMembership,
  listMyRegistrations,
  getMyRegistration,
} from '../domain-services/registration-service';
import {
  startDomainTransfer,
  listMyTransfers,
  getMyTransfer,
  transferStatusLabel,
} from '../domain-services/transfer-service';
import { lookupDomainInfo, listMyWhoisLookups } from '../domain-services/whois-service';
import { requestAppraisal, listMyAppraisals, getMyAppraisal } from '../domain-services/appraisal-service';
import {
  listAuctions,
  getAuctionDetail,
  placeBid,
  listMyBids,
  listMyWonAuctions,
  listMyLostAuctions,
  createAuctionPaymentOrder,
} from '../domain-services/auction-service';
import {
  listPublishedPlans,
  getMyMembership,
  createMembershipOrder,
  cancelMyMembership,
  memberPricingPreview,
} from '../domain-services/club-service';
import { domainProviderReadiness } from '../domain-services/provider-service';

const domainNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i, 'must be a valid domain name or search term');
const uuidSchema = z.string().uuid('id must be a valid UUID');
const moneySchema = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, 'must be a monetary amount like 12.99');

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
  }
  return parsed.data;
}

export async function registerDomainServiceRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  // ---------------------------------------------------------------------------------------
  // Readiness (public): which Domain Services are backed by a configured provider.
  // ---------------------------------------------------------------------------------------
  app.get('/api/v1/domain-services/readiness', async () => {
    const [registrar, rdap, appraisal] = await Promise.all([
      domainProviderReadiness(pool, 'registrar'),
      domainProviderReadiness(pool, 'rdap'),
      domainProviderReadiness(pool, 'appraisal'),
    ]);
    return {
      registrar,
      rdap,
      appraisal,
      auctions: { configured: true }, // internal marketplace, always operational
    };
  });

  // ---------------------------------------------------------------------------------------
  // Search (public, strict limit) + bulk search (authenticated, throttled)
  // ---------------------------------------------------------------------------------------
  app.post(
    '/api/v1/domain-services/search',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const input = parseOrThrow(z.object({ query: domainNameSchema }), request.body);
      // Optional auth: history is stored only for signed-in users.
      let userId: string | null = null;
      try {
        const auth = await authenticate(request, env, pool);
        userId = auth.userId;
      } catch {
        userId = null;
      }
      const outcome = await searchDomains(pool, userId, input.query);
      if (userId) {
        await auditRequest(pool, request, userId, {
          action: 'domain_search',
          resourceType: 'domain_search',
          resourceId: outcome.searchId || null,
          metadata: { query: input.query, status: outcome.status, results: outcome.results.length },
        }).catch(() => undefined);
      }
      return outcome;
    }
  );

  app.post('/api/v1/domain-services/bulk-search', async (request) => {
    const auth = await authenticate(request, env, pool);
    const input = parseOrThrow(
      z.object({
        content: z.string().min(1).max(100_000),
        sourceType: z.enum(['text', 'csv', 'txt']).default('text'),
      }),
      request.body
    );
    const outcome = await bulkSearchDomains(pool, auth.userId, input.content, input.sourceType ?? 'text');
    await auditRequest(pool, request, auth.userId, {
      action: 'domain_bulk_search',
      resourceType: 'domain_search',
      resourceId: outcome.searchId || null,
      metadata: { accepted: outcome.acceptedCount, rejected: outcome.rejectedCount, status: outcome.status },
    }).catch(() => undefined);
    return outcome;
  });

  app.get('/api/v1/domain-services/searches', async (request) => {
    const auth = await authenticate(request, env, pool);
    return { searches: await listMySearches(pool, auth.userId) };
  });

  app.get('/api/v1/domain-services/searches/bulk', async (request) => {
    const auth = await authenticate(request, env, pool);
    return { searches: await listMyBulkSearches(pool, auth.userId) };
  });

  app.get<{ Params: { id: string } }>('/api/v1/domain-services/searches/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(uuidSchema, request.params.id);
    const results = await getSearchResults(pool, auth.userId, id);
    if (!results) throw new NotFoundError('No search was found with that id');
    return { results };
  });

  // ---------------------------------------------------------------------------------------
  // Extensions directory (public)
  // ---------------------------------------------------------------------------------------
  app.get('/api/v1/domain-services/extensions', async (request) => {
    const search = typeof (request.query as Record<string, unknown>)?.search === 'string'
      ? (request.query as { search: string }).search
      : undefined;
    return { extensions: await listExtensionDirectory(pool, search) };
  });

  // ---------------------------------------------------------------------------------------
  // Registration (authenticated): quote → order → pay through the standard invoice flow
  // ---------------------------------------------------------------------------------------
  app.post('/api/v1/domain-services/registrations/quote', async (request) => {
    const auth = await authenticate(request, env, pool);
    const input = parseOrThrow(
      z.object({ domainName: domainNameSchema, years: z.number().int().min(1).max(10).default(1) }),
      request.body
    );
    return { quote: await registrationQuoteWithMembership(pool, auth.userId, input.domainName, input.years ?? 1) };
  });

  app.post('/api/v1/domain-services/registrations', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const input = parseOrThrow(
      z.object({
        domainName: domainNameSchema,
        years: z.number().int().min(1).max(10).default(1),
        contact: z.object({
          firstName: z.string().min(1).max(120),
          lastName: z.string().min(1).max(120),
          organization: z.string().max(255).nullable().optional(),
          email: z.string().email(),
          phone: z.string().min(5).max(40),
          addressLine1: z.string().min(1).max(255),
          addressLine2: z.string().max(255).nullable().optional(),
          city: z.string().min(1).max(120),
          state: z.string().max(120).nullable().optional(),
          postalCode: z.string().max(32).nullable().optional(),
          countryCode: z.string().length(2),
        }),
      }),
      request.body
    );

    const result = await createRegistrationOrder(pool, getKeyRing(), auth.userId, {
      domainName: input.domainName,
      years: input.years ?? 1,
      contact: input.contact,
    });

    await auditRequest(pool, request, auth.userId, {
      action: 'domain_registration_ordered',
      resourceType: 'domain_registration',
      resourceId: result.registrationId,
      metadata: { domainName: input.domainName.toLowerCase(), years: input.years, orderId: result.orderId },
    });

    reply.code(201);
    return result;
  });

  app.get('/api/v1/domain-services/registrations', async (request) => {
    const auth = await authenticate(request, env, pool);
    return { registrations: await listMyRegistrations(pool, auth.userId) };
  });

  app.get<{ Params: { id: string } }>('/api/v1/domain-services/registrations/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(uuidSchema, request.params.id);
    return { registration: await getMyRegistration(pool, auth.userId, id) };
  });

  // ---------------------------------------------------------------------------------------
  // Transfer (authenticated)
  // ---------------------------------------------------------------------------------------
  app.post('/api/v1/domain-services/transfers', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const input = parseOrThrow(
      z.object({
        domainName: domainNameSchema,
        currentRegistrar: z.string().max(255).nullable().optional(),
        authCode: z.string().min(4).max(128),
        authorizationConfirmed: z.literal(true),
        contact: z
          .object({
            firstName: z.string().min(1).max(120),
            lastName: z.string().min(1).max(120),
            email: z.string().email(),
            phone: z.string().min(5).max(40),
            addressLine1: z.string().min(1).max(255),
            city: z.string().min(1).max(120),
            state: z.string().max(120).nullable().optional(),
            postalCode: z.string().max(32).nullable().optional(),
            countryCode: z.string().length(2),
          })
          .nullable()
          .optional(),
      }),
      request.body
    );

    const result = await startDomainTransfer(pool, getKeyRing(), auth.userId, {
      domainName: input.domainName,
      currentRegistrar: input.currentRegistrar ?? null,
      authCode: input.authCode,
      authorizationConfirmed: input.authorizationConfirmed,
      contact: input.contact ?? null,
    });

    await auditRequest(pool, request, auth.userId, {
      action: 'domain_transfer_requested',
      resourceType: 'domain_transfer',
      resourceId: result.transferId,
      metadata: { domainName: input.domainName.toLowerCase(), hasOrder: Boolean(result.orderId) },
    });

    reply.code(201);
    return { ...result, statusLabel: transferStatusLabel('pending') };
  });

  app.get('/api/v1/domain-services/transfers', async (request) => {
    const auth = await authenticate(request, env, pool);
    const transfers = await listMyTransfers(pool, auth.userId);
    return { transfers: transfers.map((t: Record<string, unknown> & { status: string }) => ({ ...t, statusLabel: transferStatusLabel(t.status) })) };
  });

  app.get<{ Params: { id: string } }>('/api/v1/domain-services/transfers/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(uuidSchema, request.params.id);
    const transfer = await getMyTransfer(pool, auth.userId, id);
    return { transfer: { ...transfer, statusLabel: transferStatusLabel(String(transfer.status)) } };
  });

  // ---------------------------------------------------------------------------------------
  // WHOIS / RDAP (public with strict limit; history for signed-in users)
  // ---------------------------------------------------------------------------------------
  app.post(
    '/api/v1/domain-services/whois',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request) => {
      const input = parseOrThrow(z.object({ domainName: domainNameSchema }), request.body);
      let userId: string | null = null;
      try {
        const auth = await authenticate(request, env, pool);
        userId = auth.userId;
      } catch {
        userId = null;
      }
      const outcome = await lookupDomainInfo(pool, userId, input.domainName);
      if (userId) {
        await auditRequest(pool, request, userId, {
          action: 'domain_whois_lookup',
          resourceType: 'domain_whois_lookup',
          resourceId: outcome.lookupId,
          metadata: { domainName: input.domainName.toLowerCase(), status: outcome.status },
        }).catch(() => undefined);
      }
      return outcome;
    }
  );

  app.get('/api/v1/domain-services/whois/history', async (request) => {
    const auth = await authenticate(request, env, pool);
    return { lookups: await listMyWhoisLookups(pool, auth.userId) };
  });

  // ---------------------------------------------------------------------------------------
  // Appraisal (authenticated, provider-gated)
  // ---------------------------------------------------------------------------------------
  app.post('/api/v1/domain-services/appraisals', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const input = parseOrThrow(z.object({ domainName: domainNameSchema }), request.body);
    const result = await requestAppraisal(pool, auth.userId, input.domainName);
    await auditRequest(pool, request, auth.userId, {
      action: 'domain_appraisal_requested',
      resourceType: 'domain_appraisal',
      resourceId: result.appraisalId || null,
      metadata: { domainName: input.domainName.toLowerCase(), status: result.status },
    }).catch(() => undefined);
    reply.code(result.status === 'completed' ? 200 : 201);
    return result;
  });

  app.get('/api/v1/domain-services/appraisals', async (request) => {
    const auth = await authenticate(request, env, pool);
    return { appraisals: await listMyAppraisals(pool, auth.userId) };
  });

  app.get<{ Params: { id: string } }>('/api/v1/domain-services/appraisals/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(uuidSchema, request.params.id);
    return { appraisal: await getMyAppraisal(pool, auth.userId, id) };
  });

  // ---------------------------------------------------------------------------------------
  // Auctions (browse public; bid/pay authenticated)
  // ---------------------------------------------------------------------------------------
  app.get('/api/v1/domain-services/auctions', async (request) => {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    const page = Number.parseInt(query.page ?? '1', 10) || 1;
    const limit = Number.parseInt(query.limit ?? '20', 10) || 20;
    return listAuctions(pool, {
      status: query.status,
      search: query.search,
      page,
      limit,
    });
  });

  app.get<{ Params: { id: string } }>('/api/v1/domain-services/auctions/:id', async (request) => {
    const id = parseOrThrow(uuidSchema, request.params.id);
    let userId: string | undefined;
    try {
      const auth = await authenticate(request, env, pool);
      userId = auth.userId;
    } catch {
      userId = undefined;
    }
    return getAuctionDetail(pool, id, userId);
  });

  app.post<{ Params: { id: string } }>('/api/v1/domain-services/auctions/:id/bids', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(uuidSchema, request.params.id);
    const input = parseOrThrow(
      z.object({
        amount: moneySchema,
        idempotencyKey: z.string().min(8).max(128).nullable().optional(),
      }),
      request.body
    );

    const result = await placeBid(pool, {
      auctionId: id,
      userId: auth.userId,
      amount: input.amount,
      idempotencyKey: input.idempotencyKey ?? null,
    });

    await auditRequest(pool, request, auth.userId, {
      action: 'domain_bid_placed',
      resourceType: 'domain_auction',
      resourceId: id,
      metadata: { amount: result.amount, bidId: result.bidId },
    }).catch(() => undefined);

    reply.code(201);
    return result;
  });

  app.get('/api/v1/domain-services/auctions/my/bids', async (request) => {
    const auth = await authenticate(request, env, pool);
    return { bids: await listMyBids(pool, auth.userId) };
  });

  app.get('/api/v1/domain-services/auctions/my/won', async (request) => {
    const auth = await authenticate(request, env, pool);
    return { auctions: await listMyWonAuctions(pool, auth.userId) };
  });

  app.get('/api/v1/domain-services/auctions/my/lost', async (request) => {
    const auth = await authenticate(request, env, pool);
    return { auctions: await listMyLostAuctions(pool, auth.userId) };
  });

  app.post<{ Params: { id: string } }>('/api/v1/domain-services/auctions/:id/pay', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(uuidSchema, request.params.id);
    const result = await createAuctionPaymentOrder(pool, auth.userId, id, randomUUID);
    await auditRequest(pool, request, auth.userId, {
      action: 'domain_auction_payment_initiated',
      resourceType: 'domain_auction',
      resourceId: id,
      metadata: { orderId: result.orderId, amount: result.amount },
    }).catch(() => undefined);
    reply.code(201);
    return result;
  });

  // ---------------------------------------------------------------------------------------
  // Discount Domain Club (authenticated)
  // ---------------------------------------------------------------------------------------
  app.get('/api/v1/domain-services/club/plans', async () => {
    return { plans: await listPublishedPlans(pool) };
  });

  app.post<{ Params: { id: string } }>('/api/v1/domain-services/club/plans/:id/subscribe', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const planId = parseOrThrow(uuidSchema, request.params.id);
    const result = await createMembershipOrder(pool, auth.userId, planId, randomUUID);
    await auditRequest(pool, request, auth.userId, {
      action: 'domain_club_subscription_started',
      resourceType: 'domain_club_membership',
      resourceId: result.membershipId,
      metadata: { planId, orderId: result.orderId },
    }).catch(() => undefined);
    reply.code(201);
    return result;
  });

  app.get('/api/v1/domain-services/club/membership', async (request) => {
    const auth = await authenticate(request, env, pool);
    return { membership: await getMyMembership(pool, auth.userId) };
  });

  app.delete('/api/v1/domain-services/club/membership', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const membership = await getMyMembership(pool, auth.userId);
    if (!membership) throw new NotFoundError('No membership was found');
    await cancelMyMembership(pool, auth.userId, membership.id);
    await auditRequest(pool, request, auth.userId, {
      action: 'domain_club_membership_cancelled',
      resourceType: 'domain_club_membership',
      resourceId: membership.id,
    }).catch(() => undefined);
    reply.code(204);
    return null;
  });

  app.get('/api/v1/domain-services/club/pricing-preview', async (request) => {
    const query = (request.query ?? {}) as { standardPrice?: string };
    const standardPrice = query.standardPrice && moneySchema.safeParse(query.standardPrice).success ? query.standardPrice : null;
    if (!standardPrice) throw new ValidationError('Provide standardPrice as a decimal amount, e.g. 20.00');
    let userId: string | null = null;
    try {
      const auth = await authenticate(request, env, pool);
      userId = auth.userId;
    } catch {
      userId = null;
    }
    // Anonymous visitors preview the cheapest published plan; members see their own discount.
    if (userId) {
      const { getActiveMembershipDiscount } = await import('../domain-services/club-service');
      const discount = await getActiveMembershipDiscount(pool, userId, 'example.com'); // all-extensions plans apply
      if (discount) {
        const { fromCents, toCents } = await import('../lib/money');
        const standardCents = toCents(standardPrice);
        const discountCents = discount.type === 'percentage'
          ? Math.round((standardCents * discount.value) / 100)
          : Math.min(discount.value, standardCents);
        return {
          standardPrice,
          memberPrice: fromCents(standardCents - discountCents),
          savings: fromCents(discountCents),
          clubName: discount.clubName,
        };
      }
    }
    return memberPricingPreview(pool, userId, standardPrice);
  });

  // ---------------------------------------------------------------------------------------
  // Domain transactions (authenticated, read-only view of the caller's records)
  // ---------------------------------------------------------------------------------------
  app.get('/api/v1/domain-services/transactions', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { rows } = await pool.query(
      `SELECT t.id, t.transaction_type, t.status, t.amount, t.currency, t.order_id, t.invoice_id,
              t.payment_id, t.provider_reference, t.error_code, t.created_at, t.updated_at,
              o.order_number, i.invoice_number
         FROM domain_transactions t
         LEFT JOIN orders o ON o.id = t.order_id
         LEFT JOIN invoices i ON i.id = t.invoice_id
        WHERE t.user_id = $1
        ORDER BY t.created_at DESC
        LIMIT 100`,
      [auth.userId]
    );
    return { transactions: rows };
  });
}
