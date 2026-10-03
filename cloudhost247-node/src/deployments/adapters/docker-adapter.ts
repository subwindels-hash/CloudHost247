/**
 * Phase 6 — Docker adapter (spec §32, §33): deploys isolated Compose projects on VPS/dedicated
 * servers through the authenticated server agent (never direct Docker access — spec §31).
 *
 * In DEPLOYMENT_SIMULATION_MODE the adapter short-circuits to a recorded simulation: every step
 * is logged and marked simulated, and nothing touches a real server. This keeps CI/staging runs
 * of the whole pipeline honest — an installation deployed in simulation mode carries a visible
 * `simulated` flag through the API rather than pretending to be real infrastructure.
 */
import type {
  AdapterContext,
  ApplicationStatusResult,
  BackupResult,
  DeploymentAdapter,
  DeploymentOperationResult,
  DeployInstallationInput,
  LogsResult,
} from './types';
import { generateComposeProject } from '../compose-generator';
import {
  AgentUnavailableError,
  agentAppLogs,
  agentAppStatus,
  agentDeployApp,
  agentRestartApp,
  agentRestoreBackup,
  agentRunBackup,
  agentRunHealthcheck,
  agentStartApp,
  agentStopApp,
  agentTearDownApp,
} from '../agent-client';
import type { ApplicationManifest } from '../../marketplace/manifest-schema';
import type { ServerRow } from '../../db/servers';

function ok(message: string): DeploymentOperationResult {
  return { ok: true, code: 'OK', message };
}

function fail(code: string, err: unknown): DeploymentOperationResult {
  return { ok: false, code, message: err instanceof Error ? err.message : String(err) };
}

export interface DockerAdapterOptions {
  simulationMode: boolean;
}

export function createDockerAdapter(options: DockerAdapterOptions): DeploymentAdapter {
  async function isSimulated(ctx: AdapterContext): Promise<boolean> {
    if (options.simulationMode) {
      await ctx.log('warn', 'SIMULATION MODE: no real server or Docker was contacted');
      return true;
    }
    return false;
  }

  return {
    kind: 'docker',

    /**
     * The agent's restore untars the project directory — compose.yaml, .env and volumes/ — while the
     * containers are up, so a running database's data files are replaced under it and the file on
     * disk stops matching the running containers. The restore pipeline stops the application first
     * and starts it again afterwards (see DeploymentAdapter.restoreRequiresStoppedApplication).
     */
    restoreRequiresStoppedApplication: true,

    async deployApplication(ctx, input) {
      if (await isSimulated(ctx)) {
        await ctx.log('info', `Simulated deploy of ${input.project} (image ${input.appImage})`);
        return ok(`Simulated deployment of ${input.project}`);
      }
      const bundle = generateComposeProject({
        manifest: input.manifest,
        appImage: input.appImage,
        project: input.project,
        domain: input.domain,
        sslEnabled: input.sslEnabled,
        cpuLimit: input.cpuLimit,
        memoryLimitMb: input.memoryLimitMb,
        environmentKeys: Object.keys(input.environment),
      });
      try {
        await agentDeployApp(ctx.db, agentRef(ctx.server), input.project, {
          composeYaml: bundle.composeYaml,
          environment: input.environment,
        });
        return ok(`Deployed ${input.project} (${bundle.volumeNames.length} volumes)`);
      } catch (err) {
        return fail(err instanceof AgentUnavailableError ? 'AGENT_UNREACHABLE' : 'DEPLOY_FAILED', err);
      }
    },

    async destroyApplication(ctx, project) {
      if (await isSimulated(ctx)) return ok(`Simulated teardown of ${project}`);
      try {
        await agentTearDownApp(ctx.db, agentRef(ctx.server), project, true);
        return ok(`Removed ${project} and its volumes`);
      } catch (err) {
        return fail(err instanceof AgentUnavailableError ? 'AGENT_UNREACHABLE' : 'DESTROY_FAILED', err);
      }
    },

    async startApplication(ctx, project) {
      if (await isSimulated(ctx)) return ok(`Simulated start of ${project}`);
      try {
        await agentStartApp(ctx.db, agentRef(ctx.server), project);
        return ok(`Started ${project}`);
      } catch (err) {
        return fail('START_FAILED', err);
      }
    },

    async stopApplication(ctx, project) {
      if (await isSimulated(ctx)) return ok(`Simulated stop of ${project}`);
      try {
        await agentStopApp(ctx.db, agentRef(ctx.server), project);
        return ok(`Stopped ${project}`);
      } catch (err) {
        return fail('STOP_FAILED', err);
      }
    },

    async restartApplication(ctx, project) {
      if (await isSimulated(ctx)) return ok(`Simulated restart of ${project}`);
      try {
        await agentRestartApp(ctx.db, agentRef(ctx.server), project);
        return ok(`Restarted ${project}`);
      } catch (err) {
        return fail('RESTART_FAILED', err);
      }
    },

    async applicationStatus(ctx, project): Promise<ApplicationStatusResult> {
      if (await isSimulated(ctx)) {
        return { ok: true, code: 'SIMULATION', message: 'Simulated status; live health is unavailable', running: false, health: 'unknown' };
      }
      try {
        const status = await agentAppStatus(ctx.db, agentRef(ctx.server), project);
        const allRunning = status.containers.length > 0 && status.containers.every((c) => c.state === 'running');
        const hasUnhealthyContainer = status.containers.some((c) => c.health === 'unhealthy');
        const allContainersHealthy = allRunning && status.containers.every((c) => c.health === 'healthy');
        return {
          ok: true,
          code: 'OK',
          message: `${status.containers.length} container(s)`,
          running: status.running,
          // Running is not the same as healthy. Docker only reports a definitive health state
          // when the container has a healthcheck; otherwise the control plane must show UNKNOWN.
          health: hasUnhealthyContainer ? 'unhealthy' : allContainersHealthy ? 'healthy' : 'unknown',
        };
      } catch (err) {
        return { ok: false, code: 'STATUS_FAILED', message: (err as Error).message, running: false, health: 'unknown' };
      }
    },

    async applicationLogs(ctx, project, tail = 200): Promise<LogsResult> {
      if (await isSimulated(ctx)) {
        return { ok: true, code: 'OK', message: 'ok', logs: '[simulation mode] no real container logs exist\n' };
      }
      try {
        const result = await agentAppLogs(ctx.db, agentRef(ctx.server), project, tail);
        return { ok: true, code: 'OK', message: 'ok', logs: result.logs };
      } catch (err) {
        return { ok: false, code: 'LOGS_FAILED', message: (err as Error).message, logs: '' };
      }
    },

    async runHealthcheck(ctx, project, manifest): Promise<ApplicationStatusResult> {
      if (await isSimulated(ctx)) {
        return { ok: true, code: 'SIMULATION', message: 'Simulated health check; live health is unavailable', running: false, health: 'unknown' };
      }
      const check = manifest.healthcheck;
      if (!check) {
        return { ok: true, code: 'NO_HEALTHCHECK', message: 'Manifest defines no healthcheck', running: false, health: 'unknown' };
      }
      try {
        const report = await agentRunHealthcheck(ctx.db, agentRef(ctx.server), project, check.service ?? 'app', {
          type: check.type,
          path: check.path,
          port: check.port ?? manifest.services.app?.port,
          command: check.command,
          timeoutMs: 10_000,
        });
        return {
          ok: true,
          code: 'OK',
          message: report.detail,
          running: true,
          health: report.healthy ? 'healthy' : 'unhealthy',
        };
      } catch (err) {
        return { ok: false, code: 'HEALTHCHECK_FAILED', message: (err as Error).message, running: false, health: 'unknown' };
      }
    },

    async runBackup(ctx, project, manifest): Promise<BackupResult> {
      if (await isSimulated(ctx)) {
        return { ok: true, code: 'OK', message: 'Simulated backup', archivePath: `/simulated/${project}.tar.gz`, sizeBytes: 1024, checksum: 'simulated' };
      }
      try {
        const includeDatabases = manifest.backup.includes.includes('database');
        const result = await agentRunBackup(ctx.db, agentRef(ctx.server), project, {
          includeVolumes: manifest.backup.includes.includes('volumes'),
          includeDatabases,
        });
        // A backup that was asked for a database dump and produced none must not read as a clean
        // backup in the deployment log: the archive is still valid (volumes are in it), so this is a
        // warning that names the reason, not a failure — the platform has no way to know whether the
        // service runs an engine with a logical dump at all (redis persists in the volume tar).
        if (includeDatabases && result.databaseDump && !result.databaseDump.engine) {
          await ctx.log(
            'warn',
            `Backup for ${project} was requested with a database dump but the agent produced none: ` +
              `${result.databaseDump.reason ?? 'no reason reported'}` +
              (result.databaseDump.attempted?.length
                ? ` (tried: ${result.databaseDump.attempted.join('; ')})`
                : '')
          );
        }
        const dumped = result.databaseDump?.engine;
        return {
          ok: true,
          code: 'OK',
          message: dumped ? `Backup completed (${dumped} dump included)` : 'Backup completed',
          archivePath: result.archivePath,
          sizeBytes: result.sizeBytes,
          checksum: result.checksum,
          // Verbatim, so the row records the agent's evidence and not this adapter's summary of it.
          databaseDump: result.databaseDump ?? null,
        };
      } catch (err) {
        return { ok: false, code: 'BACKUP_FAILED', message: (err as Error).message, archivePath: null, sizeBytes: null, checksum: null };
      }
    },

    async restoreBackup(ctx, project, archivePath, options) {
      if (await isSimulated(ctx)) return ok(`Simulated restore of ${archivePath}`);
      try {
        const result = await agentRestoreBackup(
          ctx.db,
          agentRef(ctx.server),
          project,
          archivePath,
          options?.expectedChecksum
        );
        // Say which of the two happened. "Restored" and "restored and verified against the recorded
        // checksum" are different facts, and a caller reading only the first would have no way to tell
        // whether the integrity check ran, was skipped because no digest was on record, or was skipped
        // because this agent is older than the check.
        return ok(
          result.checksumVerified
            ? `Restored ${project} from ${archivePath} (archive verified against the recorded checksum)`
            : `Restored ${project} from ${archivePath}`
        );
      } catch (err) {
        return fail('RESTORE_FAILED', err);
      }
    },

    /**
     * Hosting accounts (WHM/cPanel) are not containers: creating, suspending or deleting a hosting
     * account on a VPS/dedicated server is the cPanel adapter's job on a CPANEL-typed server
     * (spec §35 — never deploy Docker applications into ordinary cPanel hosting, and never fake a
     * hosting account with a container). A structured refusal keeps the deployment log honest and
     * tells the operator which adapter to use; the engine's server-type selection routes there.
     */
    async provisionHosting(): Promise<DeploymentOperationResult> {
      return {
        ok: false,
        code: 'HOSTING_REQUIRES_CPANEL_ADAPTER',
        message: 'Hosting accounts are provisioned by the cPanel adapter on a CPANEL server, not by containers',
      };
    },
    async suspendHosting(): Promise<DeploymentOperationResult> {
      return {
        ok: false,
        code: 'HOSTING_REQUIRES_CPANEL_ADAPTER',
        message: 'Hosting account suspension is a WHM operation (cPanel adapter), not a container action',
      };
    },
    async terminateHosting(): Promise<DeploymentOperationResult> {
      return {
        ok: false,
        code: 'HOSTING_REQUIRES_CPANEL_ADAPTER',
        message: 'Hosting account termination is a WHM operation (cPanel adapter), not a container action',
      };
    },
  };
}

function agentRef(server: ServerRow): { id: string; agentId: string | null; agentUrl: string | null } {
  const url = typeof server.metadata?.agent_url === 'string' ? server.metadata.agent_url : null;
  return { id: server.id, agentId: server.agent_id, agentUrl: url };
}
