import type { InfrastructureProviderRow, ServerOsImageRow } from '../../db/infrastructure-providers';

export type ProviderFailureCode =
  | 'PROVIDER_TIMEOUT'
  | 'NETWORK_TEMPORARY_FAILURE'
  | 'RATE_LIMITED'
  | 'IMAGE_UNAVAILABLE'
  | 'INVALID_CONFIGURATION'
  | 'AUTHENTICATION_FAILED'
  | 'INSUFFICIENT_CAPACITY'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'CONFIGURATION_REQUIRED'
  | 'SERVICE_UNAVAILABLE'
  | 'RESOURCE_NOT_FOUND'
  | 'UNSUPPORTED_OPERATION'
  | 'PROVIDER_ERROR';

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderFailureCode,
    message: string,
    public readonly retryable: boolean,
    public readonly providerResponse?: unknown
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface ProviderServer {
  id: string;
  status: string;
  name: string | null;
  ipAddress: string | null;
  imageId: string | null;
  metadata: Record<string, unknown>;
}

export interface ProviderImage {
  id: string;
  name: string | null;
  architecture: string | null;
  available: boolean;
  metadata: Record<string, unknown>;
}

export interface CreateProviderServerInput {
  idempotencyKey: string;
  name: string;
  hostname: string;
  architecture: 'x86_64' | 'arm64';
  image: ServerOsImageRow;
  regionCode: string;
  datacenterCode: string | null;
  planMetadata: Record<string, unknown>;
  sshPublicKeys: string[];
  userData: string;
}

export interface ReinstallProviderServerInput {
  providerServerId: string;
  idempotencyKey: string;
  isRetry: boolean;
  image: ServerOsImageRow;
  architecture: 'x86_64' | 'arm64';
  hostname: string;
  sshPublicKeys: string[];
  userData: string;
}

export interface ProviderHealthResult {
  exists: boolean;
  poweredOn: boolean;
  ipAddress: string | null;
  imageMatches: boolean;
  providerStatus: string;
  detail?: string;
}

/**
 * Infrastructure adapter boundary. Provider identifiers and credentials never cross into route
 * handlers or browser DTOs. Implementations must be idempotent: createServer is paired with
 * findServerByIdempotencyKey so a crash between provider creation and local persistence cannot
 * allocate a second billable resource.
 */
/** What the platform knows when asking a provider to boot a server into its rescue system. */
export interface RescueRequest {
  /** Rescue images are per-architecture on every provider that offers them. */
  architecture: 'x86_64' | 'arm64';
  /** Provider-side SSH key ids from the server template, where the provider injects them. */
  providerSshKeyIds?: Array<string | number>;
}

/**
 * The result of entering rescue mode. `password` is a one-time credential that must be handed to
 * the requesting customer and never stored, logged or audited — the same rule the console session
 * follows. Providers that key rescue access off an injected SSH key return no password at all.
 */
export interface RescueSession {
  /** Provider's name for the rescue system booted, e.g. `linux64`. */
  type: string;
  username: string;
  password?: string;
  /** True when the server was rebooted into rescue as part of this call. */
  rebooted: boolean;
  notes?: string;
}

export interface InfrastructureProviderAdapter {
  readonly kind: string;
  readonly provider: InfrastructureProviderRow;

  validateConfiguration(): Promise<void>;
  createServer(input: CreateProviderServerInput): Promise<ProviderServer>;
  provisionServer(input: CreateProviderServerInput): Promise<ProviderServer>;
  findServerByIdempotencyKey(idempotencyKey: string): Promise<ProviderServer | null>;
  deleteServer(providerServerId: string): Promise<void>;
  rebootServer(providerServerId: string): Promise<void>;
  shutdownServer(providerServerId: string): Promise<void>;
  startServer(providerServerId: string): Promise<void>;
  powerOnServer(providerServerId: string): Promise<void>;
  powerOffServer(providerServerId: string): Promise<void>;
  getServer(providerServerId: string): Promise<ProviderServer>;
  getServerStatus(providerServerId: string): Promise<ProviderServer>;
  getServerIP(providerServerId: string): Promise<string | null>;
  getAvailableImages(): Promise<ProviderImage[]>;
  getImage(image: ServerOsImageRow): Promise<ProviderImage | null>;
  reinstallServer(input: ReinstallProviderServerInput): Promise<ProviderServer>;
  rebuildServer(input: ReinstallProviderServerInput): Promise<ProviderServer>;
  resizeServer(providerServerId: string, planMetadata: Record<string, unknown>): Promise<ProviderServer>;
  createSnapshot(providerServerId: string, description: string): Promise<Record<string, unknown>>;
  deleteSnapshot(providerServerId: string, snapshotId: string): Promise<void>;
  restoreSnapshot(providerServerId: string, snapshotId: string): Promise<void>;
  getConsole(providerServerId: string): Promise<Record<string, unknown>>;
  enableRescue(providerServerId: string, input: RescueRequest): Promise<RescueSession>;
  disableRescue(providerServerId: string): Promise<void>;
  getServerMetrics(providerServerId: string): Promise<Record<string, unknown>>;
  healthCheck(providerServerId: string, expectedImage: ServerOsImageRow): Promise<ProviderHealthResult>;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
