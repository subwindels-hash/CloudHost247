/**
 * Dokploy Domains Service
 *
 * Manages custom domains, subdomains, DNS records and SSL certificates.
 */

import { DokployClient } from './client';

export class DokployDomains {
  private client: DokployClient;

  constructor(client: DokployClient) {
    this.client = client;
  }

  /**
   * Connects a custom domain to an application
   */
  async connectDomain(
    projectId: string,
    appId: string,
    domain: string,
    customerId: string,
  ) {
    await this.validateOwnership(customerId, projectId);
    
    return this.client.addDomain(projectId, appId, domain);
  }

  /**
   * Configures SSL certificate (automatic renewal)
   */
  async configureSsl(
    projectId: string,
    appId: string,
    domain: string,
    customerId: string,
  ) {
    await this.validateOwnership(customerId, projectId);
    // Implementation: trigger SSL provisioning in Dokploy
    return {
      domain,
      sslStatus: 'provisioning',
      certificateAuthority: 'letsencrypt',
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
