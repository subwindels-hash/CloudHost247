import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from '../config/env';
import type {
  InitiatePaymentInput,
  GatewayInitiationResult,
  PaymentGateway,
  WebhookEventDTO,
  WebhookHandler,
} from './types';

export class StripeGateway implements PaymentGateway, WebhookHandler {
  readonly id = 'stripe';
  readonly gatewayId = 'stripe';

  async initiatePayment(input: InitiatePaymentInput, _env: Env): Promise<GatewayInitiationResult> {
    return {
      providerReference: `pi_mock_${input.paymentId.replace(/-/g, '').slice(0, 16)}`,
      method: 'stripe_card',
      instructions: null,
    };
  }

  verifySignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
    env: Env
  ): boolean {
    const secret = env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return false;

    const header = headers['stripe-signature'];
    const sigHeader = Array.isArray(header) ? header[0] : header;
    if (!sigHeader) return false;

    // Parse header components: t=123456789,v1=hexsignature...
    const items = sigHeader.split(',').map((part) => part.trim().split('='));
    let timestamp: number | null = null;
    const signatures: string[] = [];

    for (const [key, value] of items) {
      if (key === 't' && value) {
        timestamp = parseInt(value, 10);
      } else if (key === 'v1' && value) {
        signatures.push(value);
      }
    }

    if (!timestamp || isNaN(timestamp) || signatures.length === 0) {
      return false;
    }

    // Freshness check: reject timestamps older or newer than 300 seconds
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - timestamp) > 300) {
      return false;
    }

    const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
    const expectedSig = createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
    const expectedBuf = Buffer.from(expectedSig, 'hex');

    for (const sig of signatures) {
      const sigBuf = Buffer.from(sig, 'hex');
      if (expectedBuf.length === sigBuf.length && timingSafeEqual(expectedBuf, sigBuf)) {
        return true;
      }
    }

    return false;
  }

  parseEvent(
    rawBody: Buffer,
    _headers: Record<string, string | string[] | undefined>,
    rawPayloadHash: string
  ): WebhookEventDTO {
    const json = JSON.parse(rawBody.toString('utf8'));
    const eventType = String(json.type || '');
    const dataObj = json.data?.object || {};

    let canonicalEventType: WebhookEventDTO['canonicalEventType'] = 'unhandled';
    let outcome: WebhookEventDTO['outcome'] = 'unhandled';
    let failureReason: string | undefined = undefined;

    if (eventType === 'payment_intent.succeeded') {
      canonicalEventType = 'payment.success';
      outcome = 'succeeded';
    } else if (eventType === 'payment_intent.payment_failed') {
      canonicalEventType = 'payment.failed';
      outcome = 'failed';
      failureReason = dataObj.last_payment_error?.message || 'Payment intent failed';
    } else if (eventType === 'payment_intent.canceled') {
      canonicalEventType = 'payment.cancelled';
      outcome = 'failed';
      failureReason = 'Payment intent was canceled';
    }

    const amountCents = typeof dataObj.amount === 'number' ? dataObj.amount : 0;
    const currency = typeof dataObj.currency === 'string' ? dataObj.currency.toUpperCase() : 'USD';
    const providerPaymentReference = String(dataObj.id || json.id || '');
    const cloudhostPaymentId = dataObj.metadata?.payment_id ? String(dataObj.metadata.payment_id) : undefined;

    return {
      gateway: 'stripe',
      providerEventId: String(json.id || ''),
      providerPaymentReference,
      cloudhostPaymentId,
      canonicalEventType,
      eventOccurredAt: json.created ? new Date(json.created * 1000) : new Date(),
      receivedAt: new Date(),
      amountCents,
      currency,
      outcome,
      failureReason,
      rawPayloadHash,
    };
  }
}
