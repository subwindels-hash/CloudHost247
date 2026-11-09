import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv, resetEnvCache } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { defaultConfiguration } from '../../src/marketing/types';
import { CONSENT_COOKIE, consentGranted, requiresOptIn, safeSourceUrl } from '../../src/marketing/consent-service';
import { listActivity } from '../../src/marketing/config-service';

const env = loadEnv({ NODE_ENV: 'test', APP_URL: 'http://localhost:3000', DATABASE_URL: 'postgresql://test:test@localhost/test', JWT_SECRET: 'j'.repeat(32), LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);
const BASE = '/api/v1/marketing';
describe('public Meta runtime and persisted cookie consent', () => {
  let db: PGlite; let app: ReturnType<typeof buildApp>;
  beforeEach(async () => {
    process.env.DATABASE_URL = env.DATABASE_URL; process.env.JWT_SECRET = env.JWT_SECRET; resetEnvCache();
    db = new PGlite(); await migrateUp(new PgliteClient(db), { isProduction: false });
    app = buildApp(env, { pool: db, serveFrontend: false });
  });
  afterEach(async () => { await app.close(); await db.close(); });
  async function bootstrap(cookie?: string) {
    const res = await app.inject({ method: 'GET', url: `${BASE}/bootstrap`, headers: { host: 'localhost:3000', ...(cookie ? { cookie } : {}) } });
    expect(res.statusCode).toBe(200);
    const setCookie = res.headers['set-cookie'];
    return { body: res.json(), cookie: typeof setCookie === 'string' ? setCookie.split(';')[0]! : cookie!, headers: res.headers };
  }
  async function change(session: Awaited<ReturnType<typeof bootstrap>>, action: string, preferences?: object) {
    return app.inject({ method: 'PUT', url: `${BASE}/consent`, headers: { cookie: session.cookie, origin: 'http://localhost:3000', host: 'localhost:3000', 'x-consent-csrf': session.body.consent.csrfToken }, payload: { action, preferences, policyVersion: 1 } });
  }
  async function enable(domain = 'localhost') {
    await db.query(`UPDATE marketing_integrations SET enabled=true,website_domain=$1,configuration=$2 WHERE provider_key='meta_pixel'`, [domain, JSON.stringify({ ...defaultConfiguration, pixelId: '123456789012345', websiteDomain: domain, enabled: true })]);
  }
  it('fails closed with no config/choice and issues only an essential opaque HttpOnly cookie', async () => {
    const session = await bootstrap();
    expect(session.body.configuration).toMatchObject({ enabled: false, pixelId: null, diagnostic: 'missing_configuration' });
    expect(session.body.consent).toMatchObject({ decided: false, marketingGranted: false, requiresOptIn: true, preferences: { essential: true, analytics: false, marketing: false } });
    expect(String(session.headers['set-cookie'])).toContain('HttpOnly; SameSite=Lax');
    expect(session.cookie).toMatch(new RegExp(`^${CONSENT_COOKIE}=[a-f0-9]{64}$`));
    const stored = (await db.query<{ token_hash: string }>('SELECT token_hash FROM marketing_consent_sessions')).rows[0]!;
    expect(session.cookie).not.toContain(stored.token_hash);
    expect(session.headers['cache-control']).toBe('private, no-store');
  });
  it('persists accept, reject, customized choices and withdrawal with history', async () => {
    let session = await bootstrap();
    for (const [action, preferences, expected] of [
      ['accept_all', undefined, true], ['reject_optional', undefined, false],
      ['save_preferences', { essential: true, analytics: true, marketing: false }, false],
      ['save_preferences', { essential: true, analytics: false, marketing: true }, true],
      ['withdraw', undefined, false],
    ] as const) {
      const res = await change(session, action, preferences);
      expect(res.statusCode).toBe(200);
      expect(res.json().consent.marketingGranted).toBe(expected);
      session = await bootstrap(session.cookie);
      expect(session.body.consent.marketingGranted).toBe(expected);
    }
    expect((await db.query('SELECT action FROM marketing_consent_history ORDER BY created_at')).rows.map(r => r.action)).toEqual(['accept_all','reject_optional','save_preferences','save_preferences','withdraw']);
  });
  it('rejects CSRF, cross-origin, essential opt-out and unknown fields', async () => {
    const session = await bootstrap();
    expect((await app.inject({ method: 'PUT', url: `${BASE}/consent`, headers: { cookie: session.cookie }, payload: { action: 'accept_all', policyVersion: 1 } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: `${BASE}/consent`, headers: { cookie: session.cookie, origin: 'https://evil.example', 'x-consent-csrf': session.body.consent.csrfToken }, payload: { action: 'accept_all', policyVersion: 1 } })).statusCode).toBe(403);
    expect((await change(session, 'save_preferences', { essential: false, analytics: true, marketing: true })).statusCode).toBe(400);
    expect((await change(session, 'save_preferences', { essential: true, analytics: true, marketing: true, email: 'private@example.com' })).statusCode).toBe(400);
    expect((await bootstrap()).body.consent.marketingGranted).toBe(false);
  });
  it('never enables a mismatched domain and never exposes CAPI credentials', async () => {
    await enable('cloudhost247.com');
    expect((await bootstrap()).body.configuration).toMatchObject({ enabled: false, diagnostic: 'domain_mismatch' });
    await enable();
    expect((await bootstrap()).body.configuration).toMatchObject({ enabled: true, pixelId: '123456789012345' });
    expect(JSON.stringify((await bootstrap()).body)).not.toContain('hasToken');
  });
  it('records only consented allowlisted browser events, deduplicates and refuses Purchase/PII', async () => {
    await enable(); const session = await bootstrap();
    const event = { eventName: 'AddToCart', eventId: 'cart:line-12345678', customData: { content_ids: ['plan-123'], currency: 'NGN', value: 1500 }, sourceUrl: 'http://localhost:3000/cart?secret=neverstore' };
    const send = (body: unknown) => app.inject({ method: 'POST', url: `${BASE}/browser-events`, headers: { cookie: session.cookie, origin: 'http://localhost:3000', host: 'localhost:3000', 'x-consent-csrf': session.body.consent.csrfToken }, payload: body });
    expect((await send({ events: [event] })).statusCode).toBe(403);
    await change(session, 'accept_all');
    expect((await send({ events: [event] })).json()).toMatchObject({ recorded: 1, duplicates: 0 });
    expect((await send({ events: [event] })).json()).toMatchObject({ recorded: 0, duplicates: 1 });
    expect((await send({ events: [{ ...event, eventName: 'Purchase' }] })).statusCode).toBe(400);
    expect((await send({ events: [{ ...event, customData: { email: 'private@example.com' } }] })).statusCode).toBe(400);
    // Free-text catalog labels are screened for obvious PII (email / phone / card digit runs).
    expect((await send({ events: [{ ...event, customData: { content_name: 'private@example.com' } }] })).statusCode).toBe(400);
    expect((await send({ events: [{ ...event, customData: { content_name: 'call 08012345678' } }] })).statusCode).toBe(400);
    expect((await send({ events: [{ ...event, customData: { content_category: 'card 4111111111111111' } }] })).statusCode).toBe(400);
    const stored = (await db.query('SELECT * FROM marketing_events')).rows;
    expect(stored).toHaveLength(1); expect(JSON.stringify(stored)).not.toContain('neverstore'); expect(JSON.stringify(stored)).not.toContain('private@example.com');
    await change(session, 'withdraw');
    expect((await send({ events: [event] })).statusCode).toBe(403);
  });
  it('accepts legitimate catalog labels and invoice numbers in content_name/content_category', async () => {
    await enable(); const session = await bootstrap(); await change(session, 'accept_all');
    const send = (customData: unknown, eventId: string) => app.inject({ method: 'POST', url: `${BASE}/browser-events`, headers: { cookie: session.cookie, origin: 'http://localhost:3000', host: 'localhost:3000', 'x-consent-csrf': session.body.consent.csrfToken }, payload: { events: [{ eventName: 'AddToCart', eventId, customData }] } });
    expect((await send({ content_name: 'Starter plan', content_category: 'web_hosting' }, 'cart:label-0001')).json()).toMatchObject({ recorded: 1 });
    expect((await send({ content_name: 'n00000001' }, 'payment-info:0002')).json()).toMatchObject({ recorded: 1 });
  });
  it('marks the browser side of a server-recorded conversion without overwriting server authority', async () => {
    await enable(); const session = await bootstrap(); await change(session, 'accept_all');
    await db.query(`INSERT INTO marketing_events(id,provider_key,pixel_id,config_revision,event_name,event_id,custom_data,source_url,session_id,occurred_at,server_recorded_at)
      SELECT $1,'meta_pixel','123456789012345',1,'CompleteRegistration',$2,'{"content_name":"CloudHost247 account"}'::jsonb,'http://localhost:3000/register',id,now(),now() FROM marketing_consent_sessions`, [randomUUID(), 'registration:user-123']);
    const send = (s: Awaited<ReturnType<typeof bootstrap>>) => app.inject({ method: 'POST', url: `${BASE}/browser-events`, headers: { cookie: s.cookie, origin: 'http://localhost:3000', host: 'localhost:3000', 'x-consent-csrf': s.body.consent.csrfToken }, payload: { events: [{ eventName: 'CompleteRegistration', eventId: 'registration:user-123', customData: { content_name: 'client overwrite attempt' } }] } });
    expect((await send(session)).json()).toMatchObject({ recorded: 0, duplicates: 1 });
    const row = (await db.query('SELECT * FROM marketing_events')).rows[0];
    expect(row.browser_dispatched_at).not.toBeNull(); expect(row.server_recorded_at).not.toBeNull();
    expect(row.custom_data).toEqual({ content_name: 'CloudHost247 account' });
    expect((await listActivity(db))[0]).toMatchObject({ channel: 'browser_and_server' });
    // A different consent session must not attach its browser dispatch to the original server event.
    const other = await bootstrap(); await change(other, 'accept_all');
    expect((await send(other)).json()).toMatchObject({ recorded: 0, duplicates: 1 });
    expect((await db.query('SELECT * FROM marketing_events')).rows).toHaveLength(1);
  });
  it('expires consent and invalidates older policy versions', async () => {
    const session = await bootstrap(); await change(session, 'accept_all');
    await db.query('UPDATE marketing_consent_sessions SET expires_at=now()-interval \'1 second\'');
    expect((await bootstrap(session.cookie)).body.consent.marketingGranted).toBe(false);
    const fresh = await bootstrap(); await change(fresh, 'accept_all');
    await db.query('UPDATE marketing_consent_sessions SET policy_version=0');
    expect((await bootstrap(fresh.cookie)).body.consent.marketingGranted).toBe(false);
  });
  it('uses conservative jurisdiction rules and strips query/fragment and foreign origins', () => {
    expect(requiresOptIn('global_opt_in','US')).toBe(true);
    expect(requiresOptIn('jurisdiction_opt_in',null)).toBe(true);
    expect(requiresOptIn('jurisdiction_opt_in','NG')).toBe(true);
    expect(requiresOptIn('jurisdiction_opt_in','GB')).toBe(true);
    expect(safeSourceUrl('https://evil.example/path?token=x','https://cloudhost247.com')).toBe('https://cloudhost247.com/');
    expect(safeSourceUrl('/cart?email=x#secret','https://cloudhost247.com')).toBe('https://cloudhost247.com/cart');
    expect(consentGranted(null)).toBe(false);
  });
});
