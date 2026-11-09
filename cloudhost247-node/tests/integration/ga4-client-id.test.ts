import { randomUUID } from 'node:crypto';
import { createProduct } from '../../src/db/catalog-products';
import { createPlan } from '../../src/db/catalog-plans';
import { createPricing } from '../../src/db/catalog-pricing';
import { signAuthToken } from '../../src/lib/jwt';
import { drainGa4Purchases } from '../../src/marketing/ga4-purchase-delivery';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { loadEnv, resetEnvCache } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { defaultGa4 } from '../../src/marketing/ga4-config';
import { decryptSecret } from '../../src/lib/crypto';
import { getKeyRing } from '../../src/lib/keyring';

// Exercise the preserved legacy mechanics only. This test-only mock bypasses the hard stop;
// ga4-purchase-disabled.test.ts verifies the real fail-closed production behavior.
vi.mock('../../src/marketing/ga4-purchase-safety', () => ({ isGa4PurchaseDeliverySafe: () => true }));

const secret = 'private-api-secret';
const env=loadEnv({NODE_ENV:'test',APP_URL:'http://localhost:3000',DATABASE_URL:'postgresql://test:test@localhost/test',JWT_SECRET:'j'.repeat(32),CREDENTIAL_ENCRYPTION_KEY:'a'.repeat(64),GA4_PURCHASE_DELIVERY_ENABLED:'true', GA4_PURCHASE_STAGING_AUTHORIZED:'true',GA4_PURCHASE_MEASUREMENT_ID:'G-1234567890',GA4_PURCHASE_API_SECRET:secret,LOG_LEVEL:'silent'} as NodeJS.ProcessEnv);
describe('consent-bound GA4 client ID', () => {
  let db:PGlite; let app:ReturnType<typeof buildApp>; let cookie:string; let csrf:string; let consentRevision:number;
  beforeEach(async () => {
    process.env.DATABASE_URL=env.DATABASE_URL; process.env.JWT_SECRET=env.JWT_SECRET; process.env.CREDENTIAL_ENCRYPTION_KEY=env.CREDENTIAL_ENCRYPTION_KEY!; resetEnvCache();
    db=new PGlite(); await migrateUp(new PgliteClient(db),{isProduction:false}); app=buildApp(env,{pool:db,serveFrontend:false});
    await db.query("UPDATE marketing_integrations SET enabled=true,website_domain='localhost',configuration=$1 WHERE provider_key='google_analytics'",[JSON.stringify({...defaultGa4,websiteDomain:'localhost',enabled:true,measurementId:'G-1234567890',streamReviewed:true,userDataReviewed:true})]);
    const response=await app.inject({method:'GET',url:'/api/v1/marketing/bootstrap',headers:{host:'localhost:3000'}});
    expect(response.json().analytics.purchaseCapture).toBe(true); expect(response.body).not.toContain(secret);
    cookie=String(response.headers['set-cookie']).split(';')[0]!; csrf=response.json().consent.csrfToken; consentRevision=response.json().consent.analyticsRevision;
  });
  afterEach(async () => {await app.close(); await db.close();});
  const headers = () => ({host:'localhost:3000',origin:'http://localhost:3000',cookie,'x-consent-csrf':csrf});
  async function consent(analytics:boolean) {const response=await app.inject({method:'PUT',url:'/api/v1/marketing/consent',headers:headers(),payload:{action:'save_preferences',policyVersion:1,preferences:{essential:true,analytics,marketing:false}}}); if(response.statusCode===200) consentRevision=response.json().consent.analyticsRevision; return response;}
  async function capture(payload:unknown, h:Record<string,string>=headers()) {return app.inject({method:'POST',url:'/api/v1/marketing/ga4-client-id',headers:h,payload:{...(payload as object),consentRevision}});}
  it('requires consent, same-origin CSRF and a valid-format client ID', async () => {
    expect((await capture({clientId:'123.456',revision:1})).statusCode).toBe(403);
    await consent(true);
    expect((await capture({clientId:'123.456',revision:1},{...headers(),origin:'https://evil.example'})).statusCode).toBe(403);
    expect((await capture({clientId:'123.456',revision:1},{...headers(),'x-consent-csrf':'wrong'})).statusCode).toBe(403);
    for (const id of ['private@example.test','', 'random', '123.456?secret']) expect((await capture({clientId:id,revision:1})).statusCode).toBe(400);
    expect((await capture({clientId:'123.456',revision:2})).statusCode).toBe(403);
    expect((await capture({clientId:'123.456',revision:1,email:'private@example.test'})).statusCode).toBe(400);
    const ok=await capture({clientId:'123.456',revision:1}); expect(ok.statusCode).toBe(204); expect(ok.body).toBe('');
    expect(ok.headers['cache-control']).toBe('private, no-store');
    const row=(await db.query<{client_id_ciphertext:string}>('SELECT client_id_ciphertext FROM ga4_browser_ids')).rows[0]!;
    expect(row.client_id_ciphertext).not.toContain('123.456'); expect(decryptSecret(getKeyRing(),row.client_id_ciphertext)).toBe('123.456');
  });
  it('carries a consented ID through authenticated checkout and queues only after staff confirms a manual payment', async () => {
    await consent(true); expect((await capture({clientId:'123.456',revision:1})).statusCode).toBe(204);
    const customer=randomUUID(), admin=randomUUID();
    await db.query("INSERT INTO users(id,email,password_hash,full_name,role) VALUES($1,'customer@example.test','unused','Customer','customer'),($2,'admin@example.test','unused','Admin','admin')",[customer,admin]);
    const buyer=signAuthToken(env,{sub:customer,role:'customer',email:'customer@example.test'});
    const staff=signAuthToken(env,{sub:admin,role:'admin',email:'admin@example.test'});
    const product=await createProduct(db,{id:randomUUID(),slug:'web-hosting',name:'Hosting',productType:'hosting'});
    await db.query("UPDATE products SET status='active',visibility='public' WHERE id=$1",[product.id]);
    const plan=await createPlan(db,{id:randomUUID(),productId:product.id,slug:'starter',name:'Starter'});
    await db.query("UPDATE product_plans SET status='active' WHERE id=$1",[plan.id]);
    await createPricing(db,{id:randomUUID(),planId:plan.id,billingPeriod:'monthly',currency:'USD',amount:19.99,effectiveStatus:'published'});
    const buyerHeaders={...headers(),authorization:`Bearer ${buyer}`};
    expect((await app.inject({method:'POST',url:'/api/v1/cart/items',headers:buyerHeaders,payload:{planId:plan.id,billingPeriod:'monthly',quantity:1}})).statusCode).toBe(201);
    const checkout=await app.inject({method:'POST',url:'/api/v1/orders',headers:buyerHeaders,payload:{}}); expect(checkout.statusCode).toBe(201);
    const order=checkout.json().order; const stored=(await db.query<{client_id_ciphertext:string}>('SELECT client_id_ciphertext FROM ga4_checkout_contexts WHERE order_id=$1',[order.id])).rows[0]!;
    expect(decryptSecret(getKeyRing(),stored.client_id_ciphertext)).toBe('123.456');
    const initiation=await app.inject({method:'POST',url:`/api/v1/invoices/${order.invoiceId}/payments`,headers:buyerHeaders,payload:{gateway:'manual'}}); expect(initiation.statusCode).toBe(201);
    const paymentId=initiation.json().payment.id;
    expect((await db.query('SELECT * FROM ga4_purchase_outbox')).rows).toHaveLength(0);
    const confirmed=await app.inject({method:'POST',url:`/api/v1/admin/payments/${paymentId}/confirm-manual`,headers:{authorization:`Bearer ${staff}`}});
    expect(confirmed.statusCode,confirmed.body).toBe(200); expect((await db.query('SELECT * FROM ga4_purchase_outbox')).rows).toHaveLength(1);
    expect((await app.inject({method:'POST',url:`/api/v1/admin/payments/${paymentId}/confirm-manual`,headers:{authorization:`Bearer ${staff}`}})).statusCode).toBe(409);
    const fetchImpl=vi.fn(async () => new Response(null,{status:204}));
    expect(await drainGa4Purchases(db,env,{fetchImpl:fetchImpl as unknown as typeof fetch})).toMatchObject({claimed:1,httpAccepted:1});
    const payload=JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string,RequestInit])[1].body));
    expect(payload.events[0].params).toMatchObject({transaction_id:order.id,currency:'USD',value:19.99,items:[{item_id:'web-hosting',price:19.99,quantity:1}]});
  });
  it('removes the encrypted identifier on withdrawal and does not restore it on re-consent', async () => {
    await consent(true); expect((await capture({clientId:'123.456',revision:1})).statusCode).toBe(204);
    await consent(false); expect((await db.query('SELECT * FROM ga4_browser_ids')).rows).toHaveLength(0);
    const oldRevision=consentRevision-1; await consent(true); expect((await db.query('SELECT * FROM ga4_browser_ids')).rows).toHaveLength(0);
    const stale=await app.inject({method:'POST',url:'/api/v1/marketing/ga4-client-id',headers:headers(),payload:{clientId:'123.456',revision:1,consentRevision:oldRevision}});
    expect(stale.statusCode).toBe(403); expect((await db.query('SELECT * FROM ga4_browser_ids')).rows).toHaveLength(0);
  });
  it('does not advertise or store client IDs without explicit staging authorization', async () => {
    await consent(true);
    const unauthorized=buildApp({...env,GA4_PURCHASE_STAGING_AUTHORIZED:false},{pool:db,serveFrontend:false});
    const bootstrap=await unauthorized.inject({method:'GET',url:'/api/v1/marketing/bootstrap',headers:{host:'localhost:3000',cookie}});
    expect(bootstrap.json().analytics.purchaseCapture).toBe(false); expect(bootstrap.body).not.toContain(secret);
    const response=await unauthorized.inject({method:'POST',url:'/api/v1/marketing/ga4-client-id',headers:headers(),payload:{clientId:'123.456',revision:1,consentRevision}});
    expect(response.statusCode).toBe(403); expect((await db.query('SELECT * FROM ga4_browser_ids')).rows).toHaveLength(0); await unauthorized.close();
  });
  it('does not accept an ID on the wrong host or with disabled server delivery', async () => {
    await consent(true);
    expect((await capture({clientId:'123.456',revision:1},{...headers(),host:'other.example',origin:'http://other.example'})).statusCode).toBe(403);
    const disabled=buildApp({...env,GA4_PURCHASE_DELIVERY_ENABLED:false},{pool:db,serveFrontend:false});
    const response=await disabled.inject({method:'POST',url:'/api/v1/marketing/ga4-client-id',headers:headers(),payload:{clientId:'123.456',revision:1,consentRevision}});
    expect(response.statusCode).toBe(403); expect((await db.query('SELECT * FROM ga4_browser_ids')).rows).toHaveLength(0); await disabled.close();
  });
});
