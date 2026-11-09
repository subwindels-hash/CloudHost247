import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { userInfo } from 'node:os';
import { resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PgClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { loadEnv, resetEnvCache } from '../../src/config/env';
import { encryptSecret } from '../../src/lib/crypto';
import { getKeyRing } from '../../src/lib/keyring';
import { hashConsentToken, saveConsent } from '../../src/marketing/consent-service';
import { defaultGa4 } from '../../src/marketing/ga4-config';
import { queueGa4Purchase } from '../../src/marketing/ga4-purchase-delivery';

// Explicit opt-in only. This uses synthetic data in a randomly named disposable schema on a
// private local Unix socket, never a remote database or a Google request. See the evidence doc.
const enabled = process.env.GA4_PG_TEST_CONFIRM === 'disposable' && Boolean(process.env.GA4_PG_TEST_SOCKET);
const port = 55439;
const token = 'c'.repeat(64);
const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@localhost/test', JWT_SECRET: 'j'.repeat(32),
  CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64), GA4_PURCHASE_DELIVERY_ENABLED: 'true', GA4_PURCHASE_STAGING_AUTHORIZED: 'true',
  GA4_PURCHASE_MEASUREMENT_ID: 'G-1234567890', GA4_PURCHASE_API_SECRET: 'dummy-test-api-secret' } as NodeJS.ProcessEnv);
interface Message { type: string; pid?: number; result?: { claimed: number; httpAccepted: number; unknown: number; cancelled: number } }
class Worker {
  child: ChildProcess;
  messages: Message[] = [];
  constructor(socket: string, schema: string, pauseCheck = false, pauseAfterCheck = false, initialConnect = false) {
    this.child = fork(resolve('tests/helpers/ga4-purchase-postgres-worker.ts'), [], {
      execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { PATH: process.env.PATH, NODE_ENV: 'test', DATABASE_URL: env.DATABASE_URL, JWT_SECRET: env.JWT_SECRET,
        CREDENTIAL_ENCRYPTION_KEY: env.CREDENTIAL_ENCRYPTION_KEY, GA4_TEST_SOCKET: socket, GA4_TEST_PORT: String(port),
        GA4_TEST_DB_USER: userInfo().username, GA4_TEST_SCHEMA: schema, GA4_TEST_PAUSE_CHECK: pauseCheck ? '1' : '0',
        GA4_TEST_PAUSE_AFTER_CHECK: pauseAfterCheck ? '1' : '0', GA4_TEST_INITIAL_CONNECT: initialConnect ? '1' : '0' },
    });
    this.child.on('message', (msg: Message) => this.messages.push(msg));
  }
  async wait(type: string): Promise<Message> {
    const existing = this.messages.find(m => m.type === type); if (existing) return existing;
    return new Promise((resolveMessage, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error(`Test worker timed out waiting for ${type}`)); }, 25000);
      const onMessage = (msg: Message) => { if (msg.type === type) { cleanup(); resolveMessage(msg); } else if (msg.type === 'failure') { cleanup(); reject(new Error('Test worker failed')); } };
      const onExit = () => { cleanup(); reject(new Error(`Test worker exited before ${type}`)); };
      const cleanup = () => { clearTimeout(timer); this.child.off('message', onMessage); this.child.off('exit', onExit); };
      this.child.on('message', onMessage); this.child.once('exit', onExit);
    });
  }
  send(msg: string) { this.child.send(msg); }
  stop() { if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL'); }
}

describe.skipIf(!enabled)('GA4 outbox with independent PostgreSQL worker processes', () => {
  let socket: string; let schema: string; let admin: Pool; let pool: Pool; let setupClient: PoolClient; let order: string; let payment: string;
  const workers: Worker[] = [];
  beforeEach(async () => {
    socket = realpathSync(process.env.GA4_PG_TEST_SOCKET!);
    if (!socket.startsWith('/tmp/') || process.env.GA4_PG_TEST_CONFIRM !== 'disposable') throw new Error('Only an explicitly disposable local test socket is allowed');
    schema = `ga4_cert_${randomUUID().replace(/-/g, '')}`;
    process.env.DATABASE_URL = env.DATABASE_URL; process.env.JWT_SECRET = env.JWT_SECRET; process.env.CREDENTIAL_ENCRYPTION_KEY = env.CREDENTIAL_ENCRYPTION_KEY; resetEnvCache();
    admin = new Pool({ host: socket, port, database: 'postgres', user: userInfo().username });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ host: socket, port, database: 'postgres', user: userInfo().username, options: `-c search_path=${schema}` });
    setupClient = await pool.connect(); try { await migrateUp(new PgClient(setupClient), { isProduction: false }); } finally { setupClient.release(); }
    const user = randomUUID(), staff = randomUUID(), invoice = randomUUID(), session = randomUUID(); order = randomUUID(); payment = randomUUID();
    await pool.query("INSERT INTO users(id,email,password_hash,full_name,role) VALUES($1,'test@example.test','unused','Synthetic','customer'),($2,'staff@example.test','unused','Staff','admin')", [user,staff]);
    await pool.query('INSERT INTO marketing_consent_sessions(id,token_hash,decided,preferences) VALUES($1,$2,true,$3)', [session,hashConsentToken(token),JSON.stringify({essential:true,analytics:true,marketing:false})]);
    await pool.query("UPDATE marketing_integrations SET enabled=true,website_domain='localhost',configuration=$1 WHERE provider_key='google_analytics'", [JSON.stringify({...defaultGa4,enabled:true,websiteDomain:'localhost',measurementId:'G-1234567890',streamReviewed:true,userDataReviewed:true})]);
    await pool.query("INSERT INTO orders(id,user_id,currency,subtotal_amount,total_amount,payment_status) VALUES($1,$2,'NGN',1500.50,1500.50,'paid')", [order,user]);
    await pool.query("INSERT INTO invoices(id,order_id,user_id,status,currency,subtotal_amount,total_amount) VALUES($1,$2,$3,'paid','NGN',1500.50,1500.50)", [invoice,order,user]);
    await pool.query("INSERT INTO payments(id,invoice_id,user_id,provider,amount,currency,status,completed_at,confirmed_by_user_id) VALUES($1,$2,$3,'manual',1500.50,'NGN','successful',now(),$4)", [payment,invoice,user,staff]);
    await pool.query("INSERT INTO order_items(id,order_id,product_name_snapshot,plan_name_snapshot,billing_period,quantity,unit_price_amount,currency,line_total_amount,metadata) VALUES($1,$2,'Synthetic','Synthetic','monthly',2,750.25,'NGN',1500.50,$3)", [randomUUID(),order,JSON.stringify({kind:'platform_plan',serviceKind:'website_builder'})]);
    await pool.query("INSERT INTO ga4_checkout_contexts(order_id,consent_session_id,config_revision,client_id_ciphertext,measurement_id) VALUES($1,$2,1,$3,'G-1234567890')", [order,session,encryptSecret(getKeyRing(),'123.456')]);
    expect(await queueGa4Purchase(pool,env,payment)).toBe(false);
    // Simulate a row queued by a previous deployment; do not create new rows in production.
    await pool.query("INSERT INTO ga4_purchase_outbox(order_id,payment_id,status) VALUES($1,$2,'queued')", [order,payment]);
  }, 90000);
  afterEach(async () => {
    workers.forEach(worker => worker.stop()); workers.length=0;
    if (pool) await pool.end();
    if (admin) { if (/^ga4_cert_[a-f0-9]{32}$/.test(schema)) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); }
  }, 30000);
  function worker(pauseCheck = false, pauseAfterCheck = false, initialConnect = false) { const w = new Worker(socket,schema,pauseCheck,pauseAfterCheck,initialConnect); workers.push(w); return w; }
  async function state() { return (await pool.query<{status:string;http_status:number|null}>('SELECT status,http_status FROM ga4_purchase_outbox WHERE order_id=$1',[order])).rows[0]; }

  it('does not claim or dispatch a pre-existing queued order across six processes even if flags are on', async () => {
    const group=Array.from({length:6},()=>worker()); await Promise.all(group.map(w=>w.wait('ready'))); group.forEach(w=>w.send('start'));
    await Promise.all(group.map(w=>w.wait('done')));
    expect(group.flatMap(w=>w.messages.filter(m=>m.type==='attempt'))).toHaveLength(0);
    expect(await state()).toEqual({status:'queued',http_status:null});
  }, 90000);
  it('allows withdrawal to commit while workers are unable to send and cancels the old queued row', async () => {
    const group=Array.from({length:3},()=>worker()); await Promise.all(group.map(w=>w.wait('ready')));
    group.forEach(w=>w.send('start')); await saveConsent(pool,token,'withdraw',undefined); await Promise.all(group.map(w=>w.wait('done')));
    expect(group.flatMap(w=>w.messages.filter(m=>m.type==='attempt'))).toHaveLength(0);
    expect(await state()).toEqual({status:'cancelled',http_status:null});
  }, 90000);
  it('does not resume a pre-existing queued order after a process restart', async () => {
    const first=worker(); await first.wait('ready'); const exited=new Promise<void>(done=>first.child.once('exit',()=>done())); first.stop(); await exited;
    const second=worker(); await second.wait('ready'); second.send('start'); await second.wait('done');
    expect(second.messages.filter(m=>m.type==='attempt')).toHaveLength(0); expect((await state())?.status).toBe('queued');
  }, 90000);
  it('still cannot send after an interrupted PostgreSQL connection', async () => {
    const w=worker(false,false,true); const ready=await w.wait('ready'); expect(ready.pid).toBeDefined();
    expect((await admin.query<{terminated:boolean}>('SELECT pg_terminate_backend($1) AS terminated',[ready.pid])).rows[0]?.terminated).toBe(true);
    await saveConsent(pool,token,'withdraw',undefined); w.send('start'); await w.wait('done');
    expect(w.messages.filter(m=>m.type==='attempt')).toHaveLength(0); expect((await state())?.status).toBe('cancelled');
  }, 90000);
  it('withdrawal marks a pre-existing sending claim unknown without blocking or retrying', async () => {
    await pool.query("UPDATE ga4_purchase_outbox SET status='sending',claim_token=$2,lease_until=now()+interval '5 minutes' WHERE order_id=$1",[order,randomUUID()]);
    await saveConsent(pool,token,'withdraw',undefined); expect((await state())?.status).toBe('unknown');
    const w=worker(); await w.wait('ready'); w.send('start'); await w.wait('done');
    expect(w.messages.filter(m=>m.type==='attempt')).toHaveLength(0); expect((await state())?.status).toBe('unknown');
  }, 90000);
  it.skip('historical enabled sender: claims a single order at most once across six separate processes', async () => {
    const group=Array.from({length:6},()=>worker()); await Promise.all(group.map(w=>w.wait('ready'))); group.forEach(w=>w.send('start'));
    const winner=await Promise.any(group.map(w=>w.wait('attempt').then(()=>w)));
    await Promise.all(group.filter(w=>w!==winner).map(w=>w.wait('done')));
    winner.send('respond'); await winner.wait('done');
    expect(group.reduce((sum,w)=>sum+w.messages.filter(m=>m.type==='attempt').length,0)).toBe(1);
    expect(await state()).toEqual({status:'http_accepted',http_status:204});
  }, 90000);
  it.skip('historical enabled sender: prevents dispatch when withdrawal commits before a separate worker final check', async () => {
    const w=worker(true); await w.wait('ready'); w.send('start'); await w.wait('before-check');
    await saveConsent(pool,token,'withdraw',undefined); expect((await state())?.status).toBe('unknown');
    w.send('continue'); await w.wait('done');
    expect(w.messages.filter(m=>m.type==='attempt')).toHaveLength(0); expect((await state())?.status).toBe('cancelled');
  }, 90000);
  it.skip('historical enabled sender: records an in-flight response after withdrawal without sending twice', async () => {
    const first=worker(); await first.wait('ready'); first.send('start'); await first.wait('attempt');
    await saveConsent(pool,token,'withdraw',undefined); expect((await state())?.status).toBe('unknown');
    first.send('respond'); await first.wait('done'); expect(await state()).toEqual({status:'http_accepted',http_status:204});
    const second=worker(); await second.wait('ready'); second.send('start'); await second.wait('done');
    expect(second.messages.filter(m=>m.type==='attempt')).toHaveLength(0);
  }, 90000);
  it.skip('historical enabled sender: exposes the known final-check-to-dispatch race instead of claiming strict suppression', async () => {
    // This is a documented limitation, not consent-race certification: a suspended worker can
    // resume after a completed withdrawal if it already read a successful eligibility result.
    const w=worker(false,true); await w.wait('ready'); w.send('start'); await w.wait('after-check');
    await saveConsent(pool,token,'withdraw',undefined); expect((await state())?.status).toBe('unknown');
    w.send('continue'); await w.wait('attempt'); w.send('respond'); await w.wait('done');
    expect(await state()).toEqual({status:'http_accepted',http_status:204});
  }, 90000);
  it.skip('historical enabled sender: sends a queued record after replacing the worker process', async () => {
    const first=worker(); await first.wait('ready');
    const exited=new Promise<void>(resolveExit=>first.child.once('exit',()=>resolveExit())); first.stop(); await exited;
    expect((await state())?.status).toBe('queued');
    const second=worker(); await second.wait('ready'); second.send('start'); await second.wait('attempt'); second.send('respond'); await second.wait('done');
    expect(await state()).toEqual({status:'http_accepted',http_status:204});
  }, 90000);
  it.skip('historical enabled sender: keeps a killed in-flight worker ambiguous after a new process starts', async () => {
    const first=worker(); await first.wait('ready'); first.send('start'); await first.wait('attempt');
    const exited=new Promise<void>(resolveExit=>first.child.once('exit',()=>resolveExit())); first.stop(); await exited;
    expect((await state())?.status).toBe('sending');
    // Simulate passage of the existing five-minute lease without sleeping or changing production data.
    await pool.query("UPDATE ga4_purchase_outbox SET lease_until=now()-interval '1 second' WHERE order_id=$1",[order]);
    const second=worker(); await second.wait('ready'); second.send('start'); await second.wait('done');
    expect(second.messages.filter(m=>m.type==='attempt')).toHaveLength(0); expect((await state())?.status).toBe('unknown');
  }, 90000);
});
