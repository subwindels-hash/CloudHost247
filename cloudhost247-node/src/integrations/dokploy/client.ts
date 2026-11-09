/**
 * Dokploy Integration Client
 *
 * Connects CloudHost247 backend to Dokploy Community Edition API.
 * All communication is server-to-server.
 *
 * Official API documentation: https://docs.dokploy.com/docs/api
 */

import { z } from 'zod';
import { fetch } from 'undici'; // Available in Node.js 20+

export interface DokployConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export class DokployClient {
  private config: DokployConfig;

  constructor(config: DokployConfig) {
    this.config = {
      timeoutMs: 30000,
      ...config,
    };
  }

  public async request<T>(
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    body?: unknown,
  ): Promise<T> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}${path}`;
    
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    // Use AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    const options = {
      method,
      headers,
      signal: controller.signal,
    } as any; // Bypass undici-types FormData incompatibility for generic JSON body

    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(
          `Dokploy API ${method} ${path} failed: ${response.status} ${response.statusText} ${errorBody}`,
        );
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // --- Projects ---
  async createProject(customerId: string, name: string, description?: string) {
    // Maps CloudHost247 customer to Dokploy project
    return this.request<{ id: string; name: string; metadata?: Record<string, string> }>(
      '/api/projects',
      'POST',
      {
        name,
        description: description || `CloudHost247 Customer ${customerId}`,
        // Customer isolation: metadata for ownership mapping
        metadata: {
          cloudhost247CustomerId: customerId,
        },
      },
    );
  }

  async getProject(projectId: string) {
    return this.request<{ id: string; name: string; metadata?: Record<string, string> }>(`/api/projects/${projectId}`, 'GET');
  }

  // --- Applications ---
  async deployApplication(
    projectId: string,
    name: string,
    source: {
      type: 'github' | 'gitlab' | 'bitbucket' | 'docker' | 'git';
      repositoryUrl?: string;
      dockerImage?: string;
      branch?: string;
      commitSha?: string;
    },
    runtime: 'nodejs' | 'react' | 'nextjs' | 'vue' | 'angular' | 'php' | 'laravel' | 'python' | 'django' | 'fastapi' | 'static' | 'docker',
    environmentVariables?: Record<string, string>,
  ) {
    return this.request<{ id: string; name: string; status: string }>(
      `/api/projects/${projectId}/applications`,
      'POST',
      {
        name,
        runtime,
        source,
        environmentVariables: environmentVariables || {},
      },
    );
  }

  async getApplication(projectId: string, appId: string) {
    return this.request<any>(`/api/projects/${projectId}/applications/${appId}`, 'GET');
  }

  async restartApplication(projectId: string, appId: string) {
    return this.request<any>(`/api/projects/${projectId}/applications/${appId}/restart`, 'POST');
  }

  async stopApplication(projectId: string, appId: string) {
    return this.request<any>(`/api/projects/${projectId}/applications/${appId}/stop`, 'POST');
  }

  async startApplication(projectId: string, appId: string) {
    return this.request<any>(`/api/projects/${projectId}/applications/${appId}/start`, 'POST');
  }

  async deleteApplication(projectId: string, appId: string) {
    return this.request<any>(`/api/projects/${projectId}/applications/${appId}`, 'DELETE');
  }

  // --- Databases ---
  async createDatabase(projectId: string, type: 'postgresql' | 'mysql' | 'mariadb' | 'mongodb' | 'redis', name: string) {
    return this.request<any>(
      `/api/projects/${projectId}/databases`,
      'POST',
      {
        type,
        name,
      },
    );
  }

  // --- Domains ---
  async addDomain(projectId: string, appId: string, domain: string) {
    return this.request<any>(
      `/api/projects/${projectId}/applications/${appId}/domains`,
      'POST',
      { domain },
    );
  }

  // --- Environment Variables ---
  async updateEnvironmentVariables(projectId: string, appId: string, variables: Record<string, string>) {
    return this.request<any>(
      `/api/projects/${projectId}/applications/${appId}/environment`,
      'PUT',
      { variables },
    );
  }

  // --- Deployments & Logs ---
  async getDeployments(projectId: string, appId: string) {
    return this.request<any[]>(`/api/projects/${projectId}/applications/${appId}/deployments`, 'GET');
  }

  async getDeploymentLogs(projectId: string, appId: string, deploymentId: string) {
    return this.request<any>(`/api/projects/${projectId}/applications/${appId}/deployments/${deploymentId}/logs`, 'GET');
  }

  // --- Monitoring ---
  async getApplicationStats(projectId: string, appId: string) {
    return this.request<any>(`/api/projects/${projectId}/applications/${appId}/stats`, 'GET');
  }

  // --- Backups ---
  async createBackup(projectId: string, appId: string) {
    return this.request<any>(`/api/projects/${projectId}/applications/${appId}/backups`, 'POST');
  }
}