import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import '../../../../shared/site/marketing.js';
import '../../../../shared/site/marketing.css';

export interface MarketingConsent {
  preferences: { essential: true; analytics: boolean; marketing: boolean };
  decided: boolean; marketingGranted: boolean; jurisdiction: string | null;
  requiresOptIn: boolean; policyVersion: number; expiresAt: string; csrfToken: string;
}
export interface MarketingSnapshot {
  ready: boolean; initializedPixel: string | null; error: string | null;
  configuration: { enabled: boolean; pixelId: string | null; revision: number; diagnostic: string; consentBannerEnabled?: boolean } | null;
  consent: MarketingConsent | null;
  analytics?: { initialized: string | null; status: string; error: string | null };
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
  trackPurchase(receipt: PurchaseReceipt): boolean; trackAnalyticsContact(): boolean; trackAnalyticsSearch(): boolean; trackAnalyticsItem(itemId: string): boolean; trackAnalyticsCatalog(itemIds: string[]): boolean; trackAnalyticsSelect(itemId: string): boolean; pageView(path: string): boolean; openPreferences(): void;
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
// Public catalog pages are also rendered in a server-side content test and may be
// prerendered. A deny-by-default snapshot must not access browser globals during render.
const serverSnapshot: MarketingSnapshot = { ready: false, initializedPixel: null, error: null, configuration: null, consent: null };
export function useMarketing() {
  const [state, setState] = useState<MarketingSnapshot>(() => typeof window === 'undefined' ? serverSnapshot : marketingEngine().snapshot());
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

/** Called only after the contact API confirms persistence. No form data is accepted or queued. */
export function trackAnalyticsContact(): boolean {
  try { return marketingEngine().trackAnalyticsContact(); } catch { return false; }
}

/** Only fixed, published catalogue IDs on supported public pages are accepted by the engine. */
export function trackAnalyticsItem(itemId: string): boolean {
  try { return marketingEngine().trackAnalyticsItem(itemId); } catch { return false; }
}

/** Public catalogue list and selection accept fixed identifiers only in the shared engine. */
export function trackAnalyticsCatalog(itemIds: string[]): boolean {
  try { return marketingEngine().trackAnalyticsCatalog(itemIds); } catch { return false; }
}
export function trackAnalyticsSelect(itemId: string): boolean {
  try { return marketingEngine().trackAnalyticsSelect(itemId); } catch { return false; }
}

/** Record a search action, never the free-text search query. */
export function trackAnalyticsSearch(): boolean {
  try { return marketingEngine().trackAnalyticsSearch(); } catch { return false; }
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
