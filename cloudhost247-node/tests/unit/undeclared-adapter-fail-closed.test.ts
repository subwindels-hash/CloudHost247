import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createInfrastructureProviderAdapter,
} from '../../src/infrastructure/providers/registry';
import {
  ADAPTER_KINDS,
  ADAPTER_PROFILES,
  describeProviderConfiguration,
  getAdapterProfile,
} from '../../src/infrastructure/providers/configuration';
import { providerErrorToHttpError } from '../../src/infrastructure/providers/error-mapping';
import type { InfrastructureProviderRow } from '../../src/db/infrastructure-providers';

/**
 * A8 — undeclared provider adapters must fail closed, provably and non-retryably.
 *
 * The admin API only accepts adapter kinds that have a profile (the accepted list is derived from
 * ADAPTER_PROFILES), so the fallback adapter is the last-resort guard for a provider row that
 * predates or bypasses that API. It must never borrow another provider's implementation, never
 * fall back to the development mock, and never look retryable: an operator seeing "temporarily
 * unavailable, try again shortly" would retry a condition that only a build change can fix.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function providerRow(adapter: string, overrides: Partial<InfrastructureProviderRow> = {}): InfrastructureProviderRow {
  return {
    id: 'provider-unknown', name: 'Unknown platform', slug: 'unknown-platform', provider_type: 'OTHER',
    adapter, status: 'ACTIVE', api_base_url: 'https://unknown.test', credential_env_prefix: null,
    capabilities: {}, metadata: {}, last_health_check_at: null, last_health_status: null,
    created_at: '', updated_at: '', ...overrides,
  } as InfrastructureProviderRow;
}

describe('undeclared provider adapters fail closed', () => {
  it('accepts exactly the adapter kinds that exist, from one source of truth', () => {
    expect(new Set(ADAPTER_KINDS)).toEqual(new Set(Object.keys(ADAPTER_PROFILES)));
    expect(ADAPTER_KINDS).not.toContain('linode');
    // Every advertised kind resolves to a real profile, and only that kind.
    for (const kind of ADAPTER_KINDS) {
      expect(getAdapterProfile(kind)?.kind).toBe(kind);
    }
  });

  it('resolves every declared kind to that kind of adapter, never to another provider or mock', () => {
    for (const kind of ADAPTER_KINDS) {
      const adapter = createInfrastructureProviderAdapter(providerRow(kind));
      expect(adapter.kind).toBe(kind);
    }
  });

  it('refuses an undeclared kind with a non-retryable unsupported operation, and never with the mock', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('an undeclared adapter must not reach the network');
    });
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createInfrastructureProviderAdapter(providerRow('linode'));
    expect(adapter.kind).toBe('linode');

    // Every method of the adapter contract, so a newly added operation cannot slip through
    // unimplemented or (worse) silently succeed.
    const invocations: Array<[string, () => Promise<unknown>]> = [
      ['validateConfiguration', () => adapter.validateConfiguration()],
      ['createServer', () => adapter.createServer({} as never)],
      ['provisionServer', () => adapter.provisionServer({} as never)],
      ['findServerByIdempotencyKey', () => adapter.findServerByIdempotencyKey('key')],
      ['deleteServer', () => adapter.deleteServer('srv-1')],
      ['rebootServer', () => adapter.rebootServer('srv-1')],
      ['shutdownServer', () => adapter.shutdownServer('srv-1')],
      ['startServer', () => adapter.startServer('srv-1')],
      ['powerOnServer', () => adapter.powerOnServer('srv-1')],
      ['powerOffServer', () => adapter.powerOffServer('srv-1')],
      ['getServer', () => adapter.getServer('srv-1')],
      ['getServerStatus', () => adapter.getServerStatus('srv-1')],
      ['getServerIP', () => adapter.getServerIP('srv-1')],
      ['getAvailableImages', () => adapter.getAvailableImages()],
      ['getImage', () => adapter.getImage({} as never)],
      ['reinstallServer', () => adapter.reinstallServer({} as never)],
      ['rebuildServer', () => adapter.rebuildServer({} as never)],
      ['resizeServer', () => adapter.resizeServer('srv-1', {})],
      ['createSnapshot', () => adapter.createSnapshot('srv-1', 'name')],
      ['deleteSnapshot', () => adapter.deleteSnapshot('srv-1', 'snap-1')],
      ['restoreSnapshot', () => adapter.restoreSnapshot('srv-1', 'snap-1')],
      ['getConsole', () => adapter.getConsole('srv-1')],
      ['enableRescue', () => adapter.enableRescue('srv-1', { architecture: 'x86_64' })],
      ['disableRescue', () => adapter.disableRescue('srv-1')],
      ['getServerMetrics', () => adapter.getServerMetrics('srv-1')],
      ['healthCheck', () => adapter.healthCheck('srv-1', {} as never)],
    ];
    for (const [name, invoke] of invocations) {
      await expect(invoke(), name).rejects.toMatchObject({
        code: 'UNSUPPORTED_OPERATION',
        retryable: false,
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('names the kind and the build in the refusal, instead of suggesting a retry', async () => {
    const adapter = createInfrastructureProviderAdapter(providerRow('linode'));
    await expect(adapter.validateConfiguration()).rejects.toThrow(/linode/);
    await expect(adapter.validateConfiguration()).rejects.toThrow(/no native adapter is implemented/i);
    await expect(adapter.validateConfiguration()).rejects.not.toThrow(/try again/i);
  });

  it('reaches the customer as a non-retryable refusal, never as "try again shortly"', async () => {
    const adapter = createInfrastructureProviderAdapter(providerRow('linode'));
    const error = await adapter.validateConfiguration().catch((thrown: unknown) => thrown);
    const http = providerErrorToHttpError(error);
    expect(http.statusCode).toBe(400);
    expect(http.code).toBe('VALIDATION_ERROR');
    expect(http.message).not.toMatch(/try again/i);
  });

  it('describes an undeclared provider as not ready, with no capabilities and a reason', () => {
    const report = describeProviderConfiguration({ adapter: 'linode', api_base_url: null, credential_env_prefix: null });
    expect(report.ready).toBe(false);
    expect(report.missing).toContain('adapter implementation');
    expect(report.notes).toMatch(/no adapter implementation is registered/i);
    for (const capability of ['reinstall', 'snapshot', 'resize', 'console', 'metrics', 'rescue']) {
      expect((report.capabilities as unknown as Record<string, boolean>)[capability]).toBe(false);
    }
  });
});
