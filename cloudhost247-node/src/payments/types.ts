import type { Env } from '../config/env';

/**
 * Phase 5C payment gateway abstraction. A "gateway" is anything capable of *initiating* a payment
 * attempt for an invoice — it is deliberately not asked to (and cannot) report success or failure
 * synchronously. Every real gateway confirms a payment asynchronously (a redirect callback, a
 * webhook, a human) — modelling `initiatePayment` as "return the details of a now-pending attempt"
 * rather than "return whether it succeeded" is what keeps this interface honest about that, and
 * keeps Phase 5D's job (receiving and verifying those asynchronous confirmations) a separate,
 * additive layer instead of something baked into this interface's shape.
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
