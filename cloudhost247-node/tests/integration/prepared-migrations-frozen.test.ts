import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import {
  QUARANTINED_MIGRATIONS,
  listMigrationFiles,
  migrateUp,
  planMigration,
  status,
} from '../../database/migrate';

/**
 * A10 — migrations prepared but never executed.
 *
 * Two of the four frozen artifacts had no recorded hash, so nothing distinguished "the artifact that
 * was reviewed" from "whatever is on disk now". These tests pin the ledger in
 * docs/NODE_PLATFORM_STATUS.md §A10, confirm the quarantine still names exactly those versions, and
 * prove `migrate plan` reports a production run faithfully without executing anything.
 */
const FROZEN = ['0023', '0024', '0025', '0041'];

function documentedLedger(): Map<string, string> {
  const docPath = path.resolve(process.cwd(), '..', 'docs', 'NODE_PLATFORM_STATUS.md');
  const doc = readFileSync(docPath, 'utf8');
  const ledger = new Map<string, string>();
  const row = /^\|\s*`(00\d{2}_[^`]+\.sql)`\s*\|\s*`([0-9a-f]{64})`\s*\|/gm;
  for (const match of doc.matchAll(row)) {
    ledger.set(match[1]!, match[2]!);
  }
  return ledger;
}

describe('A10 — the frozen migration artifacts are auditable', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
  });

  afterEach(async () => {
    await db.close();
  });

  it('matches every frozen artifact against its recorded SHA-256', () => {
    const ledger = documentedLedger();
    const files = listMigrationFiles();

    for (const version of FROZEN) {
      const file = files.find((candidate) => candidate.version === version);
      expect(file, `migration ${version} exists`).toBeDefined();
      const recorded = ledger.get(file!.name);
      expect(recorded, `${file!.name} has a recorded SHA-256 in docs/NODE_PLATFORM_STATUS.md §A10`).toBeDefined();
      expect(file!.checksum, `${file!.name} is byte-identical to the reviewed artifact`).toBe(recorded);
    }
  });

  it('quarantines exactly the documented frozen set, each with its reason', () => {
    expect(Object.keys(QUARANTINED_MIGRATIONS).sort()).toEqual(FROZEN);
    for (const version of FROZEN) {
      expect(QUARANTINED_MIGRATIONS[version]!.reason).toMatch(/NOT authorized for production execution/i);
    }
  });

  it('records a test suite alongside each frozen artifact', () => {
    const doc = readFileSync(path.resolve(process.cwd(), '..', 'docs', 'NODE_PLATFORM_STATUS.md'), 'utf8');
    for (const version of FROZEN) {
      const line = doc.split('\n').find((entry) => entry.startsWith(`| \`${version}_`));
      expect(line, `${version} ledger row`).toBeDefined();
      expect(line, `${version} names its tests`).toMatch(/tests\//);
      expect(line, `${version} is marked NOT EXECUTED`).toMatch(/NOT EXECUTED/);
    }
  });
});

describe('A10 — migrate plan reports without executing', () => {
  let db: PGlite;
  let client: PgliteClient;

  beforeEach(async () => {
    db = new PGlite();
    client = new PgliteClient(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('plans a full non-production run and executes nothing', async () => {
    const plan = await planMigration(client, { isProduction: false });

    expect(plan.upToDate).toBe(false);
    expect(plan.refusal).toBeUndefined();
    expect(plan.quarantined).toEqual([]);
    expect(plan.wouldApply.length).toBeGreaterThanOrEqual(66);
    expect(plan.wouldApply).toContain('0066_add_provider_record_id_to_dns_records.sql');

    // Read-only: no schema, and not even the migrations bookkeeping table is populated.
    const tables = await db.query<{ present: boolean }>(
      `SELECT to_regclass('public.users') IS NOT NULL AS present`
    );
    expect(tables.rows[0]!.present).toBe(false);
  });

  it('reports the production refusal and the quarantined set without touching the database', async () => {
    const plan = await planMigration(client, { isProduction: true, confirmedForProduction: true });

    expect(plan.refusal?.code).toBe('QUARANTINED_DEPENDENCY');
    expect(plan.refusal?.reason).toContain('0041');
    expect(plan.refusal?.reason).toContain('AUTHORIZED_MIGRATIONS=0041');
    expect(plan.wouldApply).toEqual([]);
    expect(plan.quarantined.map((entry) => entry.version)).toEqual(FROZEN);

    const tables = await db.query<{ present: boolean }>(
      `SELECT to_regclass('public.users') IS NOT NULL AS present`
    );
    expect(tables.rows[0]!.present).toBe(false);
  });

  it('reports the confirmation gate before anything else', async () => {
    const plan = await planMigration(client, { isProduction: true });
    expect(plan.refusal?.code).toBe('CONFIRMATION_REQUIRED');
    expect(plan.quarantined).toEqual([]);
  });

  it('plans exactly what an authorized production run then applies — the two cannot disagree', async () => {
    const opts = {
      isProduction: true,
      confirmedForProduction: true,
      authorizedQuarantined: [...FROZEN],
    };
    const plan = await planMigration(client, opts);
    expect(plan.refusal).toBeUndefined();

    const result = await migrateUp(client, opts);
    expect(result.applied).toEqual(plan.wouldApply);
    expect(result.quarantined).toBeUndefined();
  });

  it('plans exactly what an unconfirmed non-production run applies, and sees it as up to date afterwards', async () => {
    const plan = await planMigration(client, { isProduction: false });
    const result = await migrateUp(client, { isProduction: false });
    expect(result.applied).toEqual(plan.wouldApply);

    const after = await planMigration(client, { isProduction: false });
    expect(after.upToDate).toBe(true);
    expect(after.wouldApply).toEqual([]);
    expect(after.pending).toEqual([]);
  });

  it('marks the frozen artifacts in status output as quarantined and unapplied in production', async () => {
    const rows = await status(client);
    const frozenRows = rows.filter((row) => row.quarantined);
    expect(frozenRows.map((row) => row.version)).toEqual(FROZEN);
    expect(frozenRows.every((row) => row.applied === false)).toBe(true);
  });
});
