import type { Env } from '../config/env';
import { ValidationError } from '../lib/errors';
import { manualGateway } from './manual-gateway';
import { sandboxGateway, SandboxGateway } from './sandbox-gateway';
import { StripeGateway } from './stripe-gateway';
import { PayPalGateway } from './paypal-gateway';
import { PaystackGateway } from './paystack-gateway';
import type { PaymentGateway, WebhookHandler } from './types';

const stripeGateway = new StripeGateway();
const paypalGateway = new PayPalGateway();
const paystackGateway = new PaystackGateway();

const INITIATION_GATEWAYS: Record<string, PaymentGateway> = {
  [manualGateway.id]: manualGateway,
  [sandboxGateway.id]: sandboxGateway,
};

const WEBHOOK_HANDLERS: Record<string, WebhookHandler> = {
  sandbox: sandboxGateway instanceof SandboxGateway ? sandboxGateway : new SandboxGateway(),
  stripe: stripeGateway,
  paypal: paypalGateway,
  paystack: paystackGateway,
};

/** The exact set of payment initiation gateway ids recognized by the system in Phase 5C. */
export const AVAILABLE_GATEWAY_IDS = Object.keys(INITIATION_GATEWAYS) as ReadonlyArray<
  'manual' | 'sandbox'
>;

/** The exact set of webhook receiver gateway ids recognized by the system in Phase 5D. */
export const AVAILABLE_WEBHOOK_GATEWAY_IDS = Object.keys(WEBHOOK_HANDLERS) as ReadonlyArray<
  'sandbox' | 'stripe' | 'paypal' | 'paystack'
>;

export function getGateway(id: string, _env: Env): PaymentGateway {
  const gateway = INITIATION_GATEWAYS[id];
  if (!gateway) {
    throw new ValidationError(`Unknown payment gateway: ${id}`);
  }
  return gateway;
}

export function getWebhookHandler(gatewayId: string): WebhookHandler | null {
  return WEBHOOK_HANDLERS[gatewayId] || null;
}
