/**
 * Design Studio — migrations 0102–0104 against a *fresh* install and an *existing* database.
 *
 * Two questions that "the suite passes" does not answer:
 *
 *  1. **Fresh install.** Does a brand-new database, migrated from empty, end up with the table and all
 *     three columns? A migration that assumes something an earlier one did not create fails only here.
 *  2. **Existing database.** The upgrade path that actually matters in production: a database that
 *     already holds customer templates, migrated *up to 0101* (before the revision column), must gain
 *     the column without disturbing a single row. If `revision` had been added without a default, or
 *     with a NOT NULL that could not be satisfied, this is where it would show.
 *
 * The freshness test also establishes the thing that broke earlier in this branch's life: two migration
 * files sharing a version number. `schema_migrations` has a primary key on `version`, so a duplicate
 * fails the second file and rolls it back — on a fresh install, in production, for a customer whose
 * database happens to be new. `assertNoDuplicateVersions` below is the cheap guard.
 *
 * These run on real PostgreSQL when `TEST_POSTGRES_URL` is set (they create and drop throwaway
 * databases) and on PGlite otherwise, because the *migration* questions do not need concurrency —
 * except the upgrade one, which is exercised identically on both.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { PgliteClient } from '../../database/db-client';
import { MIGRATIONS_DIR, migrateUp } from '../../database/migrate';
import { createScratchDatabase, hasRealPostgres, type ScratchDatabase } from '../helpers/real-postgres';

/** Every migration file's version prefix, in order. */
function migrationVersions(): Array<{ version: string; name: string }> {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ version: name.slice(0, 4), name }));
}

const SAMPLE_DOCUMENT = {
  templateId: 'address-70x40',
  widthMm: 70,
  heightMm: 40,
  elements: [{ kind: 'field', id: 'recipient', x: 0, y: 4, width: 53, height: 15, binding: { key: 'recipient' } }],
};

describe('design-studio migrations', () => {
  it('has no two migration files sharing a version number', () => {
    // A duplicate version makes `INSERT INTO schema_migrations` collide on a fresh install: the second
    // file fails and rolls back, so one feature silently does not exist on new databases. This happened
    // in this branch (0099 was taken by `main` while it was being written) and is why the block is now
    // 0102–0104.
    const versions = migrationVersions();
    const seen = new Map<string, string[]>();
    for (const { version, name } of versions) {
      seen.set(version, [...(seen.get(version) ?? []), name]);
    }
    const duplicates = [...seen.entries()].filter(([, names]) => names.length > 1);
    expect(duplicates, `duplicate migration versions: ${JSON.stringify(duplicates)}`).toEqual([]);
  });
});

describe('fresh installation (PGlite)', () => {
  let db: PGlite;
  let client: PgliteClient;

  beforeAll(async () => {
    db = new PGlite();
    client = new PgliteClient(db);
    await migrateUp(client, { allowProduction: true });
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it('creates the table with every column the API depends on', async () => {
    const columns = await client.query<{ column_name: string; is_nullable: string; column_default: string | null }>(
      `SELECT column_name, is_nullable, column_default FROM information_schema.columns
        WHERE table_name = 'design_studio_templates' ORDER BY ordinal_position`
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names).toEqual(
      expect.arrayContaining(['id', 'user_id', 'kind', 'name', 'summary', 'document', 'source_template', 'revision', 'last_forced_at', 'created_at', 'updated_at'])
    );
    // The revision defaults to 1 rather than being nullable: a NULL would make every conditional update
    // fail to match, and the template would be silently un-editable.
    const revision = columns.rows.find((row) => row.column_name === 'revision');
    expect(revision?.is_nullable).toBe('NO');
    expect(revision?.column_default).toBe('1');
    const forcedAt = columns.rows.find((row) => row.column_name === 'last_forced_at');
    expect(forcedAt?.is_nullable).toBe('YES');
  });

  it('installs both unique indexes and the partial forced index', async () => {
    const indexes = await client.query<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE tablename = 'design_studio_templates'");
    const names = indexes.rows.map((row) => row.indexname);
    expect(names).toEqual(
      expect.arrayContaining([
        'design_studio_templates_pkey',
        'design_studio_templates_owner_idx',
        'design_studio_templates_owner_name_idx',
        'design_studio_templates_forced_idx',
      ])
    );
  });

  it('records all three migrations', async () => {
    const applied = await client.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
    const names = applied.rows.map((row) => row.name);
    for (const expected of [
      '0102_create_design_studio_templates.sql',
      '0103_add_design_studio_template_revision.sql',
      '0104_add_design_studio_template_forced_at.sql',
    ]) {
      expect(names).toContain(expected);
    }
  });
});

describe.runIf(hasRealPostgres)('upgrade of an existing database (real PostgreSQL)', () => {
  let scratch: ScratchDatabase;

  beforeAll(async () => {
    scratch = await createScratchDatabase('ch247_mig');
  }, 120_000);

  afterAll(async () => {
    if (scratch) await scratch.close();
  }, 60_000);

  it('adds the columns to a table that already holds customer templates, without touching the rows', async () => {
    // Reproduce the production upgrade: a row written by the release *before* `revision` existed.
    // The migration has already run here (createScratchDatabase migrates fully), so this simulates the
    // pre-upgrade shape by dropping the two columns and re-applying the two migrations.
    const userId = '00000000-0000-4000-8000-0000000000aa';
    await scratch.client.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, status) VALUES ($1, 'upgrade@example.com', 'hash', 'Upgrade', 'customer', 'active')`,
      [userId]
    );
    await scratch.client.query(
      `INSERT INTO design_studio_templates (id, user_id, kind, name, summary, document, source_template)
       VALUES ('00000000-0000-4000-8000-0000000000bb', $1, 'label', 'Pre-existing', 'before the upgrade', $2::jsonb, 'address-70x40')`,
      [userId, JSON.stringify(SAMPLE_DOCUMENT)]
    );

    // Roll the schema back to the pre-0103 shape and forget those two migrations, then let the runner
    // apply them again — exactly what a production `migrate up` does, but without a fresh database.
    await scratch.client.query('ALTER TABLE design_studio_templates DROP COLUMN IF EXISTS last_forced_at');
    await scratch.client.query('DROP INDEX IF EXISTS design_studio_templates_forced_idx');
    await scratch.client.query('ALTER TABLE design_studio_templates DROP COLUMN IF EXISTS revision');
    await scratch.client.query("DELETE FROM schema_migrations WHERE version IN ('0103', '0104')");

    const result = await migrateUp(scratch.client, { allowProduction: true });
    expect(result.applied).toEqual(
      expect.arrayContaining(['0103_add_design_studio_template_revision.sql', '0104_add_design_studio_template_forced_at.sql'])
    );

    // The row survived, unchanged, and is now version 1.
    const { rows } = await scratch.client.query<{ name: string; revision: number; document: unknown; last_forced_at: Date | null }>(
      'SELECT name, revision, document, last_forced_at FROM design_studio_templates WHERE id = $1',
      ['00000000-0000-4000-8000-0000000000bb']
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Pre-existing');
    expect(rows[0]?.revision).toBe(1);
    expect(rows[0]?.document).toEqual(SAMPLE_DOCUMENT);
    // Nothing has ever been forcibly overwritten, so the stamp is NULL rather than "now".
    expect(rows[0]?.last_forced_at).toBeNull();
  }, 60_000);

  it('is idempotent: running the migrations again changes nothing', async () => {
    const result = await migrateUp(scratch.client, { allowProduction: true });
    expect(result.applied).toEqual([]);
    const { rows } = await scratch.client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM schema_migrations WHERE version IN ('0102', '0103', '0104')"
    );
    expect(rows[0]?.count).toBe('3');
  }, 60_000);
});
