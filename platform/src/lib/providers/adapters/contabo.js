/**
 * Contabo Cloud VPS / VDS adapter.
 *
 * Ported from cloudhost247-node/src/infrastructure/providers/contabo-adapter.ts.
 *
 * Required configuration: `<PREFIX>_CLIENT_ID`, `<PREFIX>_CLIENT_SECRET`, `<PREFIX>_API_USER`,
 * `<PREFIX>_API_PASSWORD` (the OAuth2 client-credentials pair plus the Contabo API user, which its
 * `password` grant requires). Endpoints default to Contabo's public API and identity server and can
 * be overridden per provider (`api_base_url`, `<PREFIX>_API_URL`, `<PREFIX>_TOKEN_URL`).
 *
 * The access token is cached in memory only, never written anywhere, and a single in-flight token
 * request is shared so a burst of API calls does not hammer the identity server. The customer-facing
 * instance name carries a `ch247:<job key>` marker because the Compute API has no idempotency key:
 * the provider is always asked for that marker before an instance is created.
 *
 * This build applies the same plaintext refusal to the Contabo endpoints as to every other provider
 * (the audited original only did so for some providers) — an OAuth client secret and API password
 * must never travel over http.
 */
'use strict';

const { randomInt, randomUUID } = require('node:crypto');
const { providerRequest } = require('../http');
const { asRecord, asString, ProviderError } = require('../types');
const { requireSecureBaseUrl } = require('../common');

const DEFAULT_API_URL = 'https://api.contabo.com/v1';
const DEFAULT_TOKEN_URL = 'https://auth.contabo.com/auth/realms/contabo/protocol/openid-connect/token';
const IDEMPOTENCY_MARKER = 'ch247:';

function firstData(response, description) {
  const item = (response?.data ?? [])[0];
  if (!item) throw new ProviderError('PROVIDER_ERROR', `Contabo returned no ${description}`, true);
  return item;
}

function toServer(instance) {
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

function toImage(image) {
  if (!image.imageId) return null;
  const status = String(image.status ?? '').toLowerCase();
  return {
    id: image.imageId,
    name: image.name ?? image.description ?? null,
    architecture: null,
    available: status === 'available' || status === 'ready',
    metadata: {
      osType: image.osType ?? null,
      standardImage: image.standardImage ?? false,
      providerStatus: image.status ?? null,
    },
  };
}

function asPositiveInteger(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value) && Number(value) > 0) return Number(value);
  return null;
}

/**
 * Contabo's documented password policy excludes confusable characters (no `l`, `1`, `0`, `O`, `o`).
 * `pick` is injectable so a test can drive the exact alphabet positions rather than assert on
 * randomness.
 */
function generateRescuePassword(pick = randomInt) {
  const letters = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const specials = '!@#$^&*?_~';
  const choose = (alphabet) => alphabet.charAt(pick(alphabet.length));
  let password = `${choose(letters.toUpperCase())}${choose(letters)}`;
  for (let index = 0; index < 3; index += 1) password += choose(digits);
  password += choose(specials);
  for (let index = 0; index < 4; index += 1) password += choose(letters);
  return password;
}

/** The provider-visible instance name: the customer's name plus the idempotency marker. */
function providerDisplayName(name, idempotencyKey) {
  const marker = ` [${IDEMPOTENCY_MARKER}${idempotencyKey}]`;
  return `${String(name ?? '').trim().slice(0, Math.max(1, 255 - marker.length)) || 'CloudHost247'}${marker}`;
}

class ContaboProviderAdapter {
  constructor(provider, options = {}) {
    this.kind = 'contabo';
    this.provider = provider;
    const source = options.source ?? process.env;
    this.transport = options.transport;
    const prefix = provider.credential_env_prefix || 'CONTABO';
    this.clientId = source[`${prefix}_CLIENT_ID`] ?? source.CONTABO_CLIENT_ID;
    this.clientSecret = source[`${prefix}_CLIENT_SECRET`] ?? source.CONTABO_CLIENT_SECRET;
    this.apiUser = source[`${prefix}_API_USER`] ?? source.CONTABO_API_USER;
    this.apiPassword = source[`${prefix}_API_PASSWORD`] ?? source.CONTABO_API_PASSWORD;
    this.baseUrl = provider.api_base_url ?? source[`${prefix}_API_URL`] ?? source.CONTABO_API_URL ?? DEFAULT_API_URL;
    this.tokenUrl = source[`${prefix}_TOKEN_URL`] ?? source.CONTABO_TOKEN_URL ?? DEFAULT_TOKEN_URL;
    this.token = null;
    this.tokenRequest = null;
  }

  ensureConfigured() {
    if (!this.clientId || !this.clientSecret || !this.apiUser || !this.apiPassword) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'Contabo OAuth2/API credentials are not configured', false);
    }
  }

  /**
   * Contabo's Compute API authenticates with an OAuth2 `password` grant: the client pair identifies
   * the integration and the API user's own password authorises it. Contabo rejected the
   * client-credentials grant this adapter originally used, which is why the audited original carries
   * the customer's API user here.
   */
  async exchangeToken() {
    this.ensureConfigured();
    const form = new URLSearchParams({
      grant_type: 'password',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      username: this.apiUser,
      password: this.apiPassword,
    });
    let response;
    try {
      response = await providerRequest(this.tokenUrl, {
        method: 'POST',
        body: form.toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }, { transport: this.transport });
    } catch (error) {
      if (error instanceof ProviderError) {
        const status = asRecord(error.providerResponse).status;
        if (status === 400 || status === 401 || error.code === 'AUTHENTICATION_FAILED') {
          throw new ProviderError('AUTHENTICATION_FAILED', 'Contabo rejected the configured OAuth credentials', false);
        }
      }
      throw error;
    }
    if (!response?.access_token) {
      throw new ProviderError('AUTHENTICATION_FAILED', 'Contabo OAuth token response had no access token', false);
    }
    // Refresh a little early rather than racing the expiry, and never store the token outside memory.
    const expiresInMs = Math.max(1_000, (response.expires_in ?? 60) * 1_000);
    const lifetimeMs = Math.max(1_000, expiresInMs - Math.min(30_000, Math.floor(expiresInMs / 4)));
    this.token = { value: response.access_token, expiresAt: Date.now() + lifetimeMs };
    return this.token.value;
  }

  async accessToken() {
    this.ensureConfigured();
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    if (!this.tokenRequest) {
      this.tokenRequest = this.exchangeToken().finally(() => { this.tokenRequest = null; });
    }
    return this.tokenRequest;
  }

  async request(path, init = {}) {
    const token = await this.accessToken();
    return providerRequest(
      `${requireSecureBaseUrl('Contabo', this.baseUrl)}${path}`,
      init,
      {
        headers: { Authorization: `Bearer ${token}`, 'x-request-id': randomUUID() },
        transport: this.transport,
      },
    );
  }

  async listInstances(query) {
    const result = await this.request(`/compute/instances?${query.toString()}`);
    return result?.data ?? [];
  }

  providerSshKeyIds(metadata) {
    const raw = metadata?.providerSshKeyIds;
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
      throw new ProviderError('INVALID_CONFIGURATION', 'Contabo providerSshKeyIds must be an array of Contabo secret ids', false);
    }
    const ids = raw.map(asPositiveInteger);
    if (ids.some((id) => id === null)) {
      throw new ProviderError('INVALID_CONFIGURATION', 'Contabo providerSshKeyIds must contain positive integer secret ids', false);
    }
    return ids;
  }

  async validateConfiguration() {
    await this.listInstances(new URLSearchParams({ page: '1', size: '1' }));
  }

  async createServer(input) {
    const existing = await this.findServerByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;

    const productId = asString(input.planMetadata?.providerServerType)
      ?? asString(input.planMetadata?.productId)
      ?? asString(input.planMetadata?.contaboProductId);
    const imageId = input.image?.providerImageId ?? input.image?.provider_image_id
      ?? input.image?.providerTemplateId ?? input.image?.provider_template_id;
    const period = asPositiveInteger(input.planMetadata?.contaboPeriodMonths) ?? 1;
    const defaultUser = asString(input.planMetadata?.contaboDefaultUser) ?? 'admin';
    if (!productId) throw new ProviderError('INVALID_CONFIGURATION', 'Contabo plan requires providerServerType (product id)', false);
    if (!imageId) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image has no Contabo image identifier', false);
    if (![1, 12, 24].includes(period)) {
      throw new ProviderError('INVALID_CONFIGURATION', 'Contabo contaboPeriodMonths must be 1, 12, or 24', false);
    }
    if (!['root', 'admin', 'administrator'].includes(defaultUser)) {
      throw new ProviderError('INVALID_CONFIGURATION', 'Contabo contaboDefaultUser must be root, admin, or administrator', false);
    }

    const body = {
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
    const license = asString(input.planMetadata?.contaboLicense);
    if (license) body.license = license;

    const result = await this.request('/compute/instances', { method: 'POST', body: JSON.stringify(body) });
    return toServer(firstData(result, 'created instance'));
  }

  provisionServer(input) { return this.createServer(input); }

  async findServerByIdempotencyKey(idempotencyKey) {
    const marker = `${IDEMPOTENCY_MARKER}${idempotencyKey}`;
    const instances = await this.listInstances(new URLSearchParams({ displayName: marker, page: '1', size: '100' }));
    const instance = instances.find((item) => String(item.displayName ?? '').includes(marker));
    return instance ? toServer(instance) : null;
  }

  /** Contabo cancellation is scheduled for the end of the billing period, not immediate. */
  async deleteServer() {
    throw new ProviderError(
      'UNSUPPORTED_OPERATION',
      'Contabo API cancellation is scheduled rather than immediate; use an operator-confirmed cancellation workflow',
      false,
    );
  }

  async action(providerServerId, name) {
    await this.request(`/compute/instances/${encodeURIComponent(providerServerId)}/actions/${name}`, { method: 'POST' });
  }

  async rebootServer(id) { await this.action(id, 'restart'); }
  async shutdownServer(id) { await this.action(id, 'shutdown'); }
  async startServer(id) { await this.action(id, 'start'); }
  powerOnServer(id) { return this.startServer(id); }
  powerOffServer(id) { return this.shutdownServer(id); }
  getServer(id) { return this.getServerStatus(id); }
  rebuildServer(input) { return this.reinstallServer(input); }

  /**
   * Contabo has no API resize. Its only upgrade endpoint purchases add-ons — Contabo documents it as
   * allowing just firewalling and the private-network add-on — and PATCH changes the display name
   * only. Product/size changes happen in the Control Panel, so the platform refuses instead of
   * silently doing nothing.
   */
  async resizeServer() {
    throw new ProviderError(
      'UNSUPPORTED_OPERATION',
      'Contabo has no API resize: its only upgrade endpoint purchases add-ons, and PATCH only changes the display name. Product/size changes are made in the Control Panel',
      false,
    );
  }

  async createSnapshot(providerServerId, description) {
    const name = String(description ?? '').trim().slice(0, 30) || 'CloudHost247 snapshot';
    const result = await this.request(
      `/compute/instances/${encodeURIComponent(providerServerId)}/snapshots`,
      { method: 'POST', body: JSON.stringify({ name, description: String(description ?? '').trim().slice(0, 255) || undefined }) },
    );
    return asRecord(firstData(result, 'created snapshot'));
  }

  async deleteSnapshot(providerServerId, snapshotId) {
    await this.request(
      `/compute/instances/${encodeURIComponent(providerServerId)}/snapshots/${encodeURIComponent(snapshotId)}`,
      { method: 'DELETE' },
    );
  }

  async restoreSnapshot(providerServerId, snapshotId) {
    await this.request(
      `/compute/instances/${encodeURIComponent(providerServerId)}/snapshots/${encodeURIComponent(snapshotId)}/rollback`,
      { method: 'POST', body: JSON.stringify({}) },
    );
  }

  async getServerStatus(providerServerId) {
    const result = await this.request(`/compute/instances/${encodeURIComponent(providerServerId)}`);
    return toServer(firstData(result, 'instance'));
  }

  async getServerIP(providerServerId) {
    return (await this.getServerStatus(providerServerId)).ipAddress;
  }

  async getAvailableImages() {
    const images = [];
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages && page <= 100) {
      const result = await this.request(`/compute/images?page=${page}&size=100`);
      images.push(...(result?.data ?? []));
      totalPages = Math.max(1, result?._pagination?.totalPages ?? 1);
      page += 1;
    }
    return images.map(toImage).filter((image) => image !== null);
  }

  async getImage(image) {
    const identifier = image?.providerImageId ?? image?.provider_image_id
      ?? image?.providerTemplateId ?? image?.provider_template_id;
    if (!identifier) return null;
    try {
      const result = await this.request(`/compute/images/${encodeURIComponent(identifier)}`);
      return toImage(firstData(result, 'image'));
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'RESOURCE_NOT_FOUND') return null;
      throw error;
    }
  }

  async reinstallServer(input) {
    const imageId = input.image?.providerImageId ?? input.image?.provider_image_id
      ?? input.image?.providerTemplateId ?? input.image?.provider_template_id;
    if (!imageId) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image has no Contabo image identifier', false);
    const current = await this.getServerStatus(input.providerServerId);
    if (input.isRetry && (current.imageId === imageId || ['installing', 'provisioning', 'reset_password'].includes(current.status))) {
      return current;
    }
    await this.request(`/compute/instances/${encodeURIComponent(input.providerServerId)}`, {
      method: 'PUT',
      body: JSON.stringify({ imageId, userData: input.userData, defaultUser: 'admin' }),
    });
    return this.getServerStatus(input.providerServerId);
  }

  /**
   * Contabo's rescue action boots the rescue system; access is either the SSH key secrets given here
   * or a one-time root password that is created as a Contabo secret and passed to the action. The
   * plaintext password is returned to the caller and kept nowhere else.
   */
  async enableRescue(providerServerId, input = {}) {
    const instancePath = `/compute/instances/${encodeURIComponent(providerServerId)}/actions/rescue`;
    const sshKeySecrets = (input.providerSshKeyIds ?? [])
      .map((value) => asPositiveInteger(value))
      .filter((value) => value !== null);
    if (sshKeySecrets.length > 0) {
      await this.request(instancePath, { method: 'POST', body: JSON.stringify({ sshKeys: sshKeySecrets }) });
      return {
        type: 'contabo-rescue',
        username: 'root',
        rebooted: true,
        notes: 'Contabo boots the rescue system instead of the installed OS; access uses the SSH-key secrets from the server template.',
      };
    }

    const password = generateRescuePassword();
    const secret = await this.request('/secrets', {
      method: 'POST',
      body: JSON.stringify({
        name: `ch247-rescue-${providerServerId}-${Date.now()}`,
        value: password,
        type: 'password',
      }),
    });
    const secretId = asPositiveInteger(firstData(secret, 'created rescue secret')?.secretId);
    if (secretId === null) {
      throw new ProviderError('PROVIDER_ERROR', 'Contabo returned a rescue secret without a secretId', false);
    }
    await this.request(instancePath, { method: 'POST', body: JSON.stringify({ rootPassword: secretId }) });
    return {
      type: 'contabo-rescue',
      username: 'root',
      password,
      rebooted: true,
      notes: 'Contabo boots the rescue system instead of the installed OS. The one-time password exists only as the Contabo secret passed to the rescue action; the next restart boots the installed OS again.',
    };
  }

  async disableRescue(providerServerId) {
    await this.action(providerServerId, 'restart');
  }

  /** Contabo's Compute API documents start, stop, shutdown, restart, rescue and resetPassword — no VNC. */
  async getConsole() {
    throw new ProviderError(
      'UNSUPPORTED_OPERATION',
      'Contabo exposes no VNC endpoint in the Compute API: the documented instance actions are start, stop, shutdown, restart, rescue and resetPassword. The VNC console is a Control Panel feature',
      false,
    );
  }

  async getServerMetrics() {
    throw new ProviderError(
      'UNSUPPORTED_OPERATION',
      'Contabo exposes no instance metrics endpoint; monitoring is a Control Panel add-on',
      false,
    );
  }

  async healthCheck(providerServerId, expectedImage) {
    try {
      const server = await this.getServerStatus(providerServerId);
      const expected = expectedImage?.providerImageId ?? expectedImage?.provider_image_id
        ?? expectedImage?.providerTemplateId ?? expectedImage?.provider_template_id;
      return {
        exists: true,
        poweredOn: server.status === 'running',
        ipAddress: server.ipAddress,
        imageMatches: !expected || server.imageId === expected,
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

module.exports = {
  ContaboProviderAdapter,
  generateRescuePassword,
  providerDisplayName,
  IDEMPOTENCY_MARKER,
  DEFAULT_API_URL,
  DEFAULT_TOKEN_URL,
  toServer,
  toImage,
};
