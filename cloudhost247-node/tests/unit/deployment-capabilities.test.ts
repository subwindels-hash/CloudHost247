import { describe, expect, it } from 'vitest';
import { loadManifestCatalog, validatedManifests } from '../../src/marketplace/manifest-loader';
import { deploymentCapabilities } from '../../src/deployments/capabilities';

const manifests = validatedManifests(loadManifestCatalog('manifests'));
const byId = (id: string) => {
  const manifest = manifests.find((entry) => entry.id === id);
  if (!manifest) throw new Error(`Test fixture manifest ${id} is missing`);
  return manifest;
};
const options = { kubernetesEnabled: true, simulationMode: false };
const target = (server_type: 'VPS' | 'DEDICATED' | 'CPANEL' | 'KUBERNETES' | 'SHARED') => ({
  server_type,
  status: 'active',
  docker_enabled: server_type === 'VPS' || server_type === 'DEDICATED',
  cpanel_enabled: server_type === 'CPANEL',
  kubernetes_enabled: server_type === 'KUBERNETES',
});

describe('deployment capability report', () => {
  it('reports Docker manifest health-check and lifecycle support without claiming execution', () => {
    const report = deploymentCapabilities(target('VPS'), byId('n8n'), options);
    expect(report).toMatchObject({
      engine: 'docker',
      simulationMode: false,
      operations: {
        install: { supported: true },
        verify: { supported: true, method: 'Manifest-declared HTTP health check through the server agent' },
        status: { supported: true },
        logs: { supported: true },
        start: { supported: true },
        stop: { supported: true },
        restart: { supported: true },
        update: { supported: true },
        backup: { supported: true },
        restore: { supported: true },
        uninstall: { supported: true },
      },
    });
  });

  it('reports cPanel-specific actions and refuses unsupported operations explicitly', () => {
    const report = deploymentCapabilities(target('CPANEL'), byId('wordpress'), options);
    expect(report.engine).toBe('cpanel');
    expect(report.operations.install.supported).toBe(true);
    expect(report.operations.start.method).toContain('Unsuspend');
    expect(report.operations.stop.method).toContain('Suspend');
    expect(report.operations.backup.supported).toBe(true);
    expect(report.operations.restore.supported).toBe(true);
    for (const operation of ['verify', 'logs', 'restart', 'update', 'reinstall'] as const) {
      expect(report.operations[operation].supported).toBe(false);
      expect(report.operations[operation].reason).toBeTruthy();
    }
    expect(deploymentCapabilities(target('CPANEL'), byId('n8n'), options).operations.install)
      .toMatchObject({ supported: false });
  });

  it('fails closed for disabled Kubernetes and multi-service manifests', () => {
    const multiService = deploymentCapabilities(
      target('KUBERNETES'),
      byId('n8n'),
      { kubernetesEnabled: false, simulationMode: false },
    );
    expect(multiService.operations.install.reason).toContain('KUBERNETES_ADAPTER_ENABLED');

    const enabledButIncomplete = deploymentCapabilities(
      target('KUBERNETES'),
      byId('wordpress'),
      options,
    );
    expect(enabledButIncomplete.operations.install.reason).toContain('multiple Compose services');
    expect(enabledButIncomplete.operations.update.supported).toBe(false);
    expect(enabledButIncomplete.operations.start.supported).toBe(true);
    expect(enabledButIncomplete.operations.verify.method).toContain('readiness');
    expect(enabledButIncomplete.operations.backup.supported).toBe(false);
  });

  it('fails closed when the manifest engine and declared hosting type do not fit the target', () => {
    const wordpress = byId('wordpress');
    const cpanelEngineManifest = {
      ...wordpress,
      deployment: { ...wordpress.deployment, engine: 'cpanel' as const },
    };
    const cpanelOnVps = deploymentCapabilities(
      { ...target('VPS'), cpanel_enabled: true },
      cpanelEngineManifest,
      options,
    );
    expect(cpanelOnVps.operations.install).toMatchObject({ supported: false });
    expect(cpanelOnVps.operations.install.reason).toContain('cannot run this manifest on a VPS target');

    const sharedTarget = { ...target('SHARED'), docker_enabled: true };
    const shared = deploymentCapabilities(sharedTarget, byId('n8n'), options);
    expect(shared.operations.install).toMatchObject({ supported: false });
    expect(shared.operations.install.reason).toContain('cannot run this manifest on a SHARED target');

    // Legacy vps/dedicated hosting labels must match the checks the worker will run.
    const vpsOnlyManifest = { ...byId('n8n'), supportedHostingTypes: ['vps'] as const };
    expect(deploymentCapabilities(target('VPS'), vpsOnlyManifest, options).operations.install.supported).toBe(true);
  });

  it('marks simulated mode separately from adapter support', () => {
    const report = deploymentCapabilities(target('VPS'), byId('wordpress'), {
      kubernetesEnabled: false,
      simulationMode: true,
    });
    expect(report.simulationMode).toBe(true);
    expect(report.operations.install.supported).toBe(true);
    expect(report.operations.verify.supported).toBe(true);
  });
});
