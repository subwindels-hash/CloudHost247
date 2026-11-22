/** Read-only, allowlisted WHMCS lookup for the website-launch agent. */
import path from 'node:path';
import { createHash } from 'node:crypto';
import { WhmcsClient, consoleLogger } from './client';
import { loadWhmcsConfig } from './config';
import { readProductMapFile } from './product-map';
import { catalogueFailure, createCatalogueLoader, decideOrderability, type ServiceOrderability } from './orderability';

export const LAUNCH_SERVICE_KEYS = ['hosting-web-hosting', 'hosting-business', 'hosting-wordpress'] as const;
export type LaunchServiceKey = typeof LAUNCH_SERVICE_KEYS[number];
export function isLaunchServiceKey(value: unknown): value is LaunchServiceKey {
  return typeof value === 'string' && (LAUNCH_SERVICE_KEYS as readonly string[]).includes(value);
}

// Reuse the existing catalogue loader's bounded cache and the client's circuit breaker across calls.
let cached: { fingerprint: string; loader: ReturnType<typeof createCatalogueLoader>; baseUrl: string; cartPath: string } | null = null;

export async function lookupLaunchOrderability(serviceKey: LaunchServiceKey): Promise<ServiceOrderability> {
  if (!isLaunchServiceKey(serviceKey)) throw new Error('Invalid service key');
  // This validates the map checksum just as the public WHMCS orderability endpoint does.
  const map = readProductMapFile(path.join(process.cwd(), 'config', 'whmcs', 'product-map.json'));
  const config = loadWhmcsConfig(process.env);
  if (!config.enabled) {
    return decideOrderability({ map, serviceKey, catalogue: null, unavailable: { code: 'WHMCS_DISABLED' }, cart: { baseUrl: 'https://invalid.invalid' } });
  }
  // Avoid mixing cached catalogue data and cart URLs across configuration changes. The digest is
  // never logged or returned, and the raw credential is retained only by the existing client.
  const fingerprint = createHash('sha256').update(JSON.stringify(config.config)).digest('hex');
  if (!cached || cached.fingerprint !== fingerprint) {
    const client = new WhmcsClient({ config: config.config, logger: consoleLogger });
    cached = { fingerprint, loader: createCatalogueLoader(client), baseUrl: config.config.baseUrl, cartPath: config.config.cartPath };
  }
  try {
    const catalogue = await cached.loader.load();
    return decideOrderability({ map, serviceKey, catalogue, cart: { baseUrl: cached.baseUrl, cartPath: cached.cartPath } });
  } catch (error) {
    return decideOrderability({ map, serviceKey, catalogue: null, unavailable: catalogueFailure(error), cart: { baseUrl: cached.baseUrl, cartPath: cached.cartPath } });
  }
}
