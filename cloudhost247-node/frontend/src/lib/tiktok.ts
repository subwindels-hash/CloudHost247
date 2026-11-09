import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import '../../../../shared/site/tiktok.js';

export interface TikTokSnapshot {
  ready: boolean; initializedPixel: string | null; error: string | null;
  configuration: { enabled: boolean; pixelId: string | null; revision: number; diagnostic: string; remarketingEnabled: boolean; enabledEvents: string[] } | null;
  consent: { marketingGranted: boolean; csrfToken: string } | null;
}
export interface TikTokPurchaseReceipt {
  verified: true; status: 'successful'; eventName: 'CompletePayment'; eventId: string;
  customData: { currency: string; value: number; content_ids: string[]; contents: Array<{ id: string; quantity: number }>; content_type: 'product' };
}
interface TikTokEngine {
  initialize(options?: { apiBase?: string }): Promise<TikTokEngine>;
  ready(): Promise<TikTokEngine>; refresh(): Promise<TikTokSnapshot>; snapshot(): TikTokSnapshot;
  subscribe(fn: (state: TikTokSnapshot) => void): () => void;
  track(name: string, data?: Record<string, unknown>, eventId?: string): boolean;
  trackPurchase(receipt: TikTokPurchaseReceipt): boolean; pageView(path: string): boolean;
}
declare global { interface Window { CloudHost247TikTok: TikTokEngine } }
export function tiktokEngine() { return window.CloudHost247TikTok; }
let started = false;
export function startTikTok() {
  if (started) return;
  started = true;
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  void tiktokEngine().initialize({ apiBase: `${base}/api/v1/marketing` });
}
export function useTikTok() {
  const [state, setState] = useState(tiktokEngine().snapshot());
  useEffect(() => { startTikTok(); return tiktokEngine().subscribe(setState); }, []);
  return state;
}
export function trackTikTok(name: string, data: Record<string, unknown>, eventId: string) {
  void tiktokEngine().ready().then(() => tiktokEngine().track(name, data, eventId));
}

/** Only the owner-authenticated, backend-verified receipt endpoint can produce a CompletePayment. */
export async function trackVerifiedTikTokPurchase(invoiceId: string): Promise<boolean> {
  const engine = tiktokEngine(); await engine.ready();
  if (!engine.snapshot().consent?.marketingGranted) return false;
  try {
    const receipt = await apiFetch<TikTokPurchaseReceipt>(`/api/v1/marketing/tiktok/purchase-receipt/${encodeURIComponent(invoiceId)}`);
    return engine.trackPurchase(receipt);
  } catch { return false; }
}
