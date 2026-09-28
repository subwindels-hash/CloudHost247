import { randomBytes } from 'node:crypto';
import type { Env } from '../config/env';
import type { PaymentRow } from '../db/payments';
import type { GatewayInitiationResult, InitiatePaymentInput, PaymentGateway } from './types';
import { signPayload } from './webhook-signing';

/**
 * A self-contained "fake real gateway" used for demoing/testing the async, webhook-driven payment
 * flow without any real third-party integration or money movement. Initiating a payment through it
 * behaves exactly like a real hosted-checkout provider would: it hands back a provider reference
 * immediately and the payment stays `pending` until *this same application*, acting as the
 * "provider" side, would later deliver a signed webhook call confirming it.
 *
 * That webhook-receiving half does not exist yet — it is explicitly Phase 5D's job — so as of
 * Phase 5C a sandbox-gateway payment has no way to ever leave `pending`. This is a deliberate,
 * documented limitation, not a bug: see docs/API_PAYMENTS.md.
 */
export const sandboxGateway: PaymentGateway = {
  id: 'sandbox',
  async initiatePayment(input: InitiatePaymentInput, _env: Env): Promise<GatewayInitiationResult> {
    return {
      providerReference: `sandbox_${randomBytes(12).toString('hex')}`,
      method: 'sandbox_demo',
      instructions: `This is a simulated payment for invoice ${input.invoiceNumber}. No real money moves; the sandbox gateway is for testing the payment integration only.`,
    };
  },
};

export type SandboxWebhookOutcome = 'successful' | 'failed';

export interface SandboxWebhookPayload {
  provider: 'sandbox';
  providerReference: string;
  paymentId: string;
  outcome: SandboxWebhookOutcome;
  amount: string;
  currency: string;
  occurredAt: string;
}

/**
 * Builds the exact JSON payload (and its HMAC-SHA256 signature under
 * `env.SANDBOX_GATEWAY_WEBHOOK_SECRET`) that Phase 5D's webhook receiver will need to accept and
 * verify. Not wired into any route in Phase 5C — this exists purely as groundwork so that phase can
 * start from a known-correct, already-tested payload/signature shape instead of inventing one from
 * scratch. Throws if the deployment never configured a webhook secret, since a signature cannot be
 * produced without one.
 */
export function buildSignedWebhookPayload(
  payment: PaymentRow,
  outcome: SandboxWebhookOutcome,
  env: Env
): { payload: SandboxWebhookPayload; rawBody: string; signature: string } {
  if (!env.SANDBOX_GATEWAY_WEBHOOK_SECRET) {
    throw new Error('SANDBOX_GATEWAY_WEBHOOK_SECRET is not configured — cannot sign a sandbox webhook payload');
  }
  if (payment.provider !== 'sandbox' || !payment.provider_reference) {
    throw new Error('buildSignedWebhookPayload can only be used for a payment initiated through the sandbox gateway');
  }

  const payload: SandboxWebhookPayload = {
    provider: 'sandbox',
    providerReference: payment.provider_reference,
    paymentId: payment.id,
    outcome,
    amount: payment.amount,
    currency: payment.currency,
    occurredAt: new Date().toISOString(),
  };

  const rawBody = JSON.stringify(payload);
  const signature = signPayload(env.SANDBOX_GATEWAY_WEBHOOK_SECRET, rawBody);

  return { payload, rawBody, signature };
}
