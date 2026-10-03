import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { hashPassword } from '../../src/lib/password';
import { createBackup, updateBackup, type BackupDatabaseDumpReport, type BackupIncludesReport } from '../../src/db/ops-tables';
import { importManifests } from '../../src/marketplace/import-service';
import { loadManifestCatalog, validatedManifests } from '../../src/marketplace/manifest-loader';

/**
 * What a backup actually contains.
 *
 * The agent has reported since A18 whether it produced a database dump — the engine, the service, or
 * the reason nothing was dumped — and the control plane wrote that into a deployment log line and a
 * clause in the result message, then discarded it. A completed archive with no database dump was
 * therefore indistinguishable, in the backup list, from a complete one: the same "completed" badge
 * and the same recorded checksum. A18(c) recorded that as the open half of the fix.
 *
 * Migration 0068 stores the agent's report on the backup row, and this suite pins all three states it
 * can hold — a dump, a requested dump that produced nothing, and the absence of any report — because
 * collapsing the last two is precisely the defect.
 */
describe('backup contents (0068)', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'g'.repeat(32),
    CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
  } as NodeJS.ProcessEnv);

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  async function seedInstallation(): Promise<{ userId: string; token: string; installationId: string }> {
    const catalog = loadManifestCatalog('manifests');
    const subset = validatedManifests(catalog)
      .filter((m) => m.id === 'n8n')
      .map((m) => ({ ...m }));
    await importManifests(db, subset);
    const application = (
      await db.query<{ id: string; application_version_id: string }>(
        `SELECT a.id, v.id AS application_version_id
         FROM applications a JOIN application_versions v ON v.application_id = a.id
         WHERE a.slug = 'n8n' ORDER BY v.created_at DESC LIMIT 1`
      )
    ).rows[0];

    const userId = randomUUID();
    const email = `owner-${userId}@example.com`;
    await db.query(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1,$2,$3,'T','customer')`, [
      userId,
      email,
      await hashPassword('correct-horse-battery'),
    ]);
    const installationId = randomUUID();
    await db.query(
      `INSERT INTO application_installations (id, customer_id, application_id, application_version_id, name, status, container_project)
       VALUES ($1,$2,$3,$4,'My n8n','healthy','ch247-unit')`,
      [installationId, userId, application.id, application.application_version_id]
    );
    return { userId, token: signAuthToken(env, { sub: userId, role: 'customer', email }), installationId };
  }

  it('stores the agent report as jsonb and refuses anything that is not an object', async () => {
    const column = (
      await db.query<{ data_type: string; is_nullable: string }>(
        `SELECT data_type, is_nullable FROM information_schema.columns
         WHERE table_name = 'backups' AND column_name = 'database_dump'`
      )
    ).rows[0];
    expect(column).toMatchObject({ data_type: 'jsonb', is_nullable: 'YES' });

    const { installationId } = await seedInstallation();
    const backup = await createBackup(db, { installationId });

    // A scalar here would be a protocol accident; the constraint says so rather than leaving every
    // reader to guess what `"postgres"` (as opposed to `{"engine":"postgres"}`) would mean.
    await expect(db.query(`UPDATE backups SET database_dump = '"postgres"'::jsonb WHERE id = $1`, [backup.id])).rejects.toThrow();
    await expect(db.query(`UPDATE backups SET database_dump = '[]'::jsonb WHERE id = $1`, [backup.id])).rejects.toThrow();
    await expect(
      db.query(`UPDATE backups SET database_dump = '{"engine":"postgres"}'::jsonb WHERE id = $1`, [backup.id])
    ).resolves.toBeDefined();
  });

  it('round-trips a report and leaves the column alone when nothing is passed', async () => {
    const { installationId } = await seedInstallation();
    const backup = await createBackup(db, { installationId });

    const noDump: BackupDatabaseDumpReport = {
      engine: null,
      reason: 'no service produced a logical database dump',
      attempted: ['cache:postgres (empty output)'],
    };
    const stored = await updateBackup(db, backup.id, { status: 'completed', databaseDump: noDump });
    expect(stored?.database_dump).toEqual(noDump);

    // `undefined` (and null) mean "no new information", not "erase it": a later status patch must not
    // silently drop the evidence the row exists to carry.
    const patched = await updateBackup(db, backup.id, { status: 'completed', sizeBytes: 4096 });
    expect(patched?.database_dump).toEqual(noDump);

    const withEngine: BackupDatabaseDumpReport = { engine: 'postgres', service: 'db', file: '/opt/dump.sql' };
    const replaced = await updateBackup(db, backup.id, { databaseDump: withEngine });
    expect(replaced?.database_dump).toEqual(withEngine);
  });

  it('tells the installation owner what each archive holds, and never fills a gap with a guess', async () => {
    const { token, installationId } = await seedInstallation();
    const app = buildApp(env, { serveFrontend: false, pool: db });

    const withDump = await createBackup(db, { installationId });
    await updateBackup(db, withDump.id, {
      status: 'completed',
      databaseDump: { engine: 'postgres', service: 'db', file: '/opt/dump.sql' },
    });
    const withoutDump = await createBackup(db, { installationId });
    await updateBackup(db, withoutDump.id, {
      status: 'completed',
      databaseDump: { engine: null, reason: 'no service produced a logical database dump' },
    });
    // A backup taken before the platform stored this says nothing either way.
    const legacy = await createBackup(db, { installationId });
    await updateBackup(db, legacy.id, { status: 'completed' });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/app-installations/${installationId}/backups`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const rows = (response.json() as { backups: Array<{ id: string; database_dump: unknown }> }).backups;
    const byId = new Map(rows.map((r) => [r.id, r.database_dump]));

    expect(byId.get(withDump.id)).toMatchObject({ engine: 'postgres' });
    expect(byId.get(withoutDump.id)).toMatchObject({ engine: null, reason: expect.stringContaining('no service') });
    expect(byId.get(legacy.id)).toBeNull();

    await app.close();
  });
});

/**
 * What the archive was asked for and actually holds (the agent's `includes` block).
 *
 * The control plane persisted the database-dump half of the agent's evidence (0068) and discarded
 * the rest — recorded as the open item on row A22. Migration 0070 stores the includes report
 * verbatim, and this suite pins the same three-state discipline: a report, a report with no engine
 * dumped, and no report at all (an older agent), because absence must never read as "nothing inside".
 */
describe('backup includes report (0070)', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'g'.repeat(32),
    CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
  } as NodeJS.ProcessEnv);

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  async function seedInstallation(): Promise<{ installationId: string }> {
    const catalog = loadManifestCatalog('manifests');
    const subset = validatedManifests(catalog)
      .filter((m) => m.id === 'n8n')
      .map((m) => ({ ...m }));
    await importManifests(db, subset);
    const application = (
      await db.query<{ id: string; application_version_id: string }>(
        `SELECT a.id, v.id AS application_version_id
         FROM applications a JOIN application_versions v ON v.application_id = a.id
         WHERE a.slug = 'n8n' ORDER BY v.created_at DESC LIMIT 1`
      )
    ).rows[0];
    const userId = randomUUID();
    await db.query(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1,$2,$3,'T','customer')`, [
      userId,
      `includes-${userId}@example.com`,
      await hashPassword('correct-horse-battery'),
    ]);
    const installationId = randomUUID();
    await db.query(
      `INSERT INTO application_installations (id, customer_id, application_id, application_version_id, name, status, container_project)
       VALUES ($1,$2,$3,$4,'My n8n','healthy','ch247-unit')`,
      [installationId, userId, application.id, application.application_version_id]
    );
    return { installationId };
  }

  it('stores the includes report as jsonb and refuses anything that is not an object', async () => {
    const column = (
      await db.query<{ data_type: string; is_nullable: string }>(
        `SELECT data_type, is_nullable FROM information_schema.columns
         WHERE table_name = 'backups' AND column_name = 'includes'`
      )
    ).rows[0];
    expect(column).toMatchObject({ data_type: 'jsonb', is_nullable: 'YES' });

    const { installationId } = await seedInstallation();
    const backup = await createBackup(db, { installationId });

    await expect(db.query(`UPDATE backups SET includes = 'true'::jsonb WHERE id = $1`, [backup.id])).rejects.toThrow();
    await expect(db.query(`UPDATE backups SET includes = '[]'::jsonb WHERE id = $1`, [backup.id])).rejects.toThrow();
    await expect(
      db.query(`UPDATE backups SET includes = '{"volumes":true,"databases":"postgres"}'::jsonb WHERE id = $1`, [backup.id])
    ).resolves.toBeDefined();
  });

  it('round-trips the report and leaves the column alone when nothing is passed', async () => {
    const { installationId } = await seedInstallation();
    const backup = await createBackup(db, { installationId });

    const reported: BackupIncludesReport = { volumes: true, databases: 'postgres' };
    const stored = await updateBackup(db, backup.id, { status: 'completed', includes: reported });
    expect(stored?.includes).toEqual(reported);

    // Same "leave as is" semantics as the dump evidence: a later patch must not erase it.
    const patched = await updateBackup(db, backup.id, { sizeBytes: 2048 });
    expect(patched?.includes).toEqual(reported);

    const noEngine: BackupIncludesReport = { volumes: true, databases: null };
    const replaced = await updateBackup(db, backup.id, { includes: noEngine });
    expect(replaced?.includes).toEqual(noEngine);
  });

  it('returns all three states to the installation owner, and absence stays absence', async () => {
    const { installationId } = await seedInstallation();
    const userId = (await db.query<{ customer_id: string }>(`SELECT customer_id FROM application_installations WHERE id = $1`, [installationId])).rows[0].customer_id;
    const email = `owner-${userId}@example.com`;
    const token = signAuthToken(env, { sub: userId, role: 'customer', email });
    const app = buildApp(env, { serveFrontend: false, pool: db });

    const both = await createBackup(db, { installationId });
    await updateBackup(db, both.id, { status: 'completed', includes: { volumes: true, databases: 'postgres' } });
    const volumesOnly = await createBackup(db, { installationId });
    await updateBackup(db, volumesOnly.id, { status: 'completed', includes: { volumes: true, databases: null } });
    const legacy = await createBackup(db, { installationId });
    await updateBackup(db, legacy.id, { status: 'completed' });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/app-installations/${installationId}/backups`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const rows = (response.json() as { backups: Array<{ id: string; includes: unknown }> }).backups;
    const byId = new Map(rows.map((r) => [r.id, r.includes]));

    expect(byId.get(both.id)).toEqual({ volumes: true, databases: 'postgres' });
    expect(byId.get(volumesOnly.id)).toEqual({ volumes: true, databases: null });
    expect(byId.get(legacy.id)).toBeNull();

    await app.close();
  });
});
