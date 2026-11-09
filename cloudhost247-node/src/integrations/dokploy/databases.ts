/**
 * Dokploy Databases Service
 *
 * Manages database provisioning, credentials and access controls.
 * Supports: PostgreSQL, MySQL, MariaDB, MongoDB, Redis
 */

import { DokployClient } from './client';

export class DokployDatabases {
  private client: DokployClient;

  constructor(client: DokployClient) {
    this.client = client;
  }

  /**
   * Provisions a database for a customer project
   */
  async provisionDatabase(
    projectId: string,
    customerId: string,
    type: 'postgresql' | 'mysql' | 'mariadb' | 'mongodb' | 'redis',
    name: string,
  ) {
    await this.validateOwnership(customerId, projectId);
    
    const database = await this.client.createDatabase(projectId, type, name);
    
    // Return credentials securely (never expose publicly)
    return {
      id: database.id,
      name: database.name,
      type,
      // Credentials are handled server-side only
      createdAt: database.createdAt,
    };
  }

  /**
   * Gets database information (credentials masked)
   */
  async getDatabaseInfo(projectId: string, databaseId: string, customerId: string) {
    await this.validateOwnership(customerId, projectId);
    // Implementation: fetch database info from Dokploy
    // Mask sensitive values in response
    return {
      id: databaseId,
      masked: true,
      // Actual credentials never returned to browser
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
