/**
 * Proxmox VE API client.
 *
 * Ported from cloudhost247-node/src/infrastructure/providers/proxmox-client.ts. Authentication uses
 * an API token (`PVEAPIToken=user@realm!tokenid=uuid`) so no cookie/ticket lifecycle is required and
 * the secret never leaves the server process. Proxmox wraps every response in `{ data: ... }` and
 * accepts urlencoded bodies on every mutating endpoint.
 *
 * `waitForTask` exists because Proxmox mutating calls return a UPID task handle: provisioning must
 * wait for the task to finish before touching the guest again (clone → configure → start would
 * otherwise race).
 */
'use strict';

const { providerRequest } = require('../http');
const { ProviderError } = require('../types');

class ProxmoxClient {
  constructor(baseUrl, token, options = {}) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.transport = options.transport;
  }

  headers(extra = {}) {
    return { Authorization: `PVEAPIToken=${this.token}`, ...extra };
  }

  async get(path) {
    const result = await providerRequest(`${this.baseUrl}/api2/json${path}`, { method: 'GET' }, {
      headers: this.headers(),
      transport: this.transport,
    });
    return result?.data;
  }

  async send(method, path, params) {
    let body;
    if (params) {
      const form = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) form.set(key, String(value));
      }
      body = form.toString();
    }
    const result = await providerRequest(`${this.baseUrl}/api2/json${path}`, {
      method,
      ...(body !== undefined ? { body } : {}),
    }, {
      headers: this.headers(body !== undefined ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      transport: this.transport,
    });
    return result?.data;
  }

  post(path, params) { return this.send('POST', path, params); }
  put(path, params) { return this.send('PUT', path, params); }
  delete(path, params) { return this.send('DELETE', path, params); }

  async version() {
    return (await this.get('/version')) ?? {};
  }

  async clusterResources() {
    return (await this.get('/cluster/resources?type=vm')) ?? [];
  }

  async nextId() {
    const parsed = Number(await this.get('/cluster/nextid'));
    if (!Number.isInteger(parsed)) {
      throw new ProviderError('PROVIDER_ERROR', 'Proxmox did not return a usable next VM id', true);
    }
    return parsed;
  }

  async waitForTask(node, upid, timeoutMs = 300_000, pollMs = 2_000) {
    if (!upid || typeof upid !== 'string') return;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const status = await this.get(
        `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`,
      );
      if (status?.status === 'stopped') {
        if (status.exitstatus && status.exitstatus !== 'OK') {
          throw new ProviderError('PROVIDER_ERROR', `Proxmox task failed: ${status.exitstatus}`, false, { upid });
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    throw new ProviderError('PROVIDER_TIMEOUT', 'Proxmox task did not complete in time', true, { upid });
  }
}

module.exports = { ProxmoxClient };
