import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from '../config/env';
import type {
  InitiatePaymentInput,
  GatewayInitiationResult,
  PaymentGateway,
  WebhookEventDTO,
  WebhookHandler,
} from './types';

export class PaystackGateway implements PaymentGateway, WebhookHandler {
  readonly id = 'paystack';
  readonly gatewayId = 'paystack';

  async initiatePayment(input: InitiatePaymentInput, _env: Env): Promise<GatewayInitiationResult> {
    return {
      providerReference: `pstk_ref_${input.paymentId.replace(/-/g, '').slice(0, 16)}`,
      method: 'paystack_card',
      instructions: null,
    };
  }

  verifySignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
    env: Env
  ): boolean {
    const secret = env.PAYSTACK_SECRET_KEY;
    if (!secret) return false;

    const header = headers['x-paystack-signature'];
    const signature = Array.isArray(header) ? header[0] : header;
    if (!signature) return false;

    const expectedSig = createHmac('sha512', secret).update(rawBody).digest('hex');
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    const actualBuf = Buffer.from(signature, 'hex');

    if (expectedBuf.length !== actualBuf.length) {
      return false;
    }

    return timingSafeEqual(expectedBuf, actualBuf);
  }

  parseEvent(
    rawBody: Buffer,
    _headers: Record<string, string | string[] | undefined>,
    rawPayloadHash: string
  ): WebhookEventDTO {
    const json = JSON.parse(rawBody.toString('utf8'));
    const eventType = String(json.event || '');
    const dataObj = json.data || {};

    let canonicalEventType: WebhookEventDTO['canonicalEventType'] = 'unhandled';
    let outcome: WebhookEventDTO['outcome'] = 'unhandled';
    let failureReason: string | undefined = undefined;

    if (eventType === 'charge.success') {
      canonicalEventType = 'payment.success';
      outcome = 'succeeded';
    } else if (eventType === 'charge.failed') {
      canonicalEventType = 'payment.failed';
      outcome = 'failed';
      failureReason = dataObj.gateway_response || 'Paystack charge failed';
    }

    const amountCents = typeof dataObj.amount === 'number' ? dataObj.amount : 0;
    const currency = typeof dataObj.currency === 'string' ? dataObj.currency.toUpperCase() : 'USD';
    const providerPaymentReference = String(dataObj.reference || '');
    const cloudhostPaymentId = dataObj.metadata?.payment_id ? String(dataObj.metadata.payment_id) : undefined;
    const providerEventId = String(dataObj.id ? `${eventType}_${dataObj.id}` : `${eventType}_${providerPaymentReference}`);

    return {
      gateway: 'paystack',
      providerEventId,
      providerPaymentReference,
      cloudhostPaymentId,
      canonicalEventType,
      eventOccurredAt: dataObj.paid_at ? new Date(dataObj.paid_at) : new Date(),
      receivedAt: new Date(),
      amountCents,
      currency,
      outcome,
      failureReason,
      rawPayloadHash,
    };
  }
}
