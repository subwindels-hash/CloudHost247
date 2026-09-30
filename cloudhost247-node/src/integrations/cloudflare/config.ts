/**
 * Cloudflare account configuration + client factory (spec §3–§4, §45, §67).
 *
 * The reseller account row (cloudflare_accounts) is the source of truth; its API token is an
 * AES-256-GCM envelope produced by the platform key ring (src/lib/crypto.ts) and decrypted only
 * here, only server-side, only at the moment a client is built. FAIL-CLOSED: no active account,
 * disabled module, or missing encryption key → CLOUDFLARE_CONFIGURATION_REQUIRED. Nothing ever
 * falls back to simulated Cloudflare data.
 */
import type { Queryable } from '../../db/types';
import { decryptSecret, encryptSecret } from '../../lib/crypto';
import { getKeyRing } from '../../lib/keyring';
import { getSetting } from '../../db/ops-tables';
import { CloudflareClient, type ApiLogSink } from './client';
import { CloudflareError } from './errors';
import { findActiveCloudflareAccount, insertCloudflareApiLog, touchAccountTestResult, type CloudflareAccountRow } from '../../db/cloudflare';

export function encryptApiToken(plaintext: string): string {
  return encryptSecret(getKeyRing(), plaintext);
}

/**
 * Test-only HTTP overrides (mirrors setKeyRingForTesting in src/lib/keyring.ts). Production
 * code never sets these; integration tests inject the scripted mock Cloudflare so the REAL
 * client/provisioning/route code runs against realistic envelopes without network access.
 */
let testOverrides: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } | null = null;

export function setCloudflareTestOverrides(overrides: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } | null): void {
  testOverrides = overrides;
}

export interface ResolvedCloudflare {
  account: CloudflareAccountRow;
  client: CloudflareClient;
}

export interface ResolveOptions {
  fetchImpl?: typeof fetch;
  serviceId?: string | null;
  sleep?: (ms: number) => Promise<void>;
}

/** Builds the API-log sink that persists request envelopes (never tokens/bodies). */
function buildLogSink(db: Queryable, serviceId: string | null): ApiLogSink {
  return (entry) =>
    insertCloudflareApiLog(db, {
      requestId: entry.requestId,
      cloudflareServiceId: serviceId,
      operation: entry.operation,
      method: entry.method,
      path: entry.path,
      statusCode: entry.statusCode,
      success: entry.success,
      durationMs: entry.durationMs,
      errorCode: entry.errorCode,
      errorMessage: entry.errorMessage,
    });
}

/**
 * Resolves the active account + a ready client, or throws CLOUDFLARE_CONFIGURATION_REQUIRED.
 */
export async function resolveCloudflare(db: Queryable, options: ResolveOptions = {}): Promise<ResolvedCloudflare> {
  const enabled = await getSetting<boolean>(db, 'cloudflare.enabled', true);
  if (!enabled) throw new CloudflareError('CLOUDFLARE_CONFIGURATION_REQUIRED', 'integration disabled');

  const account = await findActiveCloudflareAccount(db);
  if (!account) throw new CloudflareError('CLOUDFLARE_CONFIGURATION_REQUIRED', 'no active Cloudflare account configured');

  let apiToken: string;
  try {
    apiToken = decryptSecret(getKeyRing(), account.encrypted_api_token);
  } catch {
    throw new CloudflareError('CLOUDFLARE_CONFIGURATION_REQUIRED', 'stored token cannot be decrypted');
  }

  const client = new CloudflareClient({
    baseUrl: account.api_base_url,
    apiToken,
    fetchImpl: options.fetchImpl ?? testOverrides?.fetchImpl,
    logSink: buildLogSink(db, options.serviceId ?? null),
    sleep: options.sleep ?? testOverrides?.sleep,
  });
  return { account, client };
}

export interface ConnectionTestResult {
  status: 'CONNECTED' | 'CONFIGURATION_REQUIRED' | 'SERVICE_UNAVAILABLE' | 'AUTH_FAILED';
  accountId?: string;
  accountName?: string;
  tokenStatus?: string;
  permissions?: string[];
  responseTimeMs?: number;
  error?: string;
}

/**
 * Verifies the stored token against Cloudflare (spec §4): token verification + account read.
 * Persists last success/failure on the account row. Never returns the token.
 */
export async function testCloudflareConnection(
  db: Queryable,
  accountId: string,
  options: ResolveOptions = {}
): Promise<ConnectionTestResult> {
  const account = await findActiveCloudflareAccount(db, accountId);
  if (!account) return { status: 'CONFIGURATION_REQUIRED', error: 'Account not found or disabled' };

  let apiToken: string;
  try {
    apiToken = decryptSecret(getKeyRing(), account.encrypted_api_token);
  } catch {
    return { status: 'CONFIGURATION_REQUIRED', error: 'Stored token cannot be decrypted — re-enter the API token' };
  }

  const client = new CloudflareClient({
    baseUrl: account.api_base_url,
    apiToken,
    fetchImpl: options.fetchImpl ?? testOverrides?.fetchImpl,
    logSink: buildLogSink(db, null),
    sleep: options.sleep ?? testOverrides?.sleep,
    maxRetries: 1,
  });

  const startedAt = Date.now();
  try {
    const verify = await client.request<{ id: string; status: string; policies?: Array<{ permission_groups?: Array<{ name?: string }> }> }>(
      'token.verify',
      'GET',
      '/user/tokens/verify'
    );
    const accountInfo = await client
      .request<{ id: string; name: string }>('account.get', 'GET', `/accounts/${encodeURIComponent(account.cloudflare_account_id)}`)
      .catch(() => null);
    const responseTimeMs = Date.now() - startedAt;
    await touchAccountTestResult(db, account.id, true, null);
    const permissions = (verify.result.policies ?? [])
      .flatMap((p) => p.permission_groups ?? [])
      .map((g) => g.name ?? '')
      .filter(Boolean);
    return {
      status: 'CONNECTED',
      accountId: account.cloudflare_account_id,
      accountName: accountInfo?.result.name ?? account.account_name,
      tokenStatus: verify.result.status,
      permissions,
      responseTimeMs,
    };
  } catch (error) {
    const message = error instanceof CloudflareError ? error.safeMessage : 'Connection failed';
    await touchAccountTestResult(db, account.id, false, message);
    if (error instanceof CloudflareError && error.code === 'CLOUDFLARE_AUTH_FAILED') {
      return { status: 'AUTH_FAILED', error: message, responseTimeMs: Date.now() - startedAt };
    }
    return { status: 'SERVICE_UNAVAILABLE', error: message, responseTimeMs: Date.now() - startedAt };
  }
}
