import { apiFetch } from './api';

export type VisitorDateRange = 'live' | 'today' | 'yesterday' | '7d' | '30d' | 'custom';
export interface VisitorWindow { range?: VisitorDateRange; from?: string; to?: string }
export interface VisitorStatRow { label: string; visitors: number; sessions: number }
export interface VisitorPageRow { pagePath: string; pageViews: number; visitors: number }
export interface VisitorCountryRow { countryName: string; countryCode: string; visitors: number; sessions: number; pageViews: number }
export interface VisitorCityRow {
  cityName: string; regionName: string | null; countryName: string; countryCode: string;
  visitors: number; sessions: number; latitude: number | null; longitude: number | null;
}
export interface VisitorReferrerRow { source: string; host: string | null; visitors: number; sessions: number }
export interface VisitorTimePoint { bucket: string; visitors: number; pageViews: number }
export interface VisitorSettings {
  enabled: boolean; retentionDays: number; idleAfterSeconds: number; onlineTimeoutSeconds: number; updatedAt: string | null;
}
export interface VisitorOverview {
  range: { label: string; from: string; to: string };
  tracking: VisitorSettings;
  stats: {
    currentlyOnline: number; activeVisitors: number; uniqueVisitors: number; newVisitors: number;
    returningVisitors: number; pageViews: number; pageViewsToday: number;
  };
  topPages: VisitorPageRow[];
  countries: VisitorCountryRow[];
  cities: VisitorCityRow[];
  referrers: VisitorReferrerRow[];
  devices: VisitorStatRow[];
  browsers: VisitorStatRow[];
  operatingSystems: VisitorStatRow[];
  timeseries: VisitorTimePoint[];
}
export interface VisitorMapLocation {
  countryName: string; countryCode: string; regionName: string | null; cityName: string | null;
  latitude: number | null; longitude: number | null; visitors: number; online: number;
}
export interface VisitorJourneyEntry { pagePath: string; occurredAt: string }
export interface OnlineVisitor {
  visitorId: string; sessionId: string; status: 'online' | 'idle'; country: string | null; countryCode: string | null;
  region: string | null; city: string | null; currentPage: string; currentPages: string[];
  device: string; browser: string; operatingSystem: string; referrerHost: string | null;
  firstSeenAt: string; lastActivityAt: string; lastHeartbeatAt: string; visitDurationSeconds: number;
  openTabs: number; journey: VisitorJourneyEntry[];
}
export interface VisitorLiveSnapshot {
  generatedAt: string;
  stats: VisitorOverview['stats'];
  visitors: OnlineVisitor[];
}
export interface VisitorCountryDetail {
  countryCode: string; countryName: string; visitors: number; sessions: number; pageViews: number;
  cities: VisitorCityRow[]; topPages: VisitorPageRow[];
}

const BASE = '/api/v1/admin/visitor-intelligence';
function queryString(window: VisitorWindow = {}) {
  const params = new URLSearchParams();
  if (window.range) params.set('range', window.range);
  if (window.from) params.set('from', window.from);
  if (window.to) params.set('to', window.to);
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function getVisitorOverview(window: VisitorWindow) {
  return apiFetch<VisitorOverview>(`${BASE}/overview${queryString(window)}`);
}
export function getVisitorMap(window: VisitorWindow) {
  return apiFetch<{ range: VisitorOverview['range']; locations: VisitorMapLocation[]; countries: VisitorCountryRow[] }>(`${BASE}/map${queryString(window)}`);
}
export function getOnlineVisitors() {
  return apiFetch<{ generatedAt: string; visitors: OnlineVisitor[]; count: number }>(`${BASE}/online`);
}
export function getVisitorCountryDetail(countryCode: string, window: VisitorWindow) {
  return apiFetch<VisitorCountryDetail>(`${BASE}/countries/${encodeURIComponent(countryCode)}${queryString(window)}`);
}
export function updateVisitorSettings(settings: Partial<Pick<VisitorSettings, 'enabled' | 'retentionDays' | 'idleAfterSeconds' | 'onlineTimeoutSeconds'>>) {
  // The dashboard also holds the server's updatedAt field. Send only fields accepted by the
  // strict PATCH schema rather than accidentally echoing response-only metadata back to the API.
  const payload = {
    ...(typeof settings.enabled === 'boolean' ? { enabled: settings.enabled } : {}),
    ...(typeof settings.retentionDays === 'number' ? { retentionDays: settings.retentionDays } : {}),
    ...(typeof settings.idleAfterSeconds === 'number' ? { idleAfterSeconds: settings.idleAfterSeconds } : {}),
    ...(typeof settings.onlineTimeoutSeconds === 'number' ? { onlineTimeoutSeconds: settings.onlineTimeoutSeconds } : {}),
  };
  return apiFetch<{ settings: VisitorSettings }>(`${BASE}/settings`, { method: 'PATCH', body: JSON.stringify(payload) });
}
