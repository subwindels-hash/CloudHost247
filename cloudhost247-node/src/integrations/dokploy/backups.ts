/**
 * Dokploy Backups Service
 *
 * Manages database and application data backups, restoration and retention.
 */

import { DokployClient } from './client';

export class DokployBackups {
  private client: DokployClient;

  constructor(client: DokployClient) {
    this.client = client;
  }

  /**
   * Creates a manual backup
   */
  async createManualBackup(
    projectId: string,
    appId: string,
    customerId: string,
  ) {
    await this.validateOwnership(customerId, projectId);
    
    return this.client.createBackup(projectId, appId);
  }

  /**
   * Validates customer ownership
   */
  private async validateOwnership(customerId: string, projectId: string): Promise<boolean> {
    const projects = new (await import('./projects')).DokployProjects(this.client);
    return projects.validateCustomerOwnership(customerId, projectId);
  }
}
