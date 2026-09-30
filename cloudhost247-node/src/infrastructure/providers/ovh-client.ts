/**
 * OVHcloud API client (signed v1 API).
 *
 * OVH authenticates every call with an application key/secret plus a consumer key and a
 * SHA-1 signature over the request. Secrets stay in this module: they are read from the
 * server-side environment, never logged, and never returned to a route handler or browser.
 *
 * Signature (documented by OVH):
 *   $1$ + SHA1_HEX(appSecret + "+" + consumerKey + "+" + METHOD + "+" + URL + "+" + BODY + "+" + TIMESTAMP)
 */
import { createHash } from 'node:crypto';
import { providerRequest } from './http';
import { ProviderError } from './types';

export interface OvhClientConfig {
  endpoint: string;
  applicationKey: string;
  applicationSecret: string;
  consumerKey: string;
  cloudProjectId: string;
}

export class OvhClient {
  private timeDriftSeconds: number | null = null;

  constructor(private readonly config: OvhClientConfig) {}

  get projectPath(): string {
    return `/cloud/project/${encodeURIComponent(this.config.cloudProjectId)}`;
  }

  /**
   * OVH rejects signatures whose timestamp drifts from server time, so the unauthenticated
   * /auth/time endpoint is used once per client instance to compute the offset.
   */
  private async timestamp(): Promise<number> {
    if (this.timeDriftSeconds === null) {
      const remote = await providerRequest<number | string>(`${this.config.endpoint}/auth/time`, { method: 'GET' });
      const remoteSeconds = Number(remote);
      if (!Number.isFinite(remoteSeconds)) {
        throw new ProviderError('PROVIDER_ERROR', 'OVH did not return a usable server time', true);
      }
      this.timeDriftSeconds = remoteSeconds - Math.floor(Date.now() / 1000);
    }
    return Math.floor(Date.now() / 1000) + this.timeDriftSeconds;
  }

  async request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const url = `${this.config.endpoint}${path}`;
    const serialized = body === undefined ? '' : JSON.stringify(body);
    const timestamp = await this.timestamp();
    const signature = `$1$${createHash('sha1')
      .update(
        [
          this.config.applicationSecret,
          this.config.consumerKey,
          method,
          url,
          serialized,
          String(timestamp),
        ].join('+')
      )
      .digest('hex')}`;
    return providerRequest<T>(
      url,
      { method, ...(serialized ? { body: serialized } : {}) },
      {
        headers: {
          'X-Ovh-Application': this.config.applicationKey,
          'X-Ovh-Consumer': this.config.consumerKey,
          'X-Ovh-Timestamp': String(timestamp),
          'X-Ovh-Signature': signature,
          'Content-Type': 'application/json',
        },
      }
    );
  }
}

export interface OvhInstance {
  id: string;
  name?: string;
  status?: string;
  region?: string;
  flavorId?: string;
  imageId?: string;
  image?: { id?: string; name?: string; status?: string } | null;
  ipAddresses?: Array<{ ip?: string; type?: string; version?: number }>;
}

export interface OvhImage {
  id: string;
  name?: string;
  status?: string;
  region?: string;
  visibility?: string;
  type?: string;
  flavorType?: string | null;
  tags?: string[];
  propertiesArchitecture?: string;
}
