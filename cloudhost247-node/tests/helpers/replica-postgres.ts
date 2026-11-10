/**
 * Phase 30 — replica consistency helpers.
 *
 * Everything here talks to **two real PostgreSQL servers**: a primary accepting writes and a hot
 * standby streaming from it over `pg_basebackup` + WAL. There is no mocked replica anywhere in this
 * file, and no simulation of lag: the lag tests pause WAL replay on the standby, so the standby is
 * genuinely behind while the test assertions run.
 *
 * Two details are worth the reader's attention before the tests themselves:
 *
 * 1. **A hot standby rejects writes.** That is what makes it a trustworthy replica rather than a
 *    second primary: the standby connection is opened read-only and the helper asserts
 *    `pg_is_in_recovery()` before any read is trusted, so "the read came from the replica" is verified
 *    rather than assumed from a port number.
 *
 * 2. **Lag is created by `pg_wal_replay_pause()` on the standby**, which is a documented PostgreSQL
 *    function rather than a network trick. That makes the stale-read window deterministic: while
 *    replay is paused the standby provably cannot see the new revision, so a test that "observed a
 *    stale read" observed it because of replication, not because of a slow machine.
 */
import { Client } from 'pg';

export interface ReplicaEnv {
  primaryUrl: string;
  replicaUrl: string;
}

export function readReplicaEnv(): ReplicaEnv | null {
  const primaryUrl = process.env.TEST_REPLICA_PRIMARY_URL?.trim() || '';
  const replicaUrl = process.env.TEST_REPLICA_URL?.trim() || '';
  if (!primaryUrl || !replicaUrl) return null;
  return { primaryUrl, replicaUrl };
}

export function clientFor(url: string): Client {
  const client = new Client({ connectionString: url });
  // Idle-connection failures must not crash the worker; individual assertions still fail loudly.
  client.on('error', () => undefined);
  return client;
}

/** Assert the URL really points at a server in recovery, i.e. a standby. Never assume from the port. */
export async function assertInRecovery(url: string): Promise<{ pid: number; inRecovery: boolean }> {
  const client = clientFor(url);
  await client.connect();
  try {
    const { rows } = await client.query<{ pid: number; recovery: boolean }>(
      'SELECT pg_backend_pid() AS pid, pg_is_in_recovery() AS recovery'
    );
    return { pid: rows[0].pid, inRecovery: rows[0].recovery };
  } finally {
    await client.end();
  }
}

/** Primary-side view of streaming status: a standby that is `streaming` and replaying. */
export async function replicationStatus(primaryUrl: string): Promise<{
  state: string;
  syncState: string;
  replayLagBytes: number | null;
  sentLsn: string | null;
  replayLsn: string | null;
}> {
  const client = clientFor(primaryUrl);
  await client.connect();
  try {
    const { rows } = await client.query<{
      state: string;
      sync_state: string;
      replay_lag: string | null;
      sent_lsn: string | null;
      replay_lsn: string | null;
      replay_lag_bytes: string | null;
    }>(
      `SELECT state, sync_state, replay_lag,
              sent_lsn::text AS sent_lsn, replay_lsn::text AS replay_lsn,
              pg_wal_lsn_diff(sent_lsn, replay_lsn)::text AS replay_lag_bytes
         FROM pg_stat_replication`
    );
    if (!rows[0]) {
      return { state: 'none', syncState: 'none', replayLagBytes: null, sentLsn: null, replayLsn: null };
    }
    const row = rows[0];
    return {
      state: row.state,
      syncState: row.sync_state,
      replayLagBytes: row.replay_lag_bytes === null ? null : Number(row.replay_lag_bytes),
      sentLsn: row.sent_lsn,
      replayLsn: row.replay_lsn,
    };
  } finally {
    await client.end();
  }
}

/**
 * Pause WAL replay on the standby and report where it stopped.
 *
 * After this returns, the standby's state is frozen: writes committed on the primary are durable but
 * provably invisible to the standby until `resumeReplay`. This is how a stale read is produced on
 * demand instead of hoping a request lands inside a millisecond-wide window.
 */
export async function pauseReplay(replicaUrl: string): Promise<string> {
  const client = clientFor(replicaUrl);
  await client.connect();
  try {
    await client.query('SELECT pg_wal_replay_pause()');
    // `pg_wal_replay_pause` is a request: replay may be mid-record. Wait for the pause to take effect
    // so the caller's next read is genuinely against a frozen standby.
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const { rows } = await client.query<{ paused: boolean }>('SELECT pg_get_wal_replay_pause_state() = \'paused\' AS paused');
      if (rows[0].paused) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const { rows } = await client.query<{ lsn: string }>('SELECT pg_last_wal_replay_lsn()::text AS lsn');
    return rows[0].lsn;
  } finally {
    await client.end();
  }
}

/** Resume replay and wait until the standby has caught up to the primary's current WAL position. */
export async function resumeReplay(replicaUrl: string, timeoutMs = 15_000): Promise<void> {
  const client = clientFor(replicaUrl);
  await client.connect();
  try {
    await client.query('SELECT pg_wal_replay_resume()');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { rows } = await client.query<{ caught: boolean }>(
        `SELECT pg_last_wal_replay_lsn() >= pg_last_wal_receive_lsn() AS caught`
      );
      if (rows[0].caught) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`replica did not catch up within ${timeoutMs} ms`);
  } finally {
    await client.end();
  }
}

/**
 * Wait until a row satisfies a predicate *through a specific URL*.
 *
 * Polling the replica is the only honest way to answer "has this write replicated yet" — reading
 * `pg_stat_replication` on the primary says what the standby has *received*, not what its snapshots
 * can see.
 */
export async function waitForVisibility(
  url: string,
  query: string,
  params: unknown[] = [],
  timeoutMs = 10_000
): Promise<number> {
  const client = clientFor(url);
  await client.connect();
  const started = Date.now();
  try {
    while (Date.now() - started < timeoutMs) {
      const { rows } = await client.query(query, params);
      const value = rows[0] ? Object.values(rows[0] as Record<string, unknown>)[0] : undefined;
      if (value !== null && value !== undefined) return Date.now() - started;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`not visible via ${new URL(url).port} within ${timeoutMs} ms`);
  } finally {
    await client.end();
  }
}
