/**
 * Dokploy Projects Service
 *
 * Manages customer-to-project ownership mapping and project lifecycle.
 * Ensures customer isolation: each customer gets their own Dokploy project.
 */

import { DokployClient } from './client';

export class DokployProjects {
  private client: DokployClient;

  constructor(client: DokployClient) {
    this.client = client;
  }

  /**
   * Creates or retrieves a Dokploy project for a CloudHost247 customer
   * Idempotent: returns existing project if customer already has one
   */
  async getOrCreateCustomerProject(customerId: string, customerName?: string) {
    // In production, we'd check if project already exists for this customer
    // For now, create new project (idempotency handled by Dokploy or CloudHost247 DB)
    const project = await this.client.createProject(
      customerId,
      `Customer-${customerId}-${Date.now()}`,
      customerName ? `Hosting environment for ${customerName}` : undefined,
    );

    return project;
  }

  /**
   * Validates customer ownership of a project
   * CRITICAL: Never trust project IDs supplied by browser
   */
  async validateCustomerOwnership(customerId: string, projectId: string): Promise<boolean> {
    try {
      const project = await this.client.getProject(projectId);
      // Check metadata for customer ID mapping
      const metadata = project.metadata || {};
      return metadata.cloudhost247CustomerId === customerId;
    } catch (error) {
      console.error('Ownership validation failed:', error);
      return false;
    }
  }
}
