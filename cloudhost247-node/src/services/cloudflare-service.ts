/**
 * Cloudflare business layer (spec §5–§9, §25–§31, §42–§46, §68).
 *
 * Sits between the routes/worker and the provider abstraction (src/integrations/cloudflare).
 * Owns: feature entitlements, the authorization chain
 * (customer → service → plan → entitlement → Cloudflare operation), Cloudflare checkout
 * (order + invoice through the EXISTING billing engine), the idempotent provisioning pipeline,
 * lifecycle transitions, and plan changes gated by payment.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors';
import { recordAuditBestEffort, type AuditContext } from '../lib/audit';
import { fromCents, multiplyCents, sumCents, toCents } from '../lib/money';
import { createOrder } from '../db/orders';
import { findPlanById } from '../db/catalog-plans';
import { listPublishedPricingForPlan } from '../db/catalog-pricing';
import { issueInvoiceForOrder } from './billing-service';
import { createCustomerService, findServiceById, updateCustomerService } from '../db/customer-services';
import { createSubscription } from '../db/ops-tables';
import {
  enqueueCloudflareJob,
  findCloudflareServiceById,
  findPlanMappingByPlanId,
  insertCloudflareService,
  updateCloudflareService,
  upsertCachedDnsRecord,
  type CloudflareServiceRow,
  type CloudflareServiceWithContext,
  type CloudflarePlanMappingRow,
} from '../db/cloudflare';
import { resolveCloudflare, type ResolveOptions } from '../integrations/cloudflare/config';
import { ensureZone, setZonePaused, deleteZone } from '../integrations/cloudflare/zones';
import { findDnsRecord, createDnsRecord } from '../integrations/cloudflare/dns';
import { changeZonePlan, setZoneSetting } from '../integrations/cloudflare/features';
import { syncZoneState, activationStatusFromZone } from '../integrations/cloudflare/sync';
import { CloudflareError } from '../integrations/cloudflare/errors';
import { CLOUDFLARE_FEATURE_KEYS, capabilitiesForPlan, type CloudflareFeatureKey, type CloudflarePlanTier } from '../integrations/cloudflare/types';
import { getSetting } from '../db/ops-tables';

// ---------------------------------------------------------------------------- entitlements ---

export const entitlementsSchema = z
  .object(Object.fromEntries(CLOUDFLARE_FEATURE_KEYS.map((k) => [k, z.boolean().optional()])))
  .strict();

/** Baseline entitlements per Cloudflare tier — the admin mapping overrides these per product. */
const TIER_DEFAULT_ENTITLEMENTS: Record<CloudflarePlanTier, Partial<Record<CloudflareFeatureKey, boolean>>> = {
  free: { dns: true, dnssec: true, analytics: true, ssl: true, caching: true, cache_purge: true, development_mode: true, scrape_shield: false, firewall: false, speed: false, plan_change: true },
  pro: { dns: true, dnssec: true, analytics: true, ssl: true, caching: true, cache_purge: true, development_mode: true, scrape_shield: true, firewall: true, speed: true, plan_change: true },
  business: { dns: true, dnssec: true, analytics: true, ssl: true, caching: true, cache_purge: true, development_mode: true, scrape_shield: true, firewall: true, speed: true, plan_change: true },
  enterprise: { dns: true, dnssec: true, analytics: true, ssl: true, caching: true, cache_purge: true, development_mode: true, scrape_shield: true, firewall: true, speed: true, plan_change: false },
};

export type Entitlements = Record<CloudflareFeatureKey, boolean>;

export function resolveEntitlements(mapping: CloudflarePlanMappingRow | null, tier: CloudflarePlanTier): Entitlements {
  const defaults = TIER_DEFAULT_ENTITLEMENTS[tier];
  const capabilities = capabilitiesForPlan(tier);
  const out = {} as Entitlements;
  for (const key of CLOUDFLARE_FEATURE_KEYS) {
    const admin = mapping?.entitlements?.[key];
    const entitled = admin !== undefined ? admin : (defaults[key] ?? false);
    // An entitlement can never grant a capability the current API/tier does not support.
    const supported =
      key === 'plan_change' ? capabilities.supportsPlanChange
      : key === 'dnssec' ? capabilities.supportsDnssec
      : true;
    out[key] = entitled && supported;
  }
  return out;
}

// --------------------------------------------------------------------------- authorization ---

export interface AuthorizedCloudflareService {
  service: CloudflareServiceWithContext;
  entitlements: Entitlements;
  mapping: CloudflarePlanMappingRow | null;
}

/**
 * The full authorization chain of spec §46. Ownership is checked against the database — path
 * ids from the browser are never trusted. `feature: null` means overview access (any state);
 * a named feature additionally requires the service to be ACTIVE and the entitlement enabled.
 */
export async function authorizeCloudflareService(
  db: Queryable,
  userId: string,
  serviceId: string,
  feature: CloudflareFeatureKey | null
): Promise<AuthorizedCloudflareService> {
  const service = await findCloudflareServiceById(db, serviceId);
  // Same-response for "missing" and "not yours" — no resource enumeration (spec §71).
  if (!service || service.customer_id !== userId) {
    throw new NotFoundError('No Cloudflare service was found with that id');
  }
  const mapping = await findPlanMappingByPlanId(db, service.plan_id);
  const entitlements = resolveEntitlements(mapping, service.cloudflare_plan);
  if (feature) {
    if (service.status !== 'active') {
      throw new ValidationError(`This Cloudflare service is ${service.status.replace(/_/g, ' ')} — feature access requires an active service`);
    }
    if (!entitlements[feature]) {
      throw new ForbiddenError('FEATURE_NOT_SUPPORTED: your Cloudflare plan does not include this feature');
    }
  }
  return { service, entitlements, mapping };
}

/** Admin variant: no ownership constraint, still resolves entitlements. */
export async function loadCloudflareServiceForAdmin(db: Queryable, serviceId: string): Promise<AuthorizedCloudflareService> {
  const service = await findCloudflareServiceById(db, serviceId);
  if (!service) throw new NotFoundError('No Cloudflare service was found with that id');
  const mapping = await findPlanMappingByPlanId(db, service.plan_id);
  return { service, entitlements: resolveEntitlements(mapping, service.cloudflare_plan), mapping };
}

// -------------------------------------------------------------------------------- checkout ---

const PERIOD_DAYS: Record<string, number> = {
  one_time: 3650,
  monthly: 30,
  quarterly: 91,
  semi_annually: 182,
  annually: 365,
};

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

export interface CloudflareOrderInput {
  planId: string;
  billingPeriod: string;
  domainName?: string;
  customerDomainId?: string;
  hostingServiceId?: string;
}

/**
 * Creates a Cloudflare order + invoice through the EXISTING billing primitives (the same ones
 * cart checkout uses). The Cloudflare service itself is NOT created here — that happens only in
 * provisionCloudflareOrderItems() after the payment webhook settles (spec §68).
 */
export async function createCloudflareOrder(
  db: Queryable,
  userId: string,
  input: CloudflareOrderInput,
  genId: () => string = randomUUID
) {
  const plan = await findPlanById(db, input.planId);
  if (!plan || plan.status !== 'active') throw new ValidationError('That Cloudflare plan is not available');
  const mapping = await findPlanMappingByPlanId(db, input.planId);
  if (!mapping) throw new ValidationError('That plan is not a Cloudflare plan');

  // Resolve the target domain: explicit name, an owned customer domain, or a hosting service.
  let domainName = input.domainName?.trim().toLowerCase() ?? '';
  let customerDomainId: string | null = null;
  let hostingServiceId: string | null = null;

  if (input.customerDomainId) {
    const { rows } = await db.query<{ id: string; domain_name: string; user_id: string }>(
      `SELECT id, domain_name, user_id FROM customer_domains WHERE id = $1`,
      [input.customerDomainId]
    );
    const domain = rows[0];
    if (!domain || domain.user_id !== userId) throw new NotFoundError('No domain was found with that id');
    customerDomainId = domain.id;
    domainName = domain.domain_name.toLowerCase();
  }
  if (input.hostingServiceId) {
    const hosting = await findServiceById(db, input.hostingServiceId);
    if (!hosting || hosting.user_id !== userId) throw new NotFoundError('No hosting service was found with that id');
    hostingServiceId = hosting.id;
  }
  if (!domainName || !DOMAIN_RE.test(domainName)) {
    throw new ValidationError('A valid domain name is required for a Cloudflare service');
  }

  // One live Cloudflare service per zone name (DB also enforces this at provisioning time).
  const { rows: existing } = await db.query<{ id: string }>(
    `SELECT id FROM cloudflare_services WHERE lower(zone_name) = $1 AND status <> 'terminated'`,
    [domainName]
  );
  if (existing.length > 0) throw new ValidationError('A Cloudflare service already exists for that domain');

  const pricing = await listPublishedPricingForPlan(db, plan.id);
  const price = pricing.find((p) => p.billing_period === input.billingPeriod);
  if (!price || price.amount === null) throw new ValidationError('That billing period is not available for this plan');

  const unitCents = toCents(price.amount);
  const orderId = genId();

  return withTransaction(db, async (tx) => {
    const { order, items } = await createOrder(tx, {
      id: orderId,
      userId,
      currency: price.currency,
      subtotalAmount: fromCents(unitCents),
      discountAmount: '0.00',
      taxAmount: '0.00',
      totalAmount: fromCents(unitCents),
      items: [
        {
          id: genId(),
          productId: plan.product_id,
          planId: plan.id,
          productNameSnapshot: `Cloudflare — ${domainName}`,
          planNameSnapshot: plan.name,
          billingPeriod: input.billingPeriod,
          quantity: 1,
          unitPriceAmount: fromCents(unitCents),
          currency: price.currency,
          lineTotalAmount: fromCents(unitCents),
          metadata: {
            kind: 'cloudflare',
            cloudflare: { domainName, customerDomainId, hostingServiceId },
          },
        },
      ],
    });
    const invoice = await issueInvoiceForOrder(tx, order, genId);
    return { order, items, invoice };
  });
}

// --------------------------------------------------- paid-order hook (called by billing) ---

export interface CloudflareOrderItemMetadata {
  kind?: string;
  cloudflare?: {
    domainName?: string;
    customerDomainId?: string | null;
    hostingServiceId?: string | null;
    changePlan?: { cloudflareServiceId: string; newPlanId: string };
  };
}

/**
 * Runs inside the webhook settlement transaction via provisionPaidOrder. Creates the
 * customer_service + cloudflare_service (pending) + subscription, and enqueues the durable
 * provisioning job. Idempotent end to end: customer_service_id is unique per cloudflare service,
 * the job idempotency key is derived from the order item, and a duplicate webhook re-run
 * creates nothing new.
 */
export async function provisionCloudflareOrderItem(
  tx: Queryable,
  order: { id: string; user_id: string },
  item: { id: string; plan_id: string | null; billing_period: string; metadata?: unknown },
  genId: () => string = randomUUID
): Promise<{ cloudflareServiceId: string | null; changePlanQueued: boolean }> {
  const metadata = (item.metadata ?? {}) as CloudflareOrderItemMetadata;
  if (!item.plan_id) return { cloudflareServiceId: null, changePlanQueued: false };

  // Paid plan-change order → queue the change_plan job against the existing service.
  if (metadata.cloudflare?.changePlan) {
    const { cloudflareServiceId, newPlanId } = metadata.cloudflare.changePlan;
    const target = await findCloudflareServiceById(tx, cloudflareServiceId);
    const mapping = await findPlanMappingByPlanId(tx, newPlanId);
    if (target && target.customer_id === order.user_id && mapping) {
      await enqueueCloudflareJob(tx, {
        serviceId: target.id,
        jobType: 'change_plan',
        payload: { newPlanId, newTier: mapping.cloudflare_plan, orderId: order.id },
        idempotencyKey: `cf-change-plan:${order.id}:${item.id}`,
      });
      return { cloudflareServiceId: target.id, changePlanQueued: true };
    }
    return { cloudflareServiceId: null, changePlanQueued: false };
  }

  const mapping = await findPlanMappingByPlanId(tx, item.plan_id);
  if (!mapping || metadata.kind !== 'cloudflare') return { cloudflareServiceId: null, changePlanQueued: false };
  const domainName = metadata.cloudflare?.domainName?.toLowerCase();
  if (!domainName) return { cloudflareServiceId: null, changePlanQueued: false };

  // Idempotency: an existing live service for this zone name means a duplicate settlement.
  const { rows: existing } = await tx.query<{ id: string }>(
    `SELECT id FROM cloudflare_services WHERE lower(zone_name) = $1 AND status <> 'terminated'`,
    [domainName]
  );
  if (existing[0]) return { cloudflareServiceId: existing[0].id, changePlanQueued: false };

  const plan = await findPlanById(tx, item.plan_id);
  const customerService = await createCustomerService(tx, {
    id: genId(),
    userId: order.user_id,
    productId: plan?.product_id ?? null,
    planId: item.plan_id,
    label: `Cloudflare — ${domainName}`,
    status: 'active',
    notes: null,
    createdBy: order.user_id,
  });

  const subscription = await createSubscription(tx, {
    customerId: order.user_id,
    planId: item.plan_id,
    orderId: order.id,
    provider: 'cloudflare',
    periodEnd: new Date(Date.now() + (PERIOD_DAYS[item.billing_period] ?? 30) * 86_400_000),
  });

  const cfService = await insertCloudflareService(tx, {
    customerId: order.user_id,
    customerServiceId: customerService.id,
    customerDomainId: metadata.cloudflare?.customerDomainId ?? null,
    hostingServiceId: metadata.cloudflare?.hostingServiceId ?? null,
    subscriptionId: subscription.id,
    orderId: order.id,
    planId: item.plan_id,
    cloudflarePlan: mapping.cloudflare_plan,
    zoneName: domainName,
    proxyDefault: mapping.default_proxied ?? true,
    sslMode: mapping.default_ssl_mode ?? null,
  });
  if (!cfService) return { cloudflareServiceId: null, changePlanQueued: false };

  if (mapping.provisioning_mode === 'automatic') {
    await enqueueCloudflareJob(tx, {
      serviceId: cfService.id,
      jobType: 'provision_zone',
      idempotencyKey: `cf-provision:${order.id}:${item.id}`,
    });
  }
  return { cloudflareServiceId: cfService.id, changePlanQueued: false };
}

// ---------------------------------------------------------------------------- provisioning ---

/**
 * The idempotent provisioning pipeline (spec §11, §42). Search-then-create for the zone,
 * find-then-create for every system DNS record, defaults applied best-effort, activation
 * derived from Cloudflare's real zone status. Safe to run any number of times.
 */
export async function runCloudflareProvisioning(
  db: Queryable,
  service: CloudflareServiceRow,
  options: ResolveOptions = {}
): Promise<void> {
  const { account, client } = await resolveCloudflare(db, { ...options, serviceId: service.id });
  await updateCloudflareService(db, service.id, { status: 'provisioning' });

  const { zone } = await ensureZone(client, account.cloudflare_account_id, service.zone_name, account.default_zone_type);

  // A zone can belong to at most one live service — the partial unique index enforces it; a
  // conflict here means another customer's service already claims this zone.
  try {
    await updateCloudflareService(db, service.id, {
      zoneId: zone.id,
      cloudflareAccountId: account.id,
      nameServer1: zone.name_servers?.[0] ?? null,
      nameServer2: zone.name_servers?.[1] ?? null,
    });
  } catch (error) {
    await updateCloudflareService(db, service.id, {
      status: 'provisioning_failed',
      lastErrorCode: 'ZONE_ALREADY_CLAIMED',
      lastErrorMessage: 'This Cloudflare zone is already attached to another service',
    });
    throw error;
  }

  // System DNS for hosting attachments: point the apex + www at the hosting server's IP.
  const hostingIp = service.hosting_service_id ? await resolveHostingIp(db, service.hosting_service_id) : null;
  if (hostingIp) {
    for (const recordName of [service.zone_name, `www.${service.zone_name}`]) {
      const existing = await findDnsRecord(client, zone.id, 'A', recordName);
      const record =
        existing ??
        (await createDnsRecord(client, zone.id, {
          type: 'A',
          name: recordName,
          content: hostingIp,
          proxied: service.proxy_default,
          comment: 'ch247:system',
        }));
      await upsertCachedDnsRecord(db, {
        serviceId: service.id,
        cloudflareRecordId: record.id,
        type: record.type,
        name: record.name,
        content: record.content,
        ttl: record.ttl,
        proxied: record.proxied ?? false,
        comment: record.comment ?? 'ch247:system',
        ownership: 'SYSTEM_MANAGED',
      });
    }
  }

  // Default SSL mode (best-effort — an unsupported setting must not fail provisioning).
  const sslMode = service.ssl_mode ?? account.default_ssl_mode;
  if (sslMode) {
    try {
      await setZoneSetting(client, zone.id, 'ssl', sslMode === 'strict' ? 'strict' : sslMode);
    } catch (error) {
      if (!(error instanceof CloudflareError) || error.retryable) throw error;
    }
  }

  // Paid tiers: apply the mapped rate plan.
  if (service.cloudflare_plan !== 'free') {
    try {
      await changeZonePlan(client, zone.id, service.cloudflare_plan);
    } catch (error) {
      if (!(error instanceof CloudflareError) || error.retryable) throw error;
      // Plan purchase not available on this account — record honestly, keep zone on free.
      await updateCloudflareService(db, service.id, {
        lastErrorCode: 'PLAN_UPGRADE_UNAVAILABLE',
        lastErrorMessage: error.safeMessage,
      });
    }
  }

  await updateCloudflareService(db, service.id, {
    status: 'active',
    activationStatus: activationStatusFromZone(zone.status, zone.paused),
    sslMode,
    lastSyncedAt: new Date(),
    lastErrorCode: null,
    lastErrorMessage: null,
  });
}

/** Finds a hosting service's server IP through the existing hosting/server relationship. */
export async function resolveHostingIp(db: Queryable, hostingServiceId: string): Promise<string | null> {
  const { rows } = await db.query<{ ip: string | null }>(
    `SELECT srv.ip_address AS ip
       FROM customer_services cs
       JOIN servers srv ON srv.customer_id = cs.user_id AND srv.ip_address IS NOT NULL
      WHERE cs.id = $1
      ORDER BY srv.created_at DESC
      LIMIT 1`,
    [hostingServiceId]
  );
  return rows[0]?.ip ?? null;
}

// ------------------------------------------------------------------------------- lifecycle ---

export type LifecycleAction = 'suspend' | 'unsuspend' | 'terminate';

/** Queues a lifecycle job (never executes provider calls inside the request). */
export async function queueLifecycleAction(
  db: Queryable,
  service: CloudflareServiceRow,
  action: LifecycleAction,
  actorId: string | null,
  audit: AuditContext
): Promise<void> {
  const valid: Record<LifecycleAction, string[]> = {
    suspend: ['active', 'sync_failed'],
    unsuspend: ['suspended'],
    terminate: ['active', 'suspended', 'provisioning_failed', 'sync_failed', 'pending'],
  };
  if (!valid[action].includes(service.status)) {
    throw new ValidationError(`Cannot ${action} a Cloudflare service in '${service.status}' status`);
  }
  if (action === 'terminate') {
    await updateCloudflareService(db, service.id, { status: 'terminating' });
  }
  await enqueueCloudflareJob(db, { serviceId: service.id, jobType: action, maxAttempts: 5 });
  await recordAuditBestEffort(
    db,
    { actorId, action: `cloudflare.service_${action}_requested`, resourceType: 'cloudflare_service', resourceId: service.id },
    audit
  );
}

export async function executeSuspend(db: Queryable, service: CloudflareServiceRow, options: ResolveOptions = {}): Promise<void> {
  const policy = await getSetting<string>(db, 'cloudflare.suspension_policy', 'pause_zone');
  if (policy === 'pause_zone' && service.zone_id) {
    const { client } = await resolveCloudflare(db, { ...options, serviceId: service.id });
    await setZonePaused(client, service.zone_id, true);
  }
  await updateCloudflareService(db, service.id, { status: 'suspended', suspendedAt: new Date() });
  await updateCustomerService(db, service.customer_service_id, { status: 'suspended' });
}

export async function executeUnsuspend(db: Queryable, service: CloudflareServiceRow, options: ResolveOptions = {}): Promise<void> {
  if (service.zone_id) {
    const { client } = await resolveCloudflare(db, { ...options, serviceId: service.id });
    await setZonePaused(client, service.zone_id, false);
  }
  await updateCloudflareService(db, service.id, { status: 'active', suspendedAt: null });
  await updateCustomerService(db, service.customer_service_id, { status: 'active' });
}

export async function executeTerminate(db: Queryable, service: CloudflareServiceRow, options: ResolveOptions = {}): Promise<void> {
  const policy = await getSetting<string>(db, 'cloudflare.termination_policy', 'delete_zone');
  if (policy === 'delete_zone' && service.zone_id) {
    const { client } = await resolveCloudflare(db, { ...options, serviceId: service.id });
    try {
      await deleteZone(client, service.zone_id);
    } catch (error) {
      // Zone already gone upstream is a success for termination purposes.
      if (!(error instanceof CloudflareError) || error.code !== 'CLOUDFLARE_ZONE_NOT_FOUND') throw error;
    }
  }
  await updateCloudflareService(db, service.id, {
    status: 'terminated',
    terminatedAt: new Date(),
    activationStatus: 'pending',
    zoneId: null,
  });
  await updateCustomerService(db, service.customer_service_id, { status: 'cancelled' });
}

export async function executeChangePlan(
  db: Queryable,
  service: CloudflareServiceRow,
  payload: { newPlanId?: string; newTier?: string },
  options: ResolveOptions = {}
): Promise<void> {
  const newPlanId = payload.newPlanId;
  const newTier = (payload.newTier ?? 'free') as CloudflarePlanTier;
  if (!newPlanId) throw new Error('change_plan job missing newPlanId');
  if (service.zone_id) {
    const { client } = await resolveCloudflare(db, { ...options, serviceId: service.id });
    await changeZonePlan(client, service.zone_id, newTier);
  }
  await updateCloudflareService(db, service.id, { planId: newPlanId, cloudflarePlan: newTier });
  // Keep the customer_services row's plan pointer in step for billing/reporting.
  await updateCustomerService(db, service.customer_service_id, { planId: newPlanId });
}

// ------------------------------------------------------------------------------ plan change ---

/**
 * Customer-initiated plan change (spec §25). Clicking never changes Cloudflare directly:
 *  - priced change → order + invoice through existing billing; the job runs after settlement;
 *  - zero-priced change (downgrade to free) → job queued immediately per billing rules.
 */
export async function requestPlanChange(
  db: Queryable,
  userId: string,
  serviceId: string,
  newPlanId: string,
  billingPeriod: string,
  genId: () => string = randomUUID
): Promise<{ mode: 'invoice' | 'immediate'; orderId?: string; invoiceId?: string }> {
  const { service, entitlements } = await authorizeCloudflareService(db, userId, serviceId, null);
  if (service.status !== 'active') throw new ValidationError('Plan changes require an active service');
  if (!entitlements.plan_change) throw new ForbiddenError('FEATURE_NOT_SUPPORTED: plan changes are not enabled for this service');
  if (newPlanId === service.plan_id) throw new ValidationError('The service already uses that plan');

  const newPlan = await findPlanById(db, newPlanId);
  if (!newPlan || newPlan.status !== 'active') throw new ValidationError('That plan is not available');
  const mapping = await findPlanMappingByPlanId(db, newPlanId);
  if (!mapping) throw new ValidationError('That plan is not a Cloudflare plan');

  const pricing = await listPublishedPricingForPlan(db, newPlanId);
  const price = pricing.find((p) => p.billing_period === billingPeriod);
  if (!price || price.amount === null) throw new ValidationError('That billing period is not available for the selected plan');
  const priceCents = toCents(price.amount);

  if (priceCents === 0) {
    const job = await enqueueCloudflareJob(db, {
      serviceId: service.id,
      jobType: 'change_plan',
      payload: { newPlanId, newTier: mapping.cloudflare_plan },
      idempotencyKey: `cf-change-plan-free:${service.id}:${newPlanId}`,
    });
    if (!job) throw new ValidationError('An identical plan change is already in progress');
    return { mode: 'immediate' };
  }

  const orderId = genId();
  const { order, invoice } = await withTransaction(db, async (tx) => {
    const created = await createOrder(tx, {
      id: orderId,
      userId,
      currency: price.currency,
      subtotalAmount: fromCents(priceCents),
      discountAmount: '0.00',
      taxAmount: '0.00',
      totalAmount: fromCents(sumCents([multiplyCents(priceCents, 1)])),
      items: [
        {
          id: genId(),
          productId: newPlan.product_id,
          planId: newPlanId,
          productNameSnapshot: `Cloudflare plan change — ${service.zone_name}`,
          planNameSnapshot: newPlan.name,
          billingPeriod,
          quantity: 1,
          unitPriceAmount: fromCents(priceCents),
          currency: price.currency,
          lineTotalAmount: fromCents(priceCents),
          metadata: {
            kind: 'cloudflare',
            cloudflare: { changePlan: { cloudflareServiceId: service.id, newPlanId } },
          },
        },
      ],
    });
    const inv = await issueInvoiceForOrder(tx, created.order, genId);
    return { order: created.order, invoice: inv };
  });
  return { mode: 'invoice', orderId: order.id, invoiceId: invoice.id };
}

// ------------------------------------------------------------------------------------ sync ---

export async function runCloudflareSync(db: Queryable, service: CloudflareServiceRow, options: ResolveOptions = {}) {
  const { client } = await resolveCloudflare(db, { ...options, serviceId: service.id });
  return syncZoneState(db, client, service);
}
