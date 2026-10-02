import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContaboProviderAdapter } from '../../src/infrastructure/providers/contabo-adapter';
import { MockProviderAdapter, resetMockProviderState } from '../../src/infrastructure/providers/mock-adapter';
import { OvhProviderAdapter } from '../../src/infrastructure/providers/ovh-adapter';
import { ADAPTER_PROFILES } from '../../src/infrastructure/providers/configuration';
import type { InfrastructureProviderRow } from '../../src/db/infrastructure-providers';

/**
 * A6 — rescue mode. Only providers whose API genuinely offers a rescue system may implement it:
 * Hetzner (`enable_rescue`), OpenStack (Nova `rescue`/`unrescue`), OVH Public Cloud
 * (`POST .../rescueMode` plus the instance's `rescuePassword`) and Contabo (`POST
 * .../actions/rescue` with Contabo secret ids). This suite pins the call shapes and the
 * one-time-credential rules those providers imply.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  resetMockProviderState();
});

function providerRow(adapter: string, apiBaseUrl: string | null): InfrastructureProviderRow {
  return {
    id: `provider-${adapter}`, name: adapter, slug: adapter, provider_type: adapter.toUpperCase(),
    adapter, status: 'ACTIVE', api_base_url: apiBaseUrl, credential_env_prefix: null, capabilities: {},
    metadata: {}, last_health_check_at: null, last_health_status: null, created_at: '', updated_at: '',
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('rescue mode is implemented only where the provider API offers it', () => {
  it('advertises rescue exactly for the providers that implement it', () => {
    const withRescue = Object.values(ADAPTER_PROFILES)
      .filter((profile) => profile.capabilities.rescue)
      .map((profile) => profile.kind)
      .sort();
    expect(withRescue).toEqual(['contabo', 'hetzner', 'mock', 'openstack', 'ovh']);
  });

  describe('Contabo', () => {
    const credentials = {
      CONTABO_CLIENT_ID: 'client-id', CONTABO_CLIENT_SECRET: 'client-secret',
      CONTABO_API_USER: 'api-user@example.test', CONTABO_API_PASSWORD: 'api-password',
      CONTABO_TOKEN_URL: 'https://auth.contabo.test/token',
    } as NodeJS.ProcessEnv;

    function installFetch(responses: Array<Response>) {
      const fetchMock = vi.fn(async () => {
        const next = responses.shift();
        if (!next) throw new Error('Unexpected fetch');
        return next;
      });
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    it('stores a one-time password as a Contabo secret and references its id in the rescue action', async () => {
      const fetchMock = installFetch([
        json({ access_token: 'token', expires_in: 300 }),
        json({ data: [{ secretId: 4711, name: 'ch247-rescue' }] }),
        json({ data: [{ instanceId: 99, action: 'rescue' }] }),
      ]);
      const adapter = new ContaboProviderAdapter(providerRow('contabo', 'https://api.contabo.test/v1'), credentials);

      const session = await adapter.enableRescue('99', { architecture: 'x86_64' });

      expect(session.rebooted).toBe(true);
      expect(session.username).toBe('root');
      // Contabo's documented complexity rule: upper + lower case and three digits with one special.
      expect(session.password).toMatch(/[A-Z]/);
      expect(session.password).toMatch(/[a-z]/);
      expect(session.password).toMatch(/(\d.*){3}/);
      expect(session.password).toMatch(/[!@#$^&*?_~]/);
      expect((session.password ?? '').length).toBeGreaterThanOrEqual(8);

      const [secretUrl, secretInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(secretUrl).toBe('https://api.contabo.test/v1/secrets');
      expect(secretInit.method).toBe('POST');
      const secretBody = JSON.parse(String(secretInit.body)) as { value?: string; type?: string };
      expect(secretBody.type).toBe('password');
      expect(secretBody.value).toBe(session.password);

      const [rescueUrl, rescueInit] = fetchMock.mock.calls[2] as [string, RequestInit];
      expect(rescueUrl).toBe('https://api.contabo.test/v1/compute/instances/99/actions/rescue');
      expect(rescueInit.method).toBe('POST');
      expect(JSON.parse(String(rescueInit.body))).toEqual({ rootPassword: 4711 });
      // The generated password travels to the provider as a secret and is returned once.
      expect(String(rescueInit.body)).not.toContain(session.password);
    });

    it('reuses template SSH-key secrets instead of issuing a password', async () => {
      const fetchMock = installFetch([
        json({ access_token: 'token', expires_in: 300 }),
        json({ data: [{ instanceId: 99, action: 'rescue' }] }),
      ]);
      const adapter = new ContaboProviderAdapter(providerRow('contabo', 'https://api.contabo.test/v1'), credentials);

      const session = await adapter.enableRescue('99', { architecture: 'x86_64', providerSshKeyIds: ['12', 13] });

      expect(session.password).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [rescueUrl, rescueInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(rescueUrl).toContain('/compute/instances/99/actions/rescue');
      expect(JSON.parse(String(rescueInit.body))).toEqual({ sshKeys: [12, 13] });
    });

    it('leaves rescue through the restart action Contabo documents', async () => {
      const fetchMock = installFetch([
        json({ access_token: 'token', expires_in: 300 }),
        json({ data: [{ instanceId: 99, action: 'restart' }] }),
      ]);
      const adapter = new ContaboProviderAdapter(providerRow('contabo', 'https://api.contabo.test/v1'), credentials);

      await adapter.disableRescue('99');

      const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(url).toBe('https://api.contabo.test/v1/compute/instances/99/actions/restart');
      expect(init.method).toBe('POST');
    });
  });

  describe('OVH Public Cloud', () => {
    const credentials = {
      OVH_APPLICATION_KEY: 'app-key', OVH_APPLICATION_SECRET: 'app-secret',
      OVH_CONSUMER_KEY: 'consumer-key', OVH_CLOUD_PROJECT_ID: 'project-1',
    } as NodeJS.ProcessEnv;

    function installFetch(responses: Array<Response | Record<string, unknown>>) {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const next = responses.shift();
        if (!next) throw new Error(`Unexpected fetch: ${String(input)}`);
        return next instanceof Response ? next : json(next);
      });
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    it('flips the instance boot mode and returns the one-time rescue password from the resource', async () => {
      const fetchMock = installFetch([
        json(1_700_000_000),
        json({}, 200),
        json({ id: 'instance-1', status: 'RESCUE', rescuePassword: 'one-time-pass' }),
      ]);
      const adapter = new OvhProviderAdapter(providerRow('ovh', 'https://eu.api.ovh.test/1.0'), credentials);

      const session = await adapter.enableRescue('instance-1', { architecture: 'x86_64' });

      expect(session).toMatchObject({ type: 'ovh-rescue', username: 'root', password: 'one-time-pass', rebooted: true });
      const [rescueUrl, rescueInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(rescueUrl).toBe('https://eu.api.ovh.test/1.0/cloud/project/project-1/instance/instance-1/rescueMode');
      expect(rescueInit.method).toBe('POST');
      expect(JSON.parse(String(rescueInit.body))).toEqual({ rescue: true });
      const [statusUrl] = fetchMock.mock.calls[2] as [string, RequestInit];
      expect(statusUrl).toBe('https://eu.api.ovh.test/1.0/cloud/project/project-1/instance/instance-1');
    });

    it('exits rescue mode with rescue:false', async () => {
      const fetchMock = installFetch([json(1_700_000_000), json({})]);
      const adapter = new OvhProviderAdapter(providerRow('ovh', 'https://eu.api.ovh.test/1.0'), credentials);

      await adapter.disableRescue('instance-1');

      const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(url).toContain('/instance/instance-1/rescueMode');
      expect(JSON.parse(String(init.body))).toEqual({ rescue: false });
      // No password is read back when leaving rescue.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('Mock (development only)', () => {
    function mockAdapter() {
      return new MockProviderAdapter(
        providerRow('mock', null),
        { NODE_ENV: 'test', ALLOW_MOCK_PROVIDER: 'true' } as NodeJS.ProcessEnv
      );
    }

    const image = { provider_image_id: 'mock-image', provider_template_id: null, architecture: 'x86_64' } as never;

    async function mockServer() {
      const adapter = mockAdapter();
      const server = await adapter.createServer({
        idempotencyKey: 'rescue-flow', name: 'mock-rescue', hostname: 'mock.example.test',
        architecture: 'x86_64', image, regionCode: 'EU', datacenterCode: 'EU1', planMetadata: {},
        sshPublicKeys: [], userData: '',
      } as never);
      return { adapter, server };
    }

    it('simulates the rescue state machine without contacting a provider', async () => {
      const fetchMock = vi.fn(async () => { throw new Error('the mock adapter must never call fetch'); });
      vi.stubGlobal('fetch', fetchMock);
      const { adapter, server } = await mockServer();

      const session = await adapter.enableRescue(server.id, { architecture: 'x86_64' });
      expect(session.rebooted).toBe(true);
      expect(session.password).toContain('mock-rescue-');
      expect((await adapter.getServerStatus(server.id)).status).toBe('rescue');

      await adapter.disableRescue(server.id);
      expect((await adapter.getServerStatus(server.id)).status).toBe('running');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('still refuses to run when the development opt-in is missing', async () => {
      const adapter = new MockProviderAdapter(providerRow('mock', null), { NODE_ENV: 'test' } as NodeJS.ProcessEnv);
      await expect(adapter.enableRescue('mock-1', { architecture: 'x86_64' })).rejects.toMatchObject({
        code: 'CONFIGURATION_REQUIRED', retryable: false,
      });
    });
  });
});
