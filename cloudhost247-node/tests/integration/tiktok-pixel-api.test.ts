import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEnv, resetEnvCache } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { defaultTikTokConfiguration } from '../../src/tiktok/types';
import { recordVerifiedTikTokPayment, verifiedTikTokPurchaseReceipt } from '../../src/tiktok/event-service';
import { drainTikTokOutbox } from '../../src/tiktok/events-api-worker';
import { encryptSecret } from '../../src/lib/crypto';
import { getKeyRing } from '../../src/lib/keyring';
import { withTransaction } from '../../src/db/transaction';

const BASE = '/api/v1/admin/marketing-integrations/tiktok-pixel';
const PIXEL = 'C4A7B2D9E1F0A3B5C6D7';
const TOKEN = 'TEST_TIKTOK_ACCESS_TOKEN_0123456789';
const env = loadEnv({ NODE_ENV: 'test', APP_URL: 'http://localhost:3000', DATABASE_URL: 'postgresql://test:test@localhost/test', JWT_SECRET: 'j'.repeat(32), CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64), LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);

describe('TikTok Pixel integration', () => {
  let db: PGlite;
  let app: ReturnType<typeof buildApp>;
  let admin: string;
  let customer: string;
  beforeEach(async () => {
    process.env.DATABASE_URL = env.DATABASE_URL;
    process.env.JWT_SECRET = env.JWT_SECRET;
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'a'.repeat(64);
    resetEnvCache();
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    app = buildApp(env, { pool: db, serveFrontend: false });
    admin = await user('admin'); customer = await user('customer');
  });
  afterEach(async () => { await app.close(); await db.close(); vi.restoreAllMocks(); });
  async function user(role: 'admin' | 'customer' | 'staff') {
    const id = randomUUID();
    await db.query(`INSERT INTO users(id,email,password_hash,full_name,role) VALUES($1,$2,'unused',$3,$4)`, [id, `${role}-${id}@example.test`, role, role]);
    return signAuthToken(env, { sub: id, email: `${role}@example.test`, role });
  }
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  async function save(revision: number, overrides = {}, extra = {}) {
    return app.inject({ method: 'PUT', url: BASE, headers: auth(admin), payload: { expectedRevision: revision, configuration: { ...defaultTikTokConfiguration, pixelId: PIXEL, websiteDomain: 'localhost', enabled: true, ...overrides }, ...extra } });
  }

  it('requires admin authorization on every admin endpoint', async () => {
    expect((await app.inject({ method: 'GET', url: BASE })).statusCode).toBe(401);
    for (const token of [customer, await user('staff')]) {
      expect((await app.inject({ method: 'GET', url: BASE, headers: auth(token) })).statusCode).toBe(403);
      expect((await app.inject({ method: 'PUT', url: BASE, headers: auth(token), payload: {} })).statusCode).toBe(403);
    }
    expect((await app.inject({ method: 'GET', url: BASE, headers: auth(admin) })).json().configuration.enabled).toBe(false);
  });

  it('validates Pixel IDs and rejects script injection and arbitrary fields', async () => {
    for (const pixelId of ['abc', '123456789012345', '<script>alert(1)</script>', 'C4A7 B2D9', 'x'.repeat(33)]) {
      expect((await save(1, { pixelId })).statusCode, pixelId).toBe(400);
    }
    expect((await save(1, { pixelId: null })).statusCode).toBe(400);
    expect((await save(1, { websiteDomain: 'https://cloudhost247.com/path' })).statusCode).toBe(400);
    expect((await save(1, { testMode: true, testEventCode: null })).statusCode).toBe(400);
    expect((await save(1, { unknownScript: '<script>' })).statusCode).toBe(400);
    expect((await save(99)).statusCode).toBe(409);
  });

  it('saves, tests honestly, resets, audits, and keeps the token encrypted and server-side only', async () => {
    expect((await save(1, { eventsApi: { enabled: true } })).statusCode).toBe(400);
    const saved = await save(1, { testMode: true, testEventCode: 'TEST123', eventsApi: { enabled: true } }, { eventsApiAccessToken: TOKEN });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain(TOKEN);
    expect(saved.json().configuration).toMatchObject({ revision: 2, eventsApi: { enabled: true, hasToken: true } });
    const stored = (await db.query<{ encrypted_value: string }>(`SELECT encrypted_value FROM marketing_integration_secrets WHERE provider_key='tiktok_pixel'`)).rows[0]!;
    expect(stored.encrypted_value).toMatch(/^v1:/);
    expect(stored.encrypted_value).not.toContain(TOKEN);
    const test = await app.inject({ method: 'POST', url: `${BASE}/test`, headers: auth(admin) });
    expect(test.json()).toMatchObject({ status: 'CONFIGURATION_VALID', providerContacted: false, tiktokReceiptVerified: false });
    const diag = await app.inject({ method: 'GET', url: `${BASE}/diagnostics`, headers: auth(admin) });
    expect(diag.json().diagnostics).toMatchObject({ pixelId: PIXEL, enabled: true, duplicateEventWarnings: 0 });
    expect(diag.body).not.toContain(TOKEN);
    const audit = await app.inject({ method: 'GET', url: `${BASE}/audit`, headers: auth(admin) });
    expect(audit.json().entries.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['marketing.tiktok_pixel.configuration_saved', 'marketing.tiktok_pixel.configuration_tested']));
    expect(audit.body).not.toContain(TOKEN);
    const reset = await app.inject({ method: 'POST', url: `${BASE}/reset`, headers: auth(admin), payload: { expectedRevision: 2, confirmation: 'RESET' } });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().configuration).toMatchObject({ enabled: false, pixelId: null, revision: 3 });
    expect((await db.query(`SELECT * FROM marketing_integration_secrets WHERE provider_key='tiktok_pixel'`)).rows).toHaveLength(0);
  });

  it('public bootstrap is disabled-by-default and never exposes a token', async () => {
    const boot = await app.inject({ method: 'GET', url: '/api/v1/marketing/tiktok/bootstrap', headers: { host: 'localhost:3000' } });
    expect(boot.statusCode).toBe(200);
    expect(boot.json().configuration).toMatchObject({ provider: 'tiktok', enabled: false, pixelId: null, diagnostic: 'missing_configuration' });
    expect(boot.body).not.toContain('accessToken');
  });

  describe('verified CompletePayment + Events API dedup delivery', () => {
    let userId: string; let orderId: string; let invoiceId: string; let paymentId: string; let cookie: string; let csrf: string;
    beforeEach(async () => {
      userId = randomUUID(); orderId = randomUUID(); invoiceId = randomUUID(); paymentId = randomUUID();
      await db.query(`INSERT INTO users(id,email,password_hash,full_name,role) VALUES($1,'buyer@example.test','unused','Buyer','customer')`, [userId]);
      await db.query(`INSERT INTO orders(id,user_id,currency,subtotal_amount,total_amount,status,payment_status) VALUES($1,$2,'NGN',1500,1500,'pending','unpaid')`, [orderId, userId]);
      await db.query(`INSERT INTO order_items(id,order_id,product_name_snapshot,plan_name_snapshot,billing_period,quantity,unit_price_amount,currency,line_total_amount,metadata) VALUES($1,$2,'Hosting','Starter','monthly',2,750,'NGN',1500,$3)`, [randomUUID(), orderId, JSON.stringify({ kind: 'platform_plan', serviceKind: 'website_builder', planCode: 'starter' })]);
      await db.query(`INSERT INTO invoices(id,order_id,user_id,invoice_number,status,currency,subtotal_amount,total_amount,due_date) VALUES($1,$2,$3,'INV-TT','unpaid','NGN',1500,1500,now()+interval '7 days')`, [invoiceId, orderId, userId]);
      await db.query(`INSERT INTO payments(id,invoice_id,user_id,provider,method,amount,currency,status) VALUES($1,$2,$3,'manual','bank_transfer',1500,'NGN','pending')`, [paymentId, invoiceId, userId]);
      const bootstrap = await app.inject({ method: 'GET', url: '/api/v1/marketing/bootstrap', headers: { host: 'localhost:3000' } });
      cookie = String(bootstrap.headers['set-cookie']).split(';')[0]!; csrf = bootstrap.json().consent.csrfToken;
      await app.inject({ method: 'PUT', url: '/api/v1/marketing/consent', headers: { cookie, origin: 'http://localhost:3000', host: 'localhost:3000', 'x-consent-csrf': csrf }, payload: { action: 'accept_all', policyVersion: 1 } });
      await db.query(`INSERT INTO marketing_conversion_contexts(subject_key,order_id,session_id,source_url,fbp,fbc,ttp,ttclid) SELECT 'order:'||$1::text,$1::uuid,id,'http://localhost:3000/cart',NULL,NULL,'ttp-test','ttclid-test' FROM marketing_consent_sessions`, [orderId]);
      await db.query(`UPDATE marketing_integrations SET enabled=true,website_domain='localhost',configuration=$1 WHERE provider_key='tiktok_pixel'`, [JSON.stringify({ ...defaultTikTokConfiguration, pixelId: PIXEL, websiteDomain: 'localhost', enabled: true, eventsApi: { enabled: true } })]);
      await db.query(`INSERT INTO marketing_integration_secrets(provider_key,secret_key,encrypted_value) VALUES('tiktok_pixel','events_api_access_token',$1)`, [encryptSecret(getKeyRing(), TOKEN)]);
    });
    async function paySuccess() {
      await withTransaction(db, async tx => {
        await tx.query(`UPDATE payments SET status='successful',completed_at=now() WHERE id=$1`, [paymentId]);
        await tx.query(`UPDATE invoices SET status='paid' WHERE id=$1`, [invoiceId]);
        await tx.query(`UPDATE orders SET payment_status='paid' WHERE id=$1`, [orderId]);
        await recordVerifiedTikTokPayment(tx, paymentId);
      });
    }
    it('creates exactly one CompletePayment only after confirmed payment, preserving actual value/currency', async () => {
      await recordVerifiedTikTokPayment(db, paymentId);
      expect((await db.query(`SELECT * FROM marketing_events WHERE provider_key='tiktok_pixel'`)).rows).toHaveLength(0);
      await paySuccess(); await paySuccess();
      const events = (await db.query(`SELECT * FROM marketing_events WHERE provider_key='tiktok_pixel'`)).rows;
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ event_name: 'CompletePayment', event_id: `purchase:${paymentId}` });
      expect(events[0].custom_data).toMatchObject({ value: 1500, currency: 'NGN', content_ids: ['platform:website_builder:starter'] });
      expect((await db.query('SELECT * FROM marketing_delivery_outbox')).rows).toHaveLength(1);
      const receipt = await verifiedTikTokPurchaseReceipt(db, userId, invoiceId, events[0].session_id);
      expect(receipt.eventId).toBe(events[0].event_id);
    });
    it('worker delivers with the same event_id, retries transient failures, and records delivery', async () => {
      await paySuccess();
      const bodies: any[] = [];
      let attempt = 0;
      const fetchImpl = vi.fn(async (_url: string, init: any) => {
        attempt++; bodies.push(JSON.parse(init.body));
        return attempt === 1 ? { ok: false, status: 503, json: async () => ({ code: 50001 }) } : { ok: true, status: 200, json: async () => ({ code: 0 }) };
      }) as unknown as typeof fetch;
      expect(await drainTikTokOutbox(db, { fetchImpl })).toMatchObject({ claimed: 1, retried: 1 });
      await db.query(`UPDATE marketing_delivery_outbox SET next_attempt_at=now()`);
      expect(await drainTikTokOutbox(db, { fetchImpl })).toMatchObject({ claimed: 1, delivered: 1 });
      expect(bodies).toHaveLength(2);
      expect(bodies[0].data[0].event_id).toBe(`purchase:${paymentId}`);
      expect(bodies[1].data[0].event_id).toBe(bodies[0].data[0].event_id);
      expect(bodies[0].data[0].properties).toMatchObject({ value: 1500, currency: 'NGN' });
      expect(JSON.stringify(bodies)).not.toContain(TOKEN);
      const outbox = (await db.query('SELECT * FROM marketing_delivery_outbox')).rows[0];
      expect(outbox).toMatchObject({ status: 'delivered', attempts: 2 });
      expect(await drainTikTokOutbox(db, { fetchImpl })).toMatchObject({ claimed: 0 });
    });
    it('consent withdrawal cancels queued Events API delivery (no consent bypass)', async () => {
      await paySuccess();
      await app.inject({ method: 'PUT', url: '/api/v1/marketing/consent', headers: { cookie, origin: 'http://localhost:3000', host: 'localhost:3000', 'x-consent-csrf': csrf }, payload: { action: 'withdraw', policyVersion: 1 } });
      const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ code: 0 }) })) as unknown as typeof fetch;
      const result = await drainTikTokOutbox(db, { fetchImpl });
      expect(result.delivered).toBe(0);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });
});
