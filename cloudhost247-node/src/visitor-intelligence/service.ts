import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { analyticsConsentGranted } from '../marketing/ga4-checkout-context';
import type { ConsentRow } from '../marketing/consent-service';
import type { ClientProfile, ApproximateGeo } from './geo';

export interface VisitorSettings {
  enabled: boolean;
  retentionDays: number;
  idleAfterSeconds: number;
  onlineTimeoutSeconds: number;
  updatedAt: string | null;
}

export interface DateWindow {
  from: Date;
  to: Date;
  label: string;
}

export interface VisitorIdentityInput {
  visitorId: string;
  sessionId: string;
  tabId: string;
  pagePath: string;
  referrerHost: string | null;
}

export interface VisitorIngestContext {
  consentSessionId: string;
  geo: ApproximateGeo;
  client: ClientProfile;
}

interface SettingsRow {
  enabled: boolean;
  retention_days: number;
  idle_after_seconds: number;
  online_timeout_seconds: number;
  updated_at: string | Date;
}

function count(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoUtcDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function dayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function plusDays(date: Date, amount: number): Date {
  return new Date(date.getTime() + amount * 86_400_000);
}

/** UTC date windows are shared by all admin report endpoints. `to` is exclusive. */
export function resolveDateWindow(input: {
  range?: string;
  from?: string;
  to?: string;
} = {}, now = new Date()): DateWindow {
  const today = dayStart(now);
  const range = input.range ?? 'today';
  if (range === 'today' || range === 'live') return { from: today, to: plusDays(today, 1), label: range };
  if (range === 'yesterday') return { from: plusDays(today, -1), to: today, label: range };
  if (range === '7d') return { from: plusDays(today, -6), to: plusDays(today, 1), label: range };
  if (range === '30d') return { from: plusDays(today, -29), to: plusDays(today, 1), label: range };
  if (range !== 'custom') throw new Error('Unsupported visitor intelligence date range');
  const from = input.from ? isoUtcDay(input.from) : null;
  const through = input.to ? isoUtcDay(input.to) : null;
  if (!from || !through || from > through) throw new Error('Choose a valid custom date range');
  const days = Math.floor((through.getTime() - from.getTime()) / 86_400_000) + 1;
  if (days > 366) throw new Error('Custom date range must be no longer than 366 days');
  return { from, to: plusDays(through, 1), label: 'custom' };
}

function settingsDto(row: SettingsRow): VisitorSettings {
  return {
    enabled: row.enabled,
    retentionDays: count(row.retention_days),
    idleAfterSeconds: count(row.idle_after_seconds),
    onlineTimeoutSeconds: count(row.online_timeout_seconds),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

export async function getVisitorSettings(db: Queryable): Promise<VisitorSettings> {
  const row = (await db.query<SettingsRow>(`SELECT enabled, retention_days, idle_after_seconds, online_timeout_seconds, updated_at
    FROM visitor_intelligence_settings WHERE id=1`)).rows[0];
  if (!row) throw new Error('Visitor Intelligence settings are not initialized; apply migration 0099.');
  return settingsDto(row);
}

export async function updateVisitorSettings(
  db: Queryable,
  actorId: string,
  input: Pick<VisitorSettings, 'enabled' | 'retentionDays' | 'idleAfterSeconds' | 'onlineTimeoutSeconds'>
): Promise<VisitorSettings> {
  const row = (await db.query<SettingsRow>(`UPDATE visitor_intelligence_settings
      SET enabled=$1, retention_days=$2, idle_after_seconds=$3, online_timeout_seconds=$4,
          updated_by=$5, updated_at=now()
      WHERE id=1
      RETURNING enabled, retention_days, idle_after_seconds, online_timeout_seconds, updated_at`,
    [input.enabled, input.retentionDays, input.idleAfterSeconds, input.onlineTimeoutSeconds, actorId])).rows[0];
  if (!row) throw new Error('Visitor Intelligence settings are not initialized; apply migration 0099.');
  if (!input.enabled) {
    // Keep historical reports, but stop showing stale active tabs as soon as collection is disabled.
    await db.query('DELETE FROM visitor_presence');
  }
  return settingsDto(row);
}

async function isIngestAllowed(tx: Queryable, consentSessionId: string): Promise<boolean> {
  // Both locks are deliberate. Consent withdrawal takes FOR UPDATE on its own row and deletes
  // linked sessions; this shared lock makes an in-flight ingest commit before that delete, or see
  // the withdrawn choice. Disabling tracking has the same ordering guarantee on the settings row.
  const setting = (await tx.query<{ enabled: boolean }>(
    'SELECT enabled FROM visitor_intelligence_settings WHERE id=1 FOR SHARE'
  )).rows[0];
  if (!setting?.enabled) return false;
  const consent = (await tx.query<ConsentRow>(
    'SELECT * FROM marketing_consent_sessions WHERE id=$1 FOR SHARE', [consentSessionId]
  )).rows[0];
  return analyticsConsentGranted(consent);
}

const SESSION_IDLE_TIMEOUT_SECONDS = 30 * 60;

/** The exact 30-minute boundary is expired, matching the browser's `age < SESSION_MAX_AGE_MS` rule. */
export function isVisitorSessionExpired(lastSeenAt: Date | string, now: Date | string): boolean {
  const lastSeenMs = lastSeenAt instanceof Date ? lastSeenAt.getTime() : Date.parse(lastSeenAt);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  return nowMs - lastSeenMs >= SESSION_IDLE_TIMEOUT_SECONDS * 1000;
}

type SessionUpsertResult = 'active' | 'expired' | 'conflict';

async function upsertSession(tx: Queryable, input: VisitorIdentityInput, context: VisitorIngestContext): Promise<SessionUpsertResult> {
  const rows = (await tx.query<{ session_id: string }>(`INSERT INTO visitor_sessions (
      session_id, visitor_id, consent_session_id, first_page_path, referrer_host,
      country_name, country_code, region_name, city_name, latitude, longitude, timezone,
      device_category, browser_family, os_family
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    ON CONFLICT (session_id) DO UPDATE SET last_seen_at=now()
      WHERE visitor_sessions.visitor_id=EXCLUDED.visitor_id
        AND visitor_sessions.consent_session_id=EXCLUDED.consent_session_id
        AND visitor_sessions.last_seen_at > now() - ($16::int * interval '1 second')
    RETURNING session_id`, [
    input.sessionId,
    input.visitorId,
    context.consentSessionId,
    input.pagePath,
    input.referrerHost,
    context.geo.countryName,
    context.geo.countryCode,
    context.geo.regionName,
    context.geo.cityName,
    context.geo.latitude,
    context.geo.longitude,
    context.geo.timezone,
    context.client.deviceCategory,
    context.client.browserFamily,
    context.client.osFamily,
    SESSION_IDLE_TIMEOUT_SECONDS,
  ])).rows;
  if (rows.length === 1) return 'active';

  const existing = (await tx.query<{ last_seen_at: string | Date; checked_at: string | Date }>(`SELECT last_seen_at, now() AS checked_at
    FROM visitor_sessions
    WHERE session_id=$1 AND visitor_id=$2 AND consent_session_id=$3`, [
    input.sessionId, input.visitorId, context.consentSessionId,
  ])).rows[0];
  return existing && isVisitorSessionExpired(existing.last_seen_at, existing.checked_at) ? 'expired' : 'conflict';
}

async function upsertPresence(tx: Queryable, input: VisitorIdentityInput, active: boolean): Promise<boolean> {
  const rows = (await tx.query<{ tab_id: string }>(`INSERT INTO visitor_presence (
      tab_id, session_id, visitor_id, current_page_path, heartbeat_at, activity_at
    ) VALUES ($1,$2,$3,$4,now(),now())
    ON CONFLICT (tab_id) DO UPDATE SET
      current_page_path=EXCLUDED.current_page_path,
      heartbeat_at=now(),
      activity_at=CASE WHEN $5::boolean THEN now() ELSE visitor_presence.activity_at END,
      updated_at=now()
    WHERE visitor_presence.session_id=EXCLUDED.session_id
      AND visitor_presence.visitor_id=EXCLUDED.visitor_id
    RETURNING tab_id`, [input.tabId, input.sessionId, input.visitorId, input.pagePath, active])).rows;
  return rows.length === 1;
}

export type VisitorIngestResult = 'recorded' | 'not_allowed' | 'session_expired' | 'identity_conflict';

export async function recordVisitorPageview(
  db: Queryable,
  input: VisitorIdentityInput,
  context: VisitorIngestContext
): Promise<VisitorIngestResult> {
  return withTransaction(db, async (tx) => {
    if (!(await isIngestAllowed(tx, context.consentSessionId))) return 'not_allowed';
    const sessionResult = await upsertSession(tx, input, context);
    if (sessionResult === 'expired') return 'session_expired';
    if (sessionResult !== 'active') return 'identity_conflict';
    if (!(await upsertPresence(tx, input, true))) return 'identity_conflict';
    await tx.query(`INSERT INTO visitor_pageviews (id, session_id, visitor_id, page_path, referrer_host)
      VALUES ($1,$2,$3,$4,$5)`, [randomUUID(), input.sessionId, input.visitorId, input.pagePath, input.referrerHost]);
    await tx.query('UPDATE visitor_sessions SET last_seen_at=now() WHERE session_id=$1', [input.sessionId]);
    return 'recorded';
  });
}

export async function recordVisitorHeartbeat(
  db: Queryable,
  input: VisitorIdentityInput,
  context: VisitorIngestContext,
  active: boolean
): Promise<VisitorIngestResult> {
  return withTransaction(db, async (tx) => {
    if (!(await isIngestAllowed(tx, context.consentSessionId))) return 'not_allowed';
    const sessionResult = await upsertSession(tx, input, context);
    if (sessionResult === 'expired') return 'session_expired';
    if (sessionResult !== 'active') return 'identity_conflict';
    if (!(await upsertPresence(tx, input, active))) return 'identity_conflict';
    await tx.query('UPDATE visitor_sessions SET last_seen_at=now() WHERE session_id=$1', [input.sessionId]);
    return 'recorded';
  });
}

export interface VisitorOverview {
  range: { label: string; from: string; to: string };
  tracking: { enabled: boolean; retentionDays: number; idleAfterSeconds: number; onlineTimeoutSeconds: number; updatedAt: string | null };
  stats: {
    currentlyOnline: number;
    activeVisitors: number;
    uniqueVisitors: number;
    newVisitors: number;
    returningVisitors: number;
    pageViews: number;
    pageViewsToday: number;
  };
  topPages: Array<{ pagePath: string; pageViews: number; visitors: number }>;
  countries: Array<{ countryName: string; countryCode: string; visitors: number; sessions: number; pageViews: number }>;
  cities: Array<{ cityName: string; regionName: string | null; countryName: string; countryCode: string; visitors: number; latitude: number | null; longitude: number | null }>;
  referrers: Array<{ source: string; host: string | null; visitors: number; sessions: number }>;
  devices: Array<{ label: string; visitors: number; sessions: number }>;
  browsers: Array<{ label: string; visitors: number; sessions: number }>;
  operatingSystems: Array<{ label: string; visitors: number; sessions: number }>;
  timeseries: Array<{ bucket: string; visitors: number; pageViews: number }>;
}

function sourceLabel(host: string | null): string {
  if (!host) return 'Direct';
  const value = host.toLowerCase();
  if (/(^|\.)google\./.test(value)) return 'Google';
  if (/(^|\.)bing\./.test(value)) return 'Bing';
  if (/(^|\.)(facebook|fb)\./.test(value)) return 'Facebook';
  if (/(^|\.)(tiktok)\./.test(value)) return 'TikTok';
  if (/(^|\.)(instagram)\./.test(value)) return 'Instagram';
  if (/(^|\.)(linkedin)\./.test(value)) return 'LinkedIn';
  if (/(^|\.)(x|twitter)\./.test(value)) return 'X / Twitter';
  return 'Referral';
}

export async function getTopPages(db: Queryable, window: DateWindow, limit = 10) {
  const rows = (await db.query<{ page_path: string; page_views: string | number; visitors: string | number }>(`SELECT page_path,
      count(*)::int AS page_views, count(DISTINCT visitor_id)::int AS visitors
    FROM visitor_pageviews
    WHERE occurred_at >= $1 AND occurred_at < $2
    GROUP BY page_path
    ORDER BY page_views DESC, page_path ASC
    LIMIT $3`, [window.from.toISOString(), window.to.toISOString(), limit])).rows;
  return rows.map((row) => ({ pagePath: row.page_path, pageViews: count(row.page_views), visitors: count(row.visitors) }));
}

export async function getCountries(db: Queryable, window: DateWindow) {
  const rows = (await db.query<{ country_name: string | null; country_code: string | null; visitors: string | number; sessions: string | number; page_views: string | number }>(`SELECT
      coalesce(s.country_name, 'Unknown') AS country_name,
      coalesce(s.country_code, 'ZZ') AS country_code,
      count(DISTINCT s.visitor_id)::int AS visitors,
      count(DISTINCT s.session_id)::int AS sessions,
      count(p.id)::int AS page_views
    FROM visitor_sessions s
    LEFT JOIN visitor_pageviews p ON p.session_id=s.session_id AND p.occurred_at >= $1 AND p.occurred_at < $2
    WHERE s.first_seen_at >= $1 AND s.first_seen_at < $2
    GROUP BY coalesce(s.country_name, 'Unknown'), coalesce(s.country_code, 'ZZ')
    ORDER BY visitors DESC, country_name ASC
    LIMIT 100`, [window.from.toISOString(), window.to.toISOString()])).rows;
  return rows.map((row) => ({ countryName: row.country_name ?? 'Unknown', countryCode: (row.country_code ?? 'ZZ').trim(), visitors: count(row.visitors), sessions: count(row.sessions), pageViews: count(row.page_views) }));
}

export async function getCities(db: Queryable, window: DateWindow, countryCode?: string) {
  const rows = (await db.query<{ city_name: string | null; region_name: string | null; country_name: string | null; country_code: string | null; visitors: string | number; sessions: string | number; latitude: number | null; longitude: number | null }>(`SELECT
      coalesce(s.city_name, 'Unknown') AS city_name,
      s.region_name,
      coalesce(s.country_name, 'Unknown') AS country_name,
      coalesce(s.country_code, 'ZZ') AS country_code,
      count(DISTINCT s.visitor_id)::int AS visitors,
      count(DISTINCT s.session_id)::int AS sessions,
      avg(s.latitude) AS latitude,
      avg(s.longitude) AS longitude
    FROM visitor_sessions s
    WHERE s.first_seen_at >= $1 AND s.first_seen_at < $2
      AND ($3::text IS NULL OR s.country_code=$3)
    GROUP BY coalesce(s.city_name, 'Unknown'), s.region_name, coalesce(s.country_name, 'Unknown'), coalesce(s.country_code, 'ZZ')
    ORDER BY visitors DESC, city_name ASC
    LIMIT 100`, [window.from.toISOString(), window.to.toISOString(), countryCode ?? null])).rows;
  return rows.map((row) => ({ cityName: row.city_name ?? 'Unknown', regionName: row.region_name, countryName: row.country_name ?? 'Unknown', countryCode: (row.country_code ?? 'ZZ').trim(), visitors: count(row.visitors), sessions: count(row.sessions), latitude: row.latitude === null ? null : Number(row.latitude), longitude: row.longitude === null ? null : Number(row.longitude) }));
}

export async function getMapLocations(db: Queryable, window: DateWindow, onlineTimeoutSeconds: number) {
  const rows = (await db.query<{ country_name: string | null; country_code: string | null; region_name: string | null; city_name: string | null; latitude: number | null; longitude: number | null; visitors: string | number; online: string | number }>(`SELECT
      coalesce(s.country_name, 'Unknown') AS country_name,
      coalesce(s.country_code, 'ZZ') AS country_code,
      s.region_name,
      s.city_name,
      avg(s.latitude) AS latitude,
      avg(s.longitude) AS longitude,
      count(DISTINCT s.visitor_id)::int AS visitors,
      count(DISTINCT p.visitor_id) FILTER (WHERE p.heartbeat_at >= now() - ($3::int * interval '1 second'))::int AS online
    FROM visitor_sessions s
    LEFT JOIN visitor_presence p ON p.session_id=s.session_id
    WHERE s.first_seen_at >= $1 AND s.first_seen_at < $2
    GROUP BY coalesce(s.country_name, 'Unknown'), coalesce(s.country_code, 'ZZ'), s.region_name, s.city_name
    ORDER BY visitors DESC
    LIMIT 500`, [window.from.toISOString(), window.to.toISOString(), onlineTimeoutSeconds])).rows;
  return rows.map((row) => ({
    countryName: row.country_name ?? 'Unknown', countryCode: (row.country_code ?? 'ZZ').trim(),
    regionName: row.region_name, cityName: row.city_name,
    latitude: row.latitude === null ? null : Number(row.latitude), longitude: row.longitude === null ? null : Number(row.longitude),
    visitors: count(row.visitors), online: count(row.online),
  }));
}

export async function getOnlineVisitors(db: Queryable, settings?: VisitorSettings) {
  const config = settings ?? await getVisitorSettings(db);
  const rows = (await db.query<{
    visitor_id: string; session_id: string; first_seen_at: string | Date; last_seen_at: string | Date;
    heartbeat_at: string | Date; activity_at: string | Date; current_page_path: string;
    country_name: string | null; country_code: string | null; region_name: string | null; city_name: string | null;
    device_category: string; browser_family: string; os_family: string; referrer_host: string | null;
    open_tabs: string | number; current_pages: string[] | null; journey: Array<{ pagePath: string; occurredAt: string }> | null;
  }>(`WITH fresh_tabs AS (
      SELECT s.visitor_id, s.session_id, s.first_seen_at, s.last_seen_at,
        s.country_name, s.country_code, s.region_name, s.city_name,
        s.device_category, s.browser_family, s.os_family, s.referrer_host,
        p.tab_id, p.current_page_path, p.heartbeat_at, p.activity_at
      FROM visitor_presence p
      JOIN visitor_sessions s ON s.session_id=p.session_id AND s.visitor_id=p.visitor_id
      WHERE p.heartbeat_at >= now() - ($1::int * interval '1 second')
    ), latest AS (
      SELECT DISTINCT ON (visitor_id) * FROM fresh_tabs
      ORDER BY visitor_id, heartbeat_at DESC
    ), tab_summary AS (
      SELECT visitor_id, count(*)::int AS open_tabs,
        jsonb_agg(DISTINCT current_page_path) AS current_pages
      FROM fresh_tabs GROUP BY visitor_id
    ), journey_rows AS (
      SELECT visitor_id, page_path, occurred_at,
        row_number() OVER (PARTITION BY visitor_id ORDER BY occurred_at DESC, id DESC) AS position
      FROM visitor_pageviews WHERE occurred_at >= now() - interval '1 day'
    ), journeys AS (
      SELECT visitor_id, jsonb_agg(jsonb_build_object('pagePath',page_path,'occurredAt',occurred_at)
        ORDER BY occurred_at DESC) AS journey
      FROM journey_rows WHERE position <= 8 GROUP BY visitor_id
    )
    SELECT l.visitor_id, l.session_id, l.first_seen_at, l.last_seen_at, l.heartbeat_at, l.activity_at,
      l.current_page_path, l.country_name, l.country_code, l.region_name, l.city_name,
      l.device_category, l.browser_family, l.os_family, l.referrer_host,
      t.open_tabs, t.current_pages, j.journey
    FROM latest l JOIN tab_summary t USING(visitor_id)
    LEFT JOIN journeys j USING(visitor_id)
    ORDER BY l.heartbeat_at DESC
    LIMIT 500`, [config.onlineTimeoutSeconds])).rows;
  const now = Date.now();
  return rows.map((row) => {
    const heartbeatAt = new Date(row.heartbeat_at);
    const activityAt = new Date(row.activity_at);
    const firstSeenAt = new Date(row.first_seen_at);
    return {
      visitorId: row.visitor_id,
      sessionId: row.session_id,
      status: now - activityAt.getTime() <= config.idleAfterSeconds * 1000 ? 'online' as const : 'idle' as const,
      country: row.country_name,
      countryCode: row.country_code?.trim() ?? null,
      region: row.region_name,
      city: row.city_name,
      currentPage: row.current_page_path,
      currentPages: row.current_pages ?? [row.current_page_path],
      device: row.device_category,
      browser: row.browser_family,
      operatingSystem: row.os_family,
      referrerHost: row.referrer_host,
      firstSeenAt: firstSeenAt.toISOString(),
      lastActivityAt: activityAt.toISOString(),
      lastHeartbeatAt: heartbeatAt.toISOString(),
      visitDurationSeconds: Math.max(0, Math.floor((now - firstSeenAt.getTime()) / 1000)),
      openTabs: count(row.open_tabs),
      journey: row.journey ?? [],
    };
  });
}

export async function getOverview(db: Queryable, window: DateWindow): Promise<VisitorOverview> {
  const settings = await getVisitorSettings(db);
  const today = dayStart(new Date());
  const tomorrow = plusDays(today, 1);
  const [statsResult, topPages, countries, cities, referrers, devices, browsers, operatingSystems, timeseries] = await Promise.all([
    db.query<{
      unique_visitors: string | number; new_visitors: string | number; returning_visitors: string | number;
      page_views: string | number; page_views_today: string | number;
      currently_online: string | number; active_visitors: string | number;
    }>(`WITH ranged AS (
        SELECT DISTINCT s.visitor_id
        FROM visitor_sessions s WHERE s.first_seen_at >= $1 AND s.first_seen_at < $2
      )
      SELECT
        (SELECT count(*) FROM ranged)::int AS unique_visitors,
        (SELECT count(*) FROM ranged r WHERE NOT EXISTS (
          SELECT 1 FROM visitor_sessions prior WHERE prior.visitor_id=r.visitor_id AND prior.first_seen_at < $1
        ))::int AS new_visitors,
        (SELECT count(*) FROM ranged r WHERE EXISTS (
          SELECT 1 FROM visitor_sessions prior WHERE prior.visitor_id=r.visitor_id AND prior.first_seen_at < $1
        ))::int AS returning_visitors,
        (SELECT count(*) FROM visitor_pageviews p WHERE p.occurred_at >= $1 AND p.occurred_at < $2)::int AS page_views,
        (SELECT count(*) FROM visitor_pageviews p WHERE p.occurred_at >= $3 AND p.occurred_at < $4)::int AS page_views_today,
        (SELECT count(DISTINCT p.visitor_id) FROM visitor_presence p
          WHERE p.heartbeat_at >= now() - ($5::int * interval '1 second'))::int AS currently_online,
        (SELECT count(DISTINCT p.visitor_id) FROM visitor_presence p
          WHERE p.heartbeat_at >= now() - ($5::int * interval '1 second')
            AND p.activity_at >= now() - interval '5 minutes')::int AS active_visitors`,
      [window.from.toISOString(), window.to.toISOString(), today.toISOString(), tomorrow.toISOString(), settings.onlineTimeoutSeconds]),
    getTopPages(db, window),
    getCountries(db, window),
    getCities(db, window),
    getReferrerStats(db, window),
    getDimensionStats(db, window, 'device_category'),
    getDimensionStats(db, window, 'browser_family'),
    getDimensionStats(db, window, 'os_family'),
    getTimeseries(db, window),
  ]);
  const stats = statsResult.rows[0] as {
    unique_visitors?: string | number; new_visitors?: string | number; returning_visitors?: string | number;
    page_views?: string | number; page_views_today?: string | number;
    currently_online?: string | number; active_visitors?: string | number;
  } | undefined;
  return {
    range: { label: window.label, from: window.from.toISOString(), to: window.to.toISOString() },
    tracking: {
      enabled: settings.enabled,
      retentionDays: settings.retentionDays,
      idleAfterSeconds: settings.idleAfterSeconds,
      onlineTimeoutSeconds: settings.onlineTimeoutSeconds,
      updatedAt: settings.updatedAt,
    },
    stats: {
      currentlyOnline: count(stats?.currently_online), activeVisitors: count(stats?.active_visitors),
      uniqueVisitors: count(stats?.unique_visitors), newVisitors: count(stats?.new_visitors),
      returningVisitors: count(stats?.returning_visitors), pageViews: count(stats?.page_views), pageViewsToday: count(stats?.page_views_today),
    },
    topPages, countries: countries.slice(0, 10), cities: cities.slice(0, 10), referrers, devices, browsers, operatingSystems, timeseries,
  };
}

export async function getReferrerStats(db: Queryable, window: DateWindow) {
  const rows = (await db.query<{ host: string | null; visitors: string | number; sessions: string | number }>(`SELECT referrer_host AS host,
      count(DISTINCT visitor_id)::int AS visitors, count(*)::int AS sessions
    FROM visitor_sessions
    WHERE first_seen_at >= $1 AND first_seen_at < $2
    GROUP BY referrer_host
    ORDER BY sessions DESC
    LIMIT 50`, [window.from.toISOString(), window.to.toISOString()])).rows;
  return rows.map((row) => ({ source: sourceLabel(row.host), host: row.host, visitors: count(row.visitors), sessions: count(row.sessions) }));
}

export async function getDimensionStats(db: Queryable, window: DateWindow, column: 'device_category' | 'browser_family' | 'os_family') {
  // Column names are a closed union at the call site, never user input.
  const rows = (await db.query<{ label: string; visitors: string | number; sessions: string | number }>(`SELECT ${column} AS label,
      count(DISTINCT visitor_id)::int AS visitors, count(*)::int AS sessions
    FROM visitor_sessions
    WHERE first_seen_at >= $1 AND first_seen_at < $2
    GROUP BY ${column}
    ORDER BY sessions DESC, label ASC`, [window.from.toISOString(), window.to.toISOString()])).rows;
  return rows.map((row) => ({ label: row.label, visitors: count(row.visitors), sessions: count(row.sessions) }));
}

export async function getTimeseries(db: Queryable, window: DateWindow) {
  const durationDays = (window.to.getTime() - window.from.getTime()) / 86_400_000;
  const unit = durationDays <= 1 ? 'hour' : 'day';
  const rows = (await db.query<{ bucket: string | Date; visitors: string | number; page_views: string | number }>(`WITH buckets AS (
      SELECT date_trunc($3, occurred_at AT TIME ZONE 'UTC') AS bucket,
        count(*)::int AS page_views, count(DISTINCT visitor_id)::int AS visitors
      FROM visitor_pageviews
      WHERE occurred_at >= $1 AND occurred_at < $2
      GROUP BY date_trunc($3, occurred_at AT TIME ZONE 'UTC')
    ) SELECT bucket, visitors, page_views FROM buckets ORDER BY bucket ASC`, [window.from.toISOString(), window.to.toISOString(), unit])).rows;
  return rows.map((row) => ({ bucket: row.bucket instanceof Date ? row.bucket.toISOString() : String(row.bucket), visitors: count(row.visitors), pageViews: count(row.page_views) }));
}

export async function getMapData(db: Queryable, window: DateWindow) {
  const settings = await getVisitorSettings(db);
  const [locations, countries] = await Promise.all([
    getMapLocations(db, window, settings.onlineTimeoutSeconds),
    getCountries(db, window),
  ]);
  return { locations, countries: countries.slice(0, 10) };
}

export async function getCountryDetail(db: Queryable, window: DateWindow, countryCode: string) {
  const params = [window.from.toISOString(), window.to.toISOString(), countryCode];
  const summary = (await db.query<{ country_name: string | null; visitors: string | number; sessions: string | number; page_views: string | number }>(`SELECT
      max(country_name) AS country_name,
      count(DISTINCT visitor_id)::int AS visitors,
      count(DISTINCT session_id)::int AS sessions,
      (SELECT count(*) FROM visitor_pageviews p JOIN visitor_sessions s2 ON s2.session_id=p.session_id
        WHERE s2.country_code=$3 AND p.occurred_at >= $1 AND p.occurred_at < $2)::int AS page_views
    FROM visitor_sessions
    WHERE country_code=$3 AND first_seen_at >= $1 AND first_seen_at < $2`, params)).rows[0];
  return {
    countryCode,
    countryName: summary?.country_name ?? 'Unknown',
    visitors: count(summary?.visitors), sessions: count(summary?.sessions), pageViews: count(summary?.page_views),
    cities: await getCities(db, window, countryCode),
    topPages: await getTopPagesForCountry(db, window, countryCode),
  };
}

async function getTopPagesForCountry(db: Queryable, window: DateWindow, countryCode: string) {
  const rows = (await db.query<{ page_path: string; page_views: string | number; visitors: string | number }>(`SELECT p.page_path,
      count(*)::int AS page_views, count(DISTINCT p.visitor_id)::int AS visitors
    FROM visitor_pageviews p JOIN visitor_sessions s ON s.session_id=p.session_id
    WHERE s.country_code=$3 AND p.occurred_at >= $1 AND p.occurred_at < $2
    GROUP BY p.page_path ORDER BY page_views DESC LIMIT 10`, [window.from.toISOString(), window.to.toISOString(), countryCode])).rows;
  return rows.map((row) => ({ pagePath: row.page_path, pageViews: count(row.page_views), visitors: count(row.visitors) }));
}

export async function getVisitorsForStream(db: Queryable) {
  const settings = await getVisitorSettings(db);
  const [overview, visitors] = await Promise.all([
    getOverview(db, resolveDateWindow({ range: 'today' })),
    getOnlineVisitors(db, settings),
  ]);
  return { generatedAt: new Date().toISOString(), stats: overview.stats, visitors };
}

/** Daily worker cleanup; permanent heartbeat history is intentionally not written. */
export async function pruneVisitorIntelligence(
  db: Queryable,
  batchSize = 10_000,
  maxBatchesPerTable = 10
) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
    throw new Error('Visitor Intelligence retention batch size must be between 1 and 10000.');
  }
  if (!Number.isInteger(maxBatchesPerTable) || maxBatchesPerTable < 1 || maxBatchesPerTable > 100) {
    throw new Error('Visitor Intelligence retention max batches must be between 1 and 100.');
  }
  const settings = await getVisitorSettings(db);

  async function deleteInBatches<T>(
    sql: string,
    values: (limit: number) => unknown[],
    hasMoreSql: string,
    hasMoreValues: unknown[] = []
  ) {
    let deleted = 0;
    let batches = 0;
    let lastBatchSize = 0;
    let hasMore = false;
    const eligibleRowsRemain = async () => {
      const row = (await db.query<{ has_more: boolean }>(hasMoreSql, hasMoreValues)).rows[0];
      return row?.has_more === true;
    };
    while (batches < maxBatchesPerTable) {
      const rows = (await db.query<T>(sql, values(batchSize))).rows;
      lastBatchSize = rows.length;
      deleted += lastBatchSize;
      batches += 1;
      if (lastBatchSize < batchSize) {
        // A concurrent heartbeat/withdrawal can make a selected row ineligible before DELETE
        // obtains it. Re-check the live predicate and keep draining if other expired rows remain.
        hasMore = await eligibleRowsRemain();
        if (!hasMore) break;
      }
    }
    // A full final batch may be the exact end of the backlog. Report actual remaining work rather
    // than forcing an empty retry, while keeping the pass bounded by maxBatchesPerTable.
    if (batches === maxBatchesPerTable && lastBatchSize === batchSize) {
      hasMore = await eligibleRowsRemain();
    }
    return { deleted, batches, hasMore };
  }

  const pageviews = await deleteInBatches<{ id: string }>(`WITH expired AS (
      SELECT id FROM visitor_pageviews
      WHERE occurred_at < now() - ($1::int * interval '1 day')
      ORDER BY occurred_at ASC LIMIT $2
    ) DELETE FROM visitor_pageviews p USING expired e
      WHERE p.id=e.id AND p.occurred_at < now() - ($1::int * interval '1 day')
      RETURNING p.id`,
  (limit) => [settings.retentionDays, limit],
  `SELECT EXISTS (SELECT 1 FROM visitor_pageviews
      WHERE occurred_at < now() - ($1::int * interval '1 day')) AS has_more`,
  [settings.retentionDays]);
  const presence = await deleteInBatches<{ tab_id: string }>(`WITH stale AS (
      SELECT tab_id FROM visitor_presence
      WHERE heartbeat_at < now() - interval '1 day'
      ORDER BY heartbeat_at ASC LIMIT $1
    ) DELETE FROM visitor_presence p USING stale s
      WHERE p.tab_id=s.tab_id AND p.heartbeat_at < now() - interval '1 day'
      RETURNING p.tab_id`,
  (limit) => [limit],
  `SELECT EXISTS (SELECT 1 FROM visitor_presence WHERE heartbeat_at < now() - interval '1 day') AS has_more`);
  const sessions = await deleteInBatches<{ session_id: string }>(`WITH expired AS (
      SELECT session_id FROM visitor_sessions
      WHERE last_seen_at < now() - ($1::int * interval '1 day')
      ORDER BY last_seen_at ASC LIMIT $2
    ) DELETE FROM visitor_sessions s USING expired e
      WHERE s.session_id=e.session_id AND s.last_seen_at < now() - ($1::int * interval '1 day')
      RETURNING s.session_id`,
  (limit) => [settings.retentionDays, limit],
  `SELECT EXISTS (SELECT 1 FROM visitor_sessions
      WHERE last_seen_at < now() - ($1::int * interval '1 day')) AS has_more`,
  [settings.retentionDays]);

  return {
    pageviews: pageviews.deleted,
    presence: presence.deleted,
    sessions: sessions.deleted,
    batches: { pageviews: pageviews.batches, presence: presence.batches, sessions: sessions.batches },
    hasMore: pageviews.hasMore || presence.hasMore || sessions.hasMore,
  };
}
