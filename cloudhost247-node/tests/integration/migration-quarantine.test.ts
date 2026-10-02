import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { QUARANTINED_MIGRATIONS, migrateUp, status } from '../../database/migrate';

/**
 * The standing restriction in docs/NODE_PLATFORM_STATUS.md holds four migration artifacts back from
 * production execution. These tests pin that the hold is real, reported, and cannot be reversed
 * silently — while leaving non-production environments (local, CI, tests) untouched.
 */
const STANDING_RESTRICTION = ['0023', '0024', '0025', '0041'];

describe('production migration quarantine (standing restriction)', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
  });

  afterEach(async () => {
    await db.close();
  });

  it('quarantines exactly the migrations named by the standing restriction, each with a reason', () => {
    expect(Object.keys(QUARANTINED_MIGRATIONS).sort()).toEqual(STANDING_RESTRICTION);
    for (const version of STANDING_RESTRICTION) {
      const rule = QUARANTINED_MIGRATIONS[version];
      expect(rule, version).toBeDefined();
      expect(rule!.reason).toMatch(/NOT authorized for production execution/i);
    }
    // 0041 creates tables that later migrations build on, so it declares dependents.
    expect(QUARANTINED_MIGRATIONS['0041']!.dependents.length).toBeGreaterThan(0);
  });

  it('matches the list written in docs/NODE_PLATFORM_STATUS.md', () => {
    const docPath = path.resolve(process.cwd(), '..', 'docs', 'NODE_PLATFORM_STATUS.md');
    const doc = readFileSync(docPath, 'utf8');
    const line = doc.split('\n').find((entry) => entry.includes('NOT authorized for production execution'));
    expect(line, 'standing-restriction line').toBeDefined();
    const named = line!.match(/\b00\d{2}\b/g) ?? [];
    expect([...new Set(named)].sort()).toEqual(STANDING_RESTRICTION);
  });

  it('applies every migration in non-production environments — tests and local are unaffected', async () => {
    const client = new PgliteClient(db);
    const result = await migrateUp(client, { isProduction: false });

    expect(result.quarantined).toBeUndefined();
    for (const version of STANDING_RESTRICTION) {
      expect(result.applied.some((name) => name.startsWith(version)), version).toBe(true);
    }
    // The webhook ledger is genuinely created when the artifact is allowed to run.
    const ledger = await db.query<{ present: boolean }>(
      `SELECT to_regclass('public.webhook_events') IS NOT NULL AS present`
    );
    expect(ledger.rows[0]!.present).toBe(true);
  });

  it('refuses a production run whole, before any DDL, when a dependent migration is pending', async () => {
    const client = new PgliteClient(db);
    const result = await migrateUp(client, { isProduction: true, confirmedForProduction: true });

    expect(result.applied).toEqual([]);
    expect(result.skippedReason).toContain('Refusing to migrate production');
    expect(result.skippedReason).toContain('0041');
    expect(result.skippedReason).toContain('0042');
    expect(result.skippedReason).toContain('AUTHORIZED_MIGRATIONS=0041');
    expect(result.quarantined?.map((entry) => entry.version).sort()).toEqual(STANDING_RESTRICTION);

    // Nothing was applied: no application schema at all, not just the quarantined artifacts.
    const tables = await db.query<{ present: boolean }>(
      `SELECT to_regclass('public.webhook_events') IS NOT NULL AS present`
    );
    expect(tables.rows[0]!.present).toBe(false);
    const core = await db.query<{ present: boolean }>(
      `SELECT to_regclass('public.users') IS NOT NULL AS present`
    );
    expect(core.rows[0]!.present).toBe(false);
  });

  it('applies the quarantined artifacts only when the operator authorizes those versions for the run', async () => {
    const client = new PgliteClient(db);
    const result = await migrateUp(client, {
      isProduction: true,
      confirmedForProduction: true,
      authorizedQuarantined: [...STANDING_RESTRICTION],
    });

    expect(result.quarantined).toBeUndefined();
    expect(result.skippedReason).toBeUndefined();
    for (const version of STANDING_RESTRICTION) {
      expect(result.applied.some((name) => name.startsWith(version)), version).toBe(true);
    }
  });

  it('skips a standalone quarantined artifact and still applies the rest of the production run', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ch247-migrations-'));
    try {
      writeFileSync(path.join(dir, '0024_create_webhook_events.sql'), 'CREATE TABLE probe_0024 (id int);');
      writeFileSync(path.join(dir, '0060_create_totp_mfa.sql'), 'CREATE TABLE probe_0060 (id int);');

      const client = new PgliteClient(db);
      const result = await migrateUp(
        client,
        { isProduction: true, confirmedForProduction: true },
        dir
      );

      expect(result.applied).toEqual(['0060_create_totp_mfa.sql']);
      expect(result.quarantined?.map((entry) => entry.version)).toEqual(['0024']);
      expect(result.skippedReason).toBeUndefined();

      // The quarantined artifact really was not executed; the unrelated one was.
      const probes = await db.query<{ quarantine_ran: boolean; later_ran: boolean }>(
        `SELECT to_regclass('public.probe_0024') IS NOT NULL AS quarantine_ran,
                to_regclass('public.probe_0060') IS NOT NULL AS later_ran`
      );
      expect(probes.rows[0]).toEqual({ quarantine_ran: false, later_ran: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still requires explicit production confirmation before it can refuse or apply anything', async () => {
    const client = new PgliteClient(db);
    const result = await migrateUp(client, { isProduction: true });
    expect(result.applied).toEqual([]);
    expect(result.skippedReason).toMatch(/requires explicit confirmation/i);
  });

  it('marks quarantined migrations in status output, applied or not', async () => {
    const client = new PgliteClient(db);
    const rows = await status(client);
    const quarantinedRows = rows.filter((row) => row.quarantined);
    expect(quarantinedRows.map((row) => row.version).sort()).toEqual(STANDING_RESTRICTION);
    for (const row of quarantinedRows) {
      expect(row.quarantineReason).toMatch(/NOT authorized for production execution/i);
    }
    const normal = rows.find((row) => row.version === '0001');
    expect(normal?.quarantined).toBe(false);
    expect(normal?.quarantineReason).toBeNull();
  });
});
