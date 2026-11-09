import type { Env } from '../config/env';
import { isGa4PurchaseDeliverySafe } from './ga4-purchase-safety';
import { getKeyRing } from '../lib/keyring';

/** Explicitly opt in and bind the secret to the configured web stream. Never return to browsers. */
export function ga4PurchaseCredentials(env: Env, measurementId: string | null): { measurementId: string; apiSecret: string } | null {
  const id = env.GA4_PURCHASE_MEASUREMENT_ID;
  const secret = env.GA4_PURCHASE_API_SECRET;
  if (!isGa4PurchaseDeliverySafe() || !env.GA4_PURCHASE_DELIVERY_ENABLED || !env.GA4_PURCHASE_STAGING_AUTHORIZED || !id || id !== measurementId || !/^G-[A-Z0-9]{10}$/.test(id) ||
      !secret || !/^[A-Za-z0-9_-]{1,128}$/.test(secret)) return null;
  try { getKeyRing(); } catch { return null; }
  return { measurementId: id, apiSecret: secret };
}
