import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { createProduct } from '../../src/db/catalog-products';
import { createPlan } from '../../src/db/catalog-plans';
import { createPricing } from '../../src/db/catalog-pricing';
import { defaultGa4 } from '../../src/marketing/ga4-config';
import { attachGa4CheckoutContext } from '../../src/marketing/ga4-checkout-context';
import { withTransaction } from '../../src/db/transaction';

const env = loadEnv({ NODE_ENV: 'test', APP_URL: 'http://localhost:3000', DATABASE_URL: 'postgresql://test:test@localhost/test', JWT_SECRET: 'j'.repeat(32), LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);
describe('GA4 checkout consent context (no events emitted)', () => {
  let db: PGlite; let app: ReturnType<typeof buildApp>; let token: string; let cookie: string; let csrf: string; let planId: string;
  beforeEach(async () => {
    db = new PGlite(); await migrateUp(new PgliteClient(db), { isProduction: false });
    app = buildApp(env, { pool: db, serveFrontend: false });
    const userId = randomUUID();
    await db.query(`INSERT INTO users(id,email,password_hash,full_name,role) VALUES($1,'checkout@example.test','unused','Example','customer')`, [userId]);
    token = signAuthToken(env, { sub: userId, role: 'customer', email: 'checkout@example.test' });
    const product = await createProduct(db, { id: randomUUID(), slug: 'checkout-test', name: 'Hosting', productType: 'hosting' });
    await db.query(`UPDATE products SET status='active',visibility='public' WHERE id=$1`, [product.id]);
    const plan = await createPlan(db, { id: randomUUID(), productId: product.id, slug: 'starter', name: 'Starter' }); planId = plan.id;
    await db.query(`UPDATE product_plans SET status='active' WHERE id=$1`, [plan.id]);
    await createPricing(db, { id: randomUUID(), planId, billingPeriod: 'monthly', currency: 'USD', amount: 19.99, effectiveStatus: 'published' });
    const bootstrap = await app.inject({ method: 'GET', url: '/api/v1/marketing/bootstrap', headers: { host: 'localhost:3000' } });
    cookie = String(bootstrap.headers['set-cookie']).split(';')[0]!; csrf = bootstrap.json().consent.csrfToken;
    await db.query(`UPDATE marketing_integrations SET enabled=true,website_domain='localhost',configuration=$1 WHERE provider_key='google_analytics'`, [JSON.stringify({ ...defaultGa4, enabled: true, measurementId: 'G-1234567890', websiteDomain: 'localhost', streamReviewed: true, userDataReviewed: true })]);
  });
  afterEach(async () => { await app.close(); await db.close(); });
  async function preferences(analytics: boolean, marketing: boolean) {
    const res = await app.inject({ method: 'PUT', url: '/api/v1/marketing/consent', headers: { host: 'localhost:3000', origin: 'http://localhost:3000', cookie, 'x-consent-csrf': csrf }, payload: { action: 'save_preferences', preferences: { essential: true, analytics, marketing }, policyVersion: 1 } });
    expect(res.statusCode).toBe(200);
  }
  async function checkout(host = 'localhost:3000') {
    const headers = { authorization: `Bearer ${token}`, host, cookie, referer: 'http://localhost:3000/cart?email=private@example.test' };
    const add = await app.inject({ method: 'POST', url: '/api/v1/cart/items', headers, payload: { planId, billingPeriod: 'monthly', quantity: 1 } }); expect(add.statusCode).toBe(201);
    const response = await app.inject({ method: 'POST', url: '/api/v1/orders', headers, payload: {} }); expect(response.statusCode).toBe(201); return response.json().order;
  }
  async function contexts() { return (await db.query('SELECT * FROM ga4_checkout_contexts')).rows; }
  it('links an analytics-only choice to the order without marketing consent, PII, URLs or GA cookies', async () => {
    await preferences(true, false); const order = await checkout(); const rows = await contexts();
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ order_id: order.id, config_revision: 1 });
    expect(Object.keys(rows[0]).sort()).toEqual(['client_id_ciphertext','config_revision','consent_session_id','created_at','measurement_id','order_id']);
    expect(JSON.stringify(rows)).not.toContain('private@example.test'); expect(rows[0]).toMatchObject({ client_id_ciphertext: null, measurement_id: null });
    expect((await db.query('SELECT * FROM marketing_conversion_contexts')).rows).toHaveLength(0);
    expect((await db.query("SELECT * FROM marketing_events WHERE provider_key='google_analytics'")).rows).toHaveLength(0);
  });
  it.each(['undecided', 'marketing-only', 'disabled', 'wrong-host', 'expired', 'outdated'])('does not retain context when %s', async mode => {
    if (mode === 'marketing-only') await preferences(false, true);
    else if (mode !== 'undecided') await preferences(true, false);
    if (mode === 'disabled') await db.query("UPDATE marketing_integrations SET enabled=false WHERE provider_key='google_analytics'");
    if (mode === 'expired') await db.query("UPDATE marketing_consent_sessions SET expires_at=now()-interval '1 second'");
    if (mode === 'outdated') await db.query('UPDATE marketing_consent_sessions SET policy_version=0');
    await checkout(mode === 'wrong-host' ? 'other.example' : 'localhost:3000'); expect(await contexts()).toHaveLength(0);
  });
  it('deletes contexts on withdrawal, does not resurrect on re-consent, and retains orders', async () => {
    await preferences(true, false); await checkout(); expect(await contexts()).toHaveLength(1);
    await preferences(false, false); expect(await contexts()).toHaveLength(0);
    await preferences(true, false); expect(await contexts()).toHaveLength(0);
    expect((await db.query('SELECT * FROM orders')).rows).toHaveLength(1);
  });
  it('cascades context deletion when consent expires and is pruned', async () => {
    await preferences(true, false); await checkout(); await db.query("UPDATE marketing_consent_sessions SET expires_at=now()-interval '1 second'");
    await db.query('DELETE FROM marketing_consent_sessions WHERE expires_at < now()');
    expect(await contexts()).toHaveLength(0); expect((await db.query('SELECT * FROM orders')).rows).toHaveLength(1);
  });
  it('rechecks the current consent and config revision under the order transaction', async () => {
    await preferences(true, false); const order = await checkout(); const session = (await contexts())[0] as { consent_session_id: string };
    await db.query('DELETE FROM ga4_checkout_contexts');
    const context = { sessionId: session.consent_session_id, hostname: 'localhost', revision: 1 };
    await db.query("UPDATE marketing_integrations SET revision=revision+1 WHERE provider_key='google_analytics'");
    await withTransaction(db, tx => attachGa4CheckoutContext(tx, order.id, context)); expect(await contexts()).toHaveLength(0);
    await db.query("UPDATE marketing_integrations SET revision=1 WHERE provider_key='google_analytics'");
    await preferences(false, false);
    await withTransaction(db, tx => attachGa4CheckoutContext(tx, order.id, context)); expect(await contexts()).toHaveLength(0);
  });
  it('does not block checkout if the optional analytics context table is unavailable', async () => {
    await preferences(true, false); await db.query('DROP TABLE ga4_checkout_contexts');
    const order = await checkout(); expect(order.id).toBeTruthy(); expect((await db.query('SELECT * FROM orders')).rows).toHaveLength(1);
  });
});
