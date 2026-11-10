/**
 * Phase 31 — failover harness.
 *
 * Starts, stops, crashes and promotes **real PostgreSQL clusters**. Nothing here is mocked: the
 * "primary unavailable" case is an actual stopped postmaster, and promotion is
 * `pg_ctl promote` — the same command an operator or failover manager would run.
 *
 * A note on why the commands are spawned rather than simulated through SQL:
 *
 *  - `pg_ctl -m immediate stop` sends SIGQUIT, which is a *crash* shutdown: the postmaster does not
 *    run its normal shutdown checkpoint and does not roll back open transactions gracefully. That is
 *    what makes the "ambiguous write" test meaningful — it is the closest a local test gets to pulling
 *    the power, and it is the failure mode a real outage produces.
 *  - `pg_ctl promote` is the documented promotion mechanism. A standby promoted by any other route
 *    (touching `recovery.signal`, `pg_ctl promote` wrappers) would be a weaker claim.
 */
import { spawn } from 'node:child_process';
import { Client } from 'pg';
import { mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ClusterSpec {
  dataDir: string;
  port: number;
  role: 'primary' | 'standby';
}

export function pgBinDir(): string | null {
  const configured = process.env.TEST_PG_BIN_DIR?.trim();
  if (configured) return configured;
  // Fall back to the pgserver wheel's bundled binaries, which is what the evidence environment uses.
  return '/tmp/pgenv/lib/python3.11/site-packages/pgserver/pginstall/bin';
}

export function hasPgBinaries(): boolean {
  const dir = pgBinDir();
  if (!dir) return false;
  try {
    // `pg_ctl` is only present in a real server installation, never in a client-only package.
    require('node:fs').accessSync(join(dir, 'pg_ctl'));
    require('node:fs').accessSync(join(dir, 'pg_basebackup'));
    return true;
  } catch {
    return false;
  }
}

function run(file: string, args: string[], timeoutMs = 60_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${file} ${args.join(' ')} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

const bin = (name: string): string => join(pgBinDir()!, name);

/** Provision a fresh primary with WAL settings that make streaming replication possible. */
export async function initPrimary(spec: { dataDir: string; port: number }): Promise<void> {
  rmSync(spec.dataDir, { recursive: true, force: true });
  mkdirSync(spec.dataDir, { recursive: true });
  const init = await run(bin('initdb'), ['-D', spec.dataDir, '-U', 'postgres', '--auth=trust']);
  if (init.code !== 0) throw new Error(`initdb failed: ${init.stderr}`);

  appendFileSync(
    join(spec.dataDir, 'postgresql.conf'),
    [
      '',
      `port = ${spec.port}`,
      "listen_addresses = '127.0.0.1'",
      'wal_level = replica',
      'max_wal_senders = 10',
      'max_replication_slots = 10',
      'wal_keep_size = 256MB',
      'hot_standby = on',
      // Keep the crash window honest: synchronous commit is deliberately left at its default (on),
      // which means a COMMIT is durable on the primary but NOT necessarily on the standby.
      '',
    ].join('\n')
  );
  appendFileSync(
    join(spec.dataDir, 'pg_hba.conf'),
    'local replication all trust\nhost replication all 127.0.0.1/32 trust\nhost all all 127.0.0.1/32 trust\n'
  );
}

export async function startServer(spec: { dataDir: string; port?: number }): Promise<void> {
  const args = ['-D', spec.dataDir, '-l', join(spec.dataDir, 'server.log')];
  if (spec.port !== undefined) args.push('-o', `-p ${spec.port} -h 127.0.0.1`);
  args.push('start');
  const result = await run(bin('pg_ctl'), args);
  if (result.code !== 0 && !/already running/i.test(result.stderr)) {
    // Include the server's own log: "could not start server" on its own says nothing, and a standby
    // that cannot start is most often a recovery/connection problem the log states precisely.
    let tail = '';
    try {
      const log = require('node:fs').readFileSync(join(spec.dataDir, 'server.log'), 'utf8') as string;
      tail = log.split('\n').slice(-15).join('\n');
    } catch {
      tail = '(no server.log)';
    }
    throw new Error(`pg_ctl start failed: ${result.stderr || result.stdout}\n--- server.log tail ---\n${tail}`);
  }
  await waitForServer(spec.port ?? spec.dataDir);
}

async function waitForServer(portOrDir: number | string, timeoutMs = 30_000): Promise<void> {
  if (typeof portOrDir !== 'number') {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const client = new Client({ host: '127.0.0.1', port: portOrDir, user: 'postgres', database: 'postgres' });
      client.on('error', () => undefined);
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`server on port ${portOrDir} did not accept connections within ${timeoutMs} ms`);
}

/** Stop a server. `mode: 'immediate'` is a crash shutdown (SIGQUIT), not a clean one. */
export async function stopServer(spec: { dataDir: string }, mode: 'fast' | 'immediate' = 'fast'): Promise<void> {
  await run(bin('pg_ctl'), ['-D', spec.dataDir, '-m', mode, 'stop']);
}

/** Build a streaming standby from a real base backup. */
export async function initStandby(spec: { dataDir: string; primaryPort: number }): Promise<void> {
  rmSync(spec.dataDir, { recursive: true, force: true });
  const backup = await run(bin('pg_basebackup'), [
    '-h', '127.0.0.1',
    '-p', String(spec.primaryPort),
    '-U', 'postgres',
    '-D', spec.dataDir,
    '-R',
    '-X', 'stream',
    '-c', 'fast',
  ]);
  if (backup.code !== 0) throw new Error(`pg_basebackup failed: ${backup.stderr}`);
  writeFileSync(join(spec.dataDir, 'standby.note'), 'streaming standby built by pg_basebackup -R -X stream\n');
}

/**
 * Promote a standby. This is the real promotion mechanism; afterwards the server accepts writes.
 * `pg_ctl promote` returns before promotion completes, so callers must wait for `pg_is_in_recovery()`.
 */
export async function promoteStandby(spec: { dataDir: string }): Promise<number> {
  const started = Date.now();
  const result = await run(bin('pg_ctl'), ['-D', spec.dataDir, 'promote']);
  if (result.code !== 0 && !/already/i.test(result.stdout + result.stderr)) {
    throw new Error(`pg_ctl promote failed: ${result.stderr || result.stdout}`);
  }
  return Date.now() - started;
}

/** Poll until a server reports it is no longer in recovery (i.e. promotion finished). */
export async function waitForPromotion(port: number, timeoutMs = 60_000): Promise<number> {
  const started = Date.now();
  const deadline = started + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await queryOn(port, 'SELECT pg_is_in_recovery() AS r');
      if (value.rows[0]?.r === false) return Date.now() - started;
    } catch {
      // Connection may still be refused while the postmaster restarts after promotion.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`server on ${port} was not promoted within ${timeoutMs} ms`);
}

export function clientOn(port: number, database = 'postgres'): Client {
  const client = new Client({ host: '127.0.0.1', port, user: 'postgres', database });
  client.on('error', () => undefined);
  return client;
}

export async function queryOn(port: number, sql: string, params: unknown[] = [], database = 'postgres') {
  const client = clientOn(port, database);
  await client.connect();
  try {
    return await client.query(sql, params);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Table shape used by the evidence run: the same columns the real template table has. */
export const TEMPLATE_DDL = `
CREATE TABLE IF NOT EXISTS design_studio_templates (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  name text NOT NULL,
  summary text,
  document jsonb NOT NULL,
  source_template jsonb,
  revision integer NOT NULL DEFAULT 1,
  last_forced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

/**
 * The exact conditional update the application issues. Kept as one statement so that a promotion
 * cannot change its meaning: the predicate is evaluated by whichever server executes it.
 */
export const CONDITIONAL_UPDATE = `
UPDATE design_studio_templates
   SET document = $3::jsonb,
       revision = revision + 1,
       updated_at = now()
 WHERE id = $1 AND user_id = $2 AND revision = $4
 RETURNING revision
`;
