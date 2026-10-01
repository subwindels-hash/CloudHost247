import type { Queryable } from '../db/types';

/**
 * A short-lived, database-backed lease for a complete one-shot worker cycle.
 *
 * cPanel Cron can start a new command while a previous command is still handling a slow provider
 * call. Per-job deployment leases already prevent the same deployment from being claimed twice,
 * but periodic sweeps should not all run in parallel. This lease serializes a cron-triggered
 * cycle, survives a process crash, and makes no assumptions about an in-memory process lock.
 */
export interface WorkerCycleLease {
  name: string;
  holder: string;
  leaseMs: number;
}

export const DEFAULT_WORKER_CYCLE_LEASE_NAME = 'scheduled-worker-cycle';

function validLease(lease: WorkerCycleLease): WorkerCycleLease {
  if (!/^[A-Za-z0-9._:-]{1,96}$/.test(lease.name)) {
    throw new Error('Worker lease name must contain only letters, numbers, dots, underscores, colons, or hyphens');
  }
  if (!/^[A-Za-z0-9._:-]{1,96}$/.test(lease.holder)) {
    throw new Error('Worker lease holder must contain only letters, numbers, dots, underscores, colons, or hyphens');
  }
  if (!Number.isInteger(lease.leaseMs) || lease.leaseMs < 1_000 || lease.leaseMs > 3_600_000) {
    throw new Error('Worker lease duration must be an integer between 1 second and 1 hour');
  }
  return lease;
}

/**
 * Acquires a lease only when it is absent or expired. The conflict predicate is part of the
 * single UPSERT statement, so two cron processes cannot both win the hand-off.
 */
export async function tryAcquireWorkerCycleLease(db: Queryable, lease: WorkerCycleLease): Promise<boolean> {
  const input = validLease(lease);
  const { rows } = await db.query<{ name: string }>(
    `INSERT INTO worker_cycle_leases (name, holder, lease_expires_at, acquired_at, updated_at)
     VALUES ($1, $2, now() + ($3::text || ' milliseconds')::interval, now(), now())
     ON CONFLICT (name) DO UPDATE
       SET holder = EXCLUDED.holder,
           lease_expires_at = EXCLUDED.lease_expires_at,
           acquired_at = now(),
           updated_at = now()
       WHERE worker_cycle_leases.lease_expires_at <= now()
     RETURNING name`,
    [input.name, input.holder, String(input.leaseMs)]
  );
  return rows.length === 1;
}

/** Extends only the exact holder's active lease. A stale/expired holder may never steal it back. */
export async function renewWorkerCycleLease(db: Queryable, lease: WorkerCycleLease): Promise<boolean> {
  const input = validLease(lease);
  const { rows } = await db.query<{ name: string }>(
    `UPDATE worker_cycle_leases
     SET lease_expires_at = now() + ($3::text || ' milliseconds')::interval,
         updated_at = now()
     WHERE name = $1 AND holder = $2 AND lease_expires_at > now()
     RETURNING name`,
    [input.name, input.holder, String(input.leaseMs)]
  );
  return rows.length === 1;
}

/** Releases only the caller's lease. A later holder is never removed by an old process. */
export async function releaseWorkerCycleLease(db: Queryable, lease: Pick<WorkerCycleLease, 'name' | 'holder'>): Promise<void> {
  if (!/^[A-Za-z0-9._:-]{1,96}$/.test(lease.name) || !/^[A-Za-z0-9._:-]{1,96}$/.test(lease.holder)) {
    throw new Error('Worker lease name and holder are invalid');
  }
  await db.query(`DELETE FROM worker_cycle_leases WHERE name = $1 AND holder = $2`, [lease.name, lease.holder]);
}

export interface WorkerLeaseRunResult<T> {
  acquired: boolean;
  value?: T;
}

/**
 * Runs `task` under an automatically-renewed cycle lease. Renewal failure is reported to the
 * supplied hook but does not interrupt an in-flight provider action: individual deployment
 * leases still protect those operations and abruptly terminating a process would be less safe.
 */
export async function withWorkerCycleLease<T>(
  db: Queryable,
  lease: WorkerCycleLease,
  task: () => Promise<T>,
  onRenewalFailure: (error: Error) => void = () => undefined
): Promise<WorkerLeaseRunResult<T>> {
  if (!(await tryAcquireWorkerCycleLease(db, lease))) return { acquired: false };

  const renewalEveryMs = Math.max(1_000, Math.floor(lease.leaseMs / 3));
  const timer = setInterval(() => {
    void renewWorkerCycleLease(db, lease)
      .then((renewed) => {
        if (!renewed) onRenewalFailure(new Error(`Lost worker-cycle lease ${lease.name}`));
      })
      .catch((error: unknown) => onRenewalFailure(error instanceof Error ? error : new Error(String(error))));
  }, renewalEveryMs);
  timer.unref?.();

  try {
    return { acquired: true, value: await task() };
  } finally {
    clearInterval(timer);
    await releaseWorkerCycleLease(db, lease).catch((error: unknown) =>
      onRenewalFailure(error instanceof Error ? error : new Error(String(error)))
    );
  }
}
