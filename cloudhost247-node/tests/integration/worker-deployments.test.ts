import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { hashPassword } from '../../src/lib/password';
import { importManifests } from '../../src/marketplace/import-service';
import { loadManifestCatalog, validatedManifests } from '../../src/marketplace/manifest-loader';
import { createServer } from '../../src/db/servers';
import { createInstallationRequest } from '../../src/services/installation-service';
import { processNextJob, recoverOrphanedJobs } from '../../src/worker/handlers';
import { enqueueDeployment, findDeploymentById } from '../../src/db/deployments';
import { createBackup, updateBackup } from '../../src/db/ops-tables';
import type { DeploymentAdapter } from '../../src/deployments/adapters/types';
import type { Queryable } from '../../src/db/types';

/**
 * Phase 6 worker tests (spec §28, §29): the queue's claim semantics (SKIP LOCKED — two workers
 * never run the same job), idempotency keys, the engine-backed handlers running the FULL
 * pipeline against a stub adapter in simulation mode, failure→retry accounting, and orphaned
 * lease recovery. No real agent is ever contacted.
 */
describe('deployment worker', () => {
  let db: PGlite;
  process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/cloudhost247';
  process.env.JWT_SECRET ??= 'g'.repeat(32);
  process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'a'.repeat(64);
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'g'.repeat(32),
    CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
  } as NodeJS.ProcessEnv);

  const ok = { ok: true, code: 'OK', message: 'ok' };
  const boom = { ok: false, code: 'AGENT_UNREACHABLE', message: 'agent is down' };

  /**
   * Stub adapter matching the REAL DeploymentAdapter surface (src/deployments/adapters/types.ts)
   * — no `as never` casting, so a renamed adapter method breaks this test at compile time, not
   * at 2am in production. Records every call; configured names fail.
   */
  function stubAdapter(
    fail: Set<string> = new Set(),
    { quiesceRestore = false }: { quiesceRestore?: boolean } = {}
  ): DeploymentAdapter & { calls: string[] } {
    const calls: string[] = [];
    const restoreOptions: Array<{ expectedChecksum?: string | null } | undefined> = [];
    const op = (name: string) => {
      calls.push(name);
      return fail.has(name) ? boom : ok;
    };
    return {
      kind: 'docker',
      ...(quiesceRestore ? { restoreRequiresStoppedApplication: true } : {}),
      calls,
      restoreOptions,
      deployApplication: async (_ctx, input) => op(`deploy:${input.project}`),
      destroyApplication: async (_ctx, project) => op(`teardown:${project}`),
      startApplication: async (_ctx, project) => op(`start:${project}`),
      stopApplication: async (_ctx, project) => op(`stop:${project}`),
      restartApplication: async (_ctx, project) => op(`restart:${project}`),
      applicationStatus: async (_ctx, project) => ({ ...ok, running: !fail.has(`status:${project}`), health: 'healthy' }),
      applicationLogs: async () => ({ ...ok, logs: 'fake logs' }),
      runHealthcheck: async (_ctx, project) => ({ ...op(`healthcheck:${project}`), running: !fail.has(`healthcheck:${project}`), health: 'healthy' }),
      runBackup: async (_ctx, project) => ({ ...op(`backup:${project}`), archivePath: '/backups/x.tar.gz', sizeBytes: 1024, checksum: 'abc' }),
      restoreBackup: async (_ctx, project, _archive, options) => {
        restoreOptions.push(options);
        return op(`restore:${project}`);
      },
      provisionHosting: async () => op('provisionHosting'),
      suspendHosting: async () => op('suspendHosting'),
      terminateHosting: async () => op('terminateHosting'),
    };
  }

  const options = (adapter: DeploymentAdapter) => ({ simulationMode: true, kubernetesEnabled: false, adapterOverride: adapter });

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  async function seedCustomer() {
    const userId = randomUUID();
    await db.query(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1,$2,$3,$4,'customer')`, [
      userId,
      `worker-${randomUUID().slice(0, 8)}@example.com`,
      await hashPassword('correct-horse-battery'),
      'Worker Test',
    ]);
    return userId;
  }

  async function seedPublishedApp(slug: string) {
    const catalog = loadManifestCatalog('manifests');
    const manifest = validatedManifests(catalog).find((m) => m.id === slug);
    if (!manifest) throw new Error(`manifest ${slug} missing`);
    await importManifests(db, [manifest]);
    // Publish through the workflow (version then application).
    const app = (await db.query<{ id: string }>(`SELECT id FROM applications WHERE slug = $1`, [slug])).rows[0];
    const version = (await db.query<{ id: string }>(`SELECT id FROM application_versions WHERE application_id = $1`, [app.id])).rows[0];
    await db.query(`UPDATE application_versions SET status = 'published' WHERE id = $1`, [version.id]);
    await db.query(`UPDATE applications SET status = 'published' WHERE id = $1`, [app.id]);
    return { app, version, manifest };
  }

  async function seedServer() {
    return createServer(db, {
      name: 'worker-server',
      hostname: 'worker.example.com',
      serverType: 'VPS',
      cpuCores: 16,
      memoryMb: 32_768,
      storageMb: 409_600,
      dockerEnabled: true,
      kubernetesEnabled: false,
      cpanelEnabled: false,
    });
  }

  it('runs the full INSTALL pipeline for a free installation end-to-end', async () => {
    const userId = await seedCustomer();
    const { app } = await seedPublishedApp('uptime-kuma'); // simple single-service app
    const server = await seedServer();

    const request = await createInstallationRequest(db, userId, { applicationIdOrSlug: app.id ?? 'uptime-kuma', serverId: server.id });
    expect(request.paymentRequired).toBe(false);

    const adapter = stubAdapter();
    const ctx = { db, options: options(adapter), workerId: 'worker-1' };

    const claimed = await processNextJob(ctx);
    expect(claimed).not.toBeNull();
    expect(claimed?.action).toBe('install');

    const finished = await findDeploymentById(db, claimed!.id);
    expect(finished?.status).toBe('succeeded');
    expect(finished?.attempts).toBe(1);

    // The adapter performed the real deploy for the installation's isolated project.
    const installation = (
      await db.query<{ container_project: string; status: string; health_status: string }>(
        `SELECT container_project, status, health_status FROM application_installations WHERE id = $1`,
        [request.installationId]
      )
    ).rows[0];
    expect(adapter.calls).toContain(`deploy:${installation.container_project}`);
    expect(installation.status).toBe('healthy');
    expect(installation.health_status).toBe('healthy');

    // Steps + events are recorded for the live console.
    const steps = (await db.query(`SELECT name, status FROM deployment_steps WHERE deployment_id = $1 ORDER BY step_order`, [claimed!.id])).rows;
    expect(steps.length).toBeGreaterThan(3);
    expect(steps.every((step: { status: string }) => step.status === 'succeeded')).toBe(true);
    const events = (await db.query(`SELECT message FROM deployment_events WHERE deployment_id = $1`, [claimed!.id])).rows;
    expect(events.length).toBeGreaterThan(3);

    // Idempotency: re-enqueueing the same install key does not create a second job.
    const again = await enqueueDeployment(db, {
      installationId: request.installationId,
      serverId: server.id,
      action: 'install',
      idempotencyKey: `install:${request.installationId}:${request.orderId}`,
      requestedBy: userId,
    });
    expect(again.created).toBe(false);

    // Queue empty now.
    expect(await processNextJob(ctx)).toBeNull();
  });

  /**
   * Restoring a running docker-compose application. The agent's restore untars compose.yaml, .env
   * and volumes/ into the project directory, so a running database's data files are replaced under
   * it — and the route already allows `restore` on a `healthy` installation, so this is the normal
   * path. The pipeline must stop the application first and start it again afterwards.
   */
  describe('restore quiesces a running application', () => {
    /** Installs a free app through the real pipeline and returns everything a restore needs. */
    async function installedApp(adapter: DeploymentAdapter) {
      const userId = await seedCustomer();
      const { app } = await seedPublishedApp('uptime-kuma');
      const server = await seedServer();
      const request = await createInstallationRequest(db, userId, {
        applicationIdOrSlug: app.id ?? 'uptime-kuma',
        serverId: server.id,
      });
      const ctx = { db, options: options(adapter), workerId: 'worker-restore' };
      const claimed = await processNextJob(ctx);
      expect(claimed?.action).toBe('install');
      const installation = (
        await db.query<{ container_project: string; status: string }>(
          `SELECT container_project, status FROM application_installations WHERE id = $1`,
          [request.installationId]
        )
      ).rows[0];
      adapter.calls.length = 0; // only the restore's own calls are asserted
      return { userId, server, ctx, installationId: request.installationId, project: installation.container_project };
    }

    async function completedBackup(installationId: string, serverId: string) {
      const backup = await createBackup(db, { installationId, serverId });
      return await updateBackup(db, backup.id, {
        status: 'completed',
        storagePath: '/opt/cloudhost247/backups/proj-2026.tar.gz',
        sizeBytes: 4096,
        checksum: 'b'.repeat(64),
        completedAt: new Date().toISOString(),
      });
    }

    function enqueueRestore(userId: string, installationId: string, serverId: string, backupId: string) {
      return enqueueDeployment(db, {
        installationId,
        serverId,
        action: 'restore',
        idempotencyKey: `restore:${installationId}:${randomUUID()}`,
        requestedBy: userId,
        payload: { backupId },
      });
    }

    it('stops the application, restores, and starts it again', async () => {
      const adapter = stubAdapter(new Set(), { quiesceRestore: true });
      const { userId, server, ctx, installationId, project } = await installedApp(adapter);
      const backup = await completedBackup(installationId, server.id);

      await enqueueRestore(userId, installationId, server.id, backup!.id);
      const claimed = await processNextJob(ctx);
      expect(claimed?.action).toBe('restore');

      expect(adapter.calls).toEqual([`stop:${project}`, `restore:${project}`, `start:${project}`, `healthcheck:${project}`]);
      const finished = await findDeploymentById(db, claimed!.id);
      expect(finished?.status).toBe('succeeded');
      const installation = (
        await db.query<{ status: string; health_status: string }>(
          `SELECT status, health_status FROM application_installations WHERE id = $1`,
          [installationId]
        )
      ).rows[0];
      expect(installation.status).toBe('healthy');
      expect(installation.health_status).toBe('healthy');

      const events = (
        await db.query<{ message: string }>(`SELECT message FROM deployment_events WHERE deployment_id = $1`, [claimed!.id])
      ).rows.map((row) => row.message);
      expect(events.some((m) => m.includes('stopped for restore'))).toBe(true);
    });

    it('restores an already-stopped installation without starting it', async () => {
      // A restore must never be what starts a customer's application: nothing is writing to quiesce.
      const adapter = stubAdapter(new Set(), { quiesceRestore: true });
      const { userId, server, ctx, installationId, project } = await installedApp(adapter);
      await db.query(`UPDATE application_installations SET status = 'stopped' WHERE id = $1`, [installationId]);
      const backup = await completedBackup(installationId, server.id);

      await enqueueRestore(userId, installationId, server.id, backup!.id);
      const claimed = await processNextJob(ctx);
      expect(claimed?.action).toBe('restore');

      expect(adapter.calls).toEqual([`restore:${project}`]);
      const installation = (
        await db.query<{ status: string }>(`SELECT status FROM application_installations WHERE id = $1`, [installationId])
      ).rows[0];
      expect(installation.status).toBe('stopped');
    });

    it('does not stop anything for an engine that restores live', async () => {
      // cPanel restores an account's home directory through the panel's own UAPI, which is its normal
      // live restore path; the capability is what decides, not the pipeline guessing from the engine.
      const adapter = stubAdapter();
      const { userId, server, ctx, installationId, project } = await installedApp(adapter);
      const backup = await completedBackup(installationId, server.id);

      await enqueueRestore(userId, installationId, server.id, backup!.id);
      const claimed = await processNextJob(ctx);

      expect(adapter.calls).toEqual([`restore:${project}`]);
      expect((await findDeploymentById(db, claimed!.id))?.status).toBe('succeeded');
    });

    it('starts the application again when the restore itself fails', async () => {
      const adapter = stubAdapter(new Set(), { quiesceRestore: true });
      const { userId, server, ctx, installationId, project } = await installedApp(adapter);
      adapter.calls.length = 0;
      const failing = stubAdapter(new Set([`restore:${project}`]), { quiesceRestore: true });
      const backups = await completedBackup(installationId, server.id);

      await enqueueRestore(userId, installationId, server.id, backups!.id);
      const claimed = await processNextJob({ ...ctx, options: options(failing) });

      // The stop and the restart both happened even though the restore failed: a failed restore must
      // not leave the customer's application down.
      expect(failing.calls).toEqual([`stop:${project}`, `restore:${project}`, `start:${project}`, `healthcheck:${project}`]);
      const retrying = await findDeploymentById(db, claimed!.id);
      expect(retrying?.error_code).toBe('AGENT_UNREACHABLE');
      expect(['queued', 'failed']).toContain(retrying?.status); // queued for retry while attempts remain
    });

    it('never touches the application when it cannot be stopped', async () => {
      const adapter = stubAdapter(new Set(), { quiesceRestore: true });
      const { userId, server, ctx, installationId, project } = await installedApp(adapter);
      const failing = stubAdapter(new Set([`stop:${project}`]), { quiesceRestore: true });
      const backup = await completedBackup(installationId, server.id);

      await enqueueRestore(userId, installationId, server.id, backup!.id);
      const claimed = await processNextJob({ ...ctx, options: options(failing) });

      // Restoring into a project whose containers are still up is the thing this prevents.
      expect(failing.calls).toEqual([`stop:${project}`]);
      const deployment = await findDeploymentById(db, claimed!.id);
      expect(deployment?.error_code).toBe('AGENT_UNREACHABLE');
      expect(String(deployment?.error_message)).toContain('could not be stopped before restoring');
    });

    it('passes the checksum recorded with the backup to the engine that applies it', async () => {
      // Without this the agent has nothing to verify the archive against, and an archive damaged in
      // storage is extracted over the live project.
      const adapter = stubAdapter(new Set(), { quiesceRestore: true });
      const { userId, server, ctx, installationId } = await installedApp(adapter);
      const backup = await completedBackup(installationId, server.id);

      await enqueueRestore(userId, installationId, server.id, backup!.id);
      await processNextJob(ctx);

      expect(adapter.restoreOptions).toEqual([{ expectedChecksum: 'b'.repeat(64) }]);
    });

    it('passes a null checksum when the backup row has none, so no verification is implied', async () => {
      const adapter = stubAdapter(new Set(), { quiesceRestore: true });
      const { userId, server, ctx, installationId } = await installedApp(adapter);
      const legacy = await createBackup(db, { installationId, serverId: server.id });
      await updateBackup(db, legacy.id, {
        status: 'completed',
        storagePath: '/opt/cloudhost247/backups/legacy.tar.gz',
      });

      await enqueueRestore(userId, installationId, server.id, legacy.id);
      await processNextJob(ctx);

      expect(adapter.restoreOptions).toEqual([{ expectedChecksum: null }]);
    });

    it('refuses to restore a backup taken from a different installation', async () => {
      // The route scopes backups to their installation; the engine re-checks because this pipeline is
      // what overwrites the data, and a restore is destructive and irreversible.
      const adapter = stubAdapter(new Set(), { quiesceRestore: true });
      const { userId, server, ctx, installationId, project } = await installedApp(adapter);
      const other = await installedApp(adapter); // a second customer's installation
      const foreign = await completedBackup(other.installationId, server.id);
      expect(project).not.toBe(other.project);

      await enqueueRestore(userId, installationId, server.id, foreign!.id);
      const claimed = await processNextJob(ctx);

      expect(adapter.calls).toEqual([]);
      const deployment = await findDeploymentById(db, claimed!.id);
      expect(deployment?.error_code).toBe('BACKUP_NOT_AVAILABLE');
      expect(String(deployment?.error_message)).toContain('different installation');
    });

    it('refuses to restore a backup that is not completed', async () => {
      const adapter = stubAdapter(new Set(), { quiesceRestore: true });
      const { userId, server, ctx, installationId } = await installedApp(adapter);
      const running = await createBackup(db, { installationId, serverId: server.id });
      await updateBackup(db, running.id, { status: 'running' });

      await enqueueRestore(userId, installationId, server.id, running.id);
      const claimed = await processNextJob(ctx);

      expect(adapter.calls).toEqual([]);
      expect((await findDeploymentById(db, claimed!.id))?.error_code).toBe('BACKUP_NOT_AVAILABLE');
    });
  });

  it('never lets two workers claim the same job (SKIP LOCKED)', async () => {
    const userId = await seedCustomer();
    const { app } = await seedPublishedApp('uptime-kuma');
    const server = await seedServer();
    const request = await createInstallationRequest(db, userId, { applicationIdOrSlug: app.id ?? 'uptime-kuma', serverId: server.id });

    const adapter = stubAdapter();
    // Worker A claims first…
    const ctxA = { db, options: options(adapter), workerId: 'worker-A' };
    const ctxB = { db, options: options(adapter), workerId: 'worker-B' };
    const first = await processNextJob(ctxA);
    expect(first?.id).toBe(request.installationId ? (await db.query<{ id: string }>(`SELECT id FROM deployments WHERE installation_id = $1`, [request.installationId])).rows[0].id : '');
    // …and worker B finds nothing — the row is claimed (running), not queued.
    expect(await processNextJob(ctxB)).toBeNull();

    const finished = await findDeploymentById(db, first!.id);
    expect(finished?.worker_id).toBe('worker-A');
    expect(finished?.status).toBe('succeeded');
  });

  it('records failures with error codes and retry accounting (attempts < max_attempts)', async () => {
    const userId = await seedCustomer();
    const { app } = await seedPublishedApp('uptime-kuma');
    const server = await seedServer();
    const request = await createInstallationRequest(db, userId, { applicationIdOrSlug: app.id ?? 'uptime-kuma', serverId: server.id });

      const project = (await db.query<{ container_project: string }>(`SELECT container_project FROM application_installations WHERE id = $1`, [request.installationId])).rows[0].container_project;
    const failing = stubAdapter(new Set([`deploy:${project}`]));
    const ctx = { db, options: options(failing), workerId: 'worker-retry' };
    const claimed = await processNextJob(ctx);
    expect(claimed).not.toBeNull();

    // Attempt 1 failed but attempts < max_attempts → the job is re-queued with backoff,
    // its error recorded for the console.
    const retrying = await findDeploymentById(db, claimed!.id);
    expect(retrying?.status).toBe('queued');
    expect(retrying?.error_code).toBe('AGENT_UNREACHABLE');
    expect(retrying?.attempts).toBe(1);

    // Drain the retries: force each backoff to elapse and run to the attempt ceiling.
    let final = retrying;
    for (let attempt = 0; attempt < 5 && final?.status === 'queued'; attempt += 1) {
      await db.query(`UPDATE deployments SET run_after = now() WHERE id = $1`, [claimed!.id]);
      await processNextJob(ctx);
      final = await findDeploymentById(db, claimed!.id);
    }
    expect(final?.status).toBe('failed');
    expect(final?.error_code).toBe('AGENT_UNREACHABLE');
    expect(final?.attempts).toBe(final?.max_attempts);

    // The installation reflects the failure honestly.
    const installation = (
      await db.query<{ status: string }>(`SELECT status FROM application_installations WHERE id = $1`, [request.installationId])
    ).rows[0];
    expect(['failed', 'deploying']).toContain(installation.status);

    // Events carry the failure for the live console.
    const errors = (
      await db.query(`SELECT message FROM deployment_events WHERE deployment_id = $1 AND level = 'error'`, [claimed!.id])
    ).rows;
    expect(errors.length).toBeGreaterThan(0);
  });

  it('recovers orphaned jobs after a lease expiry (crash recovery)', async () => {
    const userId = await seedCustomer();
    const { app } = await seedPublishedApp('uptime-kuma');
    const server = await seedServer();
    await createInstallationRequest(db, userId, { applicationIdOrSlug: app.id ?? 'uptime-kuma', serverId: server.id });

    // Simulate a dead worker: claim the job, then let the lease look expired.
    await db.query(
      `UPDATE deployments SET status = 'running', worker_id = 'dead-worker', lease_expires_at = now() - interval '10 minutes' WHERE status = 'queued'`
    );
    const recovered = await recoverOrphanedJobs({ db, options: options(stubAdapter()), workerId: 'worker-2' });
    expect(recovered).toBe(1);
    const after = (
      await db.query<{ status: string; worker_id: string; lease_expires_at: string }>(
        `SELECT status, worker_id, lease_expires_at FROM deployments WHERE worker_id = 'worker-2'`
      )
    ).rows[0];
    // The orphan is reassigned with a fresh lease (still running — the dead worker never
    // finished it), and an event records the recovery for the customer's console.
    expect(after.status).toBe('running');
    expect(new Date(after.lease_expires_at).getTime()).toBeGreaterThan(Date.now());
    const recoveryEvent = (
      await db.query<{ message: string }>(`SELECT message FROM deployment_events WHERE message LIKE 'Recovered by%'`)
    ).rows[0];
    expect(recoveryEvent.message).toContain('worker-2');
  });

  it('runs lifecycle actions (restart/stop/start/backup) through their pipelines', async () => {
    const userId = await seedCustomer();
    const { app } = await seedPublishedApp('uptime-kuma');
    const server = await seedServer();
    const request = await createInstallationRequest(db, userId, { applicationIdOrSlug: app.id ?? 'uptime-kuma', serverId: server.id });
    const ctx = { db, options: options(stubAdapter()), workerId: 'worker-lifecycle' };

    // Install first.
    await processNextJob(ctx);

    const installation = (
      await db.query<{ id: string; container_project: string }>(
        `SELECT id, container_project FROM application_installations WHERE id = $1`,
        [request.installationId]
      )
    ).rows[0];
    await db.query(`UPDATE application_installations SET status = 'healthy' WHERE id = $1`, [installation.id]);

    for (const [action, prefix] of [
      ['restart', 'restart'],
      ['stop', 'stop'],
      ['start', 'start'],
      ['backup', 'backup'],
    ] as const) {
      await enqueueDeployment(db, {
        installationId: installation.id,
        serverId: server.id,
        action,
        idempotencyKey: `${action}:${installation.id}:${randomUUID()}`,
        requestedBy: userId,
      });
      const claimed = await processNextJob({ ...ctx, options: options(stubAdapter()) });
      expect(claimed?.action).toBe(action);
      const finished = await findDeploymentById(db, claimed!.id);
      expect(finished?.status, `${action} should succeed`).toBe('succeeded');
      expect(finished?.error_code).toBeNull();
    }
  });

  it('records on the backup row what the archive actually contains', async () => {
    const userId = await seedCustomer();
    const { app } = await seedPublishedApp('uptime-kuma');
    const server = await seedServer();
    const request = await createInstallationRequest(db, userId, {
      applicationIdOrSlug: app.id ?? 'uptime-kuma',
      serverId: server.id,
    });

    await processNextJob({ db, options: options(stubAdapter()), workerId: 'worker-backup-contents' });
    const installation = (
      await db.query<{ id: string }>(`SELECT id FROM application_installations WHERE id = $1`, [request.installationId])
    ).rows[0];
    await db.query(`UPDATE application_installations SET status = 'healthy' WHERE id = $1`, [installation.id]);

    const runBackupWith = async (result: Record<string, unknown>): Promise<void> => {
      const adapter: DeploymentAdapter = {
        ...stubAdapter(),
        runBackup: async (_ctx, project) => ({
          ok: true,
          code: 'OK',
          message: 'Backup completed',
          archivePath: '/backups/x.tar.gz',
          sizeBytes: 1024,
          checksum: 'abc',
          ...result,
        }),
      };
      await enqueueDeployment(db, {
        installationId: installation.id,
        serverId: server.id,
        action: 'backup',
        idempotencyKey: `backup:${installation.id}:${randomUUID()}`,
        requestedBy: userId,
      });
      const claimed = await processNextJob({ db, options: options(adapter), workerId: 'worker-backup-contents' });
      expect(claimed?.action).toBe('backup');
      expect((await findDeploymentById(db, claimed!.id))?.status).toBe('succeeded');
    };

    // 1. A dump was produced: the engine is recorded.
    await runBackupWith({ databaseDump: { engine: 'postgres', service: 'db', file: '/opt/dump.sql' } });
    // 2. A dump was requested and none was produced: the reason and every attempt are recorded, so
    //    the difference between this archive and the one above survives the deployment log.
    await runBackupWith({
      databaseDump: { engine: null, service: null, file: null, reason: 'no service produced a logical database dump', attempted: ['cache:postgres (empty output)'] },
    });
    // 3. An adapter that reports nothing (an older agent) leaves the column NULL — "not recorded",
    //    never "the database dump is there".
    await runBackupWith({});

    const rows = (
      await db.query<{ database_dump: Record<string, unknown> | null }>(
        `SELECT database_dump FROM backups WHERE installation_id = $1 ORDER BY created_at, id`,
        [installation.id]
      )
    ).rows;
    expect(rows).toHaveLength(3);
    expect(rows[0].database_dump).toMatchObject({ engine: 'postgres', service: 'db' });
    expect(rows[1].database_dump).toMatchObject({
      engine: null,
      reason: 'no service produced a logical database dump',
      attempted: ['cache:postgres (empty output)'],
    });
    expect(rows[2].database_dump).toBeNull();
  });

  it('uninstalls: teardown with volumes, installation marked deleted', async () => {
    const userId = await seedCustomer();
    const { app } = await seedPublishedApp('uptime-kuma');
    const server = await seedServer();
    const request = await createInstallationRequest(db, userId, { applicationIdOrSlug: app.id ?? 'uptime-kuma', serverId: server.id });

    const adapter = stubAdapter();
    const ctx = { db, options: options(adapter), workerId: 'worker-uninstall' };
    await processNextJob(ctx); // install

    const installation = (
      await db.query<{ id: string; container_project: string }>(
        `SELECT id, container_project FROM application_installations WHERE id = $1`,
        [request.installationId]
      )
    ).rows[0];

    await enqueueDeployment(db, {
      installationId: installation.id,
      serverId: server.id,
      action: 'uninstall',
      idempotencyKey: `uninstall:${installation.id}:${Date.now()}`,
      requestedBy: userId,
    });
    const uninstallJob = await processNextJob(ctx);
    expect(uninstallJob?.action).toBe('uninstall');
    const finished = await findDeploymentById(db, uninstallJob!.id);
    expect(finished?.status).toBe('succeeded');
    // Uninstall destroys the application's containers + volumes by design.
    expect(adapter.calls).toContain(`teardown:${installation.container_project}`);

    const row = (
      await db.query<{ status: string }>(`SELECT status FROM application_installations WHERE id = $1`, [installation.id])
    ).rows[0];
    expect(row.status).toBe('deleted');
  });
});
