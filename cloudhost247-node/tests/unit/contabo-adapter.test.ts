import { describe, expect, it, vi } from 'vitest';
import { ContaboProviderAdapter } from '../../src/infrastructure/providers/contabo-adapter';
import { ProviderError } from '../../src/infrastructure/providers/types';
import type { InfrastructureProviderRow } from '../../src/db/infrastructure-providers';

function provider(overrides: Partial<InfrastructureProviderRow> = {}): InfrastructureProviderRow {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Contabo test', slug: 'contabo-test', provider_type: 'CONTABO', adapter: 'contabo', status: 'ACTIVE',
    api_base_url: 'https://api.contabo.test/v1', credential_env_prefix: null, capabilities: {}, metadata: {},
    last_health_check_at: null, last_health_status: null, created_at: '', updated_at: '', ...overrides,
  };
}

const credentials = {
  CONTABO_CLIENT_ID: 'client-id', CONTABO_CLIENT_SECRET: 'client-secret',
  CONTABO_API_USER: 'api-user@example.test', CONTABO_API_PASSWORD: 'api-password',
  CONTABO_TOKEN_URL: 'https://auth.contabo.test/token',
} as NodeJS.ProcessEnv;

function json(body: unknown, status = 200): Response {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function installFetch(responses: Array<Response | (() => Response)>) {
  const fetchMock = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error('Unexpected fetch');
    return typeof next === 'function' ? next() : next;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const image = { provider_image_id: 'ubuntu-image', architecture: 'x86_64' } as never;

describe('ContaboProviderAdapter', () => {
  it('exchanges OAuth credentials once, then validates Compute API access with a request id', async () => {
    const fetchMock = installFetch([
      json({ access_token: 'short-lived-token', expires_in: 300 }),
      json({ data: [] }),
    ]);
    const adapter = new ContaboProviderAdapter(provider(), credentials);

    await expect(adapter.validateConfiguration()).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(tokenUrl).toBe('https://auth.contabo.test/token');
    expect(tokenInit.method).toBe('POST');
    expect(String(tokenInit.body)).toContain('grant_type=password');
    expect(String(tokenInit.body)).toContain('client_id=client-id');
    expect((tokenInit.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');

    const [apiUrl, apiInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(apiUrl).toBe('https://api.contabo.test/v1/compute/instances?page=1&size=1');
    expect((apiInit.headers as Record<string, string>).Authorization).toBe('Bearer short-lived-token');
    expect((apiInit.headers as Record<string, string>)['x-request-id']).toMatch(/^[0-9a-f-]{36}$/i);
    vi.unstubAllGlobals();
  });

  it('looks up a deterministic display-name marker before creating an instance', async () => {
    const fetchMock = installFetch([
      json({ access_token: 'token', expires_in: 300 }),
      json({ data: [] }),
      json({ data: [{ instanceId: 12345, status: 'provisioning', imageId: 'ubuntu-image', productId: 'V153', region: 'EU' }] }, 201),
    ]);
    const adapter = new ContaboProviderAdapter(provider(), credentials);
    const created = await adapter.createServer({
      idempotencyKey: 'job-123', name: 'Customer VPS', hostname: 'server.example.test', architecture: 'x86_64', image,
      regionCode: 'EU', datacenterCode: null,
      planMetadata: { providerServerType: 'V153', providerSshKeyIds: [11, '12'], contaboPeriodMonths: 12, contaboDefaultUser: 'root' },
      sshPublicKeys: ['ssh-ed25519 raw-key customer@example.test'], userData: '#cloud-config\n',
    });

    expect(created).toMatchObject({ id: '12345', status: 'provisioning', imageId: 'ubuntu-image' });
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.contabo.test/v1/compute/instances?displayName=ch247%3Ajob-123&page=1&size=100');
    const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(url).toBe('https://api.contabo.test/v1/compute/instances');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      imageId: 'ubuntu-image', productId: 'V153', region: 'EU', period: 12,
      displayName: 'Customer VPS [ch247:job-123]', defaultUser: 'root', userData: '#cloud-config\n', sshKeys: [11, 12],
    });
    vi.unstubAllGlobals();
  });

  it('reuses a cached token for status, lifecycle, snapshot, and image calls', async () => {
    const fetchMock = installFetch([
      json({ access_token: 'token', expires_in: 300 }),
      json({ data: [{ instanceId: 42, status: 'running', displayName: 'VPS', imageId: 'image-1', ipConfig: { v4: { ip: '203.0.113.10' } } }] }),
      json({ data: [{ instanceId: 42, action: 'restart' }] }, 201),
      json({ data: [{ snapshotId: 'snap-1', name: 'Before change' }] }, 201),
      json({ data: [{ imageId: 'image-1', name: 'Ubuntu', status: 'available', osType: 'Linux' }] }),
    ]);
    const adapter = new ContaboProviderAdapter(provider(), credentials);

    await expect(adapter.getServerStatus('42')).resolves.toMatchObject({ id: '42', ipAddress: '203.0.113.10' });
    await expect(adapter.rebootServer('42')).resolves.toBeUndefined();
    await expect(adapter.createSnapshot('42', 'Before change')).resolves.toMatchObject({ snapshotId: 'snap-1' });
    await expect(adapter.getImage(image)).resolves.toMatchObject({ id: 'image-1', available: true });

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls.slice(1).map(([url]) => url)).toEqual([
      'https://api.contabo.test/v1/compute/instances/42',
      'https://api.contabo.test/v1/compute/instances/42/actions/restart',
      'https://api.contabo.test/v1/compute/instances/42/snapshots',
      'https://api.contabo.test/v1/compute/images/ubuntu-image',
    ]);
    expect(JSON.parse(String((fetchMock.mock.calls[3]?.[1] as RequestInit).body))).toEqual({ name: 'Before change', description: 'Before change' });
    vi.unstubAllGlobals();
  });

  it('maps bad OAuth credentials to a non-retryable authentication failure', async () => {
    installFetch([json({ error: 'invalid_grant' }, 400)]);
    const adapter = new ContaboProviderAdapter(provider(), credentials);
    await expect(adapter.validateConfiguration()).rejects.toMatchObject<Partial<ProviderError>>({
      code: 'AUTHENTICATION_FAILED', retryable: false,
    });
    vi.unstubAllGlobals();
  });

  it('does not claim scheduled Contabo cancellation is an immediate deletion', async () => {
    const adapter = new ContaboProviderAdapter(provider(), credentials);
    await expect(adapter.deleteServer('42')).rejects.toMatchObject<Partial<ProviderError>>({
      code: 'UNSUPPORTED_OPERATION', retryable: false,
    });
  });
});
