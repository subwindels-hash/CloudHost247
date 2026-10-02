/**
 * Development-only mock provider (spec §35).
 *
 * This adapter exists so the ordering → payment → queue → worker pipeline can be exercised in
 * local development and CI without provider credentials. It is deliberately hard to enable:
 *
 *  - `NODE_ENV=production` disables it unconditionally;
 *  - it additionally requires the explicit opt-in `ALLOW_MOCK_PROVIDER=true`;
 *  - it is only ever selected when an administrator registered a provider whose adapter is
 *    literally `mock`. It is never a fallback for a real adapter that is missing credentials.
 *
 * Every resource it returns is labelled `mock: true` and carries a `mock-` id prefix so mock
 * rows can never be mistaken for real infrastructure in the database, API, or admin UI.
 */
import { randomUUID } from 'node:crypto';
import type { InfrastructureProviderRow, ServerOsImageRow } from '../../db/infrastructure-providers';
import { idempotentResourceName } from './common';
import {
  ProviderError,
  type CreateProviderServerInput,
  type InfrastructureProviderAdapter,
  type ProviderHealthResult,
  type ProviderImage,
  type ProviderServer,
  type ReinstallProviderServerInput,
  type RescueRequest,
  type RescueSession,
} from './types';

interface MockServerState {
  id: string;
  name: string;
  idempotencyKey: string;
  status: 'running' | 'stopped' | 'rescue';
  imageId: string;
  hostname: string;
  createdAt: number;
}

/** Process-local only. Mock state is never persisted and never shared with real provider code. */
const mockServers = new Map<string, MockServerState>();

export function resetMockProviderState(): void {
  mockServers.clear();
}

export function isMockProviderEnabled(source: NodeJS.ProcessEnv = process.env): boolean {
  return source.NODE_ENV !== 'production' && source.ALLOW_MOCK_PROVIDER === 'true';
}

export class MockProviderAdapter implements InfrastructureProviderAdapter {
  readonly kind = 'mock';

  constructor(readonly provider: InfrastructureProviderRow, private readonly source: NodeJS.ProcessEnv = process.env) {}

  private guard(): void {
    if (this.source.NODE_ENV === 'production') {
      throw new ProviderError(
        'SERVICE_UNAVAILABLE',
        'The mock provider is disabled in production. Configure a real infrastructure provider.',
        false
      );
    }
    if (this.source.ALLOW_MOCK_PROVIDER !== 'true') {
      throw new ProviderError(
        'CONFIGURATION_REQUIRED',
        'The mock provider requires the explicit development opt-in ALLOW_MOCK_PROVIDER=true',
        false
      );
    }
  }

  private state(providerServerId: string): MockServerState {
    this.guard();
    const server = mockServers.get(providerServerId);
    if (!server) throw new ProviderError('RESOURCE_NOT_FOUND', 'Mock server does not exist', false);
    return server;
  }

  private toServer(state: MockServerState): ProviderServer {
    return {
      id: state.id,
      status: state.status,
      name: state.name,
      // RFC 5737 documentation range — never a routable address that could be mistaken for real.
      ipAddress: '192.0.2.10',
      imageId: state.imageId,
      metadata: { mock: true, hostname: state.hostname, createdAt: new Date(state.createdAt).toISOString() },
    };
  }

  async validateConfiguration(): Promise<void> {
    this.guard();
  }

  async findServerByIdempotencyKey(idempotencyKey: string): Promise<ProviderServer | null> {
    this.guard();
    const match = [...mockServers.values()].find((server) => server.idempotencyKey === idempotencyKey);
    return match ? this.toServer(match) : null;
  }

  async createServer(input: CreateProviderServerInput): Promise<ProviderServer> {
    this.guard();
    const existing = await this.findServerByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;
    const imageId = input.image.provider_image_id ?? input.image.provider_template_id;
    if (!imageId) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image mapping has no image identifier', false);
    const state: MockServerState = {
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

  provisionServer(input: CreateProviderServerInput): Promise<ProviderServer> { return this.createServer(input); }

  async getServerStatus(providerServerId: string): Promise<ProviderServer> { return this.toServer(this.state(providerServerId)); }
  getServer(id: string): Promise<ProviderServer> { return this.getServerStatus(id); }
  async getServerIP(providerServerId: string): Promise<string | null> { return this.toServer(this.state(providerServerId)).ipAddress; }

  async deleteServer(providerServerId: string): Promise<void> {
    this.state(providerServerId);
    mockServers.delete(providerServerId);
  }

  async startServer(providerServerId: string): Promise<void> { this.state(providerServerId).status = 'running'; }
  async shutdownServer(providerServerId: string): Promise<void> { this.state(providerServerId).status = 'stopped'; }
  async rebootServer(providerServerId: string): Promise<void> { this.state(providerServerId).status = 'running'; }
  powerOnServer(id: string): Promise<void> { return this.startServer(id); }
  powerOffServer(id: string): Promise<void> { return this.shutdownServer(id); }
  rebuildServer(input: ReinstallProviderServerInput): Promise<ProviderServer> { return this.reinstallServer(input); }

  async resizeServer(providerServerId: string): Promise<ProviderServer> { return this.getServerStatus(providerServerId); }

  async createSnapshot(providerServerId: string, description: string): Promise<Record<string, unknown>> {
    this.state(providerServerId);
    return { mock: true, snapshotId: `mock-snap-${randomUUID()}`, description };
  }

  async deleteSnapshot(providerServerId: string): Promise<void> { this.state(providerServerId); }
  async restoreSnapshot(providerServerId: string): Promise<void> { this.state(providerServerId); }

  async getAvailableImages(): Promise<ProviderImage[]> {
    this.guard();
    return [];
  }

  async getImage(image: ServerOsImageRow): Promise<ProviderImage | null> {
    this.guard();
    const identifier = image.provider_image_id ?? image.provider_template_id;
    return identifier
      ? { id: identifier, name: `mock:${identifier}`, architecture: image.architecture, available: true, metadata: { mock: true } }
      : null;
  }

  async reinstallServer(input: ReinstallProviderServerInput): Promise<ProviderServer> {
    const state = this.state(input.providerServerId);
    const imageId = input.image.provider_image_id ?? input.image.provider_template_id;
    if (!imageId) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image mapping has no image identifier', false);
    state.imageId = imageId;
    state.hostname = input.hostname;
    state.status = 'running';
    return this.toServer(state);
  }

  /**
   * Simulated rescue: the state machine moves to `rescue` so the ordering → queue → worker flow can
   * exercise the whole path in development. The returned value is labelled mock and must never be
   * mistaken for a real credential.
   */
  async enableRescue(providerServerId: string, _input: RescueRequest): Promise<RescueSession> {
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

  async disableRescue(providerServerId: string): Promise<void> {
    this.state(providerServerId).status = 'running';
  }

  async getConsole(providerServerId: string): Promise<Record<string, unknown>> {
    this.state(providerServerId);
    return { mock: true, type: 'none', message: 'Mock provider has no console' };
  }

  async getServerMetrics(providerServerId: string): Promise<Record<string, unknown>> {
    this.state(providerServerId);
    return { mock: true, series: [] };
  }

  async healthCheck(providerServerId: string, expectedImage: ServerOsImageRow): Promise<ProviderHealthResult> {
    try {
      const state = this.state(providerServerId);
      const expected = expectedImage.provider_image_id ?? expectedImage.provider_template_id;
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
