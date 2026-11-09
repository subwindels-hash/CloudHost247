/**
 * Dokploy Monitoring Service
 *
 * Provides CPU, RAM, storage, network usage and container health metrics.
 */

import { DokployClient } from './client';

export class DokployMonitoring {
  private client: DokployClient;

  constructor(client: DokployClient) {
    this.client = client;
  }

  /**
   * Gets application resource usage statistics
   */
  async getApplicationStats(
    projectId: string,
    appId: string,
    customerId: string,
  ) {
    await this.validateOwnership(customerId, projectId);
    
    const stats = await this.client.getApplicationStats(projectId, appId);
    
    // Return aggregated metrics
    return {
      cpuUsage: stats.cpu || 0,
      ramUsage: stats.memory || 0,
      storageUsage: stats.storage || 0,
      networkUsage: stats.network || 0,
      uptime: stats.uptime || 0,
      containerHealth: stats.health || 'unknown',
      deploymentStatus: stats.status || 'unknown',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Validates customer ownership
   */
  private async validateOwnership(customerId: string, projectId: string): Promise<boolean> {
    const projects = new (await import('./projects')).DokployProjects(this.client);
    return projects.validateCustomerOwnership(customerId, projectId);
  }
}
