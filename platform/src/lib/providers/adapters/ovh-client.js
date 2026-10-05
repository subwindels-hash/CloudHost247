/**
 * OVHcloud API client (signed v1 API).
 *
 * Ported from cloudhost247-node/src/infrastructure/providers/ovh-client.ts. OVH authenticates every
 * call with an application key/secret plus a consumer key and a SHA-1 signature over the request.
 * Secrets stay in this module: they are read from the server-side environment, never logged, and
 * never returned to a route handler or browser.
 *
 * Signature (documented by OVH):
 *   $1$ + SHA1_HEX(appSecret + "+" + consumerKey + "+" + METHOD + "+" + URL + "+" + BODY + "+" + TIMESTAMP)
 */
'use strict';

const { createHash } = require('node:crypto');
const { providerRequest } = require('../http');
const { ProviderError } = require('../types');

class OvhClient {
  constructor(config, options = {}) {
    this.config = config;
    this.transport = options.transport;
    this.timeDriftSeconds = null;
  }

  get projectPath() {
    return `/cloud/project/${encodeURIComponent(this.config.cloudProjectId)}`;
  }

  /**
   * OVH rejects signatures whose timestamp drifts from server time, so the unauthenticated
   * /auth/time endpoint is used once per client instance to compute the offset.
   */
  async timestamp() {
    if (this.timeDriftSeconds === null) {
      const remote = await providerRequest(`${this.config.endpoint}/auth/time`, { method: 'GET' }, {
        transport: this.transport,
      });
      const remoteSeconds = Number(remote);
      if (!Number.isFinite(remoteSeconds)) {
        throw new ProviderError('PROVIDER_ERROR', 'OVH did not return a usable server time', true);
      }
      this.timeDriftSeconds = remoteSeconds - Math.floor(Date.now() / 1000);
    }
    return Math.floor(Date.now() / 1000) + this.timeDriftSeconds;
  }

  async request(method, path, body) {
    const url = `${this.config.endpoint}${path}`;
    const serialized = body === undefined ? '' : JSON.stringify(body);
    const timestamp = await this.timestamp();
    const signature = `$1$${createHash('sha1')
      .update([
        this.config.applicationSecret,
        this.config.consumerKey,
        method,
        url,
        serialized,
        String(timestamp),
      ].join('+'))
      .digest('hex')}`;
    return providerRequest(url, { method, ...(serialized ? { body: serialized } : {}) }, {
      headers: {
        'X-Ovh-Application': this.config.applicationKey,
        'X-Ovh-Consumer': this.config.consumerKey,
        'X-Ovh-Timestamp': String(timestamp),
        'X-Ovh-Signature': signature,
        'Content-Type': 'application/json',
      },
      transport: this.transport,
    });
  }
}

module.exports = { OvhClient };
