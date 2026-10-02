import { randomInt, randomUUID } from 'node:crypto';
import type { InfrastructureProviderRow, ServerOsImageRow } from '../../db/infrastructure-providers';
import { providerRequest } from './http';
import {
  ProviderError,
  asRecord,
  asString,
  type CreateProviderServerInput,
  type InfrastructureProviderAdapter,
  type ProviderHealthResult,
  type ProviderImage,
  type ProviderServer,
  type ReinstallProviderServerInput,
  type RescueRequest,
  type RescueSession,
} from './types';

const DEFAULT_API_URL = 'https://api.contabo.com/v1';
const DEFAULT_TOKEN_URL = 'https://auth.contabo.com/auth/realms/contabo/protocol/openid-connect/token';
const IDEMPOTENCY_MARKER = 'ch247:';

interface ContaboEnvelope<T> {
  data?: T[];
  _pagination?: { page?: number; totalPages?: number };
}

interface ContaboInstance {
  instanceId?: number | string;
  status?: string;
  name?: string;
  displayName?: string;
  imageId?: string;
  productId?: string;
  region?: string;
  dataCenter?: string;
  ipConfig?: { v4?: { ip?: string }; v6?: { ip?: string } };
  errorMessage?: string;
}

interface ContaboImage {
  imageId?: string;
  name?: string;
  description?: string;
  osType?: string;
  status?: string;
  standardImage?: boolean;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface CachedToken {
  value: string;
  /** Epoch milliseconds. A refresh margin is already subtracted. */
  expiresAt: number;
}

function firstData<T>(response: ContaboEnvelope<T>, description: string): T {
  const item = response.data?.[0];
  if (!item) throw new ProviderError('PROVIDER_ERROR', `Contabo returned no ${description}`, true);
  return item;
}

function toServer(instance: ContaboInstance): ProviderServer {
  const id = instance.instanceId;
  if (id === undefined || id === null) {
    throw new ProviderError('PROVIDER_ERROR', 'Contabo returned an instance without an instanceId', true);
  }
  return {
    id: String(id),
    status: instance.status ?? 'unknown',
    name: instance.displayName ?? instance.name ?? null,
    ipAddress: instance.ipConfig?.v4?.ip ?? instance.ipConfig?.v6?.ip ?? null,
    imageId: instance.imageId ?? null,
    metadata: {
      productId: instance.productId ?? null,
      region: instance.region ?? null,
      dataCenter: instance.dataCenter ?? null,
      errorMessage: instance.errorMessage ?? null,
    },
  };
}

function toImage(image: ContaboImage): ProviderImage | null {
  if (!image.imageId) return null;
  const status = (image.status ?? '').toLowerCase();
  return {
    id: image.imageId,
    name: image.name ?? image.description ?? null,
    // Contabo's image representation currently has no architecture field. The catalog's
    // architecture remains authoritative and is verified by the configured operator mapping.
    architecture: null,
    available: status === 'available' || status === 'ready',
    metadata: {
      osType: image.osType ?? null,
      standardImage: image.standardImage ?? false,
      providerStatus: image.status ?? null,
    },
  };
}

function asPositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value) && Number(value) > 0) return Number(value);
  return null;
}

interface ContaboSecret {
  secretId?: number | string;
}

/**
 * Contabo accepts only a `secretId` for the rescue root password, never a raw password. Entering
 * rescue therefore starts by storing a freshly generated one-time password as a Contabo secret and
 * passing that secret's id to the rescue action. The pattern below satisfies Contabo's documented
 * requirement: at least one upper and one lower case character, and at least three digits with one
 * special character from `!@#$^&*?_~`.
 */
function generateRescuePassword(pick: (max: number) => number = randomInt): string {
  const letters = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const specials = '!@#$^&*?_~';
  const choose = (alphabet: string): string => alphabet.charAt(pick(alphabet.length));
  let password = `${choose(letters.toUpperCase())}${choose(letters)}`;
  for (let index = 0; index < 3; index += 1) password += choose(digits);
  password += choose(specials);
  for (let index = 0; index < 4; index += 1) password += choose(letters);
  return password;
}

/**
 * Contabo requires a UUID request id on every API call. The platform idempotency key is carried
 * separately in the display-name marker because request ids must be fresh UUIDv4 values and are
 * not persistent idempotency keys.
 */
function providerDisplayName(name: string, idempotencyKey: string): string {
  const marker = ` [${IDEMPOTENCY_MARKER}${idempotencyKey}]`;
  return `${name.trim().slice(0, Math.max(1, 255 - marker.length)) || 'CloudHost247'}${marker}`;
}

/** Native Contabo Compute API adapter. OAuth access tokens live only in this process's memory. */
export class ContaboProviderAdapter implements InfrastructureProviderAdapter {
  readonly kind = 'contabo';
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly apiUser: string | undefined;
  private readonly apiPassword: string | undefined;
  private readonly baseUrl: string;
  private readonly tokenUrl: string;
  private token: CachedToken | null = null;
  private tokenRequest: Promise<string> | null = null;

  constructor(readonly provider: InfrastructureProviderRow, source: NodeJS.ProcessEnv = process.env) {
    const prefix = provider.credential_env_prefix || 'CONTABO';
    this.clientId = source[`${prefix}_CLIENT_ID`] ?? source.CONTABO_CLIENT_ID;
    this.clientSecret = source[`${prefix}_CLIENT_SECRET`] ?? source.CONTABO_CLIENT_SECRET;
    this.apiUser = source[`${prefix}_API_USER`] ?? source.CONTABO_API_USER;
    this.apiPassword = source[`${prefix}_API_PASSWORD`] ?? source.CONTABO_API_PASSWORD;
    this.baseUrl = (provider.api_base_url ?? source[`${prefix}_API_URL`] ?? source.CONTABO_API_URL ?? DEFAULT_API_URL).replace(/\/$/, '');
    this.tokenUrl = source[`${prefix}_TOKEN_URL`] ?? source.CONTABO_TOKEN_URL ?? DEFAULT_TOKEN_URL;
  }

  private ensureConfigured(): void {
    if (!this.clientId || !this.clientSecret || !this.apiUser || !this.apiPassword) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'Contabo OAuth2/API credentials are not configured', false);
    }
  }

  private async exchangeToken(): Promise<string> {
    this.ensureConfigured();
    const form = new URLSearchParams({
      grant_type: 'password',
      client_id: this.clientId as string,
      client_secret: this.clientSecret as string,
      username: this.apiUser as string,
      password: this.apiPassword as string,
    });
    let response: TokenResponse;
    try {
      response = await providerRequest<TokenResponse>(this.tokenUrl, {
        method: 'POST',
        body: form.toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } catch (error) {
      // OAuth deliberately returns HTTP 400 for bad credentials. It is not a plan/configuration
      // error and is not retriable until an operator corrects the server-side secret.
      if (error instanceof ProviderError) {
        const status = asRecord(error.providerResponse).status;
        if (status === 400 || status === 401 || error.code === 'AUTHENTICATION_FAILED') {
          throw new ProviderError('AUTHENTICATION_FAILED', 'Contabo rejected the configured OAuth credentials', false);
        }
      }
      throw error;
    }
    if (!response.access_token) {
      throw new ProviderError('AUTHENTICATION_FAILED', 'Contabo OAuth token response had no access token', false);
    }
    // Never store token material in the database, audit trail, logs, or provider response.
    const expiresInMs = Math.max(1_000, (response.expires_in ?? 60) * 1_000);
    // Refresh roughly one quarter before expiry, capped at 30 seconds. This remains safe even if
    // Contabo returns an unusually short-lived token.
    const lifetimeMs = Math.max(1_000, expiresInMs - Math.min(30_000, Math.floor(expiresInMs / 4)));
    this.token = { value: response.access_token, expiresAt: Date.now() + lifetimeMs };
    return this.token.value;
  }

  private async accessToken(): Promise<string> {
    this.ensureConfigured();
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    // A worker may issue concurrent health/status checks. Share one exchange rather than stampede
    // the OAuth endpoint or create separate short-lived credentials.
    if (!this.tokenRequest) {
      this.tokenRequest = this.exchangeToken().finally(() => { this.tokenRequest = null; });
    }
    return this.tokenRequest;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.accessToken();
    return providerRequest<T>(`${this.baseUrl}${path}`, init, {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-request-id': randomUUID(),
      },
    });
  }

  private async requestEnvelope<T>(path: string, init: RequestInit = {}): Promise<ContaboEnvelope<T>> {
    return this.request<ContaboEnvelope<T>>(path, init);
  }

  private async listInstances(query: URLSearchParams): Promise<ContaboInstance[]> {
    const result = await this.requestEnvelope<ContaboInstance>(`/compute/instances?${query.toString()}`);
    return result.data ?? [];
  }

  private providerSshKeyIds(metadata: Record<string, unknown>): number[] {
    const raw = metadata.providerSshKeyIds;
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
      throw new ProviderError('INVALID_CONFIGURATION', 'Contabo providerSshKeyIds must be an array of Contabo secret ids', false);
    }
    const ids = raw.map(asPositiveInteger);
    if (ids.some((id) => id === null)) {
      throw new ProviderError('INVALID_CONFIGURATION', 'Contabo providerSshKeyIds must contain positive integer secret ids', false);
    }
    return ids as number[];
  }

  async validateConfiguration(): Promise<void> {
    // A read-only request proves both token acquisition and Compute API authorization.
    await this.listInstances(new URLSearchParams({ page: '1', size: '1' }));
  }

  async createServer(input: CreateProviderServerInput): Promise<ProviderServer> {
    const existing = await this.findServerByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;

    const productId = asString(input.planMetadata.providerServerType)
      ?? asString(input.planMetadata.productId)
      ?? asString(input.planMetadata.contaboProductId);
    const imageId = input.image.provider_image_id ?? input.image.provider_template_id;
    const period = asPositiveInteger(input.planMetadata.contaboPeriodMonths) ?? 1;
    const defaultUser = asString(input.planMetadata.contaboDefaultUser) ?? 'admin';
    if (!productId) throw new ProviderError('INVALID_CONFIGURATION', 'Contabo plan requires providerServerType (product id)', false);
    if (!imageId) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image has no Contabo image identifier', false);
    if (![1, 12, 24].includes(period)) {
      throw new ProviderError('INVALID_CONFIGURATION', 'Contabo contaboPeriodMonths must be 1, 12, or 24', false);
    }
    if (!['root', 'admin', 'administrator'].includes(defaultUser)) {
      throw new ProviderError('INVALID_CONFIGURATION', 'Contabo contaboDefaultUser must be root, admin, or administrator', false);
    }

    const body: Record<string, unknown> = {
      imageId,
      productId,
      region: input.regionCode,
      period,
      displayName: providerDisplayName(input.name, input.idempotencyKey),
      defaultUser,
      userData: input.userData,
    };
    const sshKeys = this.providerSshKeyIds(input.planMetadata);
    if (sshKeys.length > 0) body.sshKeys = sshKeys;
    const license = asString(input.planMetadata.contaboLicense);
    if (license) body.license = license;

    const result = await this.requestEnvelope<ContaboInstance>('/compute/instances', {
      method: 'POST', body: JSON.stringify(body),
    });
    return toServer(firstData(result, 'created instance'));
  }

  provisionServer(input: CreateProviderServerInput): Promise<ProviderServer> {
    return this.createServer(input);
  }

  async findServerByIdempotencyKey(idempotencyKey: string): Promise<ProviderServer | null> {
    const marker = `${IDEMPOTENCY_MARKER}${idempotencyKey}`;
    const instances = await this.listInstances(new URLSearchParams({ displayName: marker, page: '1', size: '100' }));
    const instance = instances.find((item) => item.displayName?.includes(marker));
    return instance ? toServer(instance) : null;
  }

  async deleteServer(_providerServerId: string): Promise<void> {
    // The documented Contabo endpoint only schedules cancellation, commonly at the end of a
    // paid term. The platform's DELETE contract means the resource is already gone and billing
    // has stopped, so treating a scheduled cancellation as a completed deletion would be unsafe.
    throw new ProviderError(
      'UNSUPPORTED_OPERATION',
      'Contabo API cancellation is scheduled rather than immediate; use an operator-confirmed cancellation workflow',
      false,
    );
  }

  private async action(providerServerId: string, action: 'start' | 'restart' | 'stop' | 'shutdown'): Promise<void> {
    await this.requestEnvelope(`/compute/instances/${encodeURIComponent(providerServerId)}/actions/${action}`, { method: 'POST' });
  }

  rebootServer(id: string): Promise<void> { return this.action(id, 'restart'); }
  shutdownServer(id: string): Promise<void> { return this.action(id, 'shutdown'); }
  startServer(id: string): Promise<void> { return this.action(id, 'start'); }
  powerOnServer(id: string): Promise<void> { return this.startServer(id); }
  powerOffServer(id: string): Promise<void> { return this.shutdownServer(id); }
  getServer(id: string): Promise<ProviderServer> { return this.getServerStatus(id); }
  rebuildServer(input: ReinstallProviderServerInput): Promise<ProviderServer> { return this.reinstallServer(input); }

  async resizeServer(_providerServerId: string, _planMetadata: Record<string, unknown>): Promise<ProviderServer> {
    throw new ProviderError(
      'UNSUPPORTED_OPERATION',
      'Contabo has no API resize: its only upgrade endpoint (POST /v1/compute/instances/{id}/upgrade) purchases add-ons — Contabo documents it as allowing only firewalling and the private network add-on — and PATCH only changes the display name. Product/size changes are made in the Control Panel',
      false,
    );
  }

  async createSnapshot(providerServerId: string, description: string): Promise<Record<string, unknown>> {
    const name = description.trim().slice(0, 30) || 'CloudHost247 snapshot';
    const result = await this.requestEnvelope<Record<string, unknown>>(
      `/compute/instances/${encodeURIComponent(providerServerId)}/snapshots`,
      { method: 'POST', body: JSON.stringify({ name, description: description.trim().slice(0, 255) || undefined }) },
    );
    return asRecord(firstData(result, 'created snapshot'));
  }

  async deleteSnapshot(providerServerId: string, snapshotId: string): Promise<void> {
    await this.requestEnvelope(
      `/compute/instances/${encodeURIComponent(providerServerId)}/snapshots/${encodeURIComponent(snapshotId)}`,
      { method: 'DELETE' },
    );
  }

  async restoreSnapshot(providerServerId: string, snapshotId: string): Promise<void> {
    await this.requestEnvelope(
      `/compute/instances/${encodeURIComponent(providerServerId)}/snapshots/${encodeURIComponent(snapshotId)}/rollback`,
      { method: 'POST', body: JSON.stringify({}) },
    );
  }

  async getServerStatus(providerServerId: string): Promise<ProviderServer> {
    const result = await this.requestEnvelope<ContaboInstance>(`/compute/instances/${encodeURIComponent(providerServerId)}`);
    return toServer(firstData(result, 'instance'));
  }

  async getServerIP(providerServerId: string): Promise<string | null> {
    return (await this.getServerStatus(providerServerId)).ipAddress;
  }

  async getAvailableImages(): Promise<ProviderImage[]> {
    const images: ContaboImage[] = [];
    let page = 1;
    let totalPages = 1;
    // Avoid unbounded traversal should a malformed upstream response advertise an enormous page count.
    while (page <= totalPages && page <= 100) {
      const result = await this.requestEnvelope<ContaboImage>(`/compute/images?page=${page}&size=100`);
      images.push(...(result.data ?? []));
      totalPages = Math.max(1, result._pagination?.totalPages ?? 1);
      page += 1;
    }
    return images.map(toImage).filter((image): image is ProviderImage => image !== null);
  }

  async getImage(image: ServerOsImageRow): Promise<ProviderImage | null> {
    const identifier = image.provider_image_id ?? image.provider_template_id;
    if (!identifier) return null;
    try {
      const result = await this.requestEnvelope<ContaboImage>(`/compute/images/${encodeURIComponent(identifier)}`);
      return toImage(firstData(result, 'image'));
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'RESOURCE_NOT_FOUND') return null;
      throw error;
    }
  }

  async reinstallServer(input: ReinstallProviderServerInput): Promise<ProviderServer> {
    const imageId = input.image.provider_image_id ?? input.image.provider_template_id;
    if (!imageId) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image has no Contabo image identifier', false);
    const current = await this.getServerStatus(input.providerServerId);
    if (input.isRetry && (current.imageId === imageId || ['installing', 'provisioning', 'reset_password'].includes(current.status))) {
      return current;
    }
    // Public SSH keys are embedded in platform-generated cloud-init user-data. Contabo's sshKeys
    // field takes Contabo Secret ids and cannot safely accept raw public-key strings here.
    await this.requestEnvelope(`/compute/instances/${encodeURIComponent(input.providerServerId)}`, {
      method: 'PUT', body: JSON.stringify({ imageId, userData: input.userData, defaultUser: 'admin' }),
    });
    return this.getServerStatus(input.providerServerId);
  }

  /**
   * Enter Contabo's rescue system. The rescue action takes `sshKeys`/`rootPassword` Contabo
   * *secret ids*, not key material or a plaintext password: when the server template already
   * carries SSH-key secrets they are reused, otherwise a one-time password is stored as a Contabo
   * secret and handed to the requesting customer exactly once.
   */
  async enableRescue(providerServerId: string, input: RescueRequest): Promise<RescueSession> {
    const instancePath = `/compute/instances/${encodeURIComponent(providerServerId)}/actions/rescue`;
    const sshKeySecrets = (input.providerSshKeyIds ?? [])
      .map((value) => asPositiveInteger(value))
      .filter((value): value is number => value !== null);
    if (sshKeySecrets.length > 0) {
      await this.requestEnvelope(instancePath, { method: 'POST', body: JSON.stringify({ sshKeys: sshKeySecrets }) });
      return {
        type: 'contabo-rescue',
        username: 'root',
        rebooted: true,
        notes: 'Contabo boots the rescue system instead of the installed OS; access uses the SSH-key secrets from the server template.',
      };
    }

    const password = generateRescuePassword();
    const secret = await this.requestEnvelope<ContaboSecret>('/secrets', {
      method: 'POST',
      body: JSON.stringify({
        name: `ch247-rescue-${providerServerId}-${Date.now()}`,
        value: password,
        type: 'password',
      }),
    });
    const secretId = asPositiveInteger(firstData(secret, 'created rescue secret').secretId);
    if (secretId === null) {
      throw new ProviderError('PROVIDER_ERROR', 'Contabo returned a rescue secret without a secretId', false);
    }
    await this.requestEnvelope(instancePath, { method: 'POST', body: JSON.stringify({ rootPassword: secretId }) });
    return {
      type: 'contabo-rescue',
      username: 'root',
      password,
      rebooted: true,
      notes: 'Contabo boots the rescue system instead of the installed OS. The one-time password exists only as the Contabo secret passed to the rescue action; the next restart boots the installed OS again.',
    };
  }

  async disableRescue(providerServerId: string): Promise<void> {
    // Contabo has no unrescue action: the next restart boots the installed operating system again,
    // which is the documented way out of the rescue system.
    await this.requestEnvelope(`/compute/instances/${encodeURIComponent(providerServerId)}/actions/restart`, { method: 'POST' });
  }

  async getConsole(_providerServerId: string): Promise<Record<string, unknown>> {
    throw new ProviderError('UNSUPPORTED_OPERATION', 'Contabo exposes no VNC endpoint in the Compute API: the documented instance actions are start, stop, shutdown, restart, rescue and resetPassword. The VNC console is a Control Panel feature', false);
  }

  async getServerMetrics(_providerServerId: string): Promise<Record<string, unknown>> {
    throw new ProviderError('UNSUPPORTED_OPERATION', 'Contabo exposes no instance metrics endpoint; monitoring is a Control Panel add-on', false);
  }

  async healthCheck(providerServerId: string, expectedImage: ServerOsImageRow): Promise<ProviderHealthResult> {
    try {
      const server = await this.getServerStatus(providerServerId);
      const expectedImageId = expectedImage.provider_image_id ?? expectedImage.provider_template_id;
      return {
        exists: true,
        poweredOn: server.status === 'running',
        ipAddress: server.ipAddress,
        imageMatches: !expectedImageId || server.imageId === expectedImageId,
        providerStatus: server.status,
      };
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'RESOURCE_NOT_FOUND') {
        return { exists: false, poweredOn: false, ipAddress: null, imageMatches: false, providerStatus: 'missing' };
      }
      throw error;
    }
  }
}
