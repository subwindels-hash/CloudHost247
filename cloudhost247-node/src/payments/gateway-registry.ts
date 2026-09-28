import type { Env } from '../config/env';
import { ValidationError } from '../lib/errors';
import { manualGateway } from './manual-gateway';
import { sandboxGateway } from './sandbox-gateway';
import type { PaymentGateway } from './types';

const GATEWAYS: Record<string, PaymentGateway> = {
  [manualGateway.id]: manualGateway,
  [sandboxGateway.id]: sandboxGateway,
};

/** The exact set of gateway ids the customer-facing `POST /api/v1/invoices/:id/payments` route
 * accepts — kept alongside the registry so the two can never silently drift apart. */
export const AVAILABLE_GATEWAY_IDS = Object.keys(GATEWAYS) as ReadonlyArray<'manual' | 'sandbox'>;

/**
 * Resolves a gateway id (as supplied by a customer choosing a payment method) to its
 * implementation. Adding a real, non-sandbox provider in a future phase means adding one more
 * entry here and to `AVAILABLE_GATEWAY_IDS` — no other code in `src/services/payment-service.ts`
 * or `src/routes/payments.ts` needs to change, since both already work only in terms of the
 * `PaymentGateway` interface.
 */
export function getGateway(id: string, _env: Env): PaymentGateway {
  const gateway = GATEWAYS[id];
  if (!gateway) {
    throw new ValidationError(`Unknown payment gateway: ${id}`);
  }
  return gateway;
}
