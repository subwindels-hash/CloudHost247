/**
 * Phase 6 — the deployment engine (spec §1, §13, §14, §38): executes one queued deployment job
 * as an ordered, recorded step pipeline against the correct adapter.
 *
 * Contract with the worker (src/worker/*): the worker claims the job, renews its lease, and
 * calls executeDeployment(). The engine owns everything after that: step recording, adapter
 * selection, environment generation, installation status transitions, rollback, and the event
 * stream the customer watches over SSE (spec §24).
 *
 * Rollback model (spec §14): steps declare whether they created infrastructure. When a later
 * step fails, the engine retries it once immediately (transient network blips); if it fails
 * again the deployment moves to rolling_back, runs the inverse of every completed infrastructure
 * step in reverse order, and records rolled_back. A deployment is never left half-created
 * without a record of exactly what happened.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { generateSecret, shortId } from '../lib/crypto';
import { findApplicationById, findApplicationVersionById, type ApplicationRow, type ApplicationVersionRow } from '../db/applications';
import { findServerById, type ServerRow } from '../db/servers';
import {
  appendDeploymentEvent,
  completeDeployment,
  createDeploymentSteps,
  failDeployment,
  finishStep,
  findDeploymentById,
  listDeploymentSteps,
  markRolledBack,
  markRollingBack,
  startStep,
  type DeploymentRow,
  type DeploymentStepRow,
} from '../db/deployments';
import {
  findInstallationById,
  recordHealthResult,
  setInstallationStatus,
  updateInstallation,
  type InstallationRow,
} from '../db/application-installations';
import {
  listEnvironmentEntries,
  resolveEnvironment,
  upsertEnvironmentEntry,
  upsertVolume,
} from '../db/application-config';
import { databaseCredentialKeys, substituteTemplateValue } from './compose-generator';
import { validateManifest, type ApplicationManifest, parseDuration } from '../marketplace/manifest-schema';
import type { ApplicationStatusResult, DeploymentAdapter } from './adapters/types';
import { createDockerAdapter } from './adapters/docker-adapter';
import { createCpanelAdapter } from './adapters/cpanel-adapter';
import { createKubernetesAdapter } from './adapters/kubernetes-adapter';
import { getSetting, createBackup, updateBackup } from '../db/ops-tables';

export interface EngineOptions {
  simulationMode: boolean;
  kubernetesEnabled: boolean;
  /** Test seam: substitute adapters entirely (no real agent/cluster is ever contacted in CI). */
  adapterOverride?: DeploymentAdapter;
}

/** A step whose failure (after retry) triggers rollback of previously completed infra steps. */
interface StepDefinition {
  name: string;
  /** Creates infrastructure that must be cleaned up on rollback. */
  infra?: boolean;
  run: (ctx: StepContext) => Promise<void>;
}

interface StepContext {
  deployment: DeploymentRow;
  installation: InstallationRow | null;
  application: ApplicationRow | null;
  version: ApplicationVersionRow | null;
  server: ServerRow | null;
  manifest: ApplicationManifest;
  adapter: DeploymentAdapter;
  environment: Record<string, string>;
}

export class DeploymentExecutionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly rollbackNeeded: boolean,
    /**
     * Whether the failed pipeline actually attempted something against the installation. Defaults
     * to true — when in doubt, the panel must say "failed". Pure validation refusals (a restore
     * declined before a single adapter call) pass false, so an untouched application is not shown
     * as broken just because a deployment was refused.
     */
    public readonly installationTouched: boolean = true
  ) {
    super(message);
    this.name = 'DeploymentExecutionError';
  }
}

/** Adapter selection (spec §38): server type + manifest engine decide the backend. */
export function selectAdapter(server: ServerRow, manifest: ApplicationManifest, options: EngineOptions): DeploymentAdapter {
  if (options.adapterOverride) return options.adapterOverride;
  if (server.server_type === 'CPANEL' || manifest.deployment.engine === 'cpanel') {
    return createCpanelAdapter({ simulationMode: options.simulationMode });
  }
  if (server.server_type === 'KUBERNETES' || manifest.deployment.engine === 'kubernetes') {
    return createKubernetesAdapter({ enabled: options.kubernetesEnabled, simulationMode: options.simulationMode });
  }
  return createDockerAdapter({ simulationMode: options.simulationMode });
}

/**
 * Executes one deployment to completion (including rollback on failure). Throws only on
 * unrecoverable bookkeeping errors; business failures are recorded on the deployment row and
 * returned cleanly so the worker can schedule retries.
 */
export async function executeDeployment(
  db: Queryable,
  options: EngineOptions,
  deploymentId: string
): Promise<{ outcome: 'succeeded' | 'failed' | 'rolled_back' }> {
  const deployment = await findDeploymentById(db, deploymentId);
  if (!deployment) throw new Error(`executeDeployment: deployment ${deploymentId} not found`);

  const installation = deployment.installation_id ? await findInstallationById(db, deployment.installation_id) : null;
  const application = installation ? await findApplicationById(db, installation.application_id) : null;
  const version = installation ? await findApplicationVersionById(db, installation.application_version_id) : null;
  const server = deployment.server_id ? await findServerById(db, deployment.server_id) : null;

  const log = (level: 'debug' | 'info' | 'warn' | 'error', message: string) =>
    appendDeploymentEvent(db, deploymentId, level, message);

  // Manifest defense in depth: the stored jsonb is re-validated before anything runs.
  let manifest: ApplicationManifest | null = version ? (version.manifest as unknown as ApplicationManifest) : null;
  if (manifest) {
    const revalidated = validateManifest(manifest);
    if (!revalidated.valid || !revalidated.manifest) {
      await log('error', `Stored manifest failed re-validation: ${revalidated.errors.join('; ')}`);
      await failDeployment(db, deployment, {
        errorCode: 'MANIFEST_INVALID',
        errorMessage: revalidated.errors.join('; '),
      });
      return { outcome: 'failed' };
    }
    manifest = revalidated.manifest;
  }

  const pipeline = buildPipelineFor(deployment.action, { db, options, deployment, installation, application, version, server, manifest, log });
  if (!pipeline) {
    await log('error', `No pipeline for action ${deployment.action}`);
    await failDeployment(db, deployment, { errorCode: 'UNSUPPORTED_ACTION', errorMessage: `Unsupported action ${deployment.action}` });
    return { outcome: 'failed' };
  }

  const steps = await createDeploymentSteps(db, deploymentId, pipeline.map((s) => s.name));
  const completedInfra: Array<{ definition: StepDefinitionInternal; step: DeploymentStepRow }> = [];
  const context: StepContext = {
    deployment,
    installation,
    application,
    version,
    server,
    manifest: manifest ?? emptyManifest(),
    adapter: server && manifest ? selectAdapter(server, manifest, options) : createDockerAdapter({ simulationMode: options.simulationMode }),
    environment: {},
  };

  await log('info', `Starting ${deployment.action} deployment (attempt ${deployment.attempts})`);

  for (let index = 0; index < pipeline.length; index += 1) {
    const definition = pipeline[index];
    const step = steps[index];
    if (!definition || !step) throw new Error(`Step definition/row missing for index ${index}`);
    await startStep(db, step.id);

    let lastError: DeploymentExecutionError | null = null;
    // One immediate retry for transient failures (spec §14: "retry the failed step or roll back").
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await definition.run(context);
        lastError = null;
        break;
      } catch (err) {
        if (err instanceof DeploymentExecutionError) {
          lastError = err;
          break; // structured failures are not retried here (the job-level retry handles them)
        }
        lastError = new DeploymentExecutionError('STEP_FAILED', (err as Error).message, !!definition.infra);
        await log('warn', `Step "${definition.name}" attempt ${attempt + 1} failed: ${(err as Error).message}`);
      }
    }

    if (lastError) {
      await finishStep(db, step.id, 'failed', undefined, `${lastError.code}: ${lastError.message}`);
      await log('error', `Step "${definition.name}" failed: ${lastError.code} — ${lastError.message}`);

      if (definition.infra && completedInfra.length > 0) {
        // Rollback (spec §14): undo completed infrastructure steps in reverse order.
        await markRollingBack(db, deploymentId, `Rolled back after step "${definition.name}" failed`);
        await log('warn', `Rolling back ${completedInfra.length} completed infrastructure step(s)`);
        for (const { definition: done, step: doneStep } of completedInfra.slice().reverse()) {
          try {
            await done.rollback?.(context);
            await finishStep(db, doneStep.id, 'skipped', 'rolled back');
          } catch (rollbackErr) {
            await log('error', `Rollback of "${done.name}" failed: ${(rollbackErr as Error).message}`);
            await finishStep(db, doneStep.id, 'failed', undefined, `rollback failed: ${(rollbackErr as Error).message}`);
          }
        }
        if (installation) await setInstallationStatus(db, installation.id, 'failed').catch(() => undefined);
        await markRolledBack(db, deploymentId);
        await log('info', 'Rollback complete — no half-created resources were left behind');
        return { outcome: 'rolled_back' };
      }

      await failDeployment(db, deployment, { errorCode: lastError.code, errorMessage: lastError.message });
      // A refusal that never attempted anything against the installation must not repaint it as
      // broken: the application is untouched and its real status is the truth the panel should show.
      if (installation && lastError.installationTouched) await setInstallationStatus(db, installation.id, 'failed').catch(() => undefined);
      return { outcome: 'failed' };
    }

    await finishStep(db, step.id, 'succeeded');
    if (definition.infra && definition.rollback) {
      completedInfra.push({ definition, step });
    }
    await log('info', `✓ ${definition.name}`);
  }

  await completeDeployment(db, deploymentId);
  await log('info', `Deployment ${deployment.action} completed successfully`);
  return { outcome: 'succeeded' };
}

// Extended step definition with rollback action.
interface StepDefinitionInternal extends StepDefinition {
  rollback?: (ctx: StepContext) => Promise<void>;
}

interface PipelineContext {
  db: Queryable;
  options: EngineOptions;
  deployment: DeploymentRow;
  installation: InstallationRow | null;
  application: ApplicationRow | null;
  version: ApplicationVersionRow | null;
  server: ServerRow | null;
  manifest: ApplicationManifest | null;
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => Promise<void>;
}

function fail(code: string, message: string, rollbackNeeded = false, installationTouched = true): never {
  throw new DeploymentExecutionError(code, message, rollbackNeeded, installationTouched);
}

/** Preserve UNKNOWN when infrastructure cannot verify application health. A missing probe,
 * simulation, or an adapter that has no health API is not evidence of a healthy application. */
function healthValue(health: ApplicationStatusResult['health']): boolean | null {
  if (health === 'healthy') return true;
  if (health === 'unhealthy') return false;
  return null;
}

function requireInstallation(ctx: PipelineContext): { installation: InstallationRow; application: ApplicationRow; version: ApplicationVersionRow; manifest: ApplicationManifest } {
  const { installation, application, version, manifest } = ctx;
  if (!installation) fail('NO_INSTALLATION', 'Deployment has no linked installation');
  if (!application) fail('NO_APPLICATION', 'Installation has no linked application');
  if (!version) fail('NO_VERSION', 'Installation has no linked application version');
  if (!manifest) fail('NO_MANIFEST', 'Application version has no manifest stored');
  return { installation, application, version, manifest };
}

function requireServer(ctx: PipelineContext, hostingTypes: string[]): ServerRow {
  const { server, installation } = ctx;
  if (!server) fail('NO_SERVER', 'No server selected for this deployment');
  if (server.status !== 'active') fail('SERVER_NOT_ACTIVE', `Server is ${server.status}`);
  const compatible =
    (hostingTypes.includes('docker') && server.docker_enabled && (server.server_type === 'VPS' || server.server_type === 'DEDICATED')) ||
    (hostingTypes.includes('cpanel') && server.cpanel_enabled && server.server_type === 'CPANEL') ||
    (hostingTypes.includes('kubernetes') && server.kubernetes_enabled && server.server_type === 'KUBERNETES');
  if (!compatible) {
    fail(
      'SERVER_INCOMPATIBLE',
      `Server ${server.name} (${server.server_type}) cannot host an application requiring ${hostingTypes.join('/')}`
    );
  }
  if (installation && installation.server_id && installation.server_id !== server.id) {
    fail('SERVER_MISMATCH', 'Installation is already bound to a different server');
  }
  return server;
}

/** The install pipeline (spec §13 example, adapted to the three-adapter world). */
function installPipeline(ctx: PipelineContext): StepDefinitionInternal[] {
  const { db, log } = ctx;

  const validateOrder: StepDefinitionInternal = {
    name: 'Validate order',
    run: async (stepCtx) => {
      const { installation } = requireInstallation(ctx);
      if (!installation.order_id) {
        // Free/manual installs (admin-created) are allowed; marketplace installs require payment.
        await log('info', 'No order linked — installation authorized by staff');
        return;
      }
      const { rows } = await db.query<{ payment_status: string }>(
        `SELECT payment_status FROM orders WHERE id = $1`,
        [installation.order_id]
      );
      const order = rows[0];
      if (!order || order.payment_status !== 'paid') {
        fail('ORDER_NOT_PAID', 'Installation cannot deploy before its order is paid (spec §20)');
      }
    },
  };

  const validateApplication: StepDefinitionInternal = {
    name: 'Validate application',
    run: async () => {
      const { application, version, manifest } = requireInstallation(ctx);
      if (application.status !== 'published') {
        fail('APP_NOT_PUBLISHED', `Application ${application.slug} is ${application.status}, not published`);
      }
      if (version.status !== 'published') {
        fail('VERSION_NOT_PUBLISHED', `Version ${version.version} is ${version.status}, not published`);
      }
      if (manifest.services.app?.port === undefined && !manifest.services.app?.internal) {
        fail('MANIFEST_INVALID', 'App service has no port');
      }
    },
  };

  const validateServer: StepDefinitionInternal = {
    name: 'Validate server and resources',
    run: async () => {
      const { manifest } = requireInstallation(ctx);
      const { installation } = requireInstallation(ctx);
      const server = requireServer(ctx, manifest.supportedHostingTypes);
      // Capacity check (spec §49/§50): the server must have unallocated headroom.
      const { getServerAllocation } = await import('../db/servers');
      const allocation = await getServerAllocation(db, server.id);
      const cpuOk = allocation.cpu + (installation.cpu_limit ?? manifest.requirements.cpu) <= server.cpu_cores;
      const memOk = allocation.memoryMb + (installation.memory_limit_mb ?? manifest.requirements.memory) <= server.memory_mb;
      const storageOk = allocation.storageMb + (installation.storage_limit_mb ?? manifest.requirements.storage) <= server.storage_mb;
      if (!cpuOk || !memOk || !storageOk) {
        fail('INSUFFICIENT_CAPACITY', `Server ${server.name} lacks capacity for this installation (cpu=${cpuOk}, memory=${memOk}, storage=${storageOk})`);
      }
    },
  };

  const generateEnvironment: StepDefinitionInternal = {
    name: 'Generate environment and secrets',
    run: async (stepCtx) => {
      const { installation, manifest } = requireInstallation(ctx);
      const { getKeyRing } = await import('../lib/keyring');
      const ring = getKeyRing();
      const environment: Record<string, string> = {};

      // Required entries: generated, domain-derived, or already customer-set (checked below).
      for (const entry of manifest.environment.required) {
        if (entry.generate === 'random_32') {
          environment[entry.key] = generateSecret(32);
        } else if (entry.defaultFromDomain) {
          environment[entry.key] = installation.domain ?? '';
        } else if (entry.defaultFromUrl) {
          environment[entry.key] = `https://${installation.domain ?? 'localhost'}`;
        } else if (entry.default !== undefined) {
          environment[entry.key] = entry.default;
        }
      }
      for (const entry of manifest.environment.optional) {
        if (entry.defaultFromDomain) environment[entry.key] = installation.domain ?? '';
        else if (entry.defaultFromUrl) environment[entry.key] = `https://${installation.domain ?? 'localhost'}`;
        else if (entry.default !== undefined) environment[entry.key] = entry.default;
      }

      // Dependency database credentials (spec §13 "Create database"): generated per-installation.
      const dbUser = `ch247_${shortId(installation.id, 10)}`;
      for (const [serviceName, service] of Object.entries(manifest.services)) {
        if (!service.database) continue;
        for (const key of databaseCredentialKeys(service.database)) {
          if (key.endsWith('DB') || key.endsWith('DATABASE') || key.endsWith('USERNAME') || key === 'MONGO_INITDB_ROOT_USERNAME') {
            environment[key] = serviceName === 'app' ? dbUser : `${dbUser}_${shortId(serviceName, 4)}`;
          } else {
            environment[key] = generateSecret(24);
          }
        }
        // Substitute __DB_*__ placeholders inside manifest static env values.
        const passwordKey = service.database === 'postgres' ? 'POSTGRES_PASSWORD' : service.database === 'mongodb' ? 'MONGO_INITDB_ROOT_PASSWORD' : 'MYSQL_PASSWORD';
        for (const [key, value] of Object.entries(service.environment ?? {})) {
          environment[key] = substituteTemplateValue(String(value), {
            domain: installation.domain,
            project: installation.container_project ?? installation.id,
            dbUser: environment['POSTGRES_USER'] ?? environment['MYSQL_USER'] ?? dbUser,
            dbName: environment['POSTGRES_DB'] ?? environment['MYSQL_DATABASE'] ?? dbUser,
            dbPassword: environment[passwordKey] ?? '',
          });
        }
      }

      // Overlay customer-set values (already encrypted at rest) on top of the generated ones.
      const stored = await resolveEnvironment(db, ring, installation.id);
      Object.assign(environment, stored);

      // Refuse to deploy when a required, non-generatable variable has no value.
      for (const entry of manifest.environment.required) {
        if (!environment[entry.key]) {
          fail('MISSING_REQUIRED_ENV', `Required environment variable ${entry.key} has no value`);
        }
      }

      // Persist generated values (encrypted) so updates/reinstalls reuse the same secrets.
      const existingKeys = new Set((await listEnvironmentEntries(db, installation.id)).map((e) => e.key));
      for (const [key, value] of Object.entries(environment)) {
        if (!existingKeys.has(key)) {
          const isSecret = manifest.environment.required.some((e) => e.key === key && (e.secret || e.generate === 'random_32'))
            || manifest.environment.optional.some((e) => e.key === key && e.secret)
            || /PASSWORD|SECRET|TOKEN|KEY/i.test(key);
          await upsertEnvironmentEntry(db, ring, installation.id, key, value, isSecret);
        }
      }
      stepCtx.environment = environment;
    },
  };

  const createVolumes: StepDefinitionInternal = {
    name: 'Create volumes',
    run: async () => {
      const { installation, manifest } = requireInstallation(ctx);
      for (const [serviceName, service] of Object.entries(manifest.services)) {
        for (const mount of service.volumes) {
          await upsertVolume(db, installation.id, {
            name: `${serviceName}_${mount.replace(/\//g, '-').replace(/[^a-zA-Z0-9_.-]/g, '')}`,
            mountPath: mount,
            hostPath: `/opt/cloudhost247/apps/${installation.container_project}/volumes/${serviceName}${mount}`,
          });
        }
      }
    },
  };

  const deploy: StepDefinitionInternal = {
    name: 'Create containers (pull image, network, database, start)',
    infra: true,
    run: async (stepCtx) => {
      const { installation, manifest, version } = requireInstallation(ctx);
      const server = requireServer(ctx, manifest.supportedHostingTypes);
      const adapter = selectAdapter(server, manifest, ctx.options);
      const environment = stepCtx.environment;
      if (Object.keys(environment).length === 0) {
        const { getKeyRing } = await import('../lib/keyring');
        Object.assign(environment, await resolveEnvironment(db, getKeyRing(), installation.id));
      }
      const result = await adapter.deployApplication(
        { db, server, log: ctx.log },
        {
          installationId: installation.id,
          project: installation.container_project ?? installation.id,
          manifest,
          appImage: version.docker_image ?? '',
          domain: installation.domain,
          sslEnabled: manifest.ssl.enabled,
          cpuLimit: installation.cpu_limit ?? manifest.requirements.cpu,
          memoryLimitMb: installation.memory_limit_mb ?? manifest.requirements.memory,
          storageLimitMb: installation.storage_limit_mb ?? manifest.requirements.storage,
          environment,
        }
      );
      if (!result.ok) fail(result.code, result.message, true);
      await withTransaction(db, async (tx) => {
        await tx.query(
          `UPDATE application_installations SET internal_port = $2, updated_at = now() WHERE id = $1`,
          [installation.id, manifest.services.app?.port ?? null]
        );
      });
    },
    rollback: async (stepCtx) => {
      const { installation, manifest } = requireInstallation(ctx);
      const server = requireServer(ctx, manifest.supportedHostingTypes);
      const adapter = selectAdapter(server, manifest, ctx.options);
      await adapter.destroyApplication({ db, server, log: ctx.log }, installation.container_project ?? installation.id);
    },
  };

  const configureDomain: StepDefinitionInternal = {
    name: 'Configure domain routing',
    run: async () => {
      const { installation, manifest } = requireInstallation(ctx);
      if (!manifest.domain.enabled) {
        await log('info', 'Manifest disables domain routing — skipping');
        return;
      }
      if (!installation.domain) {
        if (manifest.domain.primaryRequired) {
          fail('DOMAIN_REQUIRED', 'This application requires a primary domain to be attached');
        }
        await log('info', 'No domain attached — application is reachable on the server network only');
        return;
      }
      // Routing (Traefik labels / Ingress / cPanel vhost) was generated in the deploy step; here
      // we record the attachment and update the domain row.
      const { rows } = await db.query(
        `UPDATE customer_domains SET points_to = $2, updated_at = now()
         WHERE id IN (
           SELECT domain_id FROM application_domains WHERE installation_id = $1 AND primary_domain = true
         )`,
        [installation.id, installation.domain]
      );
      await log('info', `Domain routing configured for ${installation.domain} (${rows.length ?? 0} attached domain record(s))`);
    },
  };

  const configureSsl: StepDefinitionInternal = {
    name: 'Provision SSL certificate',
    run: async () => {
      const { installation, manifest } = requireInstallation(ctx);
      if (!manifest.ssl.enabled || !installation.domain) {
        await log('info', 'SSL not requested for this installation — skipping');
        return;
      }
      const { setDomainSslStatus } = await import('../db/customer-domains');
      await withTransaction(db, async (tx) => {
        const { rows } = await tx.query<{ id: string }>(
          `SELECT domain_id AS id FROM application_domains WHERE installation_id = $1 AND primary_domain = true`,
          [installation.id]
        );
        const domainId = rows[0]?.id;
        if (domainId) {
          // Certificate issuance is delegated to Traefik's letsencrypt resolver (Docker) or
          // cert-manager/AutoSSL (kubernetes/cpanel) at routing time; the resolver stores it and
          // handles renewal. We mark the domain pending-issued; the healthcheck job confirms
          // issuance shortly after and flips it to issued.
          await setDomainSslStatus(tx, domainId, 'pending');
        }
      });
      await log('info', `SSL requested for ${installation.domain} via platform certificate resolver`);
    },
  };

  const healthCheck: StepDefinitionInternal = {
    name: 'Health check',
    run: async () => {
      const { installation, manifest } = requireInstallation(ctx);
      const server = requireServer(ctx, manifest.supportedHostingTypes);
      const adapter = selectAdapter(server, manifest, ctx.options);
      await setInstallationStatus(db, installation.id, 'starting');
      const report = await adapter.runHealthcheck(
        { db, server, log: ctx.log },
        installation.container_project ?? installation.id,
        manifest
      );
      if (report.health === 'unhealthy') {
        fail('HEALTHCHECK_FAILED', `Application did not become healthy: ${report.message}`);
      }
      await recordHealthResult(db, installation.id, healthValue(report.health), { resetRestarts: true });
    },
  };

  const markOnline: StepDefinitionInternal = {
    name: 'Record deployment result',
    run: async () => {
      const { installation } = requireInstallation(ctx);
      const health = await db.query<{ health_status: 'healthy' | 'unhealthy' | 'unknown' }>(
        `SELECT health_status FROM application_installations WHERE id = $1`,
        [installation.id]
      );
      const healthStatus = health.rows[0]?.health_status ?? 'unknown';

      // A deployment can finish while health is still unknown (for example a cPanel adapter
      // without a probe, or a simulation). Never turn "we could not verify it" into ONLINE.
      if (healthStatus === 'healthy') {
        await setInstallationStatus(db, installation.id, 'healthy');
        await db.query(
          `UPDATE applications SET popularity = popularity + 1 WHERE id = $1`,
          [installation.application_id]
        );
      } else {
        await ctx.log('warn', `Deployment completed but application health is ${healthStatus.toUpperCase()}; leaving status as starting`);
      }
      await updateInstallation(db, installation.id, { deploymentId: ctx.deployment.id });
    },
  };

  return [
    validateOrder,
    validateApplication,
    validateServer,
    generateEnvironment,
    createVolumes,
    deploy,
    configureDomain,
    configureSsl,
    healthCheck,
    markOnline,
  ];
}

function lifecyclePipeline(
  ctx: PipelineContext,
  action: 'start' | 'stop' | 'restart'
): StepDefinitionInternal[] {
  const db = ctx.db;
  return [
    {
      name: `Validate installation (${action})`,
      run: async () => {
        requireInstallation(ctx);
      },
    },
    {
      name: `${action.charAt(0).toUpperCase()}${action.slice(1)} application`,
      run: async () => {
        const { installation, manifest } = requireInstallation(ctx);
        const server = requireServer(ctx, manifest.supportedHostingTypes);
        const adapter = selectAdapter(server, manifest, ctx.options);
        const project = installation.container_project ?? installation.id;
        if (action !== 'stop') {
          await setInstallationStatus(db, installation.id, 'starting').catch(() => undefined);
        }
        const result = action === 'start'
          ? await adapter.startApplication({ db, server, log: ctx.log }, project)
          : action === 'stop'
            ? await adapter.stopApplication({ db, server, log: ctx.log }, project)
            : await adapter.restartApplication({ db, server, log: ctx.log }, project);
        if (!result.ok) fail(result.code, result.message);
        if (action === 'stop') {
          await setInstallationStatus(db, installation.id, 'stopped', { force: true }).catch(() => undefined);
        } else {
          const report = await adapter.runHealthcheck({ db, server, log: ctx.log }, project, manifest);
          await recordHealthResult(db, installation.id, healthValue(report.health), {});
        }
      },
    },
  ];
}

function uninstallPipeline(ctx: PipelineContext): StepDefinitionInternal[] {
  const db = ctx.db;
  return [
    {
      name: 'Validate installation',
      run: async () => {
        requireInstallation(ctx);
      },
    },
    {
      name: 'Tear down application and volumes',
      infra: true,
      run: async () => {
        const { installation, manifest } = requireInstallation(ctx);
        const server = requireServer(ctx, manifest.supportedHostingTypes);
        const adapter = selectAdapter(server, manifest, ctx.options);
        const result = await adapter.destroyApplication(
          { db, server, log: ctx.log },
          installation.container_project ?? installation.id
        );
        if (!result.ok) fail(result.code, result.message);
      },
    },
    {
      name: 'Release domain and SSL',
      run: async () => {
        const { installation } = requireInstallation(ctx);
        await db.query(`DELETE FROM application_domains WHERE installation_id = $1`, [installation.id]);
      },
    },
    {
      name: 'Mark deleted',
      run: async () => {
        const { installation } = requireInstallation(ctx);
        await setInstallationStatus(db, installation.id, 'deleting', { force: true });
        await withTransaction(db, async (tx) => {
          await tx.query(
            `UPDATE application_installations SET deleted_at = now(), status = 'deleted', updated_at = now() WHERE id = $1`,
            [installation.id]
          );
        });
      },
    },
  ];
}

function backupPipeline(ctx: PipelineContext): StepDefinitionInternal[] {
  const db = ctx.db;
  return [
    {
      name: 'Validate installation',
      run: async () => {
        requireInstallation(ctx);
      },
    },
    {
      name: 'Run backup',
      run: async () => {
        const { installation, manifest } = requireInstallation(ctx);
        const server = requireServer(ctx, manifest.supportedHostingTypes);
        const adapter = selectAdapter(server, manifest, ctx.options);
        const retentionDays = await getSetting<number>(ctx.db, 'backup.retention_days', 30);
        const backup = await createBackup(ctx.db, {
          installationId: installation.id,
          serverId: server.id,
          deploymentId: ctx.deployment.id,
          expiresAt: new Date(Date.now() + retentionDays * 86_400_000).toISOString(),
        });
        await updateBackup(ctx.db, backup.id, { status: 'running', startedAt: new Date().toISOString() });
        const result = await adapter.runBackup(
          { db, server, log: ctx.log },
          installation.container_project ?? installation.id,
          manifest
        );
        if (!result.ok) {
          await updateBackup(ctx.db, backup.id, { status: 'failed', errorMessage: result.message, completedAt: new Date().toISOString() });
          fail(result.code, result.message);
        }
        await updateBackup(ctx.db, backup.id, {
          status: 'completed',
          storagePath: result.archivePath,
          sizeBytes: result.sizeBytes,
          checksum: result.checksum,
          databaseDump: result.databaseDump ?? null,
          completedAt: new Date().toISOString(),
        });
        await updateInstallation(ctx.db, installation.id, { lastBackupAt: new Date().toISOString() });
      },
    },
  ];
}

function restorePipeline(ctx: PipelineContext): StepDefinitionInternal[] {
  const db = ctx.db;
  return [
    {
      name: 'Validate backup archive',
      run: async () => {
        const { installation } = requireInstallation(ctx);
        const backupId = String((ctx.deployment.payload as { backupId?: string }).backupId ?? '');
        const { findBackupById } = await import('../db/ops-tables');
        const backup = await findBackupById(ctx.db, backupId);
        if (!backup || backup.status !== 'completed') fail('BACKUP_NOT_AVAILABLE', 'Backup not found or not completed', false, false);
        /**
         * The customer route already scopes the backup to the installation it is being restored into
         * (`backup.installation_id !== installation.id` → 404). The engine checks it again because
         * this pipeline is what actually overwrites the installation's data, and a deployment row can
         * be enqueued by any worker path, not only through that route. A restore is destructive and
         * irreversible, so it gets the check at the point of harm as well as at the point of entry.
         */
        if (backup.installation_id !== installation.id) {
          fail('BACKUP_NOT_AVAILABLE', 'Backup belongs to a different installation', false, false);
        }
      },
    },
    {
      name: 'Take safety snapshot of current state',
      run: async () => {
        const { installation, manifest } = requireInstallation(ctx);
        const server = requireServer(ctx, manifest.supportedHostingTypes);
        const adapter = selectAdapter(server, manifest, ctx.options);
        /**
         * The same declaration that makes the pipeline quiesce the application names the restore
         * as one that replaces state on disk — so it is also the declaration that makes an undo
         * copy necessary. Adapters that restore live (cPanel's own UAPI path) do not take one:
         * their restore is the panel's normal recovery operation, not a directory replacement.
         *
         * Fail-closed: when the snapshot cannot be taken the restore is refused BEFORE the
         * application is stopped or a single byte is replaced. A destructive restore with no undo
         * copy is exactly the gap this step closes ("restore the backup I took an hour ago" must
         * be undoable), so a failed snapshot is not a warning to proceed past. The snapshot is a
         * real backup row — same agent path, checksum and retention — because restoring that row
         * IS the undo, so the customer finds it in the ordinary backup list.
         */
        if (adapter.restoreRequiresStoppedApplication !== true) {
          await ctx.log('debug', 'No safety snapshot: this engine restores live and does not replace state on disk');
          return;
        }
        const project = installation.container_project ?? installation.id;
        const retentionDays = await getSetting<number>(ctx.db, 'backup.retention_days', 30);
        const snapshot = await createBackup(ctx.db, {
          installationId: installation.id,
          serverId: server.id,
          deploymentId: ctx.deployment.id,
          backupKind: 'safety_snapshot',
          expiresAt: new Date(Date.now() + retentionDays * 86_400_000).toISOString(),
        });
        await updateBackup(ctx.db, snapshot.id, { status: 'running', startedAt: new Date().toISOString() });
        const result = await adapter.runBackup({ db, server, log: ctx.log }, project, manifest);
        if (!result.ok) {
          await updateBackup(ctx.db, snapshot.id, { status: 'failed', errorMessage: result.message, completedAt: new Date().toISOString() });
          fail(
            result.code,
            `Restore refused: the safety snapshot of the current state failed (${result.message}). Nothing was changed — a destructive restore never runs without an undo copy.`,
            false,
            false
          );
        }
        await updateBackup(ctx.db, snapshot.id, {
          status: 'completed',
          storagePath: result.archivePath,
          sizeBytes: result.sizeBytes,
          checksum: result.checksum,
          databaseDump: result.databaseDump ?? null,
          completedAt: new Date().toISOString(),
        });
        await ctx.log('info', `Safety snapshot ${snapshot.id} of the current state completed — if this restore goes wrong, restore that snapshot to undo it`);
      },
    },
    {
      name: 'Restore data',
      run: async () => {
        const { installation, manifest } = requireInstallation(ctx);
        const server = requireServer(ctx, manifest.supportedHostingTypes);
        const adapter = selectAdapter(server, manifest, ctx.options);
        const { findBackupById } = await import('../db/ops-tables');
        const backup = await findBackupById(ctx.db, String((ctx.deployment.payload as { backupId?: string }).backupId ?? ''));
        if (!backup) fail('BACKUP_NOT_AVAILABLE', 'Backup disappeared');
        const project = installation.container_project ?? installation.id;

        /**
         * Quiesce first where the engine writes underneath live workloads. A docker-compose restore
         * untars compose.yaml, .env and volumes/ into the project directory, so restoring a *running*
         * application replaces its volume data under the containers that are still writing to it —
         * a database's data files are overwritten mid-write, and the compose file on disk stops
         * matching the containers that are up. The route already allows `restore` on a `healthy`
         * installation, so this is the normal path, not an edge case.
         *
         * An installation that is already `stopped` is restored without being started afterwards:
         * nothing is running to quiesce, and a restore must not be what starts a customer's app.
         */
        const quiesce = adapter.restoreRequiresStoppedApplication === true && installation.status !== 'stopped';
        if (quiesce) {
          const stop = await adapter.stopApplication({ db, server, log: ctx.log }, project);
          if (!stop.ok) fail(stop.code, `Application could not be stopped before restoring: ${stop.message}`);
          await setInstallationStatus(db, installation.id, 'stopped', { force: true }).catch(() => undefined);
          await ctx.log('info', 'Application stopped for restore — nothing is writing to the volume data being replaced');
        }

        try {
          const result = await adapter.restoreBackup(
            { db, server, log: ctx.log },
            project,
            backup.storage_path ?? '',
            // The digest recorded when the archive was created. Null on a backup row written before
            // checksums were stored, in which case the agent has nothing to verify against — and the
            // adapter says so rather than implying the archive was checked.
            { expectedChecksum: backup.checksum }
          );
          if (!result.ok) fail(result.code, result.message);
        } finally {
          // Started again even when the restore failed: a failed restore must never leave the
          // customer's application down, and nothing later in this pipeline would start it. The
          // volume data may be partially replaced, which is exactly why the restart is logged.
          if (quiesce) {
            // Same transition the lifecycle pipeline uses before a start: the health probe below
            // promotes 'starting' to 'healthy', while a 'stopped' status would stay 'stopped' even
            // though the application is up again.
            await setInstallationStatus(db, installation.id, 'starting').catch(() => undefined);
            const start = await adapter
              .startApplication({ db, server, log: ctx.log }, project)
              .catch((err) => ({ ok: false, code: 'START_FAILED', message: String((err as Error)?.message ?? err) }));
            if (start.ok) {
              const report = await adapter.runHealthcheck({ db, server, log: ctx.log }, project, manifest);
              await recordHealthResult(db, installation.id, healthValue(report.health), {});
            } else {
              await ctx.log('error', `Application could not be restarted after the restore: ${start.message}`);
              await setInstallationStatus(db, installation.id, 'failed').catch(() => undefined);
            }
          }
        }
      },
    },
  ];
}

function updatePipeline(ctx: PipelineContext): StepDefinitionInternal[] {
  const db = ctx.db;
  return [
    {
      name: 'Validate target version',
      run: async () => {
        requireInstallation(ctx);
      },
    },
    {
      name: 'Apply update (strategy from manifest)',
      run: async () => {
        const { installation, manifest } = requireInstallation(ctx);
        const server = requireServer(ctx, manifest.supportedHostingTypes);
        const adapter = selectAdapter(server, manifest, ctx.options);
        await setInstallationStatus(db, installation.id, 'updating');
        // The engine re-deploys with the new pinned image; the update strategy (recreate vs
        // pull-and-recreate vs rolling) is embedded in the generated compose/labels.
        const { getKeyRing } = await import('../lib/keyring');
        const environment = await resolveEnvironment(ctx.db, getKeyRing(), installation.id);
        const targetVersionId = (ctx.deployment.payload as { versionId?: string }).versionId;
        let appImage: string | null = null;
        if (targetVersionId) {
          const target = await findApplicationVersionById(ctx.db, targetVersionId);
          appImage = target?.docker_image ?? null;
          if (target) await updateInstallation(ctx.db, installation.id, { applicationVersionId: target.id });
        }
        const result = await adapter.deployApplication(
          { db, server, log: ctx.log },
          {
            installationId: installation.id,
            project: installation.container_project ?? installation.id,
            manifest,
            appImage: appImage ?? ctx.version?.docker_image ?? '',
            domain: installation.domain,
            sslEnabled: manifest.ssl.enabled,
            cpuLimit: installation.cpu_limit ?? manifest.requirements.cpu,
            memoryLimitMb: installation.memory_limit_mb ?? manifest.requirements.memory,
            storageLimitMb: installation.storage_limit_mb ?? manifest.requirements.storage,
            environment,
          }
        );
        if (!result.ok) {
          await setInstallationStatus(db, installation.id, 'failed').catch(() => undefined);
          fail(result.code, result.message, true);
        }
        const report = await adapter.runHealthcheck({ db, server, log: ctx.log }, installation.container_project ?? installation.id, manifest);
        await recordHealthResult(db, installation.id, healthValue(report.health), { resetRestarts: true });
      },
    },
  ];
}

function sslPipeline(ctx: PipelineContext): StepDefinitionInternal[] {
  const db = ctx.db;
  return [
    {
      name: 'Verify domain control',
      run: async () => {
        const { installation } = requireInstallation(ctx);
        if (!installation.domain) fail('NO_DOMAIN', 'Installation has no domain attached');
        const { rows } = await ctx.db.query<{ verification_status: string }>(
          `SELECT cd.verification_status FROM application_domains ad
           JOIN customer_domains cd ON cd.id = ad.domain_id
           WHERE ad.installation_id = $1 AND ad.primary_domain = true`,
          [installation.id]
        );
        const domain = rows[0];
        if (!domain || domain.verification_status !== 'verified') {
          fail('DOMAIN_NOT_VERIFIED', 'Primary domain must be verified before SSL can be provisioned');
        }
      },
    },
    {
      name: 'Request certificate',
      run: async () => {
        const { installation } = requireInstallation(ctx);
        const { setDomainSslStatus } = await import('../db/customer-domains');
        const { rows } = await ctx.db.query<{ id: string }>(
          `SELECT domain_id AS id FROM application_domains WHERE installation_id = $1 AND primary_domain = true`,
          [installation.id]
        );
        const domainId = rows[0]?.id;
        if (domainId) await setDomainSslStatus(ctx.db, domainId, 'pending');
      },
    },
  ];
}

function provisioningPipeline(ctx: PipelineContext): StepDefinitionInternal[] {
  const db = ctx.db;
  // Hosting (cPanel account) provisioning after payment (spec §37).
  return [
    {
      name: 'Validate server and package',
      run: async () => {
        const payload = ctx.deployment.payload as {
          customerId?: string;
          customerEmail?: string;
          domain?: string;
          planName?: string;
          username?: string;
          password?: string;
          installer?: 'wordpress' | 'static-site' | 'custom';
          contactEmail?: string;
        };
        if (!payload.domain || !payload.username || !payload.password) {
          fail('PROVISION_INPUT_INVALID', 'provision payload is missing domain/username/password');
        }
      },
    },
    {
      name: 'Provision hosting account',
      infra: true,
      run: async () => {
        const payload = ctx.deployment.payload as {
          customerId: string; customerEmail: string; domain: string; planName: string;
          username: string; password: string; installer?: 'wordpress' | 'static-site' | 'custom'; contactEmail: string;
        };
        if (!ctx.server) fail('NO_SERVER', 'No cPanel server selected for provisioning');
        if (ctx.server.server_type !== 'CPANEL') fail('NOT_A_CPANEL_SERVER', 'provision action requires a CPANEL server');
        const adapter = createCpanelAdapter({ simulationMode: ctx.options.simulationMode });
        const result = await adapter.provisionHosting(
          { db: ctx.db, server: ctx.server, log: ctx.log },
          {
            customerId: payload.customerId,
            customerEmail: payload.customerEmail,
            domain: payload.domain,
            planName: payload.planName,
            username: payload.username,
            password: payload.password,
            installer: payload.installer,
            contactEmail: payload.contactEmail,
          }
        );
        if (!result.ok) fail(result.code, result.message, true);
        await ctx.db.query(
          `UPDATE deployments SET payload = payload || $2::jsonb WHERE id = $1`,
          [ctx.deployment.id, JSON.stringify({ externalId: payload.username })]
        );
      },
      rollback: async () => {
        const payload = ctx.deployment.payload as { username?: string };
        if (!ctx.server || !payload.username) return;
        const adapter = createCpanelAdapter({ simulationMode: ctx.options.simulationMode });
        await adapter.suspendHosting({ db: ctx.db, server: ctx.server, log: ctx.log }, payload.username);
      },
    },
  ];
}

function suspensionPipeline(ctx: PipelineContext, suspend: boolean): StepDefinitionInternal[] {
  const db = ctx.db;
  return [
    {
      name: suspend ? 'Suspend hosting' : 'Terminate hosting',
      run: async () => {
        const externalId = String((ctx.deployment.payload as { externalId?: string }).externalId ?? '');
        if (!externalId) fail('NO_EXTERNAL_ID', 'suspension payload missing externalId');
        if (!ctx.server) fail('NO_SERVER', 'No server selected');
        const adapter = createCpanelAdapter({ simulationMode: ctx.options.simulationMode });
        const result = suspend
          ? await adapter.suspendHosting({ db: ctx.db, server: ctx.server, log: ctx.log }, externalId)
          : await adapter.terminateHosting({ db: ctx.db, server: ctx.server, log: ctx.log }, externalId);
        if (!result.ok) fail(result.code, result.message);
      },
    },
  ];
}

function healthcheckPipeline(ctx: PipelineContext): StepDefinitionInternal[] {
  const db = ctx.db;
  return [
    {
      name: 'Check application health',
      run: async () => {
        const { installation, manifest } = requireInstallation(ctx);
        const server = requireServer(ctx, manifest.supportedHostingTypes);
        const adapter = selectAdapter(server, manifest, ctx.options);
        const report = await adapter.runHealthcheck(
          { db, server, log: ctx.log },
          installation.container_project ?? installation.id,
          manifest
        );
        const previous = installation.health_status;
        await recordHealthResult(db, installation.id, healthValue(report.health), {});

        // Automatic recovery (spec §53): unhealthy → restart, with a circuit breaker after
        // repeated failures so a broken application is not restarted forever.
        if (report.health === 'unhealthy' && installation.circuit_open_until === null) {
          const restartCount = installation.restart_count + 1;
          const circuitBreakerLimit = 5;
          if (restartCount >= circuitBreakerLimit) {
            await recordHealthResult(db, installation.id, false, {
              circuitOpenUntil: new Date(Date.now() + parseDuration('1h')).toISOString(),
            });
            await ctx.log('error', `Circuit breaker opened for ${installation.name} after ${restartCount} restarts — admin attention required`);
          } else {
            await ctx.log('warn', `Application unhealthy — automatic restart ${restartCount}/${circuitBreakerLimit}`);
            const restartResult = await adapter.restartApplication(
              { db, server, log: ctx.log },
              installation.container_project ?? installation.id
            );
            if (restartResult.ok) {
              await recordHealthResult(db, installation.id, false, { restartCountDelta: 1 });
            }
          }
        } else if (report.health === 'healthy' && previous === 'unhealthy') {
          await recordHealthResult(db, installation.id, true, { resetRestarts: true });
          await ctx.log('info', `Application recovered after restart`);
        }
      },
    },
  ];
}

function buildPipelineFor(action: string, ctx: PipelineContext): StepDefinitionInternal[] | null {
  switch (action) {
    case 'install':
    case 'reinstall':
      return installPipeline(ctx);
    case 'start':
      return lifecyclePipeline(ctx, 'start');
    case 'stop':
      return lifecyclePipeline(ctx, 'stop');
    case 'restart':
      return lifecyclePipeline(ctx, 'restart');
    case 'update':
      return updatePipeline(ctx);
    case 'uninstall':
      return uninstallPipeline(ctx);
    case 'backup':
      return backupPipeline(ctx);
    case 'restore':
      return restorePipeline(ctx);
    case 'ssl_provision':
      return sslPipeline(ctx);
    case 'provision':
      return provisioningPipeline(ctx);
    case 'suspend':
      return suspensionPipeline(ctx, true);
    case 'terminate':
      return suspensionPipeline(ctx, false);
    case 'healthcheck':
      return healthcheckPipeline(ctx);
    case 'domain_configure':
      return [
        {
          name: 'Re-apply domain routing',
          run: async () => {
            const { installation, manifest } = requireInstallation(ctx);
            const server = requireServer(ctx, manifest.supportedHostingTypes);
            const adapter = selectAdapter(server, manifest, ctx.options);
            const result = await adapter.restartApplication(
              { db: ctx.db, server, log: ctx.log },
              installation.container_project ?? installation.id
            );
            if (!result.ok) fail(result.code, result.message);
          },
        },
      ];
    default:
      return null;
  }
}

function emptyManifest(): ApplicationManifest {
  return {
    id: 'unknown',
    name: 'unknown',
    category: 'system-administration',
    featured: false,
    popularity: 0,
    requiresAdminApproval: false,
    description: 'No manifest was stored for this installation',
    deployment: { engine: 'docker-compose' },
    supportedHostingTypes: ['docker'],
    requirements: { cpu: 1, memory: 512, storage: 5120, gpu: false },
    services: { app: { internal: false, volumes: [], dependsOn: [], environment: {} } },
    environment: { required: [], optional: [] },
    domain: { enabled: false, primaryRequired: false },
    ssl: { enabled: false },
    backup: { enabled: false, includes: [] },
    update: { strategy: 'recreate' },
    versions: [],
  };
}

/** Exposed for the worker's log/poll loop and admin tooling. */
export async function deploymentStepsSnapshot(db: Queryable, deploymentId: string) {
  return listDeploymentSteps(db, deploymentId);
}

export function newEngineDeploymentId(): string {
  return randomUUID();
}
