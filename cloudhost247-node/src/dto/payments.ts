import type { PaymentRow } from '../db/payments';

/**
 * Phase 5C payment DTOs — same "never leak an internal field, never fabricate a value" mapping
 * layer used throughout this codebase (src/dto/catalog.ts, src/dto/account.ts, src/dto/commerce.ts,
 * src/dto/billing.ts). Deliberately does not expose `confirmed_by_user_id`: which staff member
 * confirmed a manual payment is an internal audit detail (already recorded in `auth_audit_log`),
 * not something a customer-facing or even admin-facing payment view needs to render as of this
 * phase.
 */
export interface PaymentDTO {
  id: string;
  invoiceId: string;
  provider: string | null;
  providerReference: string | null;
  method: string | null;
  amount: string;
  currency: string;
  status: string;
  failureReason: string | null;
  initiatedAt: string;
  completedAt: string | null;
  /** Only ever populated on the immediate response to initiating a payment (see
   * `src/services/payment-service.ts#initiatePaymentForInvoice`) — instructions text (e.g. bank
   * transfer details) is a property of the gateway call that created the attempt, not something
   * persisted on the `payments` row, so it is `null` on every other read of the same payment
   * (e.g. `GET /api/v1/payments/:id`). */
  instructions?: string | null;
}

export function toPaymentDTO(row: PaymentRow): PaymentDTO {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    provider: row.provider,
    providerReference: row.provider_reference,
    method: row.method,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    failureReason: row.failure_reason,
    initiatedAt: row.initiated_at,
    completedAt: row.completed_at,
    instructions: null,
  };
}
