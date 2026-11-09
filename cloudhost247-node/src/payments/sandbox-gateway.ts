import { randomBytes } from 'node:crypto';
import type { Env } from '../config/env';
import type { PaymentRow } from '../db/payments';
import { toCents } from '../lib/money';
import type {
  InitiatePaymentInput,
  GatewayInitiationResult,
  PaymentGateway,
  WebhookEventDTO,
  WebhookHandler,
} from './types';
import { signPayload, verifySignature } from './webhook-signing';

export class SandboxGateway implements PaymentGateway, WebhookHandler {
  readonly id = 'sandbox';
  readonly gatewayId = 'sandbox';

  async initiatePayment(input: InitiatePaymentInput, _env: Env): Promise<GatewayInitiationResult> {
    return {
      providerReference: `sandbox_${randomBytes(12).toString('hex')}`,
      method: 'sandbox_demo',
      instructions: `This is a simulated payment for invoice ${input.invoiceNumber}. No real money moves; the sandbox gateway is for testing the payment integration only.`,
    };
  }

  verifySignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
    env: Env
  ): boolean {
    const secret = env.SANDBOX_GATEWAY_WEBHOOK_SECRET;
    if (!secret) return false;

    const getHdr = (name: string): string | null => {
      const v = headers[name] ?? headers[name.toLowerCase()];
      return Array.isArray(v) ? (v[0] ?? null) : v ?? null;
    };

    const signature = getHdr('x-cloudhost-signature') || getHdr('x-sandbox-signature') || getHdr('x-signature');
    if (!signature) return false;

    // Timestamp freshness is MANDATORY for this gateway (Phase 5 hardening, finding P4-F1).
    // An omitted timestamp used to skip the freshness window entirely; replay was still bounded
    // by webhook-event idempotency, but the window should not depend on the dedup store being
    // reachable. A sandbox webhook without a parseable in-window timestamp is rejected outright,
    // exactly like Stripe requires `t=` in `Stripe-Signature`.
    const timestamp = getHdr('x-cloudhost-timestamp');
    if (!timestamp) return false;
    const timeMs = parseInt(timestamp, 10);
    if (isNaN(timeMs) || Math.abs(Date.now() - timeMs) > 300 * 1000) {
      return false;
    }

    return verifySignature(secret, rawBody.toString('utf8'), signature);
  }

  parseEvent(
    rawBody: Buffer,
    _headers: Record<string, string | string[] | undefined>,
    rawPayloadHash: string
  ): WebhookEventDTO {
    const json = JSON.parse(rawBody.toString('utf8'));
    const isSuccess = json.outcome === 'successful';
    const isFailure = json.outcome === 'failed';

    let canonicalEventType: WebhookEventDTO['canonicalEventType'] = 'unhandled';
    let outcome: WebhookEventDTO['outcome'] = 'unhandled';

    if (isSuccess) {
      canonicalEventType = 'payment.success';
      outcome = 'succeeded';
    } else if (isFailure) {
      canonicalEventType = 'payment.failed';
      outcome = 'failed';
    }

    // Standardized amount representation (Phase 5 hardening, finding P4-F2):
    //   - string  → decimal MAJOR units, exact-cent parsed via toCents ("10.00" → 1000) — PRIMARY
    //   - number  → integer MINOR units only (1000 = $10.00); fractional numbers are rejected:
    //               10.5 as a number would silently mean ten and a half CENTS, an ambiguity no
    //               financial field may carry
    // Anything else (missing, boolean, object, fractional number, malformed string) throws so
    // the receiver answers 400 "Malformed webhook payload" instead of guessing an amount.
    let amountCents = 0;
    if (typeof json.amount === 'string') {
      amountCents = toCents(json.amount);
    } else if (typeof json.amount === 'number' && Number.isInteger(json.amount) && json.amount >= 0) {
      amountCents = json.amount;
    } else {
      throw new TypeError('Sandbox webhook requires amount as a decimal string (major units) or integer cents (number)');
    }

    const providerReference = String(json.providerReference || '');
    const occurredAt = json.occurredAt ? new Date(json.occurredAt) : new Date();
    const providerEventId = String(json.eventId || `sb_evt_${providerReference}_${occurredAt.getTime()}`);

    return {
      gateway: 'sandbox',
      providerEventId,
      providerPaymentReference: providerReference,
      cloudhostPaymentId: json.paymentId ? String(json.paymentId) : undefined,
      canonicalEventType,
      eventOccurredAt: occurredAt,
      receivedAt: new Date(),
      amountCents,
      currency: typeof json.currency === 'string' ? json.currency.toUpperCase() : 'USD',
      outcome,
      failureReason: isFailure ? 'Sandbox simulated payment failure' : undefined,
      rawPayloadHash,
    };
  }
}

export const sandboxGateway = new SandboxGateway();

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
 * `env.SANDBOX_GATEWAY_WEBHOOK_SECRET`) that Phase 5D's webhook receiver accepts and verifies.
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
