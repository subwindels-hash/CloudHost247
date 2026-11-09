/**
 * Dokploy Environment Variables Service
 *
 * Manages environment variables with masking for sensitive values.
 */

import { DokployClient } from './client';

export class DokployEnvironments {
  private client: DokployClient;

  constructor(client: DokployClient) {
    this.client = client;
  }

  /**
   * Updates environment variables for an application
   * Sensitive values are masked in responses
   */
  async updateEnvironmentVariables(
    projectId: string,
    appId: string,
    variables: Record<string, string>,
    customerId: string,
  ) {
    await this.validateOwnership(customerId, projectId);
    
    // Mask sensitive values before sending to browser
    const maskedVariables = this.maskSensitiveValues(variables);
    
    const result = await this.client.updateEnvironmentVariables(
      projectId,
      appId,
      variables, // Send real values to Dokploy
    );

    return {
      ...result,
      variables: maskedVariables, // Return masked to browser
    };
  }

  /**
   * Masks sensitive environment variable values
   */
  private maskSensitiveValues(variables: Record<string, string>): Record<string, string> {
    const masked: Record<string, string> = {};
    
    for (const [key, value] of Object.entries(variables)) {
      // Mask passwords, secrets, tokens
      const isSensitive = [
        'PASSWORD',
        'SECRET',
        'TOKEN',
        'KEY',
        'CREDENTIAL',
        'AUTH',
      ].some(keyword => key.toUpperCase().includes(keyword));

      masked[key] = isSensitive ? '***MASKED***' : value;
    }

    return masked;
  }

  /**
   * Validates customer ownership
   */
  private async validateOwnership(customerId: string, projectId: string): Promise<boolean> {
    const projects = new (await import('./projects')).DokployProjects(this.client);
    return projects.validateCustomerOwnership(customerId, projectId);
  }
}
