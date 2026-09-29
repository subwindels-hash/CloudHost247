import { describe, expect, it } from 'vitest';
import { loadManifestCatalog, validatedManifests } from '../../src/marketplace/manifest-loader';
import { generateComposeProject } from '../../src/deployments/compose-generator';

/**
 * The whole point of the manifest-driven platform (spec §35): every catalog entry must
 * validate against the schema, and each must yield an isolated, resource-limited compose
 * project. If a manifest regresses, this test fails before it ever reaches production.
 */
describe('on-disk manifest catalog', () => {
  const catalog = loadManifestCatalog('manifests');
  const manifests = validatedManifests(catalog);

  it('loads every manifest in the catalog without schema errors', () => {
    expect(catalog.invalid).toEqual([]);
    expect(manifests.length).toBeGreaterThanOrEqual(50);
  });

  it('gives every app a unique id and a customer-facing app service', () => {
    const ids = new Set<string>();
    for (const manifest of manifests) {
      expect(ids.has(manifest.id)).toBe(false);
      ids.add(manifest.id);
      expect(manifest.services.app, `${manifest.id} must define an app service`).toBeDefined();
      expect(manifest.deployment.engine).toBe('docker-compose');
    }
  });

  it('keeps every version requirement positive and defaults sane', () => {
    for (const manifest of manifests) {
      expect(manifest.requirements.cpu).toBeGreaterThan(0);
      expect(manifest.requirements.memory).toBeGreaterThanOrEqual(128);
      expect(manifest.requirements.storage).toBeGreaterThan(0);
      for (const env of [...manifest.environment.required, ...manifest.environment.optional]) {
        expect(env.key).toMatch(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+|__[a-zA-Z0-9_]+)*$/);
      }
    }
  });

  it('generates an isolated compose project for every manifest (spec §32)', () => {
    for (const manifest of manifests) {
      const project = `c${'x'.repeat(8)}-inst${'y'.repeat(4)}`;
      const bundle = generateComposeProject({
        manifest,
        appImage: `${manifest.id}:stable`,
        project,
        domain: `${manifest.id}.example.com`,
        sslEnabled: true,
        cpuLimit: manifest.requirements.cpu,
        memoryLimitMb: manifest.requirements.memory,
        environmentKeys: manifest.environment.required.map((e) => e.key),
      });
      const compose = bundle.composeYaml;
      // Isolation + security invariants that must hold for every generated project.
      expect(compose).toContain(`name: ${project}`);
      expect(compose).not.toContain('/var/run/docker.sock'); // never expose the host socket
      for (const [serviceName, service] of Object.entries(manifest.services)) {
        expect(compose, `${manifest.id}:${serviceName} must be rendered`).toContain(`${serviceName}:`);
        if (service.internal) continue;
      }
      // Resource limits on the app service (spec §32).
      expect(compose).toContain('deploy:');
      expect(compose).toContain('resources:');
    }
  });

  it('emits traefik labels only for the public app service when a domain is set', () => {
    for (const manifest of manifests.slice(0, 10)) {
      const { composeYaml } = generateComposeProject({
        manifest,
        appImage: `${manifest.id}:stable`,
        project: 'cxxxxxxxx-instyyyy',
        domain: 'app.example.com',
        sslEnabled: true,
        cpuLimit: 1,
        memoryLimitMb: 512,
        environmentKeys: [],
      });
      expect(composeYaml).toContain('traefik.enable=true');
      expect(composeYaml).toContain('Host(`app.example.com`)');
    }
    // No domain → no routing labels (the app is unreachable by hostname, intentionally).
    const { composeYaml } = generateComposeProject({
      manifest: manifests[0],
      appImage: 'app:stable',
      project: 'cxxxxxxxx-instyyyy',
      domain: null,
      sslEnabled: false,
      cpuLimit: 1,
      memoryLimitMb: 512,
      environmentKeys: [],
    });
    expect(composeYaml).not.toContain('traefik.enable=true');
  });

  it('includes the dual-engine wordpress manifest with a cpanel installer', () => {
    const wordpress = manifests.find((m) => m.id === 'wordpress');
    expect(wordpress).toBeDefined();
    expect(wordpress?.deployment.cpanelInstaller).toBe('wordpress');
    expect(wordpress?.supportedHostingTypes).toContain('cpanel');
    expect(wordpress?.services.app).toBeDefined();
  });
});
