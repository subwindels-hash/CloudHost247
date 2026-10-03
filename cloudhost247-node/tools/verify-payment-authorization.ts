/**
 * Adversarial authorization matrix for every Phase 5B/5C financial HTTP route, followed by a
 * whole-database sweep.
 *
 * WHY THIS EXISTS
 *
 * The directive's hardest security requirement is that *no customer or browser request can mark an
 * order paid without verified authorization*. Route tests normally assert the status code of each
 * rejection. That is the weaker claim. Twice now in this audit a call that reported failure had
 * nevertheless changed the database (see ADDENDUM 4), so this probe asserts BOTH: the right status
 * code, AND that after every unauthorized attempt the financial state is byte-for-byte what it was
 * before.
 *
 * It drives the real Fastify application built by src/app.ts through the real auth middleware.
 * Nothing is mocked or stubbed. It creates and drops its own throwaway database and never contacts
 * production.
 *
 * HOW IT RUNS NOW (changed 2026-10-03)
 *
 * Like its sibling `verify-financial-invariants.ts`, this shipped as a bare script hardcoded to a
 * PostgreSQL server at 127.0.0.1:55432 and documented to run from `recovery/`, outside this package
 * — where a bare `pg` specifier cannot resolve, because `node_modules` lives here. The documented
 * command failed on its first import, and nothing in the repository ran it.
 *
 * The checks are now a function, `runPaymentAuthorizationChecks(db, options)`, which runs against any
 * `Queryable` — a real `pg.Pool` (the CLI below) or the embedded WASM PostgreSQL the test suite uses
 * (`tests/integration/payment-authorization-matrix.test.ts`), where it runs on every `npm test`.
 *
 * Usage:
 *   cd cloudhost247-node && npm run verify:authorization
 *
 * Connection: see the CH247_PROBE_PG_* variables in `verify-financial-invariants.ts` (identical).
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PgClient } from '../database/db-client';
import { migrateUp } from '../database/migrate';
import type { Queryable } from '../src/db/types';
import { loadEnv, type Env } from '../src/config/env';
import { buildApp } from '../src/app';
import { signAuthToken } from '../src/lib/jwt';
import { createProduct } from '../src/db/catalog-products';
import { createPlan } from '../src/db/catalog-plans';
import { createPricing } from '../src/db/catalog-pricing';

export interface AuthorizationMatrixResult {
  pass: number;
  failures: string[];
  checks: number;
}

export interface AuthorizationMatrixOptions {
  /** The env the app is built with. Defaults to a test env with a throwaway JWT secret. */
  env?: Env;
  log?: (line: string) => void;
}

export async function runPaymentAuthorizationChecks(
  db: Queryable,
  options: AuthorizationMatrixOptions = {}
): Promise<AuthorizationMatrixResult> {
  const log = options.log ?? (() => {});
  const env =
    options.env ??
    loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
      JWT_SECRET: 'p'.repeat(32),
    } as NodeJS.ProcessEnv);
  const app = buildApp(env, { serveFrontend: false, pool: db });

  let pass = 0;
  const failures: string[] = [];
  function check(name: string, ok: boolean, detail = '') {
    if (ok) {
      pass++;
      log(`  PASS  ${name}`);
    } else {
      failures.push(name);
      log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
    }
  }

  async function makeUser(role: 'customer' | 'admin' | 'super_admin') {
    const id = randomUUID();
    const email = `${role}-${id}@example.com`;
    await db.query(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1,$2,'x','T',$3)`, [
      id,
      email,
      role,
    ]);
    return { id, email, token: signAuthToken(env, { sub: id, role, email }) };
  }

  async function checkout(token: string, amount = 24.5) {
    const product = await createProduct(db, {
      id: randomUUID(),
      slug: `p-${randomUUID()}`,
      name: 'Hosting',
      productType: 'hosting',
    });
    await db.query(`UPDATE products SET status='active', visibility='public' WHERE id=$1`, [product.id]);
    const plan = await createPlan(db, { id: randomUUID(), productId: product.id, slug: `pl-${randomUUID()}`, name: 'Starter' });
    await db.query(`UPDATE product_plans SET status='active' WHERE id=$1`, [plan.id]);
    await createPricing(db, {
      id: randomUUID(),
      planId: plan.id,
      billingPeriod: 'monthly',
      currency: 'USD',
      amount,
      effectiveStatus: 'published',
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { authorization: `Bearer ${token}` },
      payload: { planId: plan.id, billingPeriod: 'monthly', quantity: 1 },
    });
    const co = await app.inject({ method: 'POST', url: '/api/v1/orders', headers: { authorization: `Bearer ${token}` } });
    const order = co.json().order;
    if (!order?.invoiceId) throw new Error(`checkout failed: ${co.statusCode} ${co.body.slice(0, 300)}`);
    return { invoiceId: order.invoiceId as string, orderId: order.id as string };
  }

  /** A snapshot of everything financial that must not move when a request is rejected. */
  async function financialState() {
    const r = await db.query(`
      SELECT
        (SELECT count(*) FROM invoices)                                        AS invoices,
        (SELECT count(*) FROM payments)                                        AS payments,
        (SELECT count(*) FROM billing_ledger)                                  AS ledger,
        (SELECT count(*) FROM invoices WHERE status='paid')                    AS paid_invoices,
        (SELECT count(*) FROM orders WHERE payment_status='paid')              AS paid_orders,
        (SELECT count(*) FROM payments WHERE status='successful')              AS successful_payments,
        (SELECT coalesce(sum(amount),0) FROM billing_ledger)                   AS ledger_total`);
    return JSON.stringify(r.rows[0]);
  }

  try {
    const customer = await makeUser('customer');
    const stranger = await makeUser('customer');
    const admin = await makeUser('admin');
    const { invoiceId } = await checkout(customer.token);

    // A pending manual payment for the customer's own invoice, created legitimately.
    const init = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${invoiceId}/payments`,
      headers: { authorization: `Bearer ${customer.token}` },
      payload: { gateway: 'manual' },
    });
    const paymentId = init.json().payment?.id as string;
    check(
      'setup: a customer can initiate a manual payment on their own invoice',
      (init.statusCode === 201 || init.statusCode === 200) && Boolean(paymentId),
      `status=${init.statusCode} body=${init.body.slice(0, 200)}`
    );
    // Guard the whole matrix. An earlier run of this probe had an undefined invoice id and
    // cheerfully reported PASS for six routes it was actually calling as "/undefined" - a
    // rejection that proves nothing about authorization. Refuse to continue on bad fixtures.
    // (Throws rather than exiting: as a library function it must fail the caller, not the process.)
    if (!invoiceId || !paymentId) {
      throw new Error(
        `FIXTURE SETUP FAILED (invoiceId=${invoiceId} paymentId=${paymentId}) - aborting rather than reporting meaningless passes.`
      );
    }

    // A token signed with a secret this deployment does not use. Derived from the live env so it can
    // never accidentally be the right secret.
    const wrongSecret = env.JWT_SECRET === 'q'.repeat(32) ? 'r'.repeat(32) : 'q'.repeat(32);
    // A *raw* env, not the parsed `Env`: `Env` holds booleans and durations, and feeding it back
    // through loadEnv() fails validation (it expects the raw strings).
    const FORGED = signAuthToken(
      loadEnv({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://x:y@localhost:5432/z',
        JWT_SECRET: wrongSecret,
      } as NodeJS.ProcessEnv),
      { sub: admin.id, role: 'super_admin', email: admin.email }
    );

    const routes: Array<{ method: 'GET' | 'POST'; url: string; payload?: unknown }> = [
      { method: 'GET', url: '/api/v1/invoices' },
      { method: 'GET', url: `/api/v1/invoices/${invoiceId}` },
      { method: 'POST', url: `/api/v1/invoices/${invoiceId}/payments`, payload: { gateway: 'manual' } },
      { method: 'GET', url: `/api/v1/payments/${paymentId}` },
      { method: 'POST', url: `/api/v1/admin/payments/${paymentId}/confirm-manual`, payload: {} },
      { method: 'POST', url: `/api/v1/admin/payments/${paymentId}/reject-manual`, payload: { reason: 'nope' } },
    ];

    const callers: Array<{ name: string; headers: Record<string, string>; allowed: (u: string) => boolean }> = [
      { name: 'no credentials at all', headers: {}, allowed: () => false },
      { name: 'a garbage bearer token', headers: { authorization: 'Bearer not-a-token' }, allowed: () => false },
      { name: 'a token signed with the wrong secret', headers: { authorization: `Bearer ${FORGED}` }, allowed: () => false },
      // A different logged-in customer: allowed to hit their own collection endpoint, never
      // another user's invoice/payment, never an admin route.
      {
        name: "another customer's valid token",
        headers: { authorization: `Bearer ${stranger.token}` },
        allowed: (u) => u === '/api/v1/invoices',
      },
      // A real customer of this very invoice must still never reach the staff confirmation route.
      {
        name: "the invoice owner's own token on staff routes",
        headers: { authorization: `Bearer ${customer.token}` },
        allowed: (u) => !u.includes('/admin/'),
      },
    ];

    log('\n=== AUTHORIZATION MATRIX: every financial route x every unauthorized caller ===');
    const before = await financialState();
    for (const caller of callers) {
      for (const route of routes) {
        if (caller.allowed(route.url)) continue;
        const res = await app.inject({
          method: route.method,
          url: route.url,
          headers: caller.headers,
          ...(route.payload !== undefined ? { payload: route.payload } : {}),
        });
        const rejected = res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 404;
        check(
          `${route.method} ${route.url.replace(/[0-9a-f-]{36}/g, ':id')} <- ${caller.name}`,
          rejected,
          `status=${res.statusCode} body=${res.body.slice(0, 140)}`
        );
      }
    }

    log('\n=== did any rejected request change financial state? ===');
    const after = await financialState();
    check('financial state is byte-for-byte unchanged after every rejected request', before === after, `before=${before}\n        after =${after}`);

    log('\n=== the specific thing the directive forbids ===');
    {
      const paidBefore = await db.query<{ status: string }>(`SELECT status FROM invoices WHERE id=$1`, [invoiceId]);
      // Counted before the attempts and compared after, not compared against zero: on a database
      // that already holds a successful payment — real data, or this probe's own earlier run — an
      // absolute count of zero would report a failure that says nothing about who caused it.
      const succBefore = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM payments WHERE status='successful'`);
      const ledBefore = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM billing_ledger WHERE entry_type='payment'`);
      // Every plausible customer-side attempt to self-confirm.
      const attempts = [
        app.inject({
          method: 'POST',
          url: `/api/v1/admin/payments/${paymentId}/confirm-manual`,
          headers: { authorization: `Bearer ${customer.token}` },
          payload: {},
        }),
        app.inject({
          method: 'POST',
          url: `/api/v1/invoices/${invoiceId}/payments`,
          headers: { authorization: `Bearer ${customer.token}` },
          payload: { gateway: 'manual', status: 'successful' },
        }),
        app.inject({
          method: 'POST',
          url: `/api/v1/invoices/${invoiceId}/payments`,
          headers: { authorization: `Bearer ${customer.token}` },
          payload: { gateway: 'manual', amount: '0.01' },
        }),
        app.inject({
          method: 'GET',
          url: `/api/v1/payments/${paymentId}`,
          headers: { authorization: `Bearer ${stranger.token}` },
        }),
      ];
      await Promise.all(attempts);
      const paidAfter = await db.query<{ status: string }>(`SELECT status FROM invoices WHERE id=$1`, [invoiceId]);
      check(
        'no customer-side request moved the invoice to paid',
        paidBefore.rows[0].status === paidAfter.rows[0].status && paidAfter.rows[0].status !== 'paid',
        `before=${paidBefore.rows[0].status} after=${paidAfter.rows[0].status}`
      );
      const succ = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM payments WHERE status='successful'`);
      check(
        'no customer-side request produced a successful payment',
        succ.rows[0].n === succBefore.rows[0].n,
        `before=${succBefore.rows[0].n} after=${succ.rows[0].n}`
      );
      const led = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM billing_ledger WHERE entry_type='payment'`);
      check(
        'no customer-side request produced a payment ledger entry',
        led.rows[0].n === ledBefore.rows[0].n,
        `before=${ledBefore.rows[0].n} after=${led.rows[0].n}`
      );
    }

    log('\n=== a client-supplied amount or status must never be honoured ===');
    {
      const inv = await db.query<{ total_amount: string }>(`SELECT total_amount FROM invoices WHERE id=$1`, [invoiceId]);
      const p = await db.query<{ amount: string; status: string }>(`SELECT amount, status FROM payments WHERE id=$1`, [paymentId]);
      check(
        'the payment amount came from the invoice, not the request body',
        p.rows[0].amount === inv.rows[0].total_amount,
        `payment=${p.rows[0].amount} invoice=${inv.rows[0].total_amount}`
      );
      // NOT asserted as still 'pending': the section above deliberately initiates further payment
      // attempts on this same invoice, and `initiatePaymentForInvoice` cancels any other pending
      // attempt so a customer can abandon a stale one. `cancelled` here is correct product
      // behaviour, and an earlier run of this probe misreported it as a failure.
      check(
        'the payment was never moved to a successful state by a customer request',
        p.rows[0].status !== 'successful',
        `status=${p.rows[0].status}`
      );
    }

    log('\n=== authorized staff CAN still do their job (the control) ===');
    {
      // A fresh attempt, because the ones above were cancelled by later initiations.
      const fresh = await app.inject({
        method: 'POST',
        url: `/api/v1/invoices/${invoiceId}/payments`,
        headers: { authorization: `Bearer ${customer.token}` },
        payload: { gateway: 'manual' },
      });
      const freshId = fresh.json().payment?.id as string;
      check('the customer can open a fresh manual payment attempt', Boolean(freshId), `status=${fresh.statusCode}`);
      const ok = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/payments/${freshId}/confirm-manual`,
        headers: { authorization: `Bearer ${admin.token}` },
        payload: {},
      });
      check('an admin can confirm a manual payment', ok.statusCode === 200, `status=${ok.statusCode} ${ok.body.slice(0, 120)}`);
      const inv = await db.query<{ status: string }>(`SELECT status FROM invoices WHERE id=$1`, [invoiceId]);
      check('that confirmation did mark the invoice paid', inv.rows[0].status === 'paid', `status=${inv.rows[0].status}`);
      const led = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM billing_ledger WHERE invoice_id=$1 AND entry_type='payment'`,
        [invoiceId]
      );
      check('and wrote exactly one payment ledger entry', led.rows[0].n === 1, `n=${led.rows[0].n}`);
      const audit = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM auth_audit_log WHERE event_type='manual_payment_confirmed' AND user_id=$1`,
        [admin.id]
      );
      check('and left an auditable record naming the acting staff member', audit.rows[0].n === 1, `n=${audit.rows[0].n}`);
    }

    log('\n=== replay: confirming an already-confirmed payment ===');
    {
      const ledBefore = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM billing_ledger`);
      const confirmedId = (await db.query<{ id: string }>(`SELECT id FROM payments WHERE status='successful' LIMIT 1`)).rows[0]
        ?.id;
      const again = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/payments/${confirmedId}/confirm-manual`,
        headers: { authorization: `Bearer ${admin.token}` },
        payload: {},
      });
      check('a replayed confirmation is refused, not a 500', again.statusCode >= 400 && again.statusCode < 500, `status=${again.statusCode}`);
      const ledAfter = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM billing_ledger`);
      check('the replay added no ledger entry', ledBefore.rows[0].n === ledAfter.rows[0].n, `${ledBefore.rows[0].n} -> ${ledAfter.rows[0].n}`);
    }
  } finally {
    await app.close();
  }

  return { pass, failures, checks: pass + failures.length };
}

// --- CLI: a real PostgreSQL server, its own throwaway database -----------------------------------

const CONN = {
  host: process.env.CH247_PROBE_PG_HOST ?? '127.0.0.1',
  port: Number(process.env.CH247_PROBE_PG_PORT ?? 55432),
  user: process.env.CH247_PROBE_PG_USER ?? 'ch',
  password: process.env.CH247_PROBE_PG_PASSWORD ?? 'ch',
  bootstrapDb: process.env.CH247_PROBE_PG_BOOTSTRAP ?? 'cloudhost247',
};
const MIGRATIONS = new URL('../database/migrations', import.meta.url).pathname;

async function main(): Promise<number> {
  const DB = 'authz_' + randomUUID().replace(/-/g, '').slice(0, 12);

  const bootstrap = new Pool({ ...CONN, database: CONN.bootstrapDb });
  await bootstrap.query(`CREATE DATABASE ${DB}`);
  await bootstrap.end();

  const pool = new Pool({ ...CONN, database: DB, max: 10 });
  try {
    await migrateUp(new PgClient(pool), { isProduction: false }, MIGRATIONS);
    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://ch:ch@127.0.0.1:55432/' + DB,
      JWT_SECRET: 'p'.repeat(32),
    } as NodeJS.ProcessEnv);

    const result = await runPaymentAuthorizationChecks(pool, { env, log: (line) => console.log(line) });
    console.log(`\n================ ${result.pass}/${result.checks} checks passed ================`);
    if (result.failures.length) console.log('FAILED:\n  - ' + result.failures.join('\n  - '));
    return result.failures.length ? 1 : 0;
  } finally {
    await pool.end();
    const teardown = new Pool({ ...CONN, database: CONN.bootstrapDb });
    await teardown.query(`DROP DATABASE ${DB}`);
    await teardown.end();
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error('PROBE CRASHED:', e);
      process.exit(2);
    });
}
