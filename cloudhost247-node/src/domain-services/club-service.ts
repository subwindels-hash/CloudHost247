/**
 * Discount Domain Club — membership plans, member pricing and lifecycle.
 *
 * Plans, prices, discounts, eligible TLDs, durations and promotions are Super Admin configured
 * (domain_club_plans). Membership charges flow through the existing order/invoice/payment
 * pipeline with item metadata { kind: 'domain_club_membership', membershipId }; the verified
 * payment webhook activates the membership. Discounts are always computed server-side from the
 * configured plan — the UI only ever displays what this module resolved.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { createOrder } from '../db/orders';
import { issueInvoiceForOrder } from '../services/billing-service';
import { fromCents, toCents } from '../lib/money';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors';
import { DEFAULT_CURRENCY } from '../config/billing';
import { normalizeExtension, extensionOf } from './domain-name';
import { recordDomainTransaction, setDomainTransactionStatus } from './transactions';

export interface ClubPlanDto {
  id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'published' | 'disabled';
  currency: string;
  billingPeriod: 'monthly' | 'annually';
  priceAmount: string;
  discountType: 'percentage' | 'fixed';
  discountValue: string;
  eligibleExtensions: string[];
  promotion: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface ClubPlanRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  currency: string;
  billing_period: string;
  price_amount: string;
  discount_type: string;
  discount_value: string;
  eligible_extensions: unknown;
  promotion: unknown;
  created_at: string;
  updated_at: string;
}

function toPlanDto(row: ClubPlanRow): ClubPlanDto {
  const extensions = Array.isArray(row.eligible_extensions)
    ? (row.eligible_extensions as unknown[]).filter((entry): entry is string => typeof entry === 'string')
    : [];
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status as ClubPlanDto['status'],
    currency: row.currency,
    billingPeriod: row.billing_period as ClubPlanDto['billingPeriod'],
    priceAmount: row.price_amount,
    discountType: row.discount_type as ClubPlanDto['discountType'],
    discountValue: row.discount_value,
    eligibleExtensions: extensions,
    promotion: (row.promotion && typeof row.promotion === 'object' ? row.promotion : {}) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listPublishedPlans(db: Queryable): Promise<ClubPlanDto[]> {
  const { rows } = await db.query<ClubPlanRow>(
    `SELECT * FROM domain_club_plans WHERE status = 'published' ORDER BY price_amount ASC`
  );
  return rows.map(toPlanDto);
}

export async function listAllPlans(db: Queryable): Promise<ClubPlanDto[]> {
  const { rows } = await db.query<ClubPlanRow>(`SELECT * FROM domain_club_plans ORDER BY created_at DESC`);
  return rows.map(toPlanDto);
}

export interface CreatePlanInput {
  name: string;
  description?: string | null;
  currency?: string;
  billingPeriod: 'monthly' | 'annually';
  priceAmount: string;
  discountType: 'percentage' | 'fixed';
  discountValue: string;
  eligibleExtensions?: string[];
  promotion?: Record<string, unknown>;
  status?: 'draft' | 'published' | 'disabled';
}

export async function createPlan(db: Queryable, actorId: string, input: CreatePlanInput): Promise<ClubPlanDto> {
  validatePlanInput(input);
  const { rows } = await db.query<ClubPlanRow>(
    `INSERT INTO domain_club_plans
       (id, name, description, status, currency, billing_period, price_amount, discount_type, discount_value,
        eligible_extensions, promotion, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      randomUUID(),
      input.name.trim(),
      input.description ?? null,
      input.status ?? 'draft',
      (input.currency ?? DEFAULT_CURRENCY).toUpperCase(),
      input.billingPeriod,
      input.priceAmount,
      input.discountType,
      input.discountValue,
      JSON.stringify((input.eligibleExtensions ?? []).map(normalizeExtension)),
      JSON.stringify(input.promotion ?? {}),
      actorId,
    ]
  );
  const created = rows[0];
  if (!created) throw new Error('Failed to create Domain Club plan');
  return toPlanDto(created);
}

export async function updatePlan(
  db: Queryable,
  planId: string,
  patch: Partial<CreatePlanInput>
): Promise<ClubPlanDto> {
  const existing = await findPlanRow(db, planId);
  if (!existing) throw new NotFoundError('No Domain Club plan was found with that id');
  const merged: CreatePlanInput = {
    name: patch.name ?? existing.name,
    description: patch.description ?? existing.description,
    billingPeriod: (patch.billingPeriod ?? existing.billing_period) as 'monthly' | 'annually',
    priceAmount: patch.priceAmount ?? existing.price_amount,
    discountType: (patch.discountType ?? existing.discount_type) as 'percentage' | 'fixed',
    discountValue: patch.discountValue ?? existing.discount_value,
    eligibleExtensions: patch.eligibleExtensions ?? toPlanDto(existing).eligibleExtensions,
    promotion: patch.promotion ?? (existing.promotion as Record<string, unknown>),
    status: (patch.status ?? existing.status) as 'draft' | 'published' | 'disabled',
    currency: patch.currency ?? existing.currency,
  };
  validatePlanInput(merged);
  const { rows } = await db.query<ClubPlanRow>(
    `UPDATE domain_club_plans SET
       name=$2, description=$3, status=$4, billing_period=$5, price_amount=$6, discount_type=$7,
       discount_value=$8, eligible_extensions=$9, promotion=$10, updated_at=now()
     WHERE id=$1 RETURNING *`,
    [
      planId,
      merged.name.trim(),
      merged.description ?? null,
      merged.status ?? 'draft',
      merged.billingPeriod,
      merged.priceAmount,
      merged.discountType,
      merged.discountValue,
      JSON.stringify((merged.eligibleExtensions ?? []).map(normalizeExtension)),
      JSON.stringify(merged.promotion ?? {}),
    ]
  );
  const updated = rows[0];
  if (!updated) throw new Error('Failed to update Domain Club plan');
  return toPlanDto(updated);
}

function validatePlanInput(input: CreatePlanInput): void {
  if (!input.name || input.name.trim().length < 2 || input.name.trim().length > 120) {
    throw new ValidationError('Plan name must be between 2 and 120 characters');
  }
  const price = Number(input.priceAmount);
  if (!Number.isFinite(price) || price < 0 || price > 1_000_000) {
    throw new ValidationError('Plan price must be a non-negative amount');
  }
  const discountValue = Number(input.discountValue);
  if (!Number.isFinite(discountValue) || discountValue < 0) {
    throw new ValidationError('Discount value must be non-negative');
  }
  if (input.discountType === 'percentage' && discountValue > 100) {
    throw new ValidationError('A percentage discount cannot exceed 100');
  }
  if (input.discountType === 'fixed' && input.currency && input.currency.toUpperCase() !== DEFAULT_CURRENCY) {
    throw new ValidationError(`Fixed discounts must be in ${DEFAULT_CURRENCY}`);
  }
  if (!['monthly', 'annually'].includes(input.billingPeriod)) {
    throw new ValidationError('Billing period must be monthly or annually');
  }
}

async function findPlanRow(db: Queryable, planId: string): Promise<ClubPlanRow | null> {
  const { rows } = await db.query<ClubPlanRow>(`SELECT * FROM domain_club_plans WHERE id = $1 LIMIT 1`, [planId]);
  return rows[0] ?? null;
}

export interface MembershipDto {
  id: string;
  planId: string;
  planName: string;
  status: string;
  startsAt: string | null;
  renewsAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  orderId: string | null;
  invoiceId: string | null;
  billingPeriod: string;
  priceAmount: string;
}

export async function getMyMembership(db: Queryable, userId: string): Promise<MembershipDto | null> {
  const { rows } = await db.query<{
    id: string; plan_id: string; status: string; starts_at: string | null; renews_at: string | null;
    cancelled_at: string | null; created_at: string; order_id: string | null; plan_name: string;
    billing_period: string; price_amount: string;
  }>(
    `SELECT m.id, m.plan_id, m.status, m.starts_at, m.renews_at, m.cancelled_at, m.created_at,
            m.order_id, p.name AS plan_name, p.billing_period, p.price_amount
       FROM domain_club_memberships m
       JOIN domain_club_plans p ON p.id = m.plan_id
      WHERE m.user_id = $1
      ORDER BY m.created_at DESC
      LIMIT 1`,
    [userId]
  );
  const row = rows[0];
  if (!row) return null;
  const invoice = await db.query<{ id: string }>(
    `SELECT i.id FROM invoices i JOIN orders o ON o.id = i.order_id WHERE o.id = $1 LIMIT 1`,
    [row.order_id]
  );
  return {
    id: row.id,
    planId: row.plan_id,
    planName: row.plan_name,
    status: row.status,
    startsAt: row.starts_at,
    renewsAt: row.renews_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    orderId: row.order_id,
    invoiceId: invoice.rows[0]?.id ?? null,
    billingPeriod: row.billing_period,
    priceAmount: row.price_amount,
  };
}

export interface MembershipDiscount {
  type: 'percentage' | 'fixed';
  /** Percentage points (0–100) or cents (for fixed). */
  value: number;
  clubName: string;
}

/**
 * Resolves the member discount applicable to a specific domain. An empty eligibleExtensions list
 * means "all extensions". Returns null when the user has no active membership.
 */
export async function getActiveMembershipDiscount(
  db: Queryable,
  userId: string,
  domainName: string
): Promise<MembershipDiscount | null> {
  const { rows } = await db.query<{
    discount_type: string; discount_value: string; eligible_extensions: unknown; name: string;
  }>(
    `SELECT p.discount_type, p.discount_value, p.eligible_extensions, p.name
       FROM domain_club_memberships m
       JOIN domain_club_plans p ON p.id = m.plan_id
      WHERE m.user_id = $1 AND m.status = 'active' AND p.status = 'published'
      ORDER BY m.created_at DESC
      LIMIT 1`,
    [userId]
  );
  const membership = rows[0];
  if (!membership) return null;

  const extensions = Array.isArray(membership.eligible_extensions)
    ? (membership.eligible_extensions as unknown[]).filter((entry): entry is string => typeof entry === 'string')
    : [];
  if (extensions.length > 0) {
    const domainExtension = normalizeExtension(extensionOf(domainName));
    const eligible = extensions.some((entry) => normalizeExtension(entry) === domainExtension);
    if (!eligible) return null;
  }

  const value = Number(membership.discount_value);
  if (!Number.isFinite(value) || value <= 0) return null;
  return {
    type: membership.discount_type as 'percentage' | 'fixed',
    value: membership.discount_type === 'percentage' ? value : toCents(String(membership.discount_value)),
    clubName: membership.name,
  };
}

/**
 * Starts (or renews) a club membership: creates the membership row (pending_payment), the order +
 * invoice through the existing billing primitives, and the domain transaction. Activation happens
 * only after the verified payment webhook.
 */
export async function createMembershipOrder(
  db: Queryable,
  userId: string,
  planId: string,
  genId: () => string = randomUUID
): Promise<{ membershipId: string; orderId: string; invoiceId: string; invoiceNumber: string; amount: string; currency: string }> {
  const plan = await findPlanRow(db, planId);
  if (!plan || plan.status !== 'published') {
    throw new NotFoundError('That Domain Club plan is not available');
  }

  // One live membership per user (partial unique index backs this up).
  const { rows: existing } = await db.query<{ id: string; status: string }>(
    `SELECT id, status FROM domain_club_memberships
      WHERE user_id = $1 AND status IN ('pending_payment','active','past_due')`,
    [userId]
  );
  if (existing[0]) {
    throw new ConflictError(
      existing[0].status === 'pending_payment'
        ? 'You already have a membership purchase awaiting payment.'
        : 'You already have an active Domain Club membership.'
    );
  }

  const membershipId = genId();
  const orderId = genId();

  const result = await withTransaction(db, async (tx) => {
    await tx.query(
      `INSERT INTO domain_club_memberships (id, user_id, plan_id, status) VALUES ($1,$2,$3,'pending_payment')`,
      [membershipId, userId, planId]
    );

    const { order } = await createOrder(tx, {
      id: orderId,
      userId,
      currency: plan.currency,
      subtotalAmount: plan.price_amount,
      discountAmount: '0.00',
      taxAmount: '0.00',
      totalAmount: plan.price_amount,
      items: [
        {
          id: genId(),
          productId: null,
          planId: null,
          productNameSnapshot: 'Discount Domain Club',
          planNameSnapshot: `${plan.name} membership (${plan.billing_period})`,
          billingPeriod: plan.billing_period === 'monthly' ? 'monthly' : 'annually',
          quantity: 1,
          unitPriceAmount: plan.price_amount,
          currency: plan.currency,
          lineTotalAmount: plan.price_amount,
          metadata: { kind: 'domain_club_membership', membershipId, planId: plan.id },
        },
      ],
    });
    const invoice = await issueInvoiceForOrder(tx, order, genId);
    await tx.query(`UPDATE domain_club_memberships SET order_id=$2 WHERE id=$1`, [membershipId, order.id]);

    await recordDomainTransaction(tx, {
      userId,
      transactionType: 'club_membership',
      status: 'pending',
      amount: plan.price_amount,
      currency: plan.currency,
      orderId: order.id,
      invoiceId: invoice.id,
      membershipId,
      metadata: { planName: plan.name, billingPeriod: plan.billing_period },
    });

    return { order, invoice };
  });

  return {
    membershipId,
    orderId: result.order.id,
    invoiceId: result.invoice.id,
    invoiceNumber: result.invoice.invoice_number,
    amount: result.order.total_amount,
    currency: result.order.currency,
  };
}

/** Webhook-settlement hook: activates a paid membership (idempotent). */
export async function markMembershipPaymentVerified(tx: Queryable, membershipId: string): Promise<void> {
  const { rows: planRows } = await tx.query(
    `SELECT p.billing_period FROM domain_club_memberships m JOIN domain_club_plans p ON p.id = m.plan_id WHERE m.id = $1`,
    [membershipId]
  );
  const period = planRows[0]?.billing_period === 'monthly' ? '1 month' : '1 year';
  const { rows: activated } = await tx.query(
    `UPDATE domain_club_memberships
        SET status = 'active', starts_at = now(), renews_at = now() + $2::interval, updated_at = now()
      WHERE id = $1 AND status = 'pending_payment'
      RETURNING id`,
    [membershipId, period]
  );
  if (activated.length === 0) return;
  const { rows: membership } = await tx.query<{ user_id: string; plan_id: string }>(
    `SELECT user_id, plan_id FROM domain_club_memberships WHERE id = $1`,
    [membershipId]
  );
  if (membership[0]) {
    const { rows: txn } = await tx.query<{ id: string }>(
      `SELECT id FROM domain_transactions WHERE membership_id = $1 AND transaction_type = 'club_membership' LIMIT 1`,
      [membershipId]
    );
    if (txn[0]) await setDomainTransactionStatus(tx, txn[0].id, 'paid');

    const { createNotification } = await import('../services/notification-service');
    await createNotification(tx, {
      userId: membership[0].user_id,
      type: 'DOMAIN_CLUB_ACTIVATED',
      title: 'Your Discount Domain Club membership is active',
      message: 'Member pricing is now applied automatically to eligible domain registrations.',
      resourceType: 'domain_club_membership',
      resourceId: membershipId,
    }).catch(() => undefined);
  }
}

/** Customer-initiated cancellation (stops renewal; keeps the paid term). */
export async function cancelMyMembership(db: Queryable, userId: string, membershipId: string): Promise<void> {
  const { rows: cancelled } = await db.query(
    `UPDATE domain_club_memberships
        SET status = 'cancelled', cancelled_at = now(), updated_at = now()
      WHERE id = $1 AND user_id = $2 AND status IN ('active','past_due')
      RETURNING id`,
    [membershipId, userId]
  );
  if (cancelled.length === 0) throw new NotFoundError('No cancellable membership was found');
}

/** Worker sweep: expire active memberships past their renewal date (no auto-charge exists). */
export async function expireLapsedMemberships(db: Queryable): Promise<number> {
  const { rows: expiredNow } = await db.query(
    `UPDATE domain_club_memberships
        SET status = 'expired', updated_at = now()
      WHERE status = 'active' AND renews_at < now()
      RETURNING id`
  );
  if (expiredNow.length > 0) {
    const { rows: expired } = await db.query<{ user_id: string; id: string }>(
      `SELECT user_id, id FROM domain_club_memberships WHERE status = 'expired' AND renews_at < now() - interval '1 day'`
    );
    const { createNotification } = await import('../services/notification-service');
    for (const membership of expired) {
      await createNotification(db, {
        userId: membership.user_id,
        type: 'DOMAIN_CLUB_EXPIRED',
        title: 'Your Discount Domain Club membership has expired',
        message: 'Member pricing is no longer applied. Renew from the Domain Club page to restore your discount.',
        resourceType: 'domain_club_membership',
        resourceId: membership.id,
      }).catch(() => undefined);
    }
  }
  return expiredNow.length;
}

/**
 * Public member-pricing preview: computes Standard / Member / You Save for a domain from the
 * configured plan + a provider quote. Used by the club page; never accepts client prices.
 */
export async function memberPricingPreview(
  db: Queryable,
  userId: string | null,
  standardPrice: string
): Promise<{ standardPrice: string; memberPrice: string | null; savings: string | null }> {
  void userId;
  const { rows } = await db.query<{ discount_type: string; discount_value: string }>(
    `SELECT p.discount_type, p.discount_value
       FROM domain_club_plans p
      WHERE p.status = 'published' AND p.discount_value > 0
      ORDER BY p.created_at ASC LIMIT 1`
  );
  const plan = rows[0];
  if (!plan) return { standardPrice, memberPrice: null, savings: null };
  const standardCents = toCents(standardPrice);
  const discountCents =
    plan.discount_type === 'percentage'
      ? Math.round((standardCents * Number(plan.discount_value)) / 100)
      : Math.min(toCents(String(plan.discount_value)), standardCents);
  const memberCents = Math.max(0, standardCents - discountCents);
  return {
    standardPrice,
    memberPrice: fromCents(memberCents),
    savings: fromCents(discountCents),
  };
}
