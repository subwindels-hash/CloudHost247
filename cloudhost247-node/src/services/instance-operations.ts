/**
 * Phase 6 — direct customer-facing instance operations that read live state (logs, status)
 * without going through the deployment queue (spec §45: "The customer should not need SSH
 * access for normal application management"). Reads only — every mutation goes through jobs.
 */
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import type { InstallationRow } from '../db/application-installations';
import { findApplicationVersionById } from '../db/applications';
import { findServerById } from '../db/servers';
import type { ApplicationManifest } from '../marketplace/manifest-schema';
import { selectAdapter, type EngineOptions } from '../deployments/engine';
import type { DeploymentOperationResult } from '../deployments/adapters/types';

function engineOptions(env: Env): EngineOptions {
  return {
    simulationMode: env.DEPLOYMENT_SIMULATION_MODE,
    kubernetesEnabled: env.KUBERNETES_ADAPTER_ENABLED,
  };
}

async function adapterFor(db: Queryable, env: Env, installation: InstallationRow) {
  const version = await findApplicationVersionById(db, installation.application_version_id);
  const server = installation.server_id ? await findServerById(db, installation.server_id) : null;
  if (!version || !server) return null;
  const manifest = version.manifest as ApplicationManifest;
  return {
    adapter: selectAdapter(server, manifest, engineOptions(env)),
    server,
    manifest,
  };
}

export async function applicationLogs(db: Queryable, env: Env, installation: InstallationRow, tail = 200) {
  const resolved = await adapterFor(db, env, installation);
  if (!resolved) {
    return { logs: '', available: false, message: 'Installation has no server or version bound yet' };
  }
  const result = await resolved.adapter.applicationLogs(
    { db, server: resolved.server, log: async () => undefined },
    installation.container_project ?? installation.id,
    tail
  );
  return { logs: result.logs, available: result.ok, message: result.message };
}

export async function applicationStatus(db: Queryable, env: Env, installation: InstallationRow): Promise<DeploymentOperationResult & { running: boolean }> {
  const resolved = await adapterFor(db, env, installation);
  if (!resolved) {
    return { ok: false, code: 'NOT_BOUND', message: 'Installation has no server or version bound yet', running: false };
  }
  const result = await resolved.adapter.applicationStatus(
    { db, server: resolved.server, log: async () => undefined },
    installation.container_project ?? installation.id
  );
  return { ...result, running: result.running };
}
