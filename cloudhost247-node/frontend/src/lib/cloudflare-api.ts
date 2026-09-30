/**
 * Cloudflare module API client — thin wrappers over the customer + admin endpoints. Uses the
 * shared apiFetch (same-origin, bearer token). The API token itself never reaches this code.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './api';

export function cfGet<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') sp.set(k, String(v));
  const qs = sp.toString();
  return apiFetch<T>(`${path}${qs ? `?${qs}` : ''}`);
}

export function cfSend<T>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
}

export type CfLoadState<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };

export function useCfData<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}) {
  const [state, setState] = useState<CfLoadState<T>>({ status: 'loading' });
  const key = `${path}|${JSON.stringify(params)}`;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    cfGet<T>(path, params)
      .then((data) => !cancelled && setState({ status: 'ready', data }))
      .catch((err: unknown) => !cancelled && setState({ status: 'error', message: err instanceof Error ? err.message : 'Request failed' }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { state, reload };
}

export interface CloudflareServiceDTO {
  id: string;
  zone_name: string;
  zone_id: string | null;
  status: string;
  activation_status: string;
  cloudflare_plan: string;
  plan_name: string;
  name_server_1: string | null;
  name_server_2: string | null;
  ssl_mode: string | null;
  dns_record_count: number;
  last_synced_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: string;
  customer_email?: string;
  service_label?: string;
}

export type CfEntitlements = Record<string, boolean>;

export const CF_FEATURE_LABELS: Record<string, string> = {
  dns: 'DNS Management',
  dnssec: 'DNSSEC',
  analytics: 'Analytics',
  ssl: 'SSL / TLS',
  firewall: 'Firewall',
  speed: 'Speed',
  caching: 'Caching',
  cache_purge: 'Cache Purge',
  development_mode: 'Development Mode',
  scrape_shield: 'Scrape Shield',
  plan_change: 'Plan Upgrade / Downgrade',
};
