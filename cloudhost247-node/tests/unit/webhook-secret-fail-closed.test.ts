import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { getWebhookHandler } from '../../src/payments/gateway-registry';

/**
 * Phase 5D is frozen: the pipeline is not authorized for deployment, and the artifacts are not
 * executed in production. A frozen pipeline must at minimum fail closed — a webhook signed with a
 * secret that this deployment does not hold must never be accepted, for any gateway.
 *
 * Each case pairs a missing-secret rejection with a positive control holding the same secret, so a
 * gateway that returned false unconditionally could not satisfy the pair.
 */
const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
  JWT_SECRET: 'w'.repeat(32),
} as NodeJS.ProcessEnv;

const STRIPE_SECRET = 'whsec_test_secret_for_stripe_webhooks_12345';
const PAYSTACK_SECRET = 'sk_test_secret_for_paystack_webhooks_12345';
const SANDBOX_SECRET = 'sandbox_test_webhook_secret_12345';

function stripeSignature(secret: string, body: Buffer): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body.toString('utf8')}`).digest('hex');
  return { 'stripe-signature': `t=${timestamp},v1=${signature}` };
}

describe('webhook gateways fail closed when their signing secret is not configured', () => {
  it('stripe: no STRIPE_WEBHOOK_SECRET means no accepted webhook', () => {
    const body = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded' }), 'utf8');
    const withSecret = loadEnv({ ...baseEnv, STRIPE_WEBHOOK_SECRET: STRIPE_SECRET });
    const withoutSecret = loadEnv({ ...baseEnv });

    const handler = getWebhookHandler('stripe');
    expect(handler).toBeDefined();
    expect(handler!.verifySignature(body, stripeSignature(STRIPE_SECRET, body), withoutSecret)).toBe(false);
    // Positive control: the same payload and header are accepted when the secret is held.
    expect(handler!.verifySignature(body, stripeSignature(STRIPE_SECRET, body), withSecret)).toBe(true);
  });

  it('paystack: no PAYSTACK_SECRET_KEY means no accepted webhook', () => {
    const body = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'ref_1' } }), 'utf8');
    const signature = createHmac('sha512', PAYSTACK_SECRET).update(body).digest('hex');
    const headers = { 'x-paystack-signature': signature };
    const withSecret = loadEnv({ ...baseEnv, PAYSTACK_SECRET_KEY: PAYSTACK_SECRET });
    const withoutSecret = loadEnv({ ...baseEnv });

    const handler = getWebhookHandler('paystack');
    expect(handler).toBeDefined();
    expect(handler!.verifySignature(body, headers, withoutSecret)).toBe(false);
    expect(handler!.verifySignature(body, headers, withSecret)).toBe(true);
  });

  it('sandbox: no SANDBOX_GATEWAY_WEBHOOK_SECRET means no accepted webhook', () => {
    const body = Buffer.from(JSON.stringify({ event_id: 'sbx_1', event_type: 'payment.success' }), 'utf8');
    const signature = createHmac('sha256', SANDBOX_SECRET).update(body.toString('utf8')).digest('hex');
    const headers = { 'x-cloudhost-signature': signature, 'x-cloudhost-timestamp': String(Date.now()) };
    const withSecret = loadEnv({ ...baseEnv, SANDBOX_GATEWAY_WEBHOOK_SECRET: SANDBOX_SECRET, ALLOW_MOCK_PROVIDER: 'true' });
    const withoutSecret = loadEnv({ ...baseEnv, ALLOW_MOCK_PROVIDER: 'true' });

    const handler = getWebhookHandler('sandbox');
    expect(handler).toBeDefined();
    expect(handler!.verifySignature(body, headers, withoutSecret)).toBe(false);
    expect(handler!.verifySignature(body, headers, withSecret)).toBe(true);
  });

  it('paypal: no PAYPAL_WEBHOOK_ID means no accepted webhook, and it rejects before any outbound call', async () => {
    const body = Buffer.from(JSON.stringify({ id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED' }), 'utf8');
    const headers = {
      'paypal-transmission-id': 'transmission-1',
      'paypal-transmission-time': new Date().toISOString(),
      'paypal-transmission-sig': 'not-a-real-signature',
      'paypal-cert-url': 'https://api.paypal.com/v1/notifications/certs/CERT-1',
      'paypal-auth-algo': 'SHA256withRSA',
    };
    const withoutWebhookId = loadEnv({ ...baseEnv });

    const handler = getWebhookHandler('paypal');
    expect(handler).toBeDefined();
    // Without the webhook id there is nothing to verify against, so the delivery is refused outright.
    expect(await handler!.verifySignature(body, headers, withoutWebhookId)).toBe(false);
  });
});
