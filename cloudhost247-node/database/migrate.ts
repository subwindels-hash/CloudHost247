/**
 * CloudHost247 migration runner — cPanel-safe CLI.
 *
 * Usage (after `npm run build`, from the application root on the cPanel server):
 *   node dist/database/migrate.js status     # show applied / pending migrations, no changes
 *   node dist/database/migrate.js verify      # checksum-verify already-applied migrations
 *   node dist/database/migrate.js up          # apply pending migrations (explicit, controlled)
 *   node dist/database/migrate.js create name # scaffold a new versioned migration file
 *
 * Design goals (docs/CPANEL_DEPLOYMENT.md "Database migrations"):
 *   - Never runs automatically on server startup.
 *   - Each migration runs inside its own transaction (BEGIN/COMMIT/ROLLBACK) so a failure never
 *     leaves the schema half-applied, and a retry after fixing the SQL is safe.
 *   - Applied migrations are checksummed; drift is reported, never silently "fixed".
 *   - In production, applying migrations requires an explicit confirmation flag/env var so it can
 *     never happen accidentally as a side effect of another command.
 *   - No destructive operation (DROP DATABASE, TRUNCATE, seed-reset) is ever part of this runner.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { loadEnv } from '../src/config/env';
import { buildPoolConfig } from '../src/db/pool';
import { DbClient, PgClient } from './db-client';

// Resolved relative to the current working directory rather than __dirname so this works
// identically whether the runner executes from compiled output (dist/database/migrate.js) or
// directly from TypeScript source (tests). cPanel Node.js Application Manager (Passenger) and
// `npm run migrate` both invoke this with the application root as the working directory.
export const MIGRATIONS_DIR = path.join(process.cwd(), 'database', 'migrations');

export interface MigrationFile {
  version: string; // e.g. 0001
  name: string; // e.g. 0001_create_users.sql
  filePath: string;
  checksum: string;
}

export function listMigrationFiles(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => {
      const filePath = path.join(dir, name);
      const contents = readFileSync(filePath, 'utf8');
      const version = name.split('_')[0] ?? name;
      const checksum = createHash('sha256').update(contents).digest('hex');
      return { version, name, filePath, checksum };
    });
}

const ENSURE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version varchar(20) PRIMARY KEY,
  name text NOT NULL,
  checksum char(64) NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
`;

export async function ensureMigrationsTable(client: DbClient): Promise<void> {
  await client.exec(ENSURE_TABLE_SQL);
}

interface AppliedRow {
  version: string;
  name: string;
  checksum: string;
  applied_at: string;
}

export async function getAppliedMigrations(client: DbClient): Promise<AppliedRow[]> {
  const { rows } = await client.query<AppliedRow>(
    'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version ASC'
  );
  return rows;
}

export async function status(client: DbClient, dir: string = MIGRATIONS_DIR) {
  await ensureMigrationsTable(client);
  const files = listMigrationFiles(dir);
  const applied = await getAppliedMigrations(client);
  const appliedByVersion = new Map(applied.map((a) => [a.version, a]));

  return files.map((f) => ({
    version: f.version,
    name: f.name,
    applied: appliedByVersion.has(f.version),
    checksumMatches: appliedByVersion.has(f.version) ? appliedByVersion.get(f.version)!.checksum === f.checksum : null,
    quarantined: Boolean(QUARANTINED_MIGRATIONS[f.version]),
    quarantineReason: QUARANTINED_MIGRATIONS[f.version]?.reason ?? null,
  }));
}

export async function verify(client: DbClient, dir: string = MIGRATIONS_DIR) {
  const rows = await status(client, dir);
  const drift = rows.filter((r) => r.applied && r.checksumMatches === false);
  return { ok: drift.length === 0, drift };
}

/**
 * Migrations whose artifacts are prepared and tested, but which a standing restriction forbids
 * executing against a production database until they are separately authorized:
 *
 *   "Migrations 0023, 0024, 0025, and 0041: Prepared and tested migration artifacts only. NOT
 *    authorized for production execution; do not run against any production database until
 *    separately authorized."  — docs/NODE_PLATFORM_STATUS.md, Standing restrictions
 *
 * The restriction is enforced here rather than left to documentation. A production run never
 * executes a quarantined artifact: standalone ones are skipped and reported, and if a pending
 * migration depends on a skipped artifact the whole run refuses up front, before any DDL, so a
 * production database is never left half-upgraded. `migrate status` marks them. Authorization is
 * per-run and explicit: AUTHORIZED_MIGRATIONS=0023,0024 (or `authorizedQuarantined` for library
 * callers). Non-production environments (tests, local, previews) are unaffected.
 */
export interface QuarantinedMigrationRule {
  reason: string;
  /**
   * Migrations that cannot be applied while this artifact is quarantined. A production run that
   * would have to leave one of them pending refuses entirely, before executing anything.
   */
  dependents: string[];
}

export const QUARANTINED_MIGRATIONS: Record<string, QuarantinedMigrationRule> = {
  '0023': {
    reason:
      'billing-invariant enforcement (B5) — prepared and tested only, NOT authorized for production execution',
    dependents: [],
  },
  '0024': {
    reason:
      'Phase 5D webhook event ledger — prepared and tested only, NOT authorized for production execution',
    dependents: [],
  },
  '0025': {
    reason:
      'Phase 5F admin billing audit extension — prepared and tested only, NOT authorized for production execution',
    dependents: [],
  },
  '0041': {
    reason:
      'OS catalog and server provisioning — prepared and tested only, NOT authorized for production execution',
    // 0042+ build on the tables 0041 creates; everything later in the ordered run is covered by
    // the first dependent, because migrateUp stops rather than skipping past a failure.
    dependents: [
      '0042',
      '0043',
      '0047',
      '0048',
      '0049',
      '0051',
      '0052',
      '0054',
      '0056',
      '0059',
    ],
  },
};

export interface MigrateUpOptions {
  /** Required to be true to actually apply anything when NODE_ENV=production. */
  confirmedForProduction?: boolean;
  isProduction: boolean;
  /**
   * Migration versions the operator has separately authorized this run despite the standing
   * quarantine (e.g. ['0024']). Nothing else lifts the quarantine for a production database.
   */
  authorizedQuarantined?: string[];
}

export interface QuarantinedMigration {
  version: string;
  name: string;
  reason: string;
  /** Migrations that cannot be applied while this artifact is quarantined. */
  dependents: string[];
}

export interface MigrateUpResult {
  applied: string[];
  skippedReason?: string;
  /** Quarantined migrations this run deliberately did not execute. Reported, never silent. */
  quarantined?: QuarantinedMigration[];
}

/**
 * Applies all pending migrations, each in its own transaction. Stops at the first failure
 * (leaving that migration's transaction rolled back) so re-running after a fix is always safe.
 */
export async function migrateUp(client: DbClient, opts: MigrateUpOptions, dir: string = MIGRATIONS_DIR): Promise<MigrateUpResult> {
  await ensureMigrationsTable(client);

  const driftCheck = await verify(client, dir);
  if (!driftCheck.ok) {
    throw new Error(
      `Refusing to migrate: checksum drift detected for already-applied migration(s): ${driftCheck.drift
        .map((d) => d.name)
        .join(', ')}. Investigate before proceeding — do not edit already-applied migration files.`
    );
  }

  const files = listMigrationFiles(dir);
  const applied = await getAppliedMigrations(client);
  const appliedVersions = new Set(applied.map((a) => a.version));
  const pending = files.filter((f) => !appliedVersions.has(f.version));

  if (pending.length === 0) {
    return { applied: [] };
  }

  if (opts.isProduction && !opts.confirmedForProduction) {
    return {
      applied: [],
      skippedReason:
        'Production migration requires explicit confirmation. Re-run with --yes (or CONFIRM_MIGRATION=yes) after verifying a database backup exists.',
    };
  }

  // The standing quarantine applies to production execution. A production run applies everything
  // except the quarantined artifacts, unless the operator authorized them for this run.
  const authorized = new Set(opts.authorizedQuarantined ?? []);
  const quarantined: QuarantinedMigration[] = [];
  const runnable = pending.filter((file) => {
    const rule = QUARANTINED_MIGRATIONS[file.version];
    if (!rule || !opts.isProduction || authorized.has(file.version)) return true;
    quarantined.push({ version: file.version, name: file.name, reason: rule.reason, dependents: rule.dependents });
    return false;
  });

  // Fail closed, before executing anything: if a later pending migration depends on a quarantined
  // artifact this run will not execute, the upgrade cannot be completed correctly. Refuse the whole
  // run instead of committing a partial upgrade that dies on a relation/foreign-key error.
  const pendingVersions = new Set(pending.map((file) => file.version));
  for (const entry of quarantined) {
    const blocked = entry.dependents.filter((version) => pendingVersions.has(version));
    if (blocked.length > 0) {
      return {
        applied: [],
        quarantined,
        skippedReason:
          `Refusing to migrate production: ${entry.version} (${entry.name}) is quarantined — ${entry.reason} — ` +
          `but pending migration(s) ${blocked.join(', ')} depend on it. Nothing was applied. ` +
          `Authorize it explicitly for this run (AUTHORIZED_MIGRATIONS=${entry.version}) once that is authorized, ` +
          `or leave the production database unchanged.`,
      };
    }
  }

  const appliedNow: string[] = [];
  for (const file of runnable) {
    const sql = readFileSync(file.filePath, 'utf8');
    try {
      await client.exec('BEGIN');
      await client.exec(sql);
      await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
        file.version,
        file.name,
        file.checksum,
      ]);
      await client.exec('COMMIT');
      appliedNow.push(file.name);
    } catch (err) {
      await client.exec('ROLLBACK').catch(() => undefined);
      throw new Error(`Migration ${file.name} failed and was rolled back: ${(err as Error).message}`);
    }
  }

  return quarantined.length > 0 ? { applied: appliedNow, quarantined } : { applied: appliedNow };
}

export function scaffoldMigration(name: string, dir: string = MIGRATIONS_DIR): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const existing = listMigrationFiles(dir);
  const nextNumber = existing.length + 1;
  const version = String(nextNumber).padStart(4, '0');
  const safeName = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const fileName = `${version}_${safeName || 'migration'}.sql`;
  const filePath = path.join(dir, fileName);
  const template = `-- Migration: ${fileName}\n-- Created: ${new Date().toISOString()}\n-- The migration runner already wraps this file's statements in BEGIN/COMMIT — do NOT add your\n-- own BEGIN/COMMIT here, it would break the runner's atomicity/rollback guarantee.\n-- Write forward-only, idempotent-friendly DDL/DML below.\n-- This file must never contain DROP DATABASE or other destructive resets.\n\n-- TODO: add statements\n`;
  writeFileSync(filePath, template, 'utf8');
  return filePath;
}

/* ------------------------------------------------------------------ */
/* CLI entry point                                                     */
/* ------------------------------------------------------------------ */

async function main() {
  const [, , command, ...rest] = process.argv;

  if (command === 'create') {
    const name = rest.join('_');
    if (!name) {
      // eslint-disable-next-line no-console
      console.error('Usage: npm run migrate:create -- <migration_name>');
      process.exit(1);
    }
    const file = scaffoldMigration(name);
    // eslint-disable-next-line no-console
    console.log(`Created ${file}`);
    return;
  }

  const env = loadEnv();
  const pool = new Pool(buildPoolConfig(env));
  const client = new PgClient(pool);

  try {
    // Always verify the connection first — never run DDL against an unreachable/misconfigured DB.
    await pool.query('SELECT 1');

    if (command === 'status' || !command) {
      const rows = await status(client);
      // eslint-disable-next-line no-console
      console.table(rows);
      return;
    }

    if (command === 'verify') {
      const result = await verify(client);
      // eslint-disable-next-line no-console
      console.log(result.ok ? 'OK: no checksum drift detected.' : 'DRIFT DETECTED:');
      if (!result.ok) {
        // eslint-disable-next-line no-console
        console.table(result.drift);
        process.exitCode = 1;
      }
      return;
    }

    if (command === 'up') {
      const confirmedForProduction = rest.includes('--yes') || process.env.CONFIRM_MIGRATION === 'yes';
      const authorizedQuarantined = (process.env.AUTHORIZED_MIGRATIONS ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      const result = await migrateUp(client, {
        isProduction: env.NODE_ENV === 'production',
        confirmedForProduction,
        authorizedQuarantined,
      });
      if (result.skippedReason) {
        // eslint-disable-next-line no-console
        console.warn(result.skippedReason);
        process.exitCode = 1;
        return;
      }
      if (result.applied.length === 0) {
        // eslint-disable-next-line no-console
        console.log('No pending migrations. Database schema is up to date.');
      } else {
        // eslint-disable-next-line no-console
        console.log(`Applied ${result.applied.length} migration(s): ${result.applied.join(', ')}`);
      }
      if (result.quarantined && result.quarantined.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          [
            '',
            'NOT APPLIED — quarantined by a standing restriction (NOT authorized for production execution):',
            ...result.quarantined.map((entry) => `  ${entry.version} ${entry.name}\n      ${entry.reason}`),
            'These migrations were deliberately skipped. To authorize specific ones for this run:',
            '  AUTHORIZED_MIGRATIONS=<comma-separated versions> migrate up --yes',
            '',
          ].join('\n')
        );
      }
      return;
    }

    // eslint-disable-next-line no-console
    console.error(`Unknown command: ${command}. Use one of: status, verify, up, create <name>.`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[migrate] fatal:', (err as Error).message);
    process.exitCode = 1;
  });
}
