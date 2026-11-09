/**
 * Dokploy Authentication Service
 *
 * Securely manages Dokploy API keys and authentication.
 * Stores keys in server-side environment secrets.
 */

import { Env } from '../../config/env';
import { DokployClient } from './client';

export class DokployAuthentication {
  private client: DokployClient;

  constructor(env: Env) {
    const dokployApiKey = env.DOKPLOY_API_KEY ?? '';
    const dokployBaseUrl = env.DOKPLOY_BASE_URL ?? 'http://localhost:3000';

    if (!dokployApiKey) {
      throw new Error('DOKPLOY_API_KEY is required for Dokploy integration');
    }

    this.client = new DokployClient({
      baseUrl: dokployBaseUrl,
      apiKey: dokployApiKey,
    });
  }

  /**
   * Verifies Dokploy connectivity and API key validity
   */
  async verifyConnection(): Promise<boolean> {
    try {
      // Test endpoint to verify API key
      await this.client.request<any>('/api/projects', 'GET');
      return true;
    } catch (error) {
      console.error('Dokploy connection verification failed:', error);
      return false;
    }
  }

  /**
   * Gets the Dokploy client for authorized operations
   */
  getClient(): DokployClient {
    return this.client;
  }
}
