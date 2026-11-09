import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import '../../../../shared/site/marketing.js';
import '../../../../shared/site/marketing.css';

export interface MarketingConsent {
  preferences: { essential: true; analytics: boolean; marketing: boolean };
  decided: boolean; marketingGranted: boolean; jurisdiction: string | null;
  requiresOptIn: boolean; policyVersion: number; csrfToken: string;
}
export interface MarketingSnapshot {
  ready: boolean; initializedPixel: string | null; error: string | null;
  configuration: { enabled: boolean; pixelId: string | null; revision: number; diagnostic: string; consentBannerEnabled?: boolean } | null;
  consent: MarketingConsent | null;
}
export interface PurchaseReceipt {
  verified: true; status: 'successful'; eventId: string;
  googleItems?: Array<{ id: string; name?: string; quantity: number }>;
  customData: { currency: string; value: number; content_ids: string[]; contents: Array<{ id: string; quantity: number }>; content_type: 'product' };
}
interface MarketingEngine {
  initialize(options?: { apiBase?: string; bannerEnabled?: boolean | null }): Promise<MarketingEngine>;
  ready(): Promise<MarketingEngine>; refresh(): Promise<MarketingSnapshot>; snapshot(): MarketingSnapshot;
  subscribe(fn: (state: MarketingSnapshot) => void): () => void;
  track(name: string, data?: Record<string, unknown>, eventId?: string): boolean;
  trackPurchase(receipt: PurchaseReceipt): boolean; pageView(path: string): boolean; openPreferences(): void;
}
declare global { interface Window { CloudHost247Marketing: MarketingEngine } }
export function marketingEngine() { return window.CloudHost247Marketing; }
let started = false;
export function startMarketing() {
  if (started) return;
  started = true;
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  void marketingEngine().initialize({ apiBase: `${base}/api/v1/marketing` });
}
export function useMarketing() {
  const [state, setState] = useState(marketingEngine().snapshot());
  useEffect(() => { startMarketing(); return marketingEngine().subscribe(setState); }, []);
  return state;
}
export function trackMarketing(name: string, data: Record<string, unknown>, eventId: string) {
  void marketingEngine().ready().then(() => marketingEngine().track(name, data, eventId));
  // TikTok mirrors the same funnel event with the SAME eventId (its own
  // provider-scoped dedup key server-side). Names TikTok does not support
  // (e.g. Meta-only Lead/Purchase) are refused by the TikTok runtime itself.
  const tiktok = (window as unknown as { CloudHost247TikTok?: { ready(): Promise<unknown>; track(n: string, d: Record<string, unknown>, id: string): boolean } }).CloudHost247TikTok;
  if (tiktok) void tiktok.ready().then(() => tiktok.track(name, data, eventId));
}

/** Only the owner-authenticated, backend-verified receipt endpoint can produce a Purchase.
 * Invoice creation, sandbox initiation and a modal callback are never purchase authority. */
export async function trackVerifiedPurchase(invoiceId: string): Promise<boolean> {
  const engine = marketingEngine(); await engine.ready();
  if (!engine.snapshot().consent?.marketingGranted) return false;
  try {
    const receipt = await apiFetch<PurchaseReceipt>(`/api/v1/marketing/purchase-receipt/${encodeURIComponent(invoiceId)}`);
    return engine.trackPurchase(receipt);
  } catch { return false; }
}
