/**
 * Platform-service fulfilment — what a *verified payment* unlocks for the packaged CloudHost247
 * services (Website Builder tiers, AI builder, Online Store, Digital Marketing, Unified Inbox) and
 * for expert-service engagements.
 *
 * This is the single dispatch point, called from `provisionPaidOrder` inside the webhook settlement
 * transaction — the same place domain registrations, Cloudflare services and server provisioning
 * are dispatched. It exists so no product module needs its own "payment succeeded" listener, and
 * so the platform keeps exactly one bridge between money and entitlement.
 *
 * Rules enforced here:
 *
 *   - The order's own payment row must already be `paid` (checked by the caller, re-checked by the
 *     settlement path). Nothing in this file can be reached from a client request.
 *   - The entitlement target is re-validated against the database: the referenced site/store/
 *     campaign must exist AND belong to the buyer. A metadata payload that names someone else's
 *     resource is ignored rather than honoured.
 *   - Every step is idempotent: a redelivered webhook re-runs this and changes nothing, because
 *     each write is either an upsert or a guarded monotonic status transition.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import type { OrderItemRow, OrderRow } from '../db/orders';
import { findPlanById } from './platform-plans';
import { createNotification } from '../services/notification-service';

/** Days added per cadence when a recurring platform tier is activated. */
const PERIOD_DAYS: Record<string, number> = {
  one_time: 3650,
  monthly: 30,
  quarterly: 91,
  semi_annually: 182,
  annually: 365,
};

export interface PlatformFulfilmentResult {
  subscriptionId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  applied: boolean;
}

interface PlatformPlanMetadata {
  kind?: string;
  planId?: string;
  serviceKind?: string;
  planCode?: string;
  resourceType?: string | null;
  resourceId?: string | null;
}

function readMetadata(item: OrderItemRow): PlatformPlanMetadata {
  const raw = item.metadata;
  if (!raw || typeof raw !== 'object') return {};
  return raw as PlatformPlanMetadata;
}

/**
 * Resolves which of the buyer's own resources a tier governs, returning null when the target is
 * missing or belongs to somebody else. Callers treat null as "activate the plan without attaching
 * it", never as "attach it anyway".
 */
async function resolveOwnedResource(
  tx: Queryable,
  userId: string,
  resourceType: string | null | undefined,
  resourceId: string | null | undefined
): Promise<{ table: string; id: string } | null> {
  if (!resourceType || !resourceId) return null;
  const table =
    resourceType === 'builder_site'
      ? 'builder_sites'
      : resourceType === 'store'
        ? 'store_stores'
        : resourceType === 'marketing_campaign'
          ? 'marketing_campaigns'
          : null;
  if (!table) return null;
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM ${table} WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [resourceId, userId]
  );
  return rows[0] ? { table, id: rows[0].id } : null;
}

/**
 * Applies a purchased platform tier: records the subscription (created only for a recurring
 * cadence) and writes the plan code onto the governed resource. Returns what was actually applied
 * so the settlement report can show it.
 */
export async function fulfilPlatformPlanItem(
  tx: Queryable,
  order: OrderRow,
  item: OrderItemRow
): Promise<PlatformFulfilmentResult> {
  const metadata = readMetadata(item);
  if (metadata.kind !== 'platform_plan' || typeof metadata.planId !== 'string') {
    return { applied: false };
  }

  const plan = await findPlanById(tx, metadata.planId);
  // A plan deleted between checkout and settlement: the money is recorded, the entitlement is not
  // granted, and the customer is told so they can contact support. Silently granting something the
  // platform can no longer describe would be worse.
  if (!plan) {
    await createNotification(tx, {
      userId: order.user_id,
      type: 'PLATFORM_PLAN_UNAVAILABLE',
      title: 'A purchased service plan could no longer be activated automatically',
      message: [
        `Order: ${order.order_number}`,
        `Line: ${item.plan_name_snapshot}`,
        'The plan is no longer published, so it could not be activated automatically.',
        'Our team has been notified and will contact you with the options (including a refund).',
      ].join('\n'),
      resourceType: 'order',
      resourceId: order.id,
    });
    return { applied: false };
  }

  const owned = await resolveOwnedResource(tx, order.user_id, metadata.resourceType, metadata.resourceId);
  let subscriptionId: string | null = null;

  if (plan.billing_period !== 'one_time') {
    const periodEnd = new Date(Date.now() + (PERIOD_DAYS[plan.billing_period] ?? 30) * 86_400_000);
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO subscriptions
         (id, customer_id, platform_plan_id, order_id, status, current_period_end, resource_type, resource_id)
       VALUES ($1, $2, $3, $4, 'active', $5, $6, $7)
       -- Idempotent: one live subscription per (order, plan) however often the webhook is delivered
       -- (backed by subscriptions_order_platform_plan_unique_idx).
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        randomUUID(),
        order.user_id,
        plan.id,
        order.id,
        periodEnd.toISOString(),
        owned ? metadata.resourceType : null,
        owned ? owned.id : null,
      ]
    );
    subscriptionId = rows[0]?.id ?? null;

    // The webhook may be redelivered after the first insert already happened — look the existing
    // subscription up so the resource still gets pointed at it.
    if (!subscriptionId) {
      const existing = await tx.query<{ id: string }>(
        `SELECT id FROM subscriptions WHERE order_id = $1 AND platform_plan_id = $2 LIMIT 1`,
        [order.id, plan.id]
      );
      subscriptionId = existing.rows[0]?.id ?? null;
    }
  }

  if (owned) {
    await tx.query(
      `UPDATE ${owned.table}
          SET plan_code = $2,
              subscription_id = COALESCE($3, subscription_id),
              updated_at = now()
        WHERE id = $1`,
      [owned.id, plan.code, subscriptionId]
    );
  }

  await createNotification(tx, {
    userId: order.user_id,
    type: 'PLATFORM_PLAN_ACTIVATED',
    title: `${plan.name} is active`,
    message: [
      `Order: ${order.order_number}`,
      `Plan: ${plan.name}`,
      plan.billing_period === 'one_time'
        ? 'This is a one-time purchase — no renewal is scheduled.'
        : `Renews on ${new Date(Date.now() + (PERIOD_DAYS[plan.billing_period] ?? 30) * 86_400_000).toISOString().slice(0, 10)}.`,
      'Manage it any time from your CloudHost247 dashboard.',
    ].join('\n'),
    resourceType: 'order',
    resourceId: order.id,
  });

  return {
    subscriptionId,
    resourceType: owned ? metadata.resourceType ?? null : null,
    resourceId: owned?.id ?? null,
    applied: true,
  };
}

/**
 * Expert-service engagement paid → the request is released to the delivery team. Guarded on the
 * status the request must be in (`quoted`): a payment for a request that was cancelled or already
 * progressed does not move it, and the transition happens exactly once.
 */
export async function fulfilExpertServiceItem(tx: Queryable, order: OrderRow, item: OrderItemRow): Promise<boolean> {
  const metadata = readMetadata(item) as { kind?: string; requestId?: string };
  if (metadata.kind !== 'expert_service' || typeof metadata.requestId !== 'string') return false;

  const { rows } = await tx.query<{ id: string }>(
    `UPDATE expert_service_requests
        SET status = 'in_progress', order_id = $2, updated_at = now()
      WHERE id = $1 AND user_id = $3 AND status IN ('quoted', 'approved')
      RETURNING id`,
    [metadata.requestId, order.id, order.user_id]
  );
  if (!rows[0]) return false;

  await tx.query(
    `INSERT INTO expert_service_request_events (id, request_id, event_type, actor_role, from_status, to_status, metadata)
     VALUES ($1, $2, 'payment_verified', 'system', 'quoted', 'in_progress', $3)`,
    [randomUUID(), metadata.requestId, JSON.stringify({ orderNumber: order.order_number })]
  );
  await createNotification(tx, {
    userId: order.user_id,
    type: 'EXPERT_SERVICE_STARTED',
    title: 'Your project has started',
    message: `Payment for order ${order.order_number} is confirmed and your CloudHost247 expert has been assigned. Track progress from your dashboard.`,
    resourceType: 'expert_service_request',
    resourceId: metadata.requestId,
  });
  return true;
}

/** Marketing engagement paid → planning begins. Same guarded, idempotent pattern. */
export async function fulfilMarketingPlanItem(tx: Queryable, order: OrderRow, item: OrderItemRow): Promise<boolean> {
  const metadata = readMetadata(item) as { kind?: string; campaignId?: string };
  if (metadata.kind !== 'marketing_plan' || typeof metadata.campaignId !== 'string') return false;

  const { rows } = await tx.query<{ id: string }>(
    `UPDATE marketing_campaigns
        SET status = 'planning', order_id = $2, updated_at = now()
      WHERE id = $1 AND user_id = $3 AND status = 'requested'
      RETURNING id`,
    [metadata.campaignId, order.id, order.user_id]
  );
  if (!rows[0]) return false;

  await tx.query(
    `INSERT INTO marketing_campaign_events (id, campaign_id, event_type, actor_role, from_status, to_status, metadata)
     VALUES ($1, $2, 'payment_verified', 'system', 'requested', 'planning', $3)`,
    [randomUUID(), metadata.campaignId, JSON.stringify({ orderNumber: order.order_number })]
  );
  return true;
}

export const PLATFORM_FULFILMENT_KINDS = ['platform_plan', 'expert_service', 'marketing_plan'] as const;
