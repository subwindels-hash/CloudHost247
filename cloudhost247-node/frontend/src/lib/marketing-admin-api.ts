import { apiFetch } from './api';
export const META_ADMIN_API = '/api/v1/admin/marketing-integrations/meta-pixel';
export interface MetaAdminConfiguration {
  providerKey: 'meta_pixel'; displayName: string; websiteDomain: string; enabled: boolean;
  pixelId: string | null; testMode: boolean; testEventCode: string | null;
  consentPolicy: 'global_opt_in' | 'jurisdiction_opt_in';
  capi: { enabled: boolean; apiVersion: string; hasToken: boolean };
  revision: number; lastConfigurationUpdate: string | null; lastConfigurationTestAt: string | null;
  lastConfigurationTestStatus: string | null; lastError: string | null;
}
export interface MetaActivity {
  id: string; event_name: string; event_id: string; pixel_id: string; custom_data: Record<string, unknown>;
  occurred_at: string; browser_dispatched_at: string | null; channel: string;
  delivery_status: string | null; attempts: number | null; http_status: number | null;
  events_received: number | null; last_error: string | null; delivered_at: string | null;
  marketing_consent_current: boolean;
}
export interface MetaAuditEntry { id: string; action: string; created_at: string; actor_id: string | null; metadata: Record<string, unknown> }
export function getMetaConfiguration() { return apiFetch<{ configuration: MetaAdminConfiguration }>(META_ADMIN_API); }
export function metaAdminSend<T>(method: 'PUT' | 'POST', path: string, body: unknown) {
  return apiFetch<T>(`${META_ADMIN_API}${path}`, { method, body: JSON.stringify(body) });
}
export function getMetaActivity() { return apiFetch<{ events: MetaActivity[]; deliveryMeaning: string }>(`${META_ADMIN_API}/activity`); }
export function getMetaAudit() { return apiFetch<{ entries: MetaAuditEntry[] }>(`${META_ADMIN_API}/audit`); }
