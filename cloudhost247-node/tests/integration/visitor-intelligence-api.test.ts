import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv, resetEnvCache } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { pruneVisitorIntelligence } from '../../src/visitor-intelligence/service';

const BASE = '/api/v1/visitor-intelligence';
const ADMIN = '/api/v1/admin/visitor-intelligence';
const env = loadEnv({
  NODE_ENV: 'test', APP_URL: 'http://localhost:3000', DATABASE_URL: 'postgresql://test:test@localhost/test',
  JWT_SECRET: 'v'.repeat(32), MARKETING_CONSENT_SECRET: 'c'.repeat(32), VISITOR_IP_MODE: 'direct', LOG_LEVEL: 'silent',
} as NodeJS.ProcessEnv);

describe('first-party Visitor Intelligence API', () => {
  let db: PGlite;
  let app: ReturnType<typeof buildApp>;
  let admin: string;
  let superAdmin: string;
  let customer: string;
  let supportStaff: string;

  beforeEach(async () => {
    process.env.DATABASE_URL = env.DATABASE_URL;
    process.env.JWT_SECRET = env.JWT_SECRET;
    resetEnvCache();
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    app = buildApp(env, { pool: db, serveFrontend: false });
    admin = await makeUser('admin');
    superAdmin = await makeUser('super_admin');
    customer = await makeUser('customer');
    supportStaff = await makeUser('staff');
  });

  afterEach(async () => { await app.close(); await db.close(); });

  async function makeUser(role: 'admin' | 'super_admin' | 'customer' | 'staff') {
    const id = randomUUID();
    const email = `${role}-${id}@example.test`;
    await db.query(`INSERT INTO users(id,email,password_hash,full_name,role) VALUES($1,$2,'unused',$3,$4)`, [id, email, role, role]);
    return signAuthToken(env, { sub: id, email, role });
  }
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  async function analyticsConsent() {
    const bootstrap = await app.inject({ method: 'GET', url: '/api/v1/marketing/bootstrap', headers: { host: 'localhost:3000' } });
    expect(bootstrap.statusCode).toBe(200);
    const cookie = String(bootstrap.headers['set-cookie']).split(';')[0]!;
    const csrf = bootstrap.json().consent.csrfToken as string;
    const saved = await app.inject({
      method: 'PUT', url: '/api/v1/marketing/consent',
      headers: { cookie, host: 'localhost:3000', origin: 'http://localhost:3000', 'x-consent-csrf': csrf },
      payload: { action: 'save_preferences', policyVersion: 1, preferences: { essential: true, analytics: true, marketing: false } },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().consent.preferences).toMatchObject({ analytics: true, marketing: false });
    return { cookie, csrf };
  }

  async function enableCollection() {
    const updated = await app.inject({ method: 'PATCH', url: `${ADMIN}/settings`, headers: auth(admin), payload: { enabled: true } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().settings.enabled).toBe(true);
  }

  function pagePayload(input: { visitorId?: string; sessionId?: string; tabId?: string; pagePath?: string } = {}) {
    return {
      visitorId: input.visitorId ?? randomUUID(),
      sessionId: input.sessionId ?? randomUUID(),
      tabId: input.tabId ?? randomUUID(),
      pagePath: input.pagePath ?? '/hosting/pro?email=person%40example.test&auth=secret#plans',
      referrerHost: 'https://search.example.test/results?q=person%40example.test',
    };
  }

  it('is disabled by default and requires admin or super_admin for every reporting/settings surface', async () => {
    const status = await app.inject({ method: 'GET', url: `${BASE}/status` });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ enabled: false, heartbeatSeconds: 30 });
    expect(status.headers['cache-control']).toMatch(/private.*no-store/);

    expect((await app.inject({ method: 'GET', url: `${ADMIN}/overview` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `${ADMIN}/overview`, headers: auth(customer) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `${ADMIN}/overview`, headers: auth(supportStaff) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `${ADMIN}/settings`, headers: auth(admin) })).json().settings).toMatchObject({ enabled: false, retentionDays: 90 });
    const updated = await app.inject({ method: 'PATCH', url: `${ADMIN}/settings`, headers: auth(admin), payload: { retentionDays: 30 } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().settings).toMatchObject({ enabled: false, retentionDays: 30 });
    const invalidRetention = await app.inject({ method: 'PATCH', url: `${ADMIN}/settings`, headers: auth(superAdmin), payload: { retentionDays: 366 } });
    expect(invalidRetention.statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `${ADMIN}/overview`, headers: auth(superAdmin) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `${ADMIN}/stream` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PATCH', url: `${ADMIN}/settings`, headers: auth(customer), payload: { enabled: true } })).statusCode).toBe(403);
  });

  it('preserves independent settings from concurrent partial PATCH requests', async () => {
    const [retentionResponse, idleResponse] = await Promise.all([
      app.inject({ method: 'PATCH', url: `${ADMIN}/settings`, headers: auth(admin), payload: { retentionDays: 45 } }),
      app.inject({ method: 'PATCH', url: `${ADMIN}/settings`, headers: auth(superAdmin), payload: { idleAfterSeconds: 300 } }),
    ]);
    expect(retentionResponse.statusCode).toBe(200);
    expect(idleResponse.statusCode).toBe(200);

    const settings = (await db.query<{ enabled: boolean; retention_days: number; idle_after_seconds: number; online_timeout_seconds: number }>(
      'SELECT enabled, retention_days, idle_after_seconds, online_timeout_seconds FROM visitor_intelligence_settings WHERE id=1'
    )).rows[0]!;
    expect(settings).toEqual({ enabled: false, retention_days: 45, idle_after_seconds: 300, online_timeout_seconds: 120 });
  });

  it('clears live presence after a successful disable while preserving historical visitor reports', async () => {
    await enableCollection();
    const consent = await analyticsConsent();
    const presence = await app.inject({
      method: 'POST', url: `${BASE}/pageview`,
      headers: { cookie: consent.cookie, host: 'localhost:3000', origin: 'http://localhost:3000', 'x-consent-csrf': consent.csrf },
      payload: pagePayload(),
    });
    expect(presence.statusCode).toBe(202);
    expect((await db.query('SELECT * FROM visitor_presence')).rows).toHaveLength(1);

    const disabled = await app.inject({ method: 'PATCH', url: `${ADMIN}/settings`, headers: auth(admin), payload: { enabled: false } });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().settings.enabled).toBe(false);
    expect((await db.query('SELECT * FROM visitor_presence')).rows).toHaveLength(0);
    expect((await db.query('SELECT * FROM visitor_sessions')).rows).toHaveLength(1);
    expect((await db.query('SELECT * FROM visitor_pageviews')).rows).toHaveLength(1);
  });

  it('rolls back setting and presence changes when the audit insert fails', async () => {
    await enableCollection();
    const consent = await analyticsConsent();
    const presence = await app.inject({
      method: 'POST', url: `${BASE}/pageview`,
      headers: { cookie: consent.cookie, host: 'localhost:3000', origin: 'http://localhost:3000', 'x-consent-csrf': consent.csrf },
      payload: pagePayload(),
    });
    expect(presence.statusCode).toBe(202);
    expect((await db.query('SELECT * FROM visitor_presence')).rows).toHaveLength(1);

    const before = (await db.query<{ enabled: boolean; retention_days: number; updated_at: string }>(
      'SELECT enabled, retention_days, updated_at::text AS updated_at FROM visitor_intelligence_settings WHERE id=1'
    )).rows[0]!;
    const auditCountBefore = Number((await db.query<{ count: number }>(
      "SELECT count(*) AS count FROM audit_logs WHERE action='visitor_intelligence.settings_updated'"
    )).rows[0]!.count);
    await db.exec(`
      CREATE FUNCTION visitor_intelligence_test_reject_settings_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'visitor_intelligence.settings_updated' THEN
          RAISE EXCEPTION 'forced Visitor Intelligence audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER visitor_intelligence_test_reject_settings_audit
        BEFORE INSERT ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION visitor_intelligence_test_reject_settings_audit();
    `);

    const failedUpdate = await app.inject({
      method: 'PATCH', url: `${ADMIN}/settings`, headers: auth(admin), payload: { enabled: false },
    });
    expect(failedUpdate.statusCode).toBe(500);
    expect((await db.query<{ enabled: boolean; retention_days: number; updated_at: string }>(
      'SELECT enabled, retention_days, updated_at::text AS updated_at FROM visitor_intelligence_settings WHERE id=1'
    )).rows[0]).toEqual(before);
    expect((await db.query('SELECT * FROM visitor_presence')).rows).toHaveLength(1);
    expect(Number((await db.query<{ count: number }>(
      "SELECT count(*) AS count FROM audit_logs WHERE action='visitor_intelligence.settings_updated'"
    )).rows[0]!.count)).toBe(auditCountBefore);
  });

  it('requires valid analytics consent, same-origin CSRF and explicit operator enablement before ingestion', async () => {
    const consent = await analyticsConsent();
    const visitor = pagePayload();
    const disabled = await app.inject({
      method: 'POST', url: `${BASE}/pageview`, remoteAddress: '8.8.8.8',
      headers: { cookie: consent.cookie, host: 'localhost:3000', origin: 'http://localhost:3000', 'x-consent-csrf': consent.csrf }, payload: visitor,
    });
    expect(disabled.statusCode).toBe(204);
    expect((await db.query('SELECT * FROM visitor_sessions')).rows).toHaveLength(0);

    await enableCollection();
    const noCsrf = await app.inject({ method: 'POST', url: `${BASE}/pageview`, headers: { cookie: consent.cookie, host: 'localhost:3000', origin: 'http://localhost:3000' }, payload: pagePayload() });
    expect(noCsrf.statusCode).toBe(403);
    const crossSite = await app.inject({ method: 'POST', url: `${BASE}/pageview`, headers: { cookie: consent.cookie, host: 'localhost:3000', origin: 'https://attacker.example', 'x-consent-csrf': consent.csrf }, payload: pagePayload() });
    expect(crossSite.statusCode).toBe(403);
    const crossSiteMetadata = await app.inject({ method: 'POST', url: `${BASE}/pageview`, headers: { cookie: consent.cookie, host: 'localhost:3000', origin: 'http://localhost:3000', 'sec-fetch-site': 'cross-site', 'x-consent-csrf': consent.csrf }, payload: pagePayload() });
    expect(crossSiteMetadata.statusCode).toBe(403);

    const accepted = await app.inject({
      method: 'POST', url: `${BASE}/pageview`, remoteAddress: '8.8.8.8',
      headers: { cookie: consent.cookie, host: 'localhost:3000', origin: 'http://localhost:3000', 'x-consent-csrf': consent.csrf, 'user-agent': 'Mozilla/5.0 Chrome/128.0 Safari/537.36' },
      payload: visitor,
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toEqual({ accepted: true });

    const session = (await db.query<Record<string, unknown>>('SELECT * FROM visitor_sessions')).rows[0]!;
    const pageview = (await db.query<Record<string, unknown>>('SELECT * FROM visitor_pageviews')).rows[0]!;
    expect(session).toMatchObject({ first_page_path: '/hosting/pro', referrer_host: 'example.test', device_category: 'desktop', browser_family: 'Chrome' });
    expect(pageview).toMatchObject({ page_path: '/hosting/pro', referrer_host: 'example.test' });
    expect(Object.keys(session).join(' ')).not.toMatch(/(^|_)(ip|user_agent)(_|$)/i);
    expect(JSON.stringify([session, pageview])).not.toContain('8.8.8.8');
    expect(JSON.stringify([session, pageview])).not.toMatch(/person%40example|secret/);

    for (const path of [
      '/admin/audit', '/health/live', '/api/v1/private', '/admin%2Fusers', '/%2561dmin%252fusers',
      '/api%252fv1/private', '/health%5Clive',
    ]) {
      const excluded = await app.inject({ method: 'POST', url: `${BASE}/pageview`, headers: { cookie: consent.cookie, host: 'localhost:3000', origin: 'http://localhost:3000', 'x-consent-csrf': consent.csrf }, payload: pagePayload({ pagePath: path }) });
      expect(excluded.statusCode).toBe(204);
    }
    const bot = await app.inject({ method: 'POST', url: `${BASE}/pageview`, headers: { cookie: consent.cookie, host: 'localhost:3000', origin: 'http://localhost:3000', 'x-consent-csrf': consent.csrf, 'user-agent': 'Googlebot/2.1' }, payload: pagePayload() });
    expect(bot.statusCode).toBe(204);
    const adminBrowsing = await app.inject({ method: 'POST', url: `${BASE}/pageview`, headers: { ...auth(admin), cookie: consent.cookie, host: 'localhost:3000', origin: 'http://localhost:3000', 'x-consent-csrf': consent.csrf }, payload: pagePayload() });
    expect(adminBrowsing.statusCode).toBe(204);
    expect((await db.query('SELECT * FROM visitor_pageviews')).rows).toHaveLength(1);
  });

  it('deduplicates multiple open tabs into one live visitor and serves protected journey/report data', async () => {
    const consent = await analyticsConsent();
    await enableCollection();
    const visitorId = randomUUID();
    const sessionId = randomUUID();
    const firstTab = randomUUID();
    const secondTab = randomUUID();
    const headers = { cookie: consent.cookie, host: 'localhost:3000', origin: 'http://localhost:3000', 'x-consent-csrf': consent.csrf, 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0' };
    for (const [tabId, pagePath] of [[firstTab, '/hosting'], [secondTab, '/hosting/pro']] as const) {
      const response = await app.inject({ method: 'POST', url: `${BASE}/pageview`, remoteAddress: '8.8.8.8', headers, payload: pagePayload({ visitorId, sessionId, tabId, pagePath }) });
      expect(response.statusCode).toBe(202);
    }
    expect((await db.query('SELECT * FROM visitor_sessions')).rows).toHaveLength(1);
    expect((await db.query('SELECT * FROM visitor_presence')).rows).toHaveLength(2);
    expect((await db.query('SELECT * FROM visitor_pageviews')).rows).toHaveLength(2);

    const online = await app.inject({ method: 'GET', url: `${ADMIN}/online`, headers: auth(admin) });
    expect(online.statusCode).toBe(200);
    expect(online.json()).toMatchObject({ count: 1, visitors: [{ visitorId, sessionId, openTabs: 2, status: 'online' }] });
    expect(online.body).not.toContain('8.8.8.8');
    expect(online.body).not.toContain('rawUserAgent');

    const overview = await app.inject({ method: 'GET', url: `${ADMIN}/overview?range=today`, headers: auth(superAdmin) });
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({
      tracking: { enabled: true, retentionDays: 90, idleAfterSeconds: 120, onlineTimeoutSeconds: 120, updatedAt: expect.any(String) },
      stats: { uniqueVisitors: 1, pageViews: 2 },
      topPages: expect.arrayContaining([{ pagePath: '/hosting', pageViews: 1, visitors: 1 }]),
    });
    expect(overview.body).not.toContain('8.8.8.8');
    expect((await app.inject({ method: 'GET', url: `${ADMIN}/map?range=today`, headers: auth(admin) })).statusCode).toBe(200);
  });

  it('audits sensitive report and live-stream reads without visitor data', async () => {
    const actorId = (await db.query<{ id: string }>("SELECT id FROM users WHERE role='admin' LIMIT 1")).rows[0]!.id;
    const reportReads = [
      ['overview?range=today', 'overview'],
      ['online', 'online'],
      ['map?range=today', 'map'],
      ['countries?range=today', 'countries'],
      ['countries/GB?range=today', 'country_detail'],
      ['cities?range=today', 'cities'],
      ['pages?range=today', 'pages'],
      ['devices?range=today', 'devices'],
      ['referrers?range=today', 'referrers'],
      ['timeseries?range=today', 'timeseries'],
      ['settings', 'settings'],
    ] as const;

    for (const [path] of reportReads) {
      const response = await app.inject({ method: 'GET', url: `${ADMIN}/${path}`, headers: auth(admin) });
      expect(response.statusCode, path).toBe(200);
    }

    const reports = (await db.query<{ actor_id: string; resource_type: string; resource_id: string; metadata: Record<string, unknown> }>(
      `SELECT actor_id, resource_type, resource_id, metadata FROM audit_logs
       WHERE resource_type IN ('visitor_intelligence_report','visitor_intelligence_settings')
       ORDER BY created_at, resource_id`
    )).rows;
    expect(reports.map((row) => row.resource_id).sort()).toEqual(reportReads.map(([, surface]) => surface).sort());
    expect(reports.every((row) => row.actor_id === actorId)).toBe(true);
    expect(reports.every((row) => Object.keys(row.metadata).every((key) => ['surface', 'range'].includes(key)))).toBe(true);
    expect(JSON.stringify(reports)).not.toMatch(/visitorId|sessionId|pagePath|page_path|cityName|countryName/i);

    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();
    const stream = await fetch(`${address}${ADMIN}/stream`, { headers: auth(admin), signal: controller.signal });
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    controller.abort();
    await reader.cancel().catch(() => undefined);

    const streamAudit = (await db.query<{ actor_id: string; action: string; resource_type: string; resource_id: string; metadata: Record<string, unknown> }>(
      `SELECT actor_id, action, resource_type, resource_id, metadata FROM audit_logs
       WHERE action='visitor_intelligence.stream_opened' ORDER BY created_at DESC LIMIT 1`
    )).rows[0];
    expect(streamAudit).toMatchObject({
      actor_id: actorId,
      action: 'visitor_intelligence.stream_opened',
      resource_type: 'visitor_intelligence_stream',
      resource_id: 'live_presence',
      metadata: { surface: 'live_presence' },
    });
    expect(JSON.stringify(streamAudit)).not.toMatch(/visitorId|sessionId|pagePath|page_path|cityName|countryName/i);
  });

  it('rejects stale sessions after 30 minutes and accepts a renewed session after wake-up', async () => {
    const consent = await analyticsConsent();
    await enableCollection();
    const visitorId = randomUUID();
    const sessionId = randomUUID();
    const tabId = randomUUID();
    const headers = { cookie: consent.cookie, host: 'localhost:3000', origin: 'http://localhost:3000', 'x-consent-csrf': consent.csrf };

    const first = await app.inject({
      method: 'POST', url: `${BASE}/pageview`, headers,
      payload: pagePayload({ visitorId, sessionId, tabId, pagePath: '/hosting' }),
    });
    expect(first.statusCode).toBe(202);
    await db.query("UPDATE visitor_sessions SET last_seen_at=now()-interval '30 minutes' WHERE session_id=$1", [sessionId]);

    const stalePageview = await app.inject({
      method: 'POST', url: `${BASE}/pageview`, headers,
      payload: pagePayload({ visitorId, sessionId, tabId, pagePath: '/hosting/after-sleep' }),
    });
    expect(stalePageview.statusCode).toBe(409);
    expect(stalePageview.json()).toEqual({ error: 'SESSION_EXPIRED' });

    const staleHeartbeat = await app.inject({
      method: 'POST', url: `${BASE}/heartbeat`, headers,
      payload: { ...pagePayload({ visitorId, sessionId, tabId, pagePath: '/hosting' }), active: false },
    });
    expect(staleHeartbeat.statusCode).toBe(409);
    expect(staleHeartbeat.json()).toEqual({ error: 'SESSION_EXPIRED' });
    expect((await db.query('SELECT * FROM visitor_pageviews')).rows).toHaveLength(1);

    const renewed = await app.inject({
      method: 'POST', url: `${BASE}/pageview`, headers,
      payload: pagePayload({ visitorId, sessionId: randomUUID(), tabId: randomUUID(), pagePath: '/hosting/after-sleep' }),
    });
    expect(renewed.statusCode).toBe(202);
    expect((await db.query('SELECT * FROM visitor_sessions')).rows).toHaveLength(2);
    expect((await db.query('SELECT * FROM visitor_pageviews')).rows).toHaveLength(2);
  });

  it('prunes retention backlogs in bounded batches and reports when another pass is needed', async () => {
    await analyticsConsent();
    const consentSessionId = (await db.query<{ id: string }>(
      'SELECT id FROM marketing_consent_sessions ORDER BY created_at DESC LIMIT 1'
    )).rows[0]!.id;

    for (let index = 0; index < 5; index += 1) {
      const sessionId = randomUUID();
      const visitorId = randomUUID();
      await db.query(`INSERT INTO visitor_sessions (session_id, visitor_id, consent_session_id, first_page_path)
        VALUES ($1,$2,$3,'/expired')`, [sessionId, visitorId, consentSessionId]);
      await db.query(`UPDATE visitor_sessions SET first_seen_at=now()-interval '100 days',
        last_seen_at=now()-interval '100 days' WHERE session_id=$1`, [sessionId]);
      await db.query(`INSERT INTO visitor_pageviews (id, session_id, visitor_id, page_path, occurred_at)
        VALUES ($1,$2,$3,'/expired',now()-interval '100 days')`, [randomUUID(), sessionId, visitorId]);
      await db.query(`INSERT INTO visitor_presence (tab_id, session_id, visitor_id, current_page_path, heartbeat_at, activity_at)
        VALUES ($1,$2,$3,'/expired',now()-interval '2 days',now()-interval '2 days')`, [randomUUID(), sessionId, visitorId]);
    }

    const currentSessionId = randomUUID();
    const currentVisitorId = randomUUID();
    await db.query(`INSERT INTO visitor_sessions (session_id, visitor_id, consent_session_id, first_page_path)
      VALUES ($1,$2,$3,'/current')`, [currentSessionId, currentVisitorId, consentSessionId]);
    await db.query(`INSERT INTO visitor_pageviews (id, session_id, visitor_id, page_path)
      VALUES ($1,$2,$3,'/current')`, [randomUUID(), currentSessionId, currentVisitorId]);
    await db.query(`INSERT INTO visitor_presence (tab_id, session_id, visitor_id, current_page_path)
      VALUES ($1,$2,$3,'/current')`, [randomUUID(), currentSessionId, currentVisitorId]);

    const firstPass = await pruneVisitorIntelligence(db, 2, 2);
    expect(firstPass.batches).toEqual({ pageviews: 2, presence: 2, sessions: 2 });
    expect(firstPass.hasMore).toBe(true);
    expect(firstPass.pageviews + firstPass.presence + firstPass.sessions).toBeGreaterThan(0);

    const secondPass = await pruneVisitorIntelligence(db, 2, 2);
    expect(secondPass.hasMore).toBe(false);
    expect((await db.query('SELECT * FROM visitor_sessions')).rows).toHaveLength(1);
    expect((await db.query('SELECT * FROM visitor_pageviews')).rows).toHaveLength(1);
    expect((await db.query('SELECT * FROM visitor_presence')).rows).toHaveLength(1);
  });

  it('deletes consent-linked visitor data when Analytics consent is withdrawn', async () => {
    const consent = await analyticsConsent();
    await enableCollection();
    const headers = { cookie: consent.cookie, host: 'localhost:3000', origin: 'http://localhost:3000', 'x-consent-csrf': consent.csrf };
    const created = await app.inject({ method: 'POST', url: `${BASE}/pageview`, headers, payload: pagePayload() });
    expect(created.statusCode).toBe(202);
    expect((await db.query('SELECT * FROM visitor_pageviews')).rows).toHaveLength(1);

    const withdrawn = await app.inject({ method: 'PUT', url: '/api/v1/marketing/consent', headers, payload: { action: 'withdraw', policyVersion: 1 } });
    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.json().consent.preferences.analytics).toBe(false);
    expect((await db.query('SELECT * FROM visitor_sessions')).rows).toHaveLength(0);
    expect((await db.query('SELECT * FROM visitor_pageviews')).rows).toHaveLength(0);
    expect((await db.query('SELECT * FROM visitor_presence')).rows).toHaveLength(0);

    const afterWithdrawal = await app.inject({ method: 'POST', url: `${BASE}/pageview`, headers, payload: pagePayload() });
    expect(afterWithdrawal.statusCode).toBe(204);
    expect((await db.query('SELECT * FROM visitor_sessions')).rows).toHaveLength(0);
  });
});
