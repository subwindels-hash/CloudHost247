/**
 * OpenStack Keystone v3 session.
 *
 * Supports either an application-credential/password login (token is fetched and cached in the
 * process, never persisted) or a pre-issued token supplied by the operator. Service endpoints
 * are read from the Keystone catalog so a deployment does not have to hardcode Nova/Glance URLs.
 */
import { providerRequest } from './http';
import { ProviderError } from './types';

export interface OpenStackAuthConfig {
  authUrl: string;
  username?: string;
  password?: string;
  projectId?: string;
  projectName?: string;
  userDomainName?: string;
  projectDomainName?: string;
  staticToken?: string;
  computeUrl?: string;
  imageUrl?: string;
  region?: string;
}

interface CatalogEntry {
  type?: string;
  endpoints?: Array<{ interface?: string; url?: string; region?: string }>;
}

export class OpenStackSession {
  private token: string | null = null;
  private expiresAt = 0;
  private catalog: CatalogEntry[] = [];

  constructor(private readonly config: OpenStackAuthConfig) {}

  private async authenticate(): Promise<void> {
    if (this.config.staticToken) {
      this.token = this.config.staticToken;
      // A static token has an operator-managed lifetime; re-read it on every request window.
      this.expiresAt = Date.now() + 60_000;
      return;
    }
    if (!this.config.username || !this.config.password || !(this.config.projectId || this.config.projectName)) {
      throw new ProviderError(
        'PROVIDER_NOT_CONFIGURED',
        'OpenStack requires either a static API token or username/password plus a project',
        false
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
    const url = `${this.config.authUrl}/auth/tokens`;
    const response = await fetchToken(url, identity);
    this.token = response.token;
    this.expiresAt = response.expiresAt;
    this.catalog = response.catalog;
  }

  private async ensureToken(): Promise<string> {
    if (!this.token || Date.now() > this.expiresAt - 30_000) await this.authenticate();
    if (!this.token) throw new ProviderError('AUTHENTICATION_FAILED', 'OpenStack authentication produced no token', false);
    return this.token;
  }

  private endpointFromCatalog(type: string): string | null {
    const service = this.catalog.find((entry) => entry.type === type);
    const endpoints = service?.endpoints ?? [];
    const match =
      endpoints.find((endpoint) => endpoint.interface === 'public' && (!this.config.region || endpoint.region === this.config.region))
      ?? endpoints.find((endpoint) => endpoint.interface === 'public');
    return match?.url?.replace(/\/$/, '') ?? null;
  }

  async computeUrl(): Promise<string> {
    await this.ensureToken();
    const url = this.config.computeUrl ?? this.endpointFromCatalog('compute');
    if (!url) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'OpenStack compute (Nova) endpoint could not be resolved', false);
    }
    return url.replace(/\/$/, '');
  }

  async imageUrl(): Promise<string> {
    await this.ensureToken();
    const url = this.config.imageUrl ?? this.endpointFromCatalog('image');
    if (!url) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'OpenStack image (Glance) endpoint could not be resolved', false);
    }
    return url.replace(/\/$/, '');
  }

  async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const token = await this.ensureToken();
    return providerRequest<T>(url, init, { headers: { 'X-Auth-Token': token, 'Content-Type': 'application/json' } });
  }
}

/**
 * Keystone returns the token in a response header, which the shared providerRequest helper does
 * not expose, so this one call uses fetch directly. Request/response bodies are never logged.
 */
async function fetchToken(
  url: string,
  body: unknown
): Promise<{ token: string; expiresAt: number; catalog: CatalogEntry[] }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError('AUTHENTICATION_FAILED', 'OpenStack rejected the supplied credentials', false);
    }
    if (!response.ok) {
      throw new ProviderError(
        response.status >= 500 ? 'NETWORK_TEMPORARY_FAILURE' : 'PROVIDER_ERROR',
        `OpenStack Keystone returned HTTP ${response.status}`,
        response.status >= 500
      );
    }
    const token = response.headers.get('x-subject-token');
    if (!token) throw new ProviderError('AUTHENTICATION_FAILED', 'OpenStack Keystone returned no token', false);
    const payload = (await response.json().catch(() => ({}))) as {
      token?: { expires_at?: string; catalog?: CatalogEntry[] };
    };
    const expiresAt = payload.token?.expires_at ? new Date(payload.token.expires_at).getTime() : Date.now() + 15 * 60_000;
    return { token, expiresAt, catalog: payload.token?.catalog ?? [] };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ProviderError('PROVIDER_TIMEOUT', 'OpenStack Keystone request timed out', true);
    }
    throw new ProviderError('NETWORK_TEMPORARY_FAILURE', 'OpenStack Keystone could not be reached', true);
  } finally {
    clearTimeout(timeout);
  }
}
