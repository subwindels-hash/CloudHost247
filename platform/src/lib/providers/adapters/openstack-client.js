/**
 * OpenStack Keystone session (identity + service catalog).
 *
 * Ported from cloudhost247-node/src/infrastructure/providers/openstack-client.ts.
 *
 * OpenStack authenticates once and then addresses every subsequent call with the token Keystone
 * returned in the `x-subject-token` response header. This client therefore needs one thing the other
 * provider clients do not: the response headers, not just the parsed body — hence the
 * `returnResponse` option on the shared HTTP entry point.
 *
 * The token and the credentials stay in this object. Nothing here logs, and the catalog is used only
 * to resolve the Nova (compute) and Glance (image) endpoints.
 */
'use strict';

const { providerRequest } = require('../http');
const { ProviderError } = require('../types');

/** Reads a header whether the caller got real fetch Headers or a plain object (tests). */
function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return Array.isArray(value) ? value[0] : value;
  }
  return null;
}

class OpenStackSession {
  constructor(config, options = {}) {
    this.config = config;
    this.transport = options.transport;
    this.token = null;
    this.expiresAt = 0;
    this.catalog = [];
  }

  /**
   * A project-scoped token can also be supplied directly (`<PREFIX>_API_TOKEN`), which is how an
   * operator whose Keystone sits behind a federation bridge uses this adapter. Static tokens are
   * re-checked every minute because their real expiry is not knowable from here.
   */
  async authenticate() {
    if (this.config.staticToken) {
      this.token = this.config.staticToken;
      this.expiresAt = Date.now() + 60_000;
      return;
    }
    if (!this.config.username || !this.config.password || !(this.config.projectId || this.config.projectName)) {
      throw new ProviderError(
        'PROVIDER_NOT_CONFIGURED',
        'OpenStack requires either a static API token or username/password plus a project',
        false,
      );
    }
    const identity = {
      auth: {
        identity: {
          methods: ['password'],
          password: {
            user: {
              name: this.config.username,
              password: this.config.password,
              domain: { name: this.config.userDomainName ?? 'Default' },
            },
          },
        },
        scope: this.config.projectId
          ? { project: { id: this.config.projectId } }
          : { project: { name: this.config.projectName, domain: { name: this.config.projectDomainName ?? 'Default' } } },
      },
    };
    const response = await this.fetchToken(`${this.config.authUrl}/auth/tokens`, identity);
    this.token = response.token;
    this.expiresAt = response.expiresAt;
    this.catalog = response.catalog;
  }

  async ensureToken() {
    if (!this.token || Date.now() > this.expiresAt - 30_000) await this.authenticate();
    if (!this.token) {
      throw new ProviderError('AUTHENTICATION_FAILED', 'OpenStack authentication produced no token', false);
    }
    return this.token;
  }

  /** Prefers a public endpoint in the configured region, then any public endpoint. */
  endpointFromCatalog(type) {
    const service = this.catalog.find((entry) => entry.type === type);
    const endpoints = service?.endpoints ?? [];
    const match = endpoints.find(
      (endpoint) => endpoint.interface === 'public' && (!this.config.region || endpoint.region === this.config.region),
    ) ?? endpoints.find((endpoint) => endpoint.interface === 'public');
    return match?.url?.replace(/\/$/, '') ?? null;
  }

  async computeUrl() {
    await this.ensureToken();
    const url = this.config.computeUrl ?? this.endpointFromCatalog('compute');
    if (!url) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'OpenStack compute (Nova) endpoint could not be resolved', false);
    }
    return url.replace(/\/$/, '');
  }

  async imageUrl() {
    await this.ensureToken();
    const url = this.config.imageUrl ?? this.endpointFromCatalog('image');
    if (!url) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'OpenStack image (Glance) endpoint could not be resolved', false);
    }
    return url.replace(/\/$/, '');
  }

  async request(url, init = {}) {
    const token = await this.ensureToken();
    return providerRequest(url, init, {
      headers: { 'X-Auth-Token': token, 'Content-Type': 'application/json' },
      transport: this.transport,
    });
  }

  async fetchToken(url, body) {
    let response;
    try {
      response = await providerRequest(url, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: JSON.stringify(body),
      }, { transport: this.transport, returnResponse: true });
    } catch (error) {
      if (error instanceof ProviderError) {
        if (error.code === 'AUTHENTICATION_FAILED') {
          throw new ProviderError('AUTHENTICATION_FAILED', 'OpenStack rejected the supplied credentials', false);
        }
        if (error.code === 'NETWORK_TEMPORARY_FAILURE' || error.code === 'PROVIDER_ERROR') {
          // Keystone's own wording is evidence for the job record, not for the customer.
          throw new ProviderError(error.code, 'OpenStack Keystone rejected the authentication request', error.retryable, error.providerResponse);
        }
        throw error;
      }
      throw error;
    }

    const token = headerValue(response.headers, 'x-subject-token');
    if (!token) throw new ProviderError('AUTHENTICATION_FAILED', 'OpenStack Keystone returned no token', false);
    const payload = response.body ?? {};
    const expiresAt = payload?.token?.expires_at
      ? new Date(payload.token.expires_at).getTime()
      : Date.now() + 15 * 60_000;
    return { token, expiresAt, catalog: payload?.token?.catalog ?? [] };
  }
}

module.exports = { OpenStackSession, headerValue };
