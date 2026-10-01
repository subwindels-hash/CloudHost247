/**
 * domain_transactions writer — the single Domain Services view over the authoritative commerce
 * records. The payment webhook remains the only thing that may set a transaction `paid`; this
 * helper only records and advances state that has actually happened.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';

export type DomainTransactionType =
  | 'registration'
  | 'renewal'
  | 'transfer'
  | 'auction_payment'
  | 'appraisal'
  | 'club_membership'
  | 'broker_fee'
  | 'domain_acquisition'
  | 'refund';

export type DomainTransactionStatus =
  | 'pending'
  | 'authorized'
  | 'processing'
  | 'paid'
  | 'failed'
  | 'refunded'
  | 'cancelled';

export interface RecordDomainTransactionInput {
  userId: string;
  transactionType: DomainTransactionType;
  status: DomainTransactionStatus;
  amount: string;
  currency: string;
  orderId?: string | null;
  invoiceId?: string | null;
  paymentId?: string | null;
  registrationId?: string | null;
  transferId?: string | null;
  auctionId?: string | null;
  appraisalId?: string | null;
  brokerCaseId?: string | null;
  membershipId?: string | null;
  providerReference?: string | null;
  metadata?: Record<string, unknown>;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export async function recordDomainTransaction(
  db: Queryable,
  input: RecordDomainTransactionInput
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO domain_transactions
       (id, user_id, transaction_type, status, amount, currency, order_id, invoice_id, payment_id,
        registration_id, transfer_id, auction_id, appraisal_id, broker_case_id, membership_id,
        provider_reference, metadata, error_code, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [
      id,
      input.userId,
      input.transactionType,
      input.status,
      input.amount,
      input.currency.toUpperCase(),
      input.orderId ?? null,
      input.invoiceId ?? null,
      input.paymentId ?? null,
      input.registrationId ?? null,
      input.transferId ?? null,
      input.auctionId ?? null,
      input.appraisalId ?? null,
      input.brokerCaseId ?? null,
      input.membershipId ?? null,
      input.providerReference ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.errorCode ?? null,
      input.errorMessage ?? null,
    ]
  );
  return id;
}

/** Advances a domain transaction's status (e.g. pending → paid after a verified webhook). */
export async function setDomainTransactionStatus(
  db: Queryable,
  transactionId: string,
  status: DomainTransactionStatus,
  patch: { paymentId?: string | null; providerReference?: string | null; errorCode?: string | null; errorMessage?: string | null } = {}
): Promise<void> {
  await db.query(
    `UPDATE domain_transactions
        SET status=$2,
            payment_id=COALESCE($3, payment_id),
            provider_reference=COALESCE($4, provider_reference),
            error_code=$5,
            error_message=$6,
            updated_at=now()
      WHERE id=$1`,
    [transactionId, status, patch.paymentId ?? null, patch.providerReference ?? null, patch.errorCode ?? null, patch.errorMessage ?? null]
  );
}

/** Finds the transaction linked to a specific order for a transaction type (unique per linkage by construction). */
export async function findDomainTransactionByOrder(
  db: Queryable,
  orderId: string,
  transactionType: DomainTransactionType
): Promise<{ id: string; status: string } | null> {
  const { rows } = await db.query<{ id: string; status: string }>(
    `SELECT id, status FROM domain_transactions WHERE order_id=$1 AND transaction_type=$2 LIMIT 1`,
    [orderId, transactionType]
  );
  return rows[0] ?? null;
}
