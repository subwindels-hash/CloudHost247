/**
 * Phase 6 — the deployment adapter contract (spec §1, §35).
 *
 * The engine never talks to infrastructure directly; it talks to an adapter. Exactly one adapter
 * is selected per deployment based on the server type + manifest engine (spec §38: "CloudHost247
 * should select the correct deployment backend based on the hosting product"):
 *
 *   docker adapter     → VPS/DEDICATED servers via the authenticated server agent
 *   cpanel adapter     → CPANEL servers via WHM (server level) + UAPI (account level)
 *   kubernetes adapter → KUBERNETES clusters (experimental, off by default — spec §39)
 *
 * Every operation reports success/failure with a machine-readable code; the engine records it on
 * the deployment + step rows and decides retry vs rollback (spec §14).
 */
import type { ApplicationManifest } from '../../marketplace/manifest-schema';
import type { Queryable } from '../../db/types';
import type { ServerRow } from '../../db/servers';

export interface AdapterContext {
  db: Queryable;
  server: ServerRow;
  /** Telemetry sink so adapter actions appear in the customer's deployment log (spec §24). */
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => Promise<void>;
}

export interface DeployInstallationInput {
  installationId: string;
  project: string;
  manifest: ApplicationManifest;
  appImage: string;
  domain: string | null;
  sslEnabled: boolean;
  cpuLimit: number;
  memoryLimitMb: number;
  storageLimitMb: number;
  /** Decrypted environment (secrets included) — adapter-local, never logged. */
  environment: Record<string, string>;
}

export interface DeploymentOperationResult {
  ok: boolean;
  /** Stable machine-readable code, e.g. AGENT_UNREACHABLE, IMAGE_PULL_FAILED. */
  code: string;
  message: string;
}

export interface ApplicationStatusResult extends DeploymentOperationResult {
  running: boolean;
  health: 'healthy' | 'unhealthy' | 'unknown';
  detail?: string;
}

export interface LogsResult extends DeploymentOperationResult {
  logs: string;
}

export interface BackupResult extends DeploymentOperationResult {
  archivePath: string | null;
  sizeBytes: number | null;
  checksum: string | null;
}

/** The complete adapter surface the engine can invoke. Adapters may be partial (cPanel deploys
 * hosting accounts, not containers) and throw UnsupportedOperationError where N/A. */
export interface DeploymentAdapter {
  readonly kind: 'docker' | 'cpanel' | 'kubernetes';

  /**
   * Whether `restoreBackup` writes underneath live workloads, so the restore pipeline has to stop the
   * application first and start it again afterwards.
   *
   * True for docker-compose: the agent untars `compose.yaml`, `.env` and `volumes/` straight into the
   * project directory, and if the containers are still running they keep writing to the very volume
   * files being replaced — a running database's data files are overwritten under it, and the compose
   * file on disk stops matching the containers that are up. cPanel restores a hosting account's home
   * directory through the panel's own UAPI, which is the account's normal (live) restore path, and
   * Kubernetes restores are refused outright, so neither sets this.
   *
   * Omitted means false. A restore into an already-`stopped` installation is never un-stopped by this.
   */
  readonly restoreRequiresStoppedApplication?: boolean;

  deployApplication(ctx: AdapterContext, input: DeployInstallationInput): Promise<DeploymentOperationResult>;
  destroyApplication(ctx: AdapterContext, project: string): Promise<DeploymentOperationResult>;
  startApplication(ctx: AdapterContext, project: string): Promise<DeploymentOperationResult>;
  stopApplication(ctx: AdapterContext, project: string): Promise<DeploymentOperationResult>;
  restartApplication(ctx: AdapterContext, project: string): Promise<DeploymentOperationResult>;
  applicationStatus(ctx: AdapterContext, project: string): Promise<ApplicationStatusResult>;
  applicationLogs(ctx: AdapterContext, project: string, tail?: number): Promise<LogsResult>;
  runHealthcheck(ctx: AdapterContext, project: string, manifest: ApplicationManifest): Promise<ApplicationStatusResult>;
  runBackup(ctx: AdapterContext, project: string, manifest: ApplicationManifest): Promise<BackupResult>;
  /**
   * `options.expectedChecksum` is the sha256 the platform recorded when the archive was created. It is
   * an integrity check against an archive damaged in storage (partial write, full disk at backup time,
   * bit rot, a truncated copy) — not authentication: the same agent computes the digest at backup time,
   * so an agent able to rewrite the archive could rewrite the digest with it. Engines that restore
   * through a provider's own archive handling (cPanel) have nothing to verify against and ignore it.
   */
  restoreBackup(
    ctx: AdapterContext,
    project: string,
    archivePath: string,
    options?: { expectedChecksum?: string | null }
  ): Promise<DeploymentOperationResult>;
  /** Platform-level hosting provisioning (cPanel account creation — spec §37); no-op elsewhere. */
  provisionHosting(ctx: AdapterContext, input: HostingProvisionInput): Promise<DeploymentOperationResult>;
  suspendHosting(ctx: AdapterContext, externalId: string): Promise<DeploymentOperationResult>;
  terminateHosting(ctx: AdapterContext, externalId: string): Promise<DeploymentOperationResult>;
}

export interface HostingProvisionInput {
  customerId: string;
  customerEmail: string;
  domain: string;
  planName: string;
  /** Username cPanel will create (admin-validated charset). */
  username: string;
  /** Random strong password generated by the platform, returned to the customer once. */
  password: string;
  /** Which installable to place (spec §38: WordPress on cPanel). */
  installer?: 'wordpress' | 'static-site' | 'custom';
  contactEmail: string;
}

export class UnsupportedOperationError extends Error {
  constructor(adapter: string, operation: string) {
    super(`${adapter} adapter does not support operation "${operation}"`);
    this.name = 'UnsupportedOperationError';
  }
}
