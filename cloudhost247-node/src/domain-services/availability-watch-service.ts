/**
 * Domain availability watches (spec §17 — "Domain availability" notifications).
 *
 * A customer watches a domain they cannot register today. The worker sweep re-checks active
 * watches through the CONFIGURED registrar — small batches, stalest-first, provider quota
 * respected — and notifies the customer exactly once when the provider reports the domain as
 * available (or registerable as premium). A watch is never fulfilled from cached search
 * results: only a fresh provider answer counts. Provider failures never mark a watch as
 * available and never kill it — they back off via check_failures.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { normalizeDomainName, isValidDomainName } from './domain-name';
import { resolveConnectedDomainProvider } from './provider-service';
import { DomainProviderError } from './providers/types';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors';

export interface AvailabilityWatchDto {
  id: string;
  domainName: string;
  status: 'watching' | 'available' | 'cancelled';
  lastCheckedAt: string | null;
  lastAvailability: string | null;
  availableAt: string | null;
  createdAt: string;
}

type WatchRow = {
  id: string;
  domain_name: string;
  status: 'watching' | 'available' | 'cancelled';
  last_checked_at: string | null;
  last_availability: string | null;
  available_at: string | null;
  created_at: string;
};

function toDto(row: WatchRow): AvailabilityWatchDto {
  return {
    id: row.id,
    domainName: row.domain_name,
    status: row.status,
    lastCheckedAt: row.last_checked_at,
    lastAvailability: row.last_availability,
    availableAt: row.available_at,
    createdAt: row.created_at,
  };
}

/** Per-sweep provider quota for watch re-checks. One batched availability call covers the lot. */
export const AVAILABILITY_WATCH_SWEEP_BATCH = 50;
const MAX_WATCHES_PER_USER = 100;

/**
 * Create a watch. Refuses honestly when no registrar is connected (a watch could never be
 * fulfilled) and when the user already has an active watch on the same domain.
 */
export async function addWatch(db: Queryable, userId: string, domainNameInput: string): Promise<AvailabilityWatchDto> {
  const domainName = normalizeDomainName(domainNameInput);
  if (!isValidDomainName(domainName) || !domainName.includes('.')) {
    throw new ValidationError('Enter a full domain name, e.g. example.com');
  }

  // A watch only makes sense when a registrar can re-check it.
  const provider = await resolveConnectedDomainProvider(db, 'registrar').catch((error) => {
    if (error instanceof DomainProviderError && error.code === 'PROVIDER_NOT_CONFIGURED') return null;
    throw error;
  });
  if (!provider) {
    throw new ValidationError('Service Provider Not Configured — availability watches need a connected registrar provider.');
  }

  const { rows: countRows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM domain_availability_watches WHERE user_id = $1 AND status = 'watching'`,
    [userId]
  );
  if ((countRows[0]?.count ?? 0) >= MAX_WATCHES_PER_USER) {
    throw new ValidationError(`You can watch at most ${MAX_WATCHES_PER_USER} domains at a time`);
  }

  // MCAS-friendly insert: the partial unique index serializes duplicate active watches.
  const id = randomUUID();
  const { rows } = await db.query<WatchRow>(
    `INSERT INTO domain_availability_watches (id, user_id, domain_name, provider_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, lower(domain_name)) WHERE status = 'watching' DO NOTHING
     RETURNING *`,
    [id, userId, domainName, provider.provider.id]
  );
  if (!rows[0]) {
    const { rows: existing } = await db.query<WatchRow>(
      `SELECT * FROM domain_availability_watches WHERE user_id = $1 AND lower(domain_name) = lower($2) AND status = 'watching'`,
      [userId, domainName]
    );
    if (existing[0]) return toDto(existing[0]); // idempotent: the watch the customer asked for already exists
    throw new ConflictError('This domain is already being watched');
  }
  return toDto(rows[0]);
}

export async function listMyWatches(db: Queryable, userId: string): Promise<AvailabilityWatchDto[]> {
  const { rows } = await db.query<WatchRow>(
    `SELECT * FROM domain_availability_watches WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [userId]
  );
  return rows.map(toDto);
}

/** Cancel an active watch. Only the owner can; "not yours" is indistinguishable from "missing". */
export async function cancelWatch(db: Queryable, userId: string, watchId: string): Promise<void> {
  const { rows } = await db.query(
    `UPDATE domain_availability_watches SET status = 'cancelled', updated_at = now()
      WHERE id = $1 AND user_id = $2 AND status = 'watching'
      RETURNING id`,
    [watchId, userId]
  );
  if (rows.length === 0) throw new NotFoundError('No active watch was found with that id');
}

export interface AvailabilityWatchSweepReport {
  checked: number;
  becameAvailable: number;
  failures: number;
}

/**
 * Worker sweep: re-check the stalest active watches in ONE batched provider call. Watches whose
 * provider check fails keep watching (failure counter + fresh last_checked_at moves them to the
 * back of the queue); only a real 'available'/'premium' answer fulfils a watch and notifies.
 */
export async function sweepAvailabilityWatches(db: Queryable, batchSize = AVAILABILITY_WATCH_SWEEP_BATCH): Promise<AvailabilityWatchSweepReport> {
  const report: AvailabilityWatchSweepReport = { checked: 0, becameAvailable: 0, failures: 0 };

  const { rows: due } = await db.query<WatchRow & { user_id: string; provider_id: string | null }>(
    `SELECT * FROM domain_availability_watches
      WHERE status = 'watching'
      ORDER BY last_checked_at ASC NULLS FIRST
      LIMIT $1`,
    [batchSize]
  );
  if (due.length === 0) return report;

  const provider = await resolveConnectedDomainProvider(db, 'registrar').catch((error) => {
    if (error instanceof DomainProviderError) return null;
    throw error;
  });
  if (!provider) return report; // no registrar right now: try again on the next sweep

  let results: Awaited<ReturnType<typeof provider.adapter.checkAvailability>>;
  try {
    results = await provider.adapter.checkAvailability(due.map((watch) => watch.domain_name));
  } catch {
    // Whole-call failure: stamp the attempts so the same rows don't monopolize the sweep.
    await db.query(
      `UPDATE domain_availability_watches
          SET last_checked_at = now(), check_failures = check_failures + 1, updated_at = now()
        WHERE id = ANY($1::uuid[])`,
      [due.map((watch) => watch.id)]
    );
    report.failures = due.length;
    return report;
  }

  const byDomain = new Map(results.map((result) => [result.domainName.toLowerCase(), result]));
  const { createNotification } = await import('../services/notification-service');

  for (const watch of due) {
    const result = byDomain.get(watch.domain_name.toLowerCase());
    if (!result) {
      await db.query(
        `UPDATE domain_availability_watches SET last_checked_at = now(), check_failures = check_failures + 1, updated_at = now() WHERE id = $1`,
        [watch.id]
      );
      report.failures += 1;
      continue;
    }

    const becameAvailable = result.status === 'available' || result.status === 'premium';
    if (becameAvailable) {
      // CAS: only the sweep run that actually flips the row notifies (dedupe is the second lock).
      const { rows: flipped } = await db.query<{ id: string; user_id: string }>(
        `UPDATE domain_availability_watches
            SET status = 'available', last_availability = $2, last_checked_at = now(),
                available_at = now(), check_failures = 0, provider_id = $3, updated_at = now()
          WHERE id = $1 AND status = 'watching'
          RETURNING id, user_id`,
        [watch.id, result.status, provider.provider.id]
      );
      if (flipped[0]) {
        await createNotification(db, {
          userId: flipped[0].user_id,
          type: 'DOMAIN_AVAILABILITY_ALERT',
          title: 'A domain you are watching is available',
          message:
            result.status === 'premium'
              ? `${watch.domain_name} is now available to register as a premium domain. Search for it to see the provider's price.`
              : `${watch.domain_name} is now available to register. Search for it to register it before someone else does.`,
          resourceType: 'domain_availability_watch',
          resourceId: watch.id,
        }).catch(() => undefined);
        report.becameAvailable += 1;
      }
    } else {
      await db.query(
        `UPDATE domain_availability_watches
            SET last_availability = $2, last_checked_at = now(), check_failures = 0, provider_id = $3, updated_at = now()
          WHERE id = $1`,
        [watch.id, result.status, provider.provider.id]
      );
    }
    report.checked += 1;
  }

  return report;
}
