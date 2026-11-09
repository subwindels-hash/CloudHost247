import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { loadEnv, resetEnvCache } from '../../src/config/env';
import { encryptSecret } from '../../src/lib/crypto';
import { getKeyRing } from '../../src/lib/keyring';
import { hashConsentToken, saveConsent } from '../../src/marketing/consent-service';
import { defaultGa4 } from '../../src/marketing/ga4-config';
import { queueGa4Purchase, drainGa4Purchases } from '../../src/marketing/ga4-purchase-delivery';
import type { Queryable } from '../../src/db/types';

// Exercise the preserved legacy mechanics only. This test-only mock bypasses the hard stop;
// ga4-purchase-disabled.test.ts verifies the real fail-closed production behavior.
vi.mock('../../src/marketing/ga4-purchase-safety', () => ({ isGa4PurchaseDeliverySafe: () => true }));

const secret = 'dummy-test-api-secret';
const clientId = '123456789.1234567890';
const env = loadEnv({ NODE_ENV:'test', DATABASE_URL:'postgresql://test:test@localhost/test', JWT_SECRET:'j'.repeat(32), CREDENTIAL_ENCRYPTION_KEY:'a'.repeat(64), GA4_PURCHASE_DELIVERY_ENABLED:'true', GA4_PURCHASE_STAGING_AUTHORIZED:'true', GA4_PURCHASE_MEASUREMENT_ID:'G-1234567890', GA4_PURCHASE_API_SECRET:secret } as NodeJS.ProcessEnv);
describe('GA4 Server-Side Purchase Event Delivery', () => {
  let db: PGlite; let order: string; let invoice: string; let payment: string; let session: string; const token = 'c'.repeat(64);
  beforeEach(async () => {
    process.env.DATABASE_URL=env.DATABASE_URL; process.env.JWT_SECRET=env.JWT_SECRET; process.env.CREDENTIAL_ENCRYPTION_KEY=env.CREDENTIAL_ENCRYPTION_KEY!; resetEnvCache();
    db = new PGlite(); await migrateUp(new PgliteClient(db), { isProduction: false });
    const user=randomUUID(), admin=randomUUID(); order=randomUUID(); invoice=randomUUID(); payment=randomUUID(); session=randomUUID();
    await db.query("INSERT INTO users(id,email,password_hash,full_name,role) VALUES($1,'private@example.test','unused','Private','customer'),($2,'admin@example.test','unused','Admin','admin')",[user,admin]);
    await db.query("INSERT INTO marketing_consent_sessions(id,token_hash,decided,preferences) VALUES($1,$2,true,$3)",[session,hashConsentToken(token),JSON.stringify({essential:true,analytics:true,marketing:false})]);
    await db.query("UPDATE marketing_integrations SET enabled=true,website_domain='localhost',configuration=$1 WHERE provider_key='google_analytics'",[JSON.stringify({...defaultGa4,enabled:true,websiteDomain:'localhost',measurementId:'G-1234567890',streamReviewed:true,userDataReviewed:true})]);
    await db.query("INSERT INTO orders(id,user_id,currency,subtotal_amount,total_amount,payment_status) VALUES($1,$2,'NGN',1500.50,1500.50,'paid')",[order,user]);
    await db.query("INSERT INTO invoices(id,order_id,user_id,status,currency,subtotal_amount,total_amount) VALUES($1,$2,$3,'paid','NGN',1500.50,1500.50)",[invoice,order,user]);
    await db.query("INSERT INTO payments(id,invoice_id,user_id,provider,amount,currency,status,completed_at,confirmed_by_user_id) VALUES($1,$2,$3,'manual',1500.50,'NGN','successful',now(),$4)",[payment,invoice,user,admin]);
    await db.query("INSERT INTO order_items(id,order_id,product_name_snapshot,plan_name_snapshot,billing_period,quantity,unit_price_amount,currency,line_total_amount,metadata) VALUES($1,$2,'Private','Private','monthly',2,750.25,'NGN',1500.50,$3)",[randomUUID(),order,JSON.stringify({kind:'platform_plan',serviceKind:'website_builder',planCode:'private'})]);
    await db.query("INSERT INTO ga4_checkout_contexts(order_id,consent_session_id,config_revision,client_id_ciphertext,measurement_id) VALUES($1,$2,1,$3,'G-1234567890')",[order,session,encryptSecret(getKeyRing(),clientId)]);
  });
  afterEach(async () => { await db.close(); vi.restoreAllMocks(); });
  const queue = () => queueGa4Purchase(db,env,payment);
  const status = async () => (await db.query<{status:string}>('SELECT status FROM ga4_purchase_outbox WHERE order_id=$1',[order])).rows[0]?.status;
  it('defaults staging authorization and delivery to disabled', async () => {
    const defaults=loadEnv({NODE_ENV:'test',DATABASE_URL:env.DATABASE_URL,JWT_SECRET:env.JWT_SECRET} as NodeJS.ProcessEnv);
    expect(defaults.GA4_PURCHASE_DELIVERY_ENABLED).toBe(false); expect(defaults.GA4_PURCHASE_STAGING_AUTHORIZED).toBe(false);
    expect(await queueGa4Purchase(db,defaults,payment)).toBe(false);
  });
  it('sends an eligible paid order once with real order ID and authoritative currency/value', async () => {
    expect(await queue()).toBe(true); expect(await queue()).toBe(false);
    const fetchImpl=vi.fn(async () => new Response(null,{status:204}));
    expect(await drainGa4Purchases(db,env,{fetchImpl:fetchImpl as unknown as typeof fetch})).toMatchObject({claimed:1,httpAccepted:1});
    expect(await drainGa4Purchases(db,env,{fetchImpl:fetchImpl as unknown as typeof fetch})).toMatchObject({claimed:0});
    expect(fetchImpl).toHaveBeenCalledOnce(); const [url,init]=fetchImpl.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toContain('measurement_id=G-1234567890'); expect(url).toContain(encodeURIComponent(secret));
    const body=JSON.parse(String(init.body)); expect(body.client_id).toBe(clientId);
    expect(body.consent).toEqual({ad_user_data:'DENIED',ad_personalization:'DENIED'});
    expect(body.events[0]).toEqual({name:'purchase',params:{transaction_id:order,currency:'NGN',value:1500.5,items:[{item_id:'platform:website_builder',price:750.25,quantity:2}]}});
    expect(JSON.stringify(body)).not.toMatch(/private|example|@/); expect(await status()).toBe('http_accepted');
    expect((await db.query('SELECT order_id,payment_id,status,http_status FROM ga4_purchase_outbox WHERE order_id=$1',[order])).rows[0]).toEqual({order_id:order,payment_id:payment,status:'http_accepted',http_status:204});
    expect(JSON.stringify((await db.query('SELECT * FROM ga4_purchase_outbox')).rows)).not.toContain(secret);
  });
  it('never queues without consent, a real browser ID, enabled delivery and matching server credentials', async () => {
    await db.query('UPDATE ga4_checkout_contexts SET client_id_ciphertext=NULL WHERE order_id=$1',[order]); expect(await queue()).toBe(false);
    await db.query('UPDATE ga4_checkout_contexts SET client_id_ciphertext=$2 WHERE order_id=$1',[order,encryptSecret(getKeyRing(),clientId)]);
    expect(await queueGa4Purchase(db,{...env,GA4_PURCHASE_DELIVERY_ENABLED:false},payment)).toBe(false);
    expect(await queueGa4Purchase(db,{...env,GA4_PURCHASE_STAGING_AUTHORIZED:false},payment)).toBe(false);
    expect(await queueGa4Purchase(db,{...env,GA4_PURCHASE_MEASUREMENT_ID:'G-AAAAAAAAAA'},payment)).toBe(false);
    await db.query("UPDATE marketing_consent_sessions SET preferences='{\"essential\":true,\"analytics\":false,\"marketing\":true}'::jsonb WHERE id=$1",[session]);
    expect(await queue()).toBe(false);
  });
  it('does not queue pending, failed, refunded or sandbox payments', async () => {
    for (const state of ['pending','failed','refunded','partially_refunded']) { await db.query('UPDATE payments SET status=$2 WHERE id=$1',[payment,state]); expect(await queue(),state).toBe(false); }
    await db.query("UPDATE payments SET status='successful',provider='sandbox' WHERE id=$1",[payment]); expect(await queue()).toBe(false);
  });
  it('cancels on withdrawal before delivery and preserves the deduplication tombstone', async () => {
    expect(await queue()).toBe(true); await saveConsent(db,token,'withdraw',undefined);
    const fetchImpl=vi.fn(); expect(await status()).toBe('cancelled');
    await drainGa4Purchases(db,env,{fetchImpl:fetchImpl as unknown as typeof fetch}); expect(fetchImpl).not.toHaveBeenCalled();
    expect((await db.query('SELECT * FROM ga4_checkout_contexts')).rows).toHaveLength(0); expect(await status()).toBe('cancelled');
  });
  it('withdrawal while a claim is pending prevents dispatch before the final eligibility check', async () => {
    await queue();
    let reached!: () => void, release!: () => void;
    const atCheck = new Promise<void>(resolve => { reached=resolve; });
    const gate = new Promise<void>(resolve => { release=resolve; });
    const wrapped: Queryable = { async query<T = Record<string, unknown>>(sql: string, args?: unknown[]) {
      if (sql.includes('SELECT 1 FROM ga4_purchase_outbox o JOIN')) { reached(); await gate; }
      return db.query<T>(sql,args);
    }};
    const fetchImpl=vi.fn(); const run=drainGa4Purchases(wrapped,env,{fetchImpl:fetchImpl as unknown as typeof fetch});
    await atCheck; await saveConsent(db,token,'withdraw',undefined); expect(await status()).toBe('unknown');
    release(); await run; expect(fetchImpl).not.toHaveBeenCalled(); expect(await status()).toBe('cancelled');
  });
  it('withdrawal during an in-flight request is unknown until its response, never falsely cancelled or retried', async () => {
    await queue();
    let entered!: () => void, resolveResponse!: (response: Response) => void;
    const started=new Promise<void>(resolve => {entered=resolve;});
    const response=new Promise<Response>(resolve => {resolveResponse=resolve;});
    const fetchImpl=vi.fn(async () => { entered(); return response; });
    const run=drainGa4Purchases(db,env,{fetchImpl:fetchImpl as unknown as typeof fetch});
    await started; await saveConsent(db,token,'withdraw',undefined);
    expect(await status()).toBe('unknown'); expect((await db.query('SELECT * FROM ga4_checkout_contexts')).rows).toHaveLength(0);
    resolveResponse(new Response(null,{status:204}));
    expect(await run).toMatchObject({claimed:1,httpAccepted:1});
    const row=(await db.query<{status:string;http_status:number}>('SELECT status,http_status FROM ga4_purchase_outbox WHERE order_id=$1',[order])).rows[0];
    expect(row).toEqual({status:'http_accepted',http_status:204});
    await drainGa4Purchases(db,env,{fetchImpl:fetchImpl as unknown as typeof fetch}); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('preserves unknown after withdrawal and an interrupted in-flight request', async () => {
    await queue();
    let entered!: () => void, rejectResponse!: (reason: Error) => void;
    const started=new Promise<void>(resolve => {entered=resolve;});
    const response=new Promise<Response>((_, reject) => {rejectResponse=reject;});
    const fetchImpl=vi.fn(async () => {entered(); return response;});
    const run=drainGa4Purchases(db,env,{fetchImpl:fetchImpl as unknown as typeof fetch});
    await started; await saveConsent(db,token,'withdraw',undefined); rejectResponse(new Error('disconnected'));
    expect(await run).toMatchObject({unknown:1}); expect(await status()).toBe('unknown');
    await drainGa4Purchases(db,env,{fetchImpl:fetchImpl as unknown as typeof fetch}); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('expires abandoned withdrawn claims without ever retrying them', async () => {
    await queue(); await db.query("UPDATE ga4_purchase_outbox SET status='sending',claim_token=$2,lease_until=now()-interval '1 second' WHERE order_id=$1",[order,randomUUID()]);
    await saveConsent(db,token,'withdraw',undefined); expect(await status()).toBe('unknown');
    const fetchImpl=vi.fn(); await drainGa4Purchases(db,env,{fetchImpl:fetchImpl as unknown as typeof fetch});
    const row=(await db.query<{status:string;claim_token:string|null;lease_until:string|null}>('SELECT status,claim_token,lease_until FROM ga4_purchase_outbox WHERE order_id=$1',[order])).rows[0];
    expect(row).toEqual({status:'unknown',claim_token:null,lease_until:null}); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('suppresses a refund after queueing but before delivery', async () => {
    await queue(); await db.query("UPDATE payments SET status='refunded' WHERE id=$1",[payment]);
    const fetchImpl=vi.fn(); expect(await drainGa4Purchases(db,env,{fetchImpl:fetchImpl as unknown as typeof fetch})).toMatchObject({claimed:1,cancelled:1});
    expect(fetchImpl).not.toHaveBeenCalled(); expect(await status()).toBe('cancelled');
  });
  it('marks timeouts and expired claims unknown without automatic duplicate retries', async () => {
    await queue(); const fetchImpl=vi.fn(async () => {throw new Error('network error including potentially secret URL');});
    const result=await drainGa4Purchases(db,env,{fetchImpl:fetchImpl as unknown as typeof fetch}); expect(result).toMatchObject({claimed:1,unknown:1});
    expect(JSON.stringify(result)).not.toContain(secret); expect(await status()).toBe('unknown');
    await drainGa4Purchases(db,env,{fetchImpl:fetchImpl as unknown as typeof fetch}); expect(fetchImpl).toHaveBeenCalledOnce();
    await db.query("UPDATE ga4_purchase_outbox SET status='sending',claim_token=$2,lease_until=now()-interval '1 second' WHERE order_id=$1",[order,randomUUID()]);
    expect(await drainGa4Purchases(db,env,{fetchImpl:fetchImpl as unknown as typeof fetch})).toMatchObject({unknown:1,claimed:0}); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('treats non-2xx responses as unknown and deletes the checkout identifier', async () => {
    await queue(); const fetchImpl=vi.fn(async () => new Response(null,{status:500}));
    expect(await drainGa4Purchases(db,env,{fetchImpl:fetchImpl as unknown as typeof fetch})).toMatchObject({claimed:1,unknown:1,httpAccepted:0});
    expect(await status()).toBe('unknown');
    expect((await db.query<{client_id_ciphertext:string|null}>('SELECT client_id_ciphertext FROM ga4_checkout_contexts WHERE order_id=$1',[order])).rows[0]?.client_id_ciphertext).toBeNull();
    await drainGa4Purchases(db,env,{fetchImpl:fetchImpl as unknown as typeof fetch}); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('does not dispatch with stale payment time', async () => {
    await queue(); await db.query("UPDATE payments SET completed_at=now()-interval '73 hours' WHERE id=$1",[payment]);
    const fetchImpl=vi.fn(); expect(await drainGa4Purchases(db,env,{fetchImpl:fetchImpl as unknown as typeof fetch})).toMatchObject({cancelled:1});
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('competing drainers cannot make two local attempts for one order', async () => {
    await queue(); const fetchImpl=vi.fn(async () => new Response(null,{status:204}));
    await Promise.all([drainGa4Purchases(db,env,{fetchImpl:fetchImpl as unknown as typeof fetch}),drainGa4Purchases(db,env,{fetchImpl:fetchImpl as unknown as typeof fetch})]);
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(await status()).toBe('http_accepted');
  });
  it('rejects invalid currencies and amounts at queue and revalidates after queueing', async () => {
    await db.query("UPDATE orders SET currency='USD' WHERE id=$1",[order]); expect(await queue()).toBe(false);
    await db.query("UPDATE orders SET currency='NGN' WHERE id=$1",[order]);
    await db.query('UPDATE payments SET amount=1500 WHERE id=$1',[payment]); expect(await queue()).toBe(false);
    await db.query('UPDATE payments SET amount=1500.50 WHERE id=$1',[payment]); expect(await queue()).toBe(true);
    await db.query('UPDATE order_items SET line_total_amount=1500 WHERE order_id=$1',[order]);
    const fetchImpl=vi.fn(); expect(await drainGa4Purchases(db,env,{fetchImpl:fetchImpl as unknown as typeof fetch})).toMatchObject({cancelled:1}); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('rejects missing or locally malformed credentials; provider rejection remains unknown', async () => {
    expect(await queueGa4Purchase(db,{...env,GA4_PURCHASE_API_SECRET:''},payment)).toBe(false);
    expect(await queueGa4Purchase(db,{...env,GA4_PURCHASE_API_SECRET:'bad secret?'},payment)).toBe(false);
    expect(await queue()).toBe(true);
    const fetchImpl=vi.fn(async () => new Response(null,{status:401}));
    expect(await drainGa4Purchases(db,env,{fetchImpl:fetchImpl as unknown as typeof fetch})).toMatchObject({unknown:1,httpAccepted:0});
    expect(await status()).toBe('unknown'); await drainGa4Purchases(db,env,{fetchImpl:fetchImpl as unknown as typeof fetch}); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it.each(['expired','obsolete-policy'])('does not dispatch after %s consent', async mode => {
    await queue();
    if (mode==='expired') await db.query("UPDATE marketing_consent_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",[session]);
    else await db.query('UPDATE marketing_consent_sessions SET policy_version=0 WHERE id=$1',[session]);
    const fetchImpl=vi.fn(); expect(await drainGa4Purchases(db,env,{fetchImpl:fetchImpl as unknown as typeof fetch})).toMatchObject({cancelled:1}); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('aborts a timed out request and does not retry the unknown outcome', async () => {
    await queue(); const fetchImpl=vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_,reject) => {
      init.signal!.addEventListener('abort', () => reject(new Error('timeout')),{once:true});
    }));
    expect(await drainGa4Purchases(db,env,{fetchImpl:fetchImpl as unknown as typeof fetch,timeoutMs:1000})).toMatchObject({unknown:1});
    expect(await status()).toBe('unknown'); await drainGa4Purchases(db,env,{fetchImpl:fetchImpl as unknown as typeof fetch}); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('restores a persisted queued row after a fresh embedded database instance and sends it only once', async () => {
    await queue(); const data=await db.dumpDataDir(); await db.close(); db=new PGlite({loadDataDir:data}); await db.waitReady;
    expect(await status()).toBe('queued'); const fetchImpl=vi.fn(async () => new Response(null,{status:204}));
    expect(await drainGa4Purchases(db,env,{fetchImpl:fetchImpl as unknown as typeof fetch})).toMatchObject({claimed:1,httpAccepted:1});
    await drainGa4Purchases(db,env,{fetchImpl:fetchImpl as unknown as typeof fetch}); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('never sends when the ID cannot be decrypted or when delivery is disabled', async () => {
    await queue(); const fetchImpl=vi.fn();
    expect(await drainGa4Purchases(db,{...env,GA4_PURCHASE_DELIVERY_ENABLED:false},{fetchImpl:fetchImpl as unknown as typeof fetch})).toMatchObject({claimed:0});
    expect(await drainGa4Purchases(db,{...env,GA4_PURCHASE_STAGING_AUTHORIZED:false},{fetchImpl:fetchImpl as unknown as typeof fetch})).toMatchObject({claimed:0});
    await db.query("UPDATE ga4_checkout_contexts SET client_id_ciphertext='corrupt' WHERE order_id=$1",[order]);
    expect(await drainGa4Purchases(db,env,{fetchImpl:fetchImpl as unknown as typeof fetch})).toMatchObject({cancelled:1}); expect(fetchImpl).not.toHaveBeenCalled();
  });
});
