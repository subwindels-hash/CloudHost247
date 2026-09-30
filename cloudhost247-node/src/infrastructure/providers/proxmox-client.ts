/**
 * Proxmox VE API client.
 *
 * Authentication uses an API token (`PVEAPIToken=user@realm!tokenid=uuid`) so no cookie/ticket
 * lifecycle is required and the secret never leaves the server process. Proxmox wraps every
 * response in `{ data: ... }` and accepts urlencoded bodies on every mutating endpoint.
 */
import { providerRequest } from './http';
import { ProviderError } from './types';

export type ProxmoxGuestType = 'qemu' | 'lxc';

export interface ProxmoxClusterResource {
  id?: string;
  type?: string;
  vmid?: number;
  name?: string;
  node?: string;
  status?: string;
  template?: number;
}

export interface ProxmoxGuestStatus {
  status?: string;
  qmpstatus?: string;
  name?: string;
  uptime?: number;
  maxmem?: number;
  cpus?: number;
}

export class ProxmoxClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `PVEAPIToken=${this.token}`, ...extra };
  }

  async get<T>(path: string): Promise<T> {
    const result = await providerRequest<{ data: T }>(`${this.baseUrl}/api2/json${path}`, { method: 'GET' }, {
      headers: this.headers(),
    });
    return result?.data as T;
  }

  private async send<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, params?: Record<string, unknown>): Promise<T> {
    let body: string | undefined;
    if (params) {
      const form = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) form.set(key, String(value));
      }
      body = form.toString();
    }
    const result = await providerRequest<{ data: T }>(
      `${this.baseUrl}/api2/json${path}`,
      { method, ...(body !== undefined ? { body } : {}) },
      { headers: this.headers(body !== undefined ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }
    );
    return result?.data as T;
  }

  post<T>(path: string, params?: Record<string, unknown>): Promise<T> { return this.send<T>('POST', path, params); }
  put<T>(path: string, params?: Record<string, unknown>): Promise<T> { return this.send<T>('PUT', path, params); }
  delete<T>(path: string, params?: Record<string, unknown>): Promise<T> { return this.send<T>('DELETE', path, params); }

  async version(): Promise<Record<string, unknown>> {
    return (await this.get<Record<string, unknown>>('/version')) ?? {};
  }

  async clusterResources(): Promise<ProxmoxClusterResource[]> {
    return (await this.get<ProxmoxClusterResource[]>('/cluster/resources?type=vm')) ?? [];
  }

  async nextId(): Promise<number> {
    const value = await this.get<string | number>('/cluster/nextid');
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
      throw new ProviderError('PROVIDER_ERROR', 'Proxmox did not return a usable next VM id', true);
    }
    return parsed;
  }

  /**
   * Proxmox mutating calls return a UPID task handle. Provisioning must wait for the task to
   * finish before touching the guest again (clone → configure → start would otherwise race).
   */
  async waitForTask(node: string, upid: string, timeoutMs = 300_000, pollMs = 2_000): Promise<void> {
    if (!upid || typeof upid !== 'string') return;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const status = await this.get<{ status?: string; exitstatus?: string }>(
        `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`
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
