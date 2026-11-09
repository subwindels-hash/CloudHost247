import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { loadEnv, resetEnvCache } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { defaultConfiguration } from '../../src/marketing/types';
import { recordVerifiedPayment, verifiedPurchaseReceipt } from '../../src/marketing/conversion-service';
import { drainCapiOutbox, pruneMarketingRetention } from '../../src/marketing/capi-worker';
import { sendCapiEvent } from '../../src/marketing/capi-client';
import { loadCapiCredentials, saveConfiguration } from '../../src/marketing/config-service';
import { CONSENT_COOKIE } from '../../src/marketing/consent-service';
import { withTransaction } from '../../src/db/transaction';

const env = loadEnv({ NODE_ENV: 'test', APP_URL: 'http://localhost:3000', DATABASE_URL: 'postgresql://test:test@localhost/test', JWT_SECRET: 'j'.repeat(32), LOG_LEVEL: 'silent', CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64) } as NodeJS.ProcessEnv);
const TOKEN = 'test-meta-token-1234567890';
describe('verified conversions and CAPI delivery', () => {
  let db: PGlite; let app: ReturnType<typeof buildApp>; let userId: string; let orderId: string; let invoiceId: string; let paymentId: string; let cookie: string; let csrf: string;
  beforeEach(async () => {
    process.env.DATABASE_URL = env.DATABASE_URL; process.env.JWT_SECRET = env.JWT_SECRET; process.env.CREDENTIAL_ENCRYPTION_KEY = env.CREDENTIAL_ENCRYPTION_KEY!; resetEnvCache();
    db = new PGlite(); await migrateUp(new PgliteClient(db), { isProduction: false });
    app = buildApp(env, { pool: db, serveFrontend: false });
    userId = randomUUID(); orderId = randomUUID(); invoiceId = randomUUID(); paymentId = randomUUID();
    await db.query(`INSERT INTO users(id,email,password_hash,full_name,role) VALUES($1,'buyer@example.test','unused','Buyer','customer')`, [userId]);
    await db.query(`INSERT INTO orders(id,user_id,currency,subtotal_amount,total_amount,status,payment_status) VALUES($1,$2,'NGN',1500,1500,'pending','unpaid')`, [orderId,userId]);
    await db.query(`INSERT INTO order_items(id,order_id,product_name_snapshot,plan_name_snapshot,billing_period,quantity,unit_price_amount,currency,line_total_amount,metadata) VALUES($1,$2,'Hosting','Starter','monthly',1,1500,'NGN',1500,$3)`, [randomUUID(),orderId,JSON.stringify({ kind: 'platform_plan', serviceKind: 'website_builder', planCode: 'starter' })]);
    await db.query(`INSERT INTO invoices(id,order_id,user_id,invoice_number,status,currency,subtotal_amount,total_amount,due_date) VALUES($1,$2,$3,'INV-MKT','unpaid','NGN',1500,1500,now()+interval '7 days')`, [invoiceId,orderId,userId]);
    await db.query(`INSERT INTO payments(id,invoice_id,user_id,provider,method,amount,currency,status) VALUES($1,$2,$3,'manual','bank_transfer',1500,'NGN','pending')`, [paymentId,invoiceId,userId]);
    const bootstrap = await app.inject({ method: 'GET', url: '/api/v1/marketing/bootstrap', headers: { host: 'localhost:3000' } });
    cookie = String(bootstrap.headers['set-cookie']).split(';')[0]!; csrf = bootstrap.json().consent.csrfToken;
    await app.inject({ method: 'PUT', url: '/api/v1/marketing/consent', headers: { cookie, origin: 'http://localhost:3000', host: 'localhost:3000', 'x-consent-csrf': csrf }, payload: { action: 'accept_all', policyVersion: 1 } });
    await db.query(`INSERT INTO marketing_conversion_contexts(subject_key,order_id,session_id,source_url,fbp,fbc) SELECT 'order:'||$1::text,$1::uuid,id,'http://localhost:3000/cart','fb.1.123.456','fb.1.123.click' FROM marketing_consent_sessions`, [orderId]);
    await enableCapi();
  });
  afterEach(async () => { await app.close(); await db.close(); vi.restoreAllMocks(); });
  async function enableCapi(capi = true) {
    const config = { ...defaultConfiguration, pixelId: '123456789012345', websiteDomain: 'localhost', enabled: true, capi: { enabled: capi, apiVersion: 'v26.0' } };
    await db.query(`UPDATE marketing_integrations SET enabled=true,website_domain='localhost',configuration=$1 WHERE provider_key='meta_pixel'`, [JSON.stringify(config)]);
    if (capi) {
      const { encryptSecret } = await import('../../src/lib/crypto'); const { getKeyRing } = await import('../../src/lib/keyring');
      await db.query(`INSERT INTO marketing_integration_secrets(provider_key,secret_key,encrypted_value) VALUES('meta_pixel','capi_access_token',$1) ON CONFLICT(provider_key,secret_key) DO UPDATE SET encrypted_value=EXCLUDED.encrypted_value`, [encryptSecret(getKeyRing(), TOKEN)]);
    }
  }
  async function paySuccess() {
    await withTransaction(db, async tx => {
      await tx.query(`UPDATE payments SET status='successful',completed_at=now() WHERE id=$1`, [paymentId]);
      await tx.query(`UPDATE invoices SET status='paid' WHERE id=$1`, [invoiceId]);
      await tx.query(`UPDATE orders SET payment_status='paid' WHERE id=$1`, [orderId]);
      await recordVerifiedPayment(tx, paymentId);
    });
  }
  it('creates one purchase only from a successful paid payment, with actual amount/currency/IDs', async () => {
    await recordVerifiedPayment(db, paymentId);
    expect((await db.query('SELECT * FROM marketing_events')).rows).toHaveLength(0);
    await paySuccess(); await paySuccess();
    const events = (await db.query('SELECT * FROM marketing_events')).rows;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event_name: 'Purchase', event_id: `purchase:${paymentId}` });
    expect(events[0].custom_data).toMatchObject({ value: 1500, currency: 'NGN', content_ids: ['platform:website_builder:starter'], contents: [{ id: 'platform:website_builder:starter', quantity: 1 }] });
    expect((await db.query('SELECT * FROM marketing_delivery_outbox')).rows).toHaveLength(1);
  });
  it('does not create a purchase after consent withdrawal', async () => {
    await app.inject({ method: 'PUT', url: '/api/v1/marketing/consent', headers: { cookie, origin: 'http://localhost:3000', host: 'localhost:3000', 'x-consent-csrf': csrf }, payload: { action: 'withdraw', policyVersion: 1 } });
    await paySuccess();
    expect((await db.query('SELECT * FROM marketing_events')).rows).toHaveLength(0);
  });
  it('receipt endpoint is owner-only and refuses unpaid/foreign invoices', async () => {
    const { signAuthToken } = await import('../../src/lib/jwt');
    const token = signAuthToken(env, { sub: userId, role: 'customer', email: 'buyer@example.test', sv: 0 });
    const headers = { authorization: `Bearer ${token}`, cookie, host: 'localhost:3000' };
    expect((await app.inject({ method: 'GET', url: `/api/v1/marketing/purchase-receipt/${invoiceId}`, headers })).statusCode).toBe(404);
    await paySuccess();
    const ok = await app.inject({ method: 'GET', url: `/api/v1/marketing/purchase-receipt/${invoiceId}`, headers });
    expect(ok.statusCode).toBe(200); expect(ok.json()).toMatchObject({ verified: true, eventId: `purchase:${paymentId}`, customData: { value: 1500, currency: 'NGN' } });
    const other = randomUUID(); await db.query(`INSERT INTO users(id,email,password_hash,full_name,role) VALUES($1,'other@example.test','unused','Other','customer')`, [other]);
    const otherToken = signAuthToken(env, { sub: other, role: 'customer', email: 'other@example.test', sv: 0 });
    expect((await app.inject({ method: 'GET', url: `/api/v1/marketing/purchase-receipt/${invoiceId}`, headers: { ...headers, authorization: `Bearer ${otherToken}` } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/v1/marketing/purchase-receipt/${invoiceId}` })).statusCode).toBe(401);
  });
  it('delivers with bearer secret, stable ID, test code and no token in URL/logs', async () => {
    await db.query(`UPDATE marketing_integrations SET configuration=$1 WHERE provider_key='meta_pixel'`, [JSON.stringify({ ...defaultConfiguration, pixelId: '123456789012345', websiteDomain: 'localhost', enabled: true, testMode: true, testEventCode: 'TEST123', capi: { enabled: true, apiVersion: 'v26.0' } })]);
    await paySuccess();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ events_received: 1 }), { status: 200 }));
    const result = await drainCapiOutbox(db, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toMatchObject({ claimed: 1, delivered: 1 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v26.0/123456789012345/events'); expect(url).not.toContain(TOKEN);
    expect((init.headers as Record<string,string>).Authorization).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(String(init.body)); expect(body.test_event_code).toBe('TEST123'); expect(body.data[0].event_id).toBe(`purchase:${paymentId}`);
    expect(body.data[0].user_data.external_id).toMatch(/^[a-f0-9]{64}$/); expect(body.data[0].user_data).not.toHaveProperty('em');
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect((await db.query('SELECT status,attempts,http_status,events_received FROM marketing_delivery_outbox')).rows[0]).toMatchObject({ status: 'delivered', attempts: 1, http_status: 200, events_received: 1 });
  });
  it('retries transient failures with backoff and dead-letters after five attempts', async () => {
    await paySuccess();
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 503 }));
    for (let i = 0; i < 5; i++) {
      const result = await drainCapiOutbox(db, { fetchImpl: fetchImpl as unknown as typeof fetch });
      expect(result.claimed).toBe(1);
      if (i < 4) { expect(result.retried).toBe(1); await db.query(`UPDATE marketing_delivery_outbox SET next_attempt_at=now()-interval '1 second'`); }
      else expect(result.failed).toBe(1);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect((await db.query('SELECT status,attempts FROM marketing_delivery_outbox')).rows[0]).toMatchObject({ status: 'dead_letter', attempts: 5 });
  });
  it('permanent errors do not retry; disabled integration does not send', async () => {
    await paySuccess();
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 400 }));
    expect(await drainCapiOutbox(db, { fetchImpl: fetchImpl as unknown as typeof fetch })).toMatchObject({ failed: 1 });
    expect((await db.query('SELECT status FROM marketing_delivery_outbox')).rows[0].status).toBe('dead_letter');
    await db.query(`UPDATE marketing_delivery_outbox SET status='queued',attempts=0`);
    await db.query(`UPDATE marketing_integrations SET enabled=false WHERE provider_key='meta_pixel'`);
    expect(await drainCapiOutbox(db, { fetchImpl: fetchImpl as unknown as typeof fetch })).toMatchObject({ claimed: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('withdrawal during an in-flight request cancels completion', async () => {
    await paySuccess();
    const fetchImpl = vi.fn(async () => {
      await db.query(`UPDATE marketing_consent_sessions SET decided=true,preferences='{"essential":true,"analytics":false,"marketing":false}'::jsonb`);
      return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
    });
    expect(await drainCapiOutbox(db, { fetchImpl: fetchImpl as unknown as typeof fetch })).toMatchObject({ cancelled: 1 });
    expect((await db.query('SELECT status FROM marketing_delivery_outbox')).rows[0].status).toBe('cancelled');
  });
  it('recovers an expired processing lease and completes only the current claim', async () => {
    await paySuccess();
    await db.query(`UPDATE marketing_delivery_outbox SET status='processing',worker_id='stale-worker',lease_until=now()-interval '1 second',attempts=1`);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ events_received: 1 }), { status: 200 }));
    expect(await drainCapiOutbox(db, { fetchImpl: fetchImpl as unknown as typeof fetch })).toMatchObject({ claimed: 1, delivered: 1 });
    const row = (await db.query('SELECT status,worker_id,attempts FROM marketing_delivery_outbox')).rows[0];
    expect(row.status).toBe('delivered'); expect(row.worker_id).not.toBe('stale-worker'); expect(Number(row.attempts)).toBe(2);
  });
  it('prunes only aged marketing data and leaves current rows intact', async () => {
    await paySuccess();
    await db.query(`UPDATE marketing_delivery_outbox SET status='delivered',updated_at=now()-interval '31 days'`);
    await db.query(`UPDATE marketing_events SET occurred_at=now()-interval '91 days'`);
    await db.query(`UPDATE marketing_conversion_contexts SET created_at=now()-interval '91 days'`);
    await db.query(`UPDATE marketing_consent_history SET created_at=now()-interval '181 days'`);
    const pruned = await pruneMarketingRetention(db);
    expect(pruned.events).toBe(1); expect(pruned.deliveries).toBe(0); // event delete cascades its outbox row first
    expect(pruned.contexts).toBe(1); expect(pruned.consentHistory).toBeGreaterThan(0); expect(pruned.consentSessions).toBe(0);
    expect((await db.query('SELECT * FROM marketing_events')).rows).toHaveLength(0);
    expect((await db.query('SELECT * FROM payments')).rows).toHaveLength(1);
  });
  it('retains an aged conversion context while the order is still awaiting payment, then prunes it once paid', async () => {
    // Order is unpaid (beforeEach default). Age its context past the 90-day window.
    await db.query(`UPDATE marketing_conversion_contexts SET created_at=now()-interval '91 days' WHERE order_id=$1`, [orderId]);
    const whileUnpaid = await pruneMarketingRetention(db);
    expect(whileUnpaid.contexts).toBe(0);
    expect((await db.query('SELECT subject_key FROM marketing_conversion_contexts WHERE order_id=$1', [orderId])).rows).toHaveLength(1);
    // A late verified payment must still attribute Purchase using the retained context.
    await paySuccess();
    expect((await db.query('SELECT event_name,event_id FROM marketing_events')).rows).toEqual([
      expect.objectContaining({ event_name: 'Purchase', event_id: `purchase:${paymentId}` }),
    ]);
    // Once the order is paid the context is no longer needed and ages out on the next prune.
    await db.query(`UPDATE marketing_conversion_contexts SET created_at=now()-interval '91 days' WHERE order_id=$1`, [orderId]);
    const afterPaid = await pruneMarketingRetention(db);
    expect(afterPaid.contexts).toBe(1);
    expect((await db.query('SELECT subject_key FROM marketing_conversion_contexts WHERE order_id=$1', [orderId])).rows).toHaveLength(0);
  });
  it('cancels pending deliveries when a save disables or retargets the integration', async () => {
    await paySuccess();
    const { saveConfiguration } = await import('../../src/marketing/config-service');
    const config = { ...defaultConfiguration, pixelId: '123456789012345', websiteDomain: 'localhost', enabled: true, capi: { enabled: true, apiVersion: 'v26.0' } };
    await saveConfiguration(db, userId, { expectedRevision: 1, configuration: { ...config, enabled: false, capi: { enabled: false, apiVersion: 'v26.0' } } });
    expect((await db.query('SELECT status FROM marketing_delivery_outbox')).rows[0].status).toBe('cancelled');
  });
  it('binds the browser purchase receipt to the checkout consent session and paid order', async () => {
    await paySuccess();
    const { signAuthToken } = await import('../../src/lib/jwt');
    const token = signAuthToken(env, { sub: userId, role: 'customer', email: 'buyer@example.test', sv: 0 });
    const fresh = await app.inject({ method: 'GET', url: '/api/v1/marketing/bootstrap', headers: { host: 'localhost:3000' } });
    const freshCookie = String(fresh.headers['set-cookie']).split(';')[0]!;
    const freshCsrf = fresh.json().consent.csrfToken;
    await app.inject({ method: 'PUT', url: '/api/v1/marketing/consent', headers: { cookie: freshCookie, origin: 'http://localhost:3000', host: 'localhost:3000', 'x-consent-csrf': freshCsrf }, payload: { action: 'accept_all', policyVersion: 1 } });
    const foreign = await app.inject({ method: 'GET', url: `/api/v1/marketing/purchase-receipt/${invoiceId}`, headers: { authorization: `Bearer ${token}`, cookie: freshCookie, host: 'localhost:3000' } });
    expect(foreign.statusCode).toBe(404);
    await db.query(`UPDATE orders SET payment_status='unpaid' WHERE id=$1`, [orderId]);
    const unpaidOrder = await app.inject({ method: 'GET', url: `/api/v1/marketing/purchase-receipt/${invoiceId}`, headers: { authorization: `Bearer ${token}`, cookie, host: 'localhost:3000' } });
    expect(unpaidOrder.statusCode).toBe(404);
  });
  it('cancels an in-flight delivery if consent is withdrawn before completion', async () => {
    await paySuccess();
    const fetchImpl = vi.fn(async () => {
      await app.inject({ method: 'PUT', url: '/api/v1/marketing/consent', headers: { cookie, origin: 'http://localhost:3000', host: 'localhost:3000', 'x-consent-csrf': csrf }, payload: { action: 'withdraw', policyVersion: 1 } });
      return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
    });
    expect(await drainCapiOutbox(db, { fetchImpl: fetchImpl as unknown as typeof fetch })).toMatchObject({ claimed: 1, cancelled: 1 });
    expect((await db.query('SELECT status,delivered_at FROM marketing_delivery_outbox')).rows[0]).toMatchObject({ status: 'cancelled', delivered_at: null });
  });
  it('retries only structured transient 4xx failures, not permanent invalid requests', async () => {
    const credentials = { pixelId: '123456789012345', apiVersion: 'v26.0', token: TOKEN };
    const event = { eventName: 'Lead' as const, eventId: 'lead:12345678', occurredAt: new Date().toISOString(), sourceUrl: 'http://localhost:3000/contact', customData: {}, userData: { external_id: 'a'.repeat(64) } };
    const transient = vi.fn(async () => new Response(JSON.stringify({ error: { is_transient: true } }), { status: 400 }));
    expect(await sendCapiEvent(credentials, event, transient as unknown as typeof fetch)).toMatchObject({ accepted: false, retryable: true });
    const permanent = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Invalid parameter' } }), { status: 400 }));
    expect(await sendCapiEvent(credentials, event, permanent as unknown as typeof fetch)).toMatchObject({ accepted: false, retryable: false });
  });
  it('keeps configuration and ciphertext on one credential snapshot during rotation', async () => {
    const newToken = 'rotated-meta-token-1234567890';
    await db.query(`UPDATE marketing_integrations SET configuration=$1 WHERE provider_key='meta_pixel'`, [JSON.stringify({ ...defaultConfiguration, pixelId: '123456789012345', websiteDomain: 'localhost', enabled: true, testMode: true, testEventCode: 'OLD_CODE', capi: { enabled: true, apiVersion: 'v26.0' } })]);
    let rotated = false;
    // Simulate a committed rotation immediately after the loader's first SELECT returns.
    // A two-statement loader would then read the new ciphertext with the old revision/test code.
    const racingPool = {
      async query<T = Record<string, unknown>>(text: string, params?: unknown[]) {
        const result = await db.query<T>(text, params);
        if (!rotated && text.includes('FROM marketing_integrations') && params?.[0] === 'meta_pixel') {
          rotated = true;
          await saveConfiguration(db, userId, { expectedRevision: 1, capiAccessToken: newToken, configuration: { ...defaultConfiguration, pixelId: '123456789012345', websiteDomain: 'localhost', enabled: true, testMode: true, testEventCode: 'NEW_CODE', capi: { enabled: true, apiVersion: 'v26.0' } } });
        }
        return result;
      },
    };
    const snapshot = await loadCapiCredentials(racingPool);
    expect(rotated).toBe(true);
    // Either complete old snapshot or complete new snapshot is safe; a mixture is not.
    if (snapshot?.token === newToken) expect(snapshot).toMatchObject({ revision: 2, testEventCode: 'NEW_CODE' });
    else expect(snapshot).toMatchObject({ token: TOKEN, revision: 1, testEventCode: 'OLD_CODE' });
    expect(await loadCapiCredentials(db)).toMatchObject({ token: newToken, revision: 2, testEventCode: 'NEW_CODE' });
  });
  it('consumes the attempt budget at claim time and terminalizes repeated worker crashes', async () => {
    await paySuccess();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ events_received: 1 }), { status: 200 }));
    let crashBeforeCompletion = true;
    const crashingPool = {
      async query<T = Record<string, unknown>>(text: string, params?: unknown[]) {
        if (crashBeforeCompletion && text.includes('RETURNING status')) throw new Error('simulated worker crash before completion');
        return db.query<T>(text, params);
      },
    };
    for (let attempt = 1; attempt <= 5; attempt++) {
      await db.query(`UPDATE marketing_delivery_outbox SET lease_until=now()-interval '1 second'`);
      await expect(drainCapiOutbox(crashingPool, { fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow('simulated worker crash');
      expect((await db.query('SELECT status,attempts FROM marketing_delivery_outbox')).rows[0]).toMatchObject({ status: 'processing', attempts: attempt });
    }
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    crashBeforeCompletion = false;
    await db.query(`UPDATE marketing_delivery_outbox SET lease_until=now()-interval '1 second'`);
    expect(await drainCapiOutbox(crashingPool, { fetchImpl: fetchImpl as unknown as typeof fetch })).toMatchObject({ claimed: 0, failed: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(5); // no sixth network attempt
    expect((await db.query('SELECT status,attempts,worker_id,lease_until FROM marketing_delivery_outbox')).rows[0]).toMatchObject({ status: 'dead_letter', attempts: 5, worker_id: null, lease_until: null });
  });
  it('client treats timeout as retryable and never reports success without a count', async () => {
    const timeout = vi.fn(async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); });
    expect(await sendCapiEvent({ pixelId: '123456789012345', apiVersion: 'v26.0', token: TOKEN }, { eventName: 'Lead', eventId: 'lead:12345678', occurredAt: new Date().toISOString(), sourceUrl: 'http://localhost:3000/contact', customData: {}, userData: { external_id: 'a'.repeat(64) } }, timeout as unknown as typeof fetch)).toMatchObject({ accepted: false, retryable: true });
    const empty = vi.fn(async () => new Response('{}', { status: 200 }));
    expect(await sendCapiEvent({ pixelId: '123456789012345', apiVersion: 'v26.0', token: TOKEN }, { eventName: 'Lead', eventId: 'lead:12345678', occurredAt: new Date().toISOString(), sourceUrl: 'http://localhost:3000/contact', customData: {}, userData: { external_id: 'a'.repeat(64) } }, empty as unknown as typeof fetch)).toMatchObject({ accepted: false, retryable: true });
  });
});
