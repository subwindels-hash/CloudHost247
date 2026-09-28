import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { getAppliedMigrations, listMigrationFiles, migrateUp, status, verify } from '../../database/migrate';

/**
 * Runs the *real* migration SQL files against @electric-sql/pglite — a WASM-compiled, real
 * PostgreSQL engine — so this test exercises actual Postgres SQL semantics without requiring a
 * running PostgreSQL server in CI or on a developer machine. This directly satisfies the
 * "migrations work" verification step required before cPanel deployment is considered ready.
 */
describe('migration runner against the real database/migrations SQL files', () => {
  let db: PGlite;
  let client: PgliteClient;

  beforeEach(async () => {
    db = new PGlite();
    client = new PgliteClient(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('finds the committed migration files in order', () => {
    const files = listMigrationFiles();
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files[0]?.name).toBe('0001_create_users.sql');
    expect(files[1]?.name).toBe('0002_create_auth_audit_log.sql');
    expect(files[2]?.name).toBe('0003_create_revoked_tokens.sql');
  });

  it('applies all pending migrations and records them in schema_migrations', async () => {
    const result = await migrateUp(client, { isProduction: false });
    expect(result.applied).toEqual([
      '0001_create_users.sql',
      '0002_create_auth_audit_log.sql',
      '0003_create_revoked_tokens.sql',
    ]);

    const applied = await getAppliedMigrations(client);
    expect(applied.map((a) => a.name)).toEqual([
      '0001_create_users.sql',
      '0002_create_auth_audit_log.sql',
      '0003_create_revoked_tokens.sql',
    ]);

    const tables = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining(['users', 'auth_audit_log', 'revoked_tokens', 'schema_migrations'])
    );
  });

  it('is idempotent: running up twice applies nothing the second time', async () => {
    await migrateUp(client, { isProduction: false });
    const second = await migrateUp(client, { isProduction: false });
    expect(second.applied).toEqual([]);
  });

  it('actually enforces the users table constraints created by the migration', async () => {
    await migrateUp(client, { isProduction: false });

    await client.query(
      "INSERT INTO users (id, email, password_hash, full_name) VALUES ('11111111-1111-1111-1111-111111111111', 'a@example.com', 'hash', 'A')"
    );

    await expect(
      client.query(
        "INSERT INTO users (id, email, password_hash, full_name, role) VALUES ('22222222-2222-2222-2222-222222222222', 'b@example.com', 'hash', 'B', 'not-a-real-role')"
      )
    ).rejects.toThrow();

    // Case-insensitive unique email index should reject a duplicate with different casing.
    await expect(
      client.query(
        "INSERT INTO users (id, email, password_hash, full_name) VALUES ('33333333-3333-3333-3333-333333333333', 'A@EXAMPLE.COM', 'hash', 'A2')"
      )
    ).rejects.toThrow();
  });

  it('refuses to apply migrations in production without explicit confirmation', async () => {
    const result = await migrateUp(client, { isProduction: true, confirmedForProduction: false });
    expect(result.applied).toEqual([]);
    expect(result.skippedReason).toMatch(/explicit confirmation/i);

    const applied = await getAppliedMigrations(client);
    expect(applied).toEqual([]);
  });

  it('applies in production once explicitly confirmed', async () => {
    const result = await migrateUp(client, { isProduction: true, confirmedForProduction: true });
    expect(result.applied.length).toBe(3);
  });

  it('status reports pending migrations before running and applied after', async () => {
    const before = await status(client);
    expect(before.every((m) => !m.applied)).toBe(true);

    await migrateUp(client, { isProduction: false });

    const after = await status(client);
    expect(after.every((m) => m.applied)).toBe(true);
    expect(after.every((m) => m.checksumMatches === true)).toBe(true);
  });

  it('verify() detects checksum drift without mutating anything', async () => {
    await migrateUp(client, { isProduction: false });
    const ok = await verify(client);
    expect(ok.ok).toBe(true);

    // Simulate drift: someone hand-edited an already-applied migration's checksum record.
    await client.query("UPDATE schema_migrations SET checksum = repeat('0', 64) WHERE version = '0001'");
    const drifted = await verify(client);
    expect(drifted.ok).toBe(false);
    expect(drifted.drift[0]?.name).toBe('0001_create_users.sql');
  });

  it('refuses to apply further migrations when drift is detected', async () => {
    await migrateUp(client, { isProduction: false });
    await client.query("UPDATE schema_migrations SET checksum = repeat('0', 64) WHERE version = '0001'");

    await expect(migrateUp(client, { isProduction: false })).rejects.toThrow(/checksum drift/i);
  });

  it('rolls back a failing migration file cleanly (no partial schema left behind)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ch247-migrations-'));
    writeFileSync(path.join(dir, '0001_ok.sql'), 'CREATE TABLE ok_table (id int primary key);');
    writeFileSync(path.join(dir, '0002_broken.sql'), 'CREATE TABLE broken_table (id int primary key); THIS IS NOT SQL;');

    await expect(migrateUp(client, { isProduction: false }, dir)).rejects.toThrow(/0002_broken\.sql failed/);

    const tables = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    // 0001 committed successfully; 0002's own (broken) DDL must not have partially applied.
    expect(tables.rows.map((r) => r.table_name)).toEqual(expect.arrayContaining(['ok_table']));
    expect(tables.rows.map((r) => r.table_name)).not.toContain('broken_table');

    rmSync(dir, { recursive: true, force: true });
  });
});
