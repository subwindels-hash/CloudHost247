import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import {
  releaseWorkerCycleLease,
  renewWorkerCycleLease,
  tryAcquireWorkerCycleLease,
} from '../../src/worker/worker-lease';

describe('one-shot worker cycle lease', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  const first = { name: 'scheduled-worker-cycle', holder: 'cron-a', leaseMs: 60_000 };
  const second = { name: 'scheduled-worker-cycle', holder: 'cron-b', leaseMs: 60_000 };

  it('allows only one cron worker to own an active cycle lease', async () => {
    expect(await tryAcquireWorkerCycleLease(db, first)).toBe(true);
    expect(await tryAcquireWorkerCycleLease(db, second)).toBe(false);
    expect(await renewWorkerCycleLease(db, first)).toBe(true);

    await releaseWorkerCycleLease(db, first);
    expect(await tryAcquireWorkerCycleLease(db, second)).toBe(true);
  });

  it('allows a later cron invocation to take over only after a crashed holder lease expires', async () => {
    expect(await tryAcquireWorkerCycleLease(db, first)).toBe(true);
    await db.query(`UPDATE worker_cycle_leases SET lease_expires_at = now() - interval '1 minute' WHERE name = $1`, [first.name]);

    expect(await tryAcquireWorkerCycleLease(db, second)).toBe(true);
    expect(await renewWorkerCycleLease(db, first)).toBe(false);
  });
});
