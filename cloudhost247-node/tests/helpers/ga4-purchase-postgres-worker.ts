// Synthetic multi-process test helper. It never contacts Google or accepts real credentials.
import { Pool } from 'pg';
import { loadEnv } from '../../src/config/env';
import { drainGa4Purchases } from '../../src/marketing/ga4-purchase-delivery';
import type { Queryable } from '../../src/db/types';

const schema = process.env.GA4_TEST_SCHEMA ?? '';
const socket = process.env.GA4_TEST_SOCKET ?? '';
if (!/^ga4_cert_[a-f0-9]{32}$/.test(schema) || !socket.startsWith('/tmp/')) throw new Error('Unsafe test database configuration');
const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@localhost/test', JWT_SECRET: 'j'.repeat(32),
  CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64), GA4_PURCHASE_DELIVERY_ENABLED: 'true', GA4_PURCHASE_STAGING_AUTHORIZED: 'true',
  GA4_PURCHASE_MEASUREMENT_ID: 'G-1234567890', GA4_PURCHASE_API_SECRET: 'dummy-test-api-secret' } as NodeJS.ProcessEnv);
const pool = new Pool({ host: socket, port: Number(process.env.GA4_TEST_PORT), database: 'postgres', user: process.env.GA4_TEST_DB_USER, options: `-c search_path=${schema}` });
pool.on('error', () => { /* simulated interrupted idle database connection */ });
// Disable the global network transport even if a future change accidentally omits our fake.
globalThis.fetch = async () => { throw new Error('External fetch is prohibited in this test'); };
function signal(type: string, data: Record<string, unknown> = {}) { process.send?.({ type, ...data }); }
function waitFor(message: string): Promise<void> {
  return new Promise(resolve => {
    const handler = (value: unknown) => { if (value === message) { process.off('message', handler); resolve(); } };
    process.on('message', handler);
  });
}
async function run() {
  if (process.env.GA4_TEST_INITIAL_CONNECT === '1') {
    const connection = await pool.query<{pid:number}>('SELECT pg_backend_pid() AS pid');
    signal('ready', {pid:connection.rows[0]?.pid});
  } else signal('ready');
  await waitFor('start');
  const queryable: Queryable = { async query<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
    if (process.env.GA4_TEST_PAUSE_CHECK === '1' && sql.includes('SELECT 1 FROM ga4_purchase_outbox o JOIN')) {
      signal('before-check'); await waitFor('continue');
    }
    const result = await pool.query(sql, params);
    if (process.env.GA4_TEST_PAUSE_AFTER_CHECK === '1' && sql.includes('SELECT 1 FROM ga4_purchase_outbox o JOIN')) {
      signal('after-check'); await waitFor('continue');
    }
    return { rows: result.rows as T[] };
  }};
  const fetchImpl: typeof fetch = async () => {
    signal('attempt');
    await waitFor('respond');
    return new Response(null, { status: 204 });
  };
  const result = await drainGa4Purchases(queryable, env, { fetchImpl });
  signal('done', { result });
  await pool.end();
  process.disconnect?.();
}
run().catch(async () => { signal('failure'); await pool.end(); process.exitCode = 1; process.disconnect?.(); });
