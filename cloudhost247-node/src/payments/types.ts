import type { Env } from '../config/env';

/**
 * Phase 5C & 5D payment gateway abstraction. A "gateway" is anything capable of *initiating* a payment
 * attempt for an invoice and *handling* incoming verified webhooks asynchronously.
 */
export interface InitiatePaymentInput {
  paymentId: string;
  invoiceNumber: string;
  amount: string;
  currency: string;
}

export interface GatewayInitiationResult {
  /** The gateway's own identifier for this attempt, if it has one yet (null for the manual
   * gateway, which has no external system to reference). */
  providerReference: string | null;
  /** Free-form payment method label shown back to the customer (e.g. `bank_transfer`,
   * `sandbox_demo`) — never a real card network/scheme name fabricated by this codebase. */
  method: string;
  /** Optional human-readable instructions for completing the payment (only the manual gateway
   * currently populates this). */
  instructions?: string | null;
}

export interface PaymentGateway {
  /** Stable identifier persisted as `payments.provider` — must match one of the ids the
   * gateway-registry (src/payments/gateway-registry.ts) and the API's `gateway` request field
   * both recognize. */
  readonly id: string;
  initiatePayment(input: InitiatePaymentInput, env: Env): Promise<GatewayInitiationResult>;
}

export interface WebhookEventDTO {
  gateway: string;
  providerEventId: string;
  providerTransmissionId?: string;
  providerPaymentReference: string;
  cloudhostPaymentId?: string;
  canonicalEventType: 'payment.success' | 'payment.failed' | 'payment.cancelled' | 'unhandled';
  eventOccurredAt: Date;
  receivedAt: Date;
  amountCents: number;
  currency: string;
  outcome: 'succeeded' | 'failed' | 'pending' | 'unhandled';
  failureReason?: string;
  rawPayloadHash: string;
}

export interface WebhookHandler {
  readonly gatewayId: string;
  verifySignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
    env: Env
  ): Promise<boolean> | boolean;
  parseEvent(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
    rawPayloadHash: string
  ): WebhookEventDTO;
}
