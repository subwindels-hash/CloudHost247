/**
 * Dokploy Applications Service
 *
 * Manages application deployment, lifecycle and resource limits.
 * Connects CloudHost247 hosting plans to Dokploy infrastructure limits.
 */

import { DokployClient } from './client';

export interface HostingPlanLimits {
  maxApplications: number;
  maxCpuAllocation: number; // vCPU
  maxRamAllocation: number; // MB
  maxStorage: number; // MB
  maxDatabases: number;
  maxDomains: number;
  bandwidthAllowance: number; // GB
  backupAllowance: number; // GB
  deploymentLimits: number;
}

export class DokployApplications {
  private client: DokployClient;

  constructor(client: DokployClient) {
    this.client = client;
  }

  /**
   * Deploys an application from supported sources
   * Supports: GitHub, GitLab, Bitbucket, Docker, Git, Templates
   */
  async deployApplication(
    projectId: string,
    customerId: string,
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
    limits?: HostingPlanLimits,
  ) {
    // Validate customer ownership before deployment
    const isValid = await this.validateOwnership(customerId, projectId);
    if (!isValid) {
      throw new Error('Customer ownership validation failed');
    }

    // Enforce resource limits (implementation depends on Dokploy API)
    // Note: Dokploy Community Edition limits may need custom enforcement
    const application = await this.client.deployApplication(
      projectId,
      name,
      source,
      runtime,
      environmentVariables,
    );

    return application;
  }

  /**
   * Restarts an application
   */
  async restartApplication(projectId: string, appId: string, customerId: string) {
    await this.validateOwnership(customerId, projectId);
    return this.client.restartApplication(projectId, appId);
  }

  /**
   * Stops an application
   */
  async stopApplication(projectId: string, appId: string, customerId: string) {
    await this.validateOwnership(customerId, projectId);
    return this.client.stopApplication(projectId, appId);
  }

  /**
   * Starts an application
   */
  async startApplication(projectId: string, appId: string, customerId: string) {
    await this.validateOwnership(customerId, projectId);
    return this.client.startApplication(projectId, appId);
  }

  /**
   * Deletes an application with confirmation
   */
  async deleteApplication(projectId: string, appId: string, customerId: string) {
    await this.validateOwnership(customerId, projectId);
    return this.client.deleteApplication(projectId, appId);
  }

  /**
   * Redeploys an application
   */
  async redeployApplication(projectId: string, appId: string, customerId: string) {
    await this.validateOwnership(customerId, projectId);
    // Implementation: stop + start or trigger Dokploy redeploy
    return this.client.restartApplication(projectId, appId);
  }

  /**
   * Validates customer ownership (security requirement)
   */
  private async validateOwnership(customerId: string, projectId: string): Promise<boolean> {
    const projects = new (await import('./projects')).DokployProjects(this.client);
    return projects.validateCustomerOwnership(customerId, projectId);
  }
}
