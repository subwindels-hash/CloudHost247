/**
 * Dokploy Deployments Service
 *
 * Manages deployment history, logs and failure tracking.
 */

import { DokployClient } from './client';

export class DokployDeployments {
  private client: DokployClient;

  constructor(client: DokployClient) {
    this.client = client;
  }

  /**
   * Gets deployment history for an application
   */
  async getDeploymentHistory(projectId: string, appId: string, customerId: string) {
    await this.validateOwnership(customerId, projectId);
    return this.client.getDeployments(projectId, appId);
  }

  /**
   * Gets deployment logs
   */
  async getDeploymentLogs(projectId: string, appId: string, deploymentId: string, customerId: string) {
    await this.validateOwnership(customerId, projectId);
    return this.client.getDeploymentLogs(projectId, appId, deploymentId);
  }

  /**
   * Validates customer ownership
   */
  private async validateOwnership(customerId: string, projectId: string): Promise<boolean> {
    const projects = new (await import('./projects')).DokployProjects(this.client);
    return projects.validateCustomerOwnership(customerId, projectId);
  }
}
