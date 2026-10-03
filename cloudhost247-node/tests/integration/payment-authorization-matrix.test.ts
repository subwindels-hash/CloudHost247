import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateUp } from '../../database/migrate';
import { PgliteClient } from '../../database/db-client';
import { runPaymentAuthorizationChecks } from '../../tools/verify-payment-authorization';

/**
 * The adversarial authorization matrix, executed.
 *
 * `tools/verify-payment-authorization.ts` (then `recovery/verify-payment-authorization.ts`) asserts
 * the directive's hardest security requirement — that no customer or browser request can mark an
 * order paid — by driving the real Fastify application through the real auth middleware and checking
 * BOTH the rejection status and that the financial state did not move. It shipped as a bare script
 * hardcoded to a PostgreSQL server at 127.0.0.1:55432, documented to run from `recovery/` where its
 * `pg` import cannot resolve, executed by nothing.
 *
 * Here it runs on every `npm test` against the embedded WASM PostgreSQL, through `app.inject` — no
 * listening socket is opened.
 */
describe('payment authorization matrix', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  it('rejects every unauthorized financial call and moves no money', async () => {
    const result = await runPaymentAuthorizationChecks(db);

    expect(result.failures).toEqual([]);
    expect(result.pass).toBe(result.checks);
    // Route-ownership pairs alone account for the bulk of the matrix; a no-op would report 0/0.
    expect(result.checks).toBeGreaterThanOrEqual(30);
  });

  it('reaches the same verdict on a second run against the same database', async () => {
    // The two "no customer-side request produced…" checks count deltas across the attempts, not
    // absolute totals, so a database that already holds a successful payment — real data, or this
    // probe's own earlier run — does not turn them red for a reason unrelated to the caller.
    const first = await runPaymentAuthorizationChecks(db);
    const second = await runPaymentAuthorizationChecks(db);

    expect(first.failures).toEqual([]);
    expect(second.failures).toEqual([]);
    expect(second.checks).toBe(first.checks);
  });
});
