/**
 * Development-only mock provider.
 *
 * Ported from cloudhost247-node/src/infrastructure/providers/mock-adapter.ts. This adapter exists so
 * the ordering → payment → queue → worker pipeline can be exercised in local development and CI
 * without provider credentials. It is deliberately hard to enable:
 *
 *  - `NODE_ENV=production` disables it unconditionally;
 *  - it additionally requires the explicit opt-in `ALLOW_MOCK_PROVIDER=true`;
 *  - it is only ever selected when an administrator registered a provider whose adapter is literally
 *    `mock`. It is never a fallback for a real adapter that is missing credentials.
 *
 * Console and metrics are refused rather than simulated: inventing either would teach a developer to
 * trust a reading no provider produced.
 */
'use strict';

const { randomUUID } = require('node:crypto');
const { ProviderError } = require('../types');
const { idempotentResourceName, unsupportedConsole, imageIdentifier } = require('../common');

/** Process-local only. Mock state is never persisted and never shared with real provider code. */
const mockServers = new Map();

function resetMockProviderState() {
  mockServers.clear();
}

function isMockProviderEnabled(source = process.env) {
  return source.NODE_ENV !== 'production' && source.ALLOW_MOCK_PROVIDER === 'true';
}

class MockProviderAdapter {
  constructor(provider, options = {}) {
    this.kind = 'mock';
    this.provider = provider;
    this.source = options.source ?? process.env;
    this.transport = options.transport;
  }

  guard() {
    if (this.source.NODE_ENV === 'production') {
      throw new ProviderError(
        'SERVICE_UNAVAILABLE',
        'The mock provider is disabled in production. Configure a real infrastructure provider.',
        false,
      );
    }
    if (this.source.ALLOW_MOCK_PROVIDER !== 'true') {
      throw new ProviderError(
        'CONFIGURATION_REQUIRED',
        'The mock provider requires the explicit development opt-in ALLOW_MOCK_PROVIDER=true',
        false,
      );
    }
  }

  state(providerServerId) {
    this.guard();
    const server = mockServers.get(providerServerId);
    if (!server) throw new ProviderError('RESOURCE_NOT_FOUND', 'Mock server does not exist', false);
    return server;
  }

  toServer(state) {
    return {
      id: state.id,
      status: state.status,
      name: state.name,
      ipAddress: '192.0.2.10',
      imageId: state.imageId,
      metadata: { mock: true, hostname: state.hostname, createdAt: new Date(state.createdAt).toISOString() },
    };
  }

  async validateConfiguration() {
    this.guard();
  }

  async findServerByIdempotencyKey(idempotencyKey) {
    this.guard();
    const match = [...mockServers.values()].find((server) => server.idempotencyKey === idempotencyKey);
    return match ? this.toServer(match) : null;
  }

  async createServer(input) {
    this.guard();
    const existing = await this.findServerByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;
    const imageId = imageIdentifier(input.image);
    if (!imageId) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image mapping has no image identifier', false);
    const state = {
      id: `mock-${randomUUID()}`,
      name: idempotentResourceName(input.idempotencyKey),
      idempotencyKey: input.idempotencyKey,
      status: 'running',
      imageId,
      hostname: input.hostname,
      createdAt: Date.now(),
    };
    mockServers.set(state.id, state);
    return this.toServer(state);
  }

  provisionServer(input) { return this.createServer(input); }

  async getServerStatus(providerServerId) { return this.toServer(this.state(providerServerId)); }
  getServer(id) { return this.getServerStatus(id); }

  async getServerIP(providerServerId) { return this.toServer(this.state(providerServerId)).ipAddress; }

  async deleteServer(providerServerId) {
    this.state(providerServerId);
    mockServers.delete(providerServerId);
  }

  async startServer(providerServerId) { this.state(providerServerId).status = 'running'; }
  async shutdownServer(providerServerId) { this.state(providerServerId).status = 'stopped'; }
  async rebootServer(providerServerId) { this.state(providerServerId).status = 'running'; }
  powerOnServer(id) { return this.startServer(id); }
  powerOffServer(id) { return this.shutdownServer(id); }
  rebuildServer(input) { return this.reinstallServer(input); }

  async resizeServer(providerServerId) { return this.getServerStatus(providerServerId); }

  async createSnapshot(providerServerId, description) {
    this.state(providerServerId);
    return { mock: true, snapshotId: `mock-snap-${randomUUID()}`, description };
  }

  async deleteSnapshot(providerServerId) { this.state(providerServerId); }
  async restoreSnapshot(providerServerId) { this.state(providerServerId); }

  async getAvailableImages() {
    this.guard();
    return [];
  }

  async getImage(image) {
    this.guard();
    const identifier = imageIdentifier(image);
    return identifier
      ? {
        id: identifier,
        name: `mock:${identifier}`,
        architecture: image?.architecture ?? image?.arch ?? null,
        available: true,
        metadata: { mock: true },
      }
      : null;
  }

  async reinstallServer(input) {
    const state = this.state(input.providerServerId);
    const imageId = imageIdentifier(input.image);
    if (!imageId) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image mapping has no image identifier', false);
    state.imageId = imageId;
    state.hostname = input.hostname;
    state.status = 'running';
    return this.toServer(state);
  }

  /**
   * Simulated rescue: the state machine moves to `rescue` so the ordering → queue → worker flow can
   * exercise the whole path in development. The returned value is labelled mock.
   */
  async enableRescue(providerServerId) {
    const state = this.state(providerServerId);
    state.status = 'rescue';
    return {
      type: 'mock-rescue',
      username: 'root',
      password: `mock-rescue-${state.id.slice(-8)}`,
      rebooted: true,
      notes: 'Simulated rescue mode. No provider was contacted.',
    };
  }

  async disableRescue(providerServerId) {
    this.state(providerServerId).status = 'running';
  }

  /**
   * The mock issues no console and measures nothing, and refuses both with the same non-retryable
   * UNSUPPORTED_OPERATION every other adapter without those capabilities uses — the capability
   * profile declares `console: false` and `metrics: false`, and the two must not drift.
   */
  async getConsole() {
    this.guard();
    return unsupportedConsole('mock', 'the development simulator issues no console session');
  }

  async getServerMetrics() {
    this.guard();
    throw new ProviderError(
      'UNSUPPORTED_OPERATION',
      'mock produces no metrics: it is a development simulator, and host telemetry comes from the CloudHost247 server agent',
      false,
    );
  }

  async healthCheck(providerServerId, expectedImage) {
    try {
      const state = this.state(providerServerId);
      const expected = imageIdentifier(expectedImage);
      return {
        exists: true,
        poweredOn: state.status === 'running',
        ipAddress: this.toServer(state).ipAddress,
        imageMatches: !expected || state.imageId === expected,
        providerStatus: state.status,
        detail: 'mock provider',
      };
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'RESOURCE_NOT_FOUND') {
        return { exists: false, poweredOn: false, ipAddress: null, imageMatches: false, providerStatus: 'missing' };
      }
      throw error;
    }
  }
}

module.exports = { MockProviderAdapter, resetMockProviderState, isMockProviderEnabled };
