/**
 * Capability report for a specific application manifest and deployment target.
 *
 * This is the shared, fail-closed contract used by installation validation, mutation routes, and
 * the customer UI. "Supported" means this build has an adapter path for the operation; it does
 * not mean the target is connected, the provider accepted anything, or an install has succeeded.
 * Those facts come only from deployment and health-check results.
 */
import type { ServerRow } from '../db/servers';
import type { ApplicationManifest } from '../marketplace/manifest-schema';

export type DeploymentEngineKind = 'docker' | 'cpanel' | 'kubernetes';
export type InstallationOperation =
  | 'install'
  | 'verify'
  | 'status'
  | 'logs'
  | 'start'
  | 'stop'
  | 'restart'
  | 'update'
  | 'reinstall'
  | 'backup'
  | 'restore'
  | 'uninstall';

export interface OperationCapability {
  supported: boolean;
  reason: string | null;
  /** What the operation actually verifies or changes, when that differs by engine. */
  method?: string;
}

export interface DeploymentCapabilityReport {
  engine: DeploymentEngineKind;
  /** True means adapter calls in this process are intentionally simulated, not live. */
  simulationMode: boolean;
  operations: Record<InstallationOperation, OperationCapability>;
}

export interface DeploymentCapabilityOptions {
  kubernetesEnabled: boolean;
  simulationMode: boolean;
}

type DeploymentTarget = Pick<ServerRow, 'server_type' | 'status' | 'docker_enabled' | 'cpanel_enabled' | 'kubernetes_enabled'>;

const supported = (method?: string): OperationCapability => ({ supported: true, reason: null, ...(method ? { method } : {}) });
const unsupported = (reason: string): OperationCapability => ({ supported: false, reason });

export function resolveDeploymentEngine(server: DeploymentTarget | null, manifest: ApplicationManifest): DeploymentEngineKind {
  if (server?.server_type === 'CPANEL' || manifest.deployment.engine === 'cpanel') return 'cpanel';
  if (server?.server_type === 'KUBERNETES' || manifest.deployment.engine === 'kubernetes') return 'kubernetes';
  return 'docker';
}

/**
 * Returns operation support for a chosen engine. Explicitly excludes unsafe/incomplete paths:
 * cPanel update currently re-enters account creation, and the Kubernetes renderer currently
 * cannot faithfully map Compose dependency services, their environment, and their volumes.
 */
function targetSupportsManifestEngine(
  server: DeploymentTarget,
  manifest: ApplicationManifest,
  engine: DeploymentEngineKind
): boolean {
  const hostingTypes = manifest.supportedHostingTypes;
  if (engine === 'docker') {
    return (server.server_type === 'VPS' && (hostingTypes.includes('docker') || hostingTypes.includes('vps')))
      || (server.server_type === 'DEDICATED' && (hostingTypes.includes('docker') || hostingTypes.includes('dedicated')));
  }
  if (engine === 'cpanel') {
    return server.server_type === 'CPANEL' && hostingTypes.includes('cpanel');
  }
  return server.server_type === 'KUBERNETES' && hostingTypes.includes('kubernetes');
}

export function deploymentCapabilities(
  server: DeploymentTarget | null,
  manifest: ApplicationManifest,
  options: DeploymentCapabilityOptions
): DeploymentCapabilityReport {
  const engine = resolveDeploymentEngine(server, manifest);
  const serviceCount = Object.keys(manifest.services).length;
  const singleServiceManifest = serviceCount === 1 && Boolean(manifest.services.app);
  let operations: Record<InstallationOperation, OperationCapability>;

  if (engine === 'cpanel') {
    const isSupportedInstaller = manifest.deployment.cpanelInstaller === 'wordpress';
    const install = isSupportedInstaller
      ? supported('WHM account creation with the WordPress UAPI installer')
      : unsupported('The cPanel application installer is only implemented for WordPress; this manifest has no supported cPanel installer.');
    const backup = manifest.backup.enabled
      ? supported('cPanel full-account backup via WHM/UAPI')
      : unsupported('This manifest has backups disabled.');
    operations = {
      install,
      verify: unsupported('cPanel exposes account status, but no application-level health probe is implemented for this target.'),
      status: supported('WHM account existence and suspension state only; this is not application health.'),
      logs: unsupported('Per-application logs are not available through the current cPanel/WHM adapter.'),
      start: supported('Unsuspend the WHM account; this does not restart an individual application process.'),
      stop: supported('Suspend the WHM account; web, mail, and FTP access are blocked.'),
      restart: unsupported('WHM has no per-account application restart operation in this adapter.'),
      update: unsupported('Application updates are not implemented for cPanel; redeploying would risk recreating the account.'),
      reinstall: unsupported('Reinstall is not implemented for cPanel; account recreation is not used as a substitute.'),
      backup,
      restore: manifest.backup.enabled
        ? supported('Restore a completed cPanel backup from the account home directory')
        : unsupported('This manifest has backups disabled.'),
      uninstall: supported('Terminate the WHM account'),
    };
  } else if (engine === 'kubernetes') {
    const disabledReason = 'The Kubernetes adapter is disabled by KUBERNETES_ADAPTER_ENABLED.';
    const incompleteManifestReason = 'This manifest has multiple Compose services. The current Kubernetes renderer does not yet map dependency service environment, volume, and network semantics safely.';
    const enabled = options.kubernetesEnabled;
    const deploymentSupported = enabled && singleServiceManifest;
    const platformOperation = (method: string): OperationCapability => enabled
      ? supported(method)
      : unsupported(disabledReason);
    operations = {
      install: !enabled
        ? unsupported(disabledReason)
        : singleServiceManifest
          ? supported('Apply Kubernetes Secret, PVC, Deployment, Service, and optional Ingress')
          : unsupported(incompleteManifestReason),
      verify: platformOperation('Kubernetes Deployment/Pod readiness; this is not an application HTTP probe.'),
      status: platformOperation('Deployment replicas and Pod readiness'),
      logs: platformOperation('Read container logs from selected Pods'),
      start: platformOperation('Scale the Deployment back to its remembered replica count'),
      stop: platformOperation('Scale the Deployment to zero replicas'),
      restart: platformOperation('Roll the Deployment by updating its pod-template restart annotation'),
      update: !enabled
        ? unsupported(disabledReason)
        : deploymentSupported
          ? supported('Re-apply the manifest to the Kubernetes Deployment')
          : unsupported(incompleteManifestReason),
      reinstall: !enabled
        ? unsupported(disabledReason)
        : deploymentSupported
          ? supported('Re-apply the single-service Kubernetes manifest')
          : unsupported(incompleteManifestReason),
      backup: unsupported('Kubernetes backup/restore is not implemented: this adapter does not yet produce a retrievable, integrity-verifiable archive.'),
      restore: unsupported('Kubernetes backup/restore is not implemented: this adapter does not yet produce a retrievable, integrity-verifiable archive.'),
      uninstall: platformOperation('Delete CloudHost247-managed Kubernetes objects for this application'),
    };
  } else {
    const verification = manifest.healthcheck
      ? supported(manifest.healthcheck.type === 'http' ? 'Manifest-declared HTTP health check through the server agent' : 'Manifest-declared command health check through the server agent')
      : unsupported('No application health check is declared in this manifest. Container status may be visible, but application health remains unverified.');
    operations = {
      install: supported('Docker Compose deployment through the authenticated server agent'),
      verify: verification,
      status: supported('Docker container state and reported container health'),
      logs: supported('Read application container logs through the authenticated server agent'),
      start: supported('Start the isolated Docker Compose project'),
      stop: supported('Stop the isolated Docker Compose project'),
      restart: supported('Restart the isolated Docker Compose project'),
      update: supported('Apply a published manifest version using its declared update strategy'),
      reinstall: supported('Recreate the isolated Docker Compose project from its saved manifest and environment'),
      backup: manifest.backup.enabled
        ? supported('Create an agent-produced archive using the manifest backup inclusions')
        : unsupported('This manifest has backups disabled.'),
      restore: manifest.backup.enabled
        ? supported('Restore a completed archive and verify its recorded checksum when available')
        : unsupported('This manifest has backups disabled.'),
      uninstall: supported('Remove the isolated Docker Compose project and its managed volumes'),
    };
  }

  const serverAdapterEnabled = engine === 'docker'
    ? server?.docker_enabled
    : engine === 'cpanel'
      ? server?.cpanel_enabled
      : server?.kubernetes_enabled;
  const targetUnavailableReason = !server
    ? 'No server is assigned to this installation, so a deployment operation cannot be dispatched.'
    : server.status !== 'active'
      ? `The assigned server is ${server.status}; operations require an active server.`
      : !targetSupportsManifestEngine(server, manifest, engine)
        ? `The ${engine} adapter cannot run this manifest on a ${server.server_type} target with its declared supported hosting types (${manifest.supportedHostingTypes.join(', ')}).`
        : serverAdapterEnabled !== true
          ? `The ${engine} adapter is not enabled on the assigned server.`
          : null;
  if (targetUnavailableReason) {
    for (const operation of Object.keys(operations) as InstallationOperation[]) {
      if (operations[operation].supported) operations[operation] = unsupported(targetUnavailableReason);
    }
  }

  return { engine, simulationMode: options.simulationMode, operations };
}
