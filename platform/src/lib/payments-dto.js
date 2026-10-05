/**
 * The customer- and staff-facing payment DTO (src/dto/payments.ts toPaymentDTO).
 *
 * Shared by the customer payment routes and the admin billing surface so a payment is described
 * identically wherever it is returned. This schema names the gateway column `gateway` where the
 * source calls it `provider`, and records a rejection rather than a generic failure reason, so
 * those two are mapped on the way out.
 */
'use strict';

function paymentDto(row) {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    provider: row.gateway,
    providerReference: row.gateway_reference ?? null,
    method: row.method ?? null,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    failureReason: row.rejection_reason ?? null,
    initiatedAt: row.created_at,
    completedAt: row.confirmed_at ?? null,
    instructions: null,
  };
}

module.exports = { paymentDto };
