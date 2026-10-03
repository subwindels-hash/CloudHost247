import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContaboProviderAdapter } from '../../src/infrastructure/providers/contabo-adapter';
import { MockProviderAdapter, resetMockProviderState } from '../../src/infrastructure/providers/mock-adapter';
import { OvhProviderAdapter } from '../../src/infrastructure/providers/ovh-adapter';
import { SolusvmProviderAdapter } from '../../src/infrastructure/providers/solusvm-adapter';
import { VultrProviderAdapter } from '../../src/infrastructure/providers/vultr-adapter';
import { ADAPTER_PROFILES } from '../../src/infrastructure/providers/configuration';
import type { InfrastructureProviderRow } from '../../src/db/infrastructure-providers';

/**
 * A6 — rescue mode. Only providers whose API genuinely offers a way to boot a repair system may
 * implement it, and "offers" includes a documented path that is not called rescue: Hetzner
 * (`enable_rescue`), OpenStack (Nova `rescue`/`unrescue`), OVH Public Cloud
 * (`POST .../rescueMode` plus the instance's `rescuePassword`), Contabo (`POST .../actions/rescue`
 * with Contabo secret ids), SolusVM (`vserver-rescue`), the development-only mock,
 * `generic_http` (delegates to the operator's bridge) and — since 2026-10-03 — Vultr, whose cloud
 * instances are repaired by booting the SystemRescue image from its public ISO library.
 *
 * This suite pins the call shapes, the one-time-credential rules and the architecture checks
 * those providers imply, and it pins which providers must *not* advertise rescue.
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
    // generic_http is here because it delegates rescue to the operator's bridge on the same
    // action contract it already delegates reboot/resize/reinstall to — the bridge, not this
    // adapter, decides whether the underlying provider offers a rescue system.
    expect(withRescue).toEqual(['contabo', 'generic_http', 'hetzner', 'mock', 'openstack', 'ovh', 'solusvm', 'vultr']);
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

  describe('SolusVM (Admin API v1)', () => {
    const credentials = {
      SOLUSVM_API_ID: 'admin-api-id',
      SOLUSVM_API_KEY: 'admin-api-key',
    } as NodeJS.ProcessEnv;

    function installFetch(bodies: Array<Record<string, unknown>>) {
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        const next = bodies.shift();
        if (!next) throw new Error(`Unexpected fetch to ${url}`);
        return new Response(JSON.stringify(next), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    function adapter() {
      return new SolusvmProviderAdapter(providerRow('solusvm', 'https://solus.test'), credentials);
    }

    it('boots the documented x86_64 rescue kernel and returns the login SolusVM issues', async () => {
      const fetchMock = installFetch([{
        status: 'success', statusmsg: 'Rescue mode enabled',
        password: 'ZkBa5SKtY7MiQT6', user: 'root', port: '22', ip: '203.0.113.7',
      }]);

      const session = await adapter().enableRescue('2041', { architecture: 'x86_64' });

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(String(url)).toBe('https://solus.test/api/admin/command.php');
      const form = new URLSearchParams(String(init?.body));
      expect(form.get('action')).toBe('vserver-rescue');
      expect(form.get('vserverid')).toBe('2041');
      expect(form.get('rescueenable')).toBe('1');
      expect(form.get('rdtype')).toBe('json');
      // Enabling rescue reboots the virtual server; the adapter reports that rather than guessing.
      expect(session.rebooted).toBe(true);
      expect(session.username).toBe('root');
      expect(session.password).toBe('ZkBa5SKtY7MiQT6');
      // The access details SolusVM returns must reach the customer, not be silently dropped.
      expect(session.notes).toContain('203.0.113.7');
      expect(session.notes).toContain('22');
    });

    it('refuses an arm64 server instead of booting an x86 rescue kernel into it', async () => {
      const fetchMock = installFetch([]);

      await expect(adapter().enableRescue('2041', { architecture: 'arm64' })).rejects.toMatchObject({
        code: 'UNSUPPORTED_OPERATION',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('leaves the rescue system with rescuedisable', async () => {
      const fetchMock = installFetch([{ status: 'success', statusmsg: 'Rescue mode disabled' }]);

      await adapter().disableRescue('2041');

      const form = new URLSearchParams(String(fetchMock.mock.calls[0]![1]?.body));
      expect(form.get('action')).toBe('vserver-rescue');
      expect(form.get('vserverid')).toBe('2041');
      expect(form.get('rescuedisable')).toBe('true');
    });

    it('does not fabricate a rescue login when SolusVM returns none', async () => {
      installFetch([{ status: 'success', statusmsg: 'Rescue mode enabled', password: 'pw' }]);

      await expect(adapter().enableRescue('2041', { architecture: 'x86_64' })).rejects.toMatchObject({
        code: 'PROVIDER_ERROR',
      });
    });
  });

  describe('Vultr (documented SystemRescue ISO path)', () => {
    const credentials = { VULTR_API_KEY: 'vultr-token' } as NodeJS.ProcessEnv;

    function installFetch(handler: (url: string) => unknown) {
      const calls: Array<{ url: string; method: string; body: string }> = [];
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, method: init?.method ?? 'GET', body: String(init?.body ?? '') });
        return json(handler(url));
      });
      vi.stubGlobal('fetch', fetchMock);
      return calls;
    }

    const library = (isos: unknown[]) => ({ public_isos: isos });

    it('resolves SystemRescue from the live public ISO list, attaches it and reboots', async () => {
      const calls = installFetch((url) => {
        if (url.endsWith('/iso-public')) {
          return library([
            { id: 'gparted-x64', name: 'GParted', description: '1.6.0' },
            { id: 'systemrescue-11.03', name: 'SystemRescue', description: '11.03' },
          ]);
        }
        return { iso_status: { status: 'isattaching' } };
      });
      const adapter = new VultrProviderAdapter(providerRow('vultr', 'https://api.vultr.test/v2'), credentials);

      const session = await adapter.enableRescue('inst-1', { architecture: 'x86_64' });

      expect(session).toMatchObject({ type: 'systemrescue-iso', username: 'root', rebooted: true });
      // There is no credential: SystemRescue signs the operator in at the console as root.
      expect(session.password).toBeUndefined();
      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        'GET https://api.vultr.test/v2/iso-public',
        'POST https://api.vultr.test/v2/instances/inst-1/iso/attach',
        'POST https://api.vultr.test/v2/instances/inst-1/reboot',
      ]);
      expect(JSON.parse(calls[1]!.body)).toEqual({ iso_id: 'systemrescue-11.03' });
      expect(session.notes).toMatch(/SystemRescue/);
      expect(session.notes).toMatch(/no password/);
      expect(session.notes).toMatch(/console/);
    });

    it('never hands an ARM image to an x86_64 instance, or an x86 image to an arm64 one', async () => {
      const calls = installFetch((url) =>
        url.endsWith('/iso-public')
          ? library([
              { id: 'systemrescue-aarch64', name: 'SystemRescue', description: '11.03 aarch64' },
              { id: 'systemrescue-x64', name: 'SystemRescue', description: '11.03 x86_64' },
            ])
          : { iso_status: { status: 'isattaching' } }
      );
      const adapter = new VultrProviderAdapter(providerRow('vultr', 'https://api.vultr.test/v2'), credentials);

      await adapter.enableRescue('inst-1', { architecture: 'arm64' });
      expect(JSON.parse(calls[1]!.body)).toEqual({ iso_id: 'systemrescue-aarch64' });

      calls.length = 0;
      await adapter.enableRescue('inst-1', { architecture: 'x86_64' });
      expect(JSON.parse(calls[1]!.body)).toEqual({ iso_id: 'systemrescue-x64' });
    });

    it('refuses an arm64 instance when the library holds only the x86 image, without attaching it', async () => {
      const calls = installFetch(() => library([{ id: 'systemrescue-x64', name: 'SystemRescue', description: '11.03' }]));
      const adapter = new VultrProviderAdapter(providerRow('vultr', 'https://api.vultr.test/v2'), credentials);

      await expect(adapter.enableRescue('inst-1', { architecture: 'arm64' })).rejects.toMatchObject({
        code: 'UNSUPPORTED_OPERATION',
        retryable: false,
      });
      // Only the library was read: nothing was attached to a machine that could not boot it.
      expect(calls).toHaveLength(1);
    });

    it('reports a library that lists no SystemRescue image instead of attaching something else', async () => {
      const calls = installFetch(() => library([{ id: 'gparted-x64', name: 'GParted', description: '1.6.0' }]));
      const adapter = new VultrProviderAdapter(providerRow('vultr', 'https://api.vultr.test/v2'), credentials);

      await expect(adapter.enableRescue('inst-1', { architecture: 'x86_64' })).rejects.toMatchObject({
        code: 'PROVIDER_ERROR',
        retryable: false,
      });
      expect(calls).toHaveLength(1);
    });

    it('leaves rescue by detaching the ISO, which Vultr reboots back into the installed system', async () => {
      const calls = installFetch(() => ({ iso_status: { status: 'isunmounting' } }));
      const adapter = new VultrProviderAdapter(providerRow('vultr', 'https://api.vultr.test/v2'), credentials);

      await adapter.disableRescue('inst-1');

      expect(calls).toEqual([
        { url: 'https://api.vultr.test/v2/instances/inst-1/iso/detach', method: 'POST', body: '' },
      ]);
    });
  });
});