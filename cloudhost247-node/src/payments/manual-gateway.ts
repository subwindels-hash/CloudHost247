import type { Env } from '../config/env';
import type { GatewayInitiationResult, InitiatePaymentInput, PaymentGateway } from './types';

// Shown only when the deployment hasn't configured MANUAL_PAYMENT_INSTRUCTIONS. Deliberately
// generic and honest ("we don't have automated instructions configured yet") rather than a
// fabricated bank account/reference number — inventing payment details here would be exactly the
// kind of fabricated-content bug this project's standing rules forbid.
const FALLBACK_INSTRUCTIONS =
  'Bank transfer instructions have not been configured for this environment yet. Please contact support with your invoice number to arrange payment.';

/**
 * The "offline" gateway: a customer initiating a payment through this gateway is told how to send
 * a bank transfer (or other out-of-band payment) and pays outside this application entirely. There
 * is no external system to call and no provider reference to obtain — the payment stays `pending`
 * until a staff member manually confirms or rejects it via
 * `src/services/payment-service.ts#confirmManualPayment` / `#rejectManualPayment`, an explicit,
 * audited human action, never an automated one.
 */
export const manualGateway: PaymentGateway = {
  id: 'manual',
  async initiatePayment(_input: InitiatePaymentInput, env: Env): Promise<GatewayInitiationResult> {
    return {
      providerReference: null,
      method: 'bank_transfer',
      instructions: env.MANUAL_PAYMENT_INSTRUCTIONS?.trim() || FALLBACK_INSTRUCTIONS,
    };
  },
};
