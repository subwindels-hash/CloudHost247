/**
 * Domain appraisal — provider-backed valuation, payment-gated when a fee is configured.
 *
 * Only a real appraisal provider (GoValue) produces valuations. Comparable sales are shown only
 * when the provider supplies them; this platform never invents a sale. Every valuation is an
 * estimate, never a guaranteed price.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { createOrder } from '../db/orders';
import { issueInvoiceForOrder } from '../services/billing-service';
import { NotFoundError, ValidationError } from '../lib/errors';
import { DEFAULT_CURRENCY } from '../config/billing';
import { DomainProviderError } from './providers/types';
import { resolveConnectedDomainProvider } from './provider-service';
import { isValidDomainName, normalizeDomainName } from './domain-name';
import { recordDomainTransaction, setDomainTransactionStatus } from './transactions';
import { APPRAISAL_MAX_PER_DAY } from './config';

/** Appraisal fee in platform currency. Zero = free appraisals (still provider-gated). */
const APPRAISAL_FEE = { amount: '0.00', currency: DEFAULT_CURRENCY, enabled: false };

export interface AppraisalRequestResult {
  appraisalId: string;
  orderId: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  amount: string;
  currency: string;
  /** Present when the appraisal executed immediately (fee-free path). */
  appraisal: AppraisalOutcomeResult | null;
  status: 'pending_payment' | 'completed' | 'provider_not_configured' | 'provider_error';
  message: string | null;
}

export interface AppraisalOutcomeResult {
  domainName: string;
  estimatedValue: string;
  currency: string;
  confidence: string | null;
  tld: string;
  domainLength: number;
  keywords: string[];
  brandability: string | null;
  comparableSales: Array<{ domainName: string; price: string; soldAt: string | null; source: string | null }>;
  factors: Record<string, unknown>;
  disclaimer: string;
}

const APPRAISAL_DISCLAIMER =
  'This valuation is an estimate produced by an automated model. It is not a guaranteed selling price, an offer, or an appraisal for legal, tax, or lending purposes.';

export async function requestAppraisal(
  db: Queryable,
  userId: string,
  domainName: string,
  genId: () => string = randomUUID
): Promise<AppraisalRequestResult> {
  const normalized = normalizeDomainName(domainName);
  if (!isValidDomainName(normalized)) throw new ValidationError('Enter a valid domain name, e.g. example.com');

  const { rows: recent } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM domain_appraisals
      WHERE user_id = $1 AND created_at > now() - interval '1 day'`,
    [userId]
  );
  if (Number(recent[0]?.count ?? 0) >= APPRAISAL_MAX_PER_DAY) {
    throw new ValidationError(`You can request ${APPRAISAL_MAX_PER_DAY} appraisals per day. Please try again tomorrow.`);
  }

  let provider;
  try {
    provider = await resolveConnectedDomainProvider(db, 'appraisal');
  } catch (error) {
    if (error instanceof DomainProviderError && error.code === 'PROVIDER_NOT_CONFIGURED') {
      return {
        appraisalId: '',
        orderId: null,
        invoiceId: null,
        invoiceNumber: null,
        amount: '0.00',
        currency: DEFAULT_CURRENCY,
        appraisal: null,
        status: 'provider_not_configured',
        message: 'Service Provider Not Configured',
      };
    }
    throw error;
  }

  const appraisalId = genId();

  if (!APPRAISAL_FEE.enabled) {
    // Fee-free path: execute immediately and store the provider's real result.
    try {
      const result = await provider.adapter.appraiseDomain(normalized);
      const outcome = { ...toOutcome(result), domainName: normalized };
      await withTransaction(db, async (tx) => {
        await tx.query(
          `INSERT INTO domain_appraisals
             (id, user_id, provider_id, domain_name, status, estimated_value, currency, confidence,
              valuation, completed_at)
           VALUES ($1,$2,$3,$4,'completed',$5,$6,$7,$8,now())`,
          [
            appraisalId,
            userId,
            provider.provider.id,
            normalized,
            result.estimatedValue.amount,
            result.estimatedValue.currency.toUpperCase(),
            result.confidence,
            JSON.stringify({
              keywords: result.keywords,
              brandability: result.brandability,
              comparableSales: result.comparableSales,
              factors: result.factors,
              disclaimer: APPRAISAL_DISCLAIMER,
            }),
          ]
        );
        await recordDomainTransaction(tx, {
          userId,
          transactionType: 'appraisal',
          status: 'paid',
          amount: '0.00',
          currency: DEFAULT_CURRENCY,
          appraisalId,
          providerReference: result.providerReference,
          metadata: { domainName: normalized, feeFree: true },
        });
      });
      return {
        appraisalId,
        orderId: null,
        invoiceId: null,
        invoiceNumber: null,
        amount: '0.00',
        currency: DEFAULT_CURRENCY,
        appraisal: outcome,
        status: 'completed',
        message: null,
      };
    } catch (error) {
      return {
        appraisalId: '',
        orderId: null,
        invoiceId: null,
        invoiceNumber: null,
        amount: '0.00',
        currency: DEFAULT_CURRENCY,
        appraisal: null,
        status: 'provider_error',
        message: 'We could not complete this request right now. Please try again.',
      };
    }
  }

  // Fee path: order first, appraisal executes only after verified payment.
  const orderId = genId();
  const result = await withTransaction(db, async (tx) => {
    await tx.query(
      `INSERT INTO domain_appraisals (id, user_id, provider_id, domain_name, status)
       VALUES ($1,$2,$3,$4,'pending_payment')`,
      [appraisalId, userId, provider.provider.id, normalized]
    );
    const { order } = await createOrder(tx, {
      id: orderId,
      userId,
      currency: APPRAISAL_FEE.currency,
      subtotalAmount: APPRAISAL_FEE.amount,
      discountAmount: '0.00',
      taxAmount: '0.00',
      totalAmount: APPRAISAL_FEE.amount,
      items: [
        {
          id: genId(),
          productId: null,
          planId: null,
          productNameSnapshot: 'Domain Services',
          planNameSnapshot: `Domain appraisal — ${normalized}`,
          billingPeriod: 'one_time',
          quantity: 1,
          unitPriceAmount: APPRAISAL_FEE.amount,
          currency: APPRAISAL_FEE.currency,
          lineTotalAmount: APPRAISAL_FEE.amount,
          metadata: { kind: 'domain_appraisal', appraisalId, domainName: normalized },
        },
      ],
    });
    const invoice = await issueInvoiceForOrder(tx, order, genId);
    await tx.query(`UPDATE domain_appraisals SET order_id=$2, invoice_id=$3 WHERE id=$1`, [appraisalId, order.id, invoice.id]);
    await recordDomainTransaction(tx, {
      userId,
      transactionType: 'appraisal',
      status: 'pending',
      amount: APPRAISAL_FEE.amount,
      currency: APPRAISAL_FEE.currency,
      orderId: order.id,
      invoiceId: invoice.id,
      appraisalId,
      metadata: { domainName: normalized },
    });
    return { order, invoice };
  });

  return {
    appraisalId,
    orderId: result.order.id,
    invoiceId: result.invoice.id,
    invoiceNumber: result.invoice.invoice_number,
    amount: result.order.total_amount,
    currency: result.order.currency,
    appraisal: null,
    status: 'pending_payment',
    message: null,
  };
}

function toOutcome(result: {
  estimatedValue: { amount: string; currency: string };
  confidence: string | null;
  tld: string;
  domainLength: number;
  keywords: string[];
  brandability: string | null;
  comparableSales: Array<{ domainName: string; price: { amount: string; currency: string }; soldAt: string | null; source?: string | null }>;
  factors: Record<string, unknown>;
}): AppraisalOutcomeResult {
  return {
    domainName: '',
    estimatedValue: result.estimatedValue.amount,
    currency: result.estimatedValue.currency,
    confidence: result.confidence,
    tld: result.tld,
    domainLength: result.domainLength,
    keywords: result.keywords,
    brandability: result.brandability,
    comparableSales: result.comparableSales.map((sale) => ({
      domainName: sale.domainName,
      price: sale.price.amount,
      soldAt: sale.soldAt,
      source: sale.source ?? null,
    })),
    factors: result.factors,
    disclaimer: APPRAISAL_DISCLAIMER,
  };
}

/** Webhook-settlement hook: a paid appraisal becomes executable (idempotent). */
export async function markAppraisalPaymentVerified(tx: Queryable, appraisalId: string): Promise<void> {
  const { rows: advanced } = await tx.query(
    `UPDATE domain_appraisals SET status='payment_verified', updated_at=now()
      WHERE id=$1 AND status='pending_payment'
      RETURNING id`,
    [appraisalId]
  );
  if (advanced.length === 0) return;
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM domain_transactions WHERE appraisal_id=$1 AND transaction_type='appraisal' LIMIT 1`,
    [appraisalId]
  );
  if (rows[0]) await setDomainTransactionStatus(tx, rows[0].id, 'processing');
}

/** Worker sweep: execute appraisals whose payment has been verified. */
export async function processPaidAppraisals(pool: Queryable, batchSize = 10): Promise<{ executed: number; failed: number }> {
  const { rows: candidates } = await pool.query<{ id: string; user_id: string; domain_name: string; provider_id: string | null }>(
    `SELECT a.id, a.user_id, a.domain_name, a.provider_id
       FROM domain_appraisals a
      WHERE a.status = 'payment_verified'
      ORDER BY a.updated_at ASC
      LIMIT $1`,
    [batchSize]
  );

  let executed = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const { rows: claimed } = await pool.query<{ id: string }>(
      `UPDATE domain_appraisals SET status='requested', updated_at=now()
        WHERE id=$1 AND status='payment_verified' RETURNING id`,
      [candidate.id]
    );
    if (!claimed[0]) continue;

    try {
      const provider = await resolveConnectedDomainProvider(pool, 'appraisal');
      const result = await provider.adapter.appraiseDomain(candidate.domain_name);
      await withTransaction(pool, async (tx) => {
        await tx.query(
          `UPDATE domain_appraisals
              SET status='completed', estimated_value=$2, currency=$3, confidence=$4, valuation=$5,
                  provider_reference=$6, completed_at=now(), updated_at=now()
            WHERE id=$1`,
          [
            candidate.id,
            result.estimatedValue.amount,
            result.estimatedValue.currency.toUpperCase(),
            result.confidence,
            JSON.stringify({
              keywords: result.keywords,
              brandability: result.brandability,
              comparableSales: result.comparableSales,
              factors: result.factors,
              disclaimer: APPRAISAL_DISCLAIMER,
            }),
            result.providerReference,
          ]
        );
        const { rows: txn } = await tx.query<{ id: string }>(
          `SELECT id FROM domain_transactions WHERE appraisal_id=$1 AND transaction_type='appraisal' LIMIT 1`,
          [candidate.id]
        );
        if (txn[0]) await setDomainTransactionStatus(tx, txn[0].id, 'paid', { providerReference: result.providerReference });
      });

      const { createNotification } = await import('../services/notification-service');
      await createNotification(pool, {
        userId: candidate.user_id,
        type: 'DOMAIN_APPRAISAL_COMPLETED',
        title: 'Your domain appraisal is ready',
        message: `The appraisal for ${candidate.domain_name} is now available in your dashboard.`,
        resourceType: 'domain_appraisal',
        resourceId: candidate.id,
      }).catch(() => undefined);
      executed += 1;
    } catch (error) {
      failed += 1;
      await pool.query(
        `UPDATE domain_appraisals
            SET status='failed', error_code='PROVIDER_ERROR',
                error_message=$2, updated_at=now()
          WHERE id=$1`,
        [candidate.id, (error instanceof Error ? error.message : String(error)).slice(0, 500)]
      );
      const { rows: txn } = await pool.query<{ id: string }>(
        `SELECT id FROM domain_transactions WHERE appraisal_id=$1 AND transaction_type='appraisal' LIMIT 1`,
        [candidate.id]
      );
      if (txn[0]) await setDomainTransactionStatus(pool, txn[0].id, 'failed', { errorCode: 'PROVIDER_ERROR' });
    }
  }
  return { executed, failed };
}

export async function listMyAppraisals(db: Queryable, userId: string) {
  const { rows } = await db.query(
    `SELECT a.id, a.domain_name, a.status, a.estimated_value, a.currency, a.confidence, a.valuation,
            a.completed_at, a.error_code, a.created_at, i.invoice_number, i.status AS invoice_status
       FROM domain_appraisals a
       LEFT JOIN invoices i ON i.id = a.invoice_id
      WHERE a.user_id = $1
      ORDER BY a.created_at DESC`,
    [userId]
  );
  return rows;
}

export async function getMyAppraisal(db: Queryable, userId: string, appraisalId: string) {
  const { rows } = await db.query(
    `SELECT id, domain_name, status, estimated_value, currency, confidence, valuation, completed_at,
            error_code, error_message, created_at
       FROM domain_appraisals WHERE id=$1 AND user_id=$2`,
    [appraisalId, userId]
  );
  if (!rows[0]) throw new NotFoundError('No appraisal was found with that id');
  return rows[0];
}
