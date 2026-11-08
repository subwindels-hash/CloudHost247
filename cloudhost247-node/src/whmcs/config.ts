/**
 * WHMCS connection settings, read from the environment and validated.
 *
 * Two rules, both learned from how this repository already treats provider credentials:
 *
 *   1. **No fallback for a secret.** If the deployment has not been given an identifier and secret,
 *      the layer reports `enabled: false` with a reason. It does not boot with an empty string, and
 *      it never tries an unauthenticated call "to see if it works".
 *   2. **Missing configuration is a normal state, not a crash.** The website must keep serving
 *      pages, support and tools while hosting checkout says, honestly, that it is not connected.
 *      That is why `loadWhmcsConfig` returns a discriminated result instead of throwing at boot.
 *
 * The secret never leaves this object: `client.ts` puts it in the request body and nowhere else,
 * and every log line in the layer is built from an explicit allow-list of fields.
 */

import { WhmcsInvalidConfigError } from './errors';

export type WhmcsMode = 'read-only' | 'full';

export interface WhmcsConfig {
  /** e.g. https://billing.example.com — no trailing slash, no `/includes/api.php`. */
  baseUrl: string;
  identifier: string;
  secret: string;
  /** `includes/api.php`, joined onto baseUrl. */
  apiUrl: string;
  /** Client-area entry points used for cart/account hand-off (paths, not URLs). */
  cartPath: string;
  clientAreaPath: string;
  timeoutMs: number;
  maxAttempts: number;
  mode: WhmcsMode;
  /**
   * Whether a customer must have MFA enabled on the CloudHost247 account before an SSO hand-off is
   * minted. Default `true`.
   *
   * This exists because of a documented property of WHMCS's SSO endpoint: a trusted token is
   * redeemed *without* WHMCS re-prompting for 2FA or CAPTCHA. If the customer protects their WHMCS
   * client area with 2FA but not their CloudHost247 account, an SSO hand-off would silently skip
   * that second factor. Requiring MFA here means the second factor is enforced by us before the
   * token exists; an operator who turns this off is explicitly accepting that downgrade, which is
   * why it has to be a deliberate environment setting rather than a default.
   */
  ssoRequireMfa: boolean;
}

export type WhmcsConfigResult =
  | { enabled: true; config: WhmcsConfig; reason: null }
  | { enabled: false; config: null; reason: string };

const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_ATTEMPTS = 3;
const MAX_ATTEMPTS = 5;
const MIN_SECRET_LENGTH = 16;

function intInRange(raw: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new WhmcsInvalidConfigError(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

/**
 * Accept https everywhere, and http only for a loopback host (local development).
 * A staging install reached over plain http would send the API secret in clear text, so it is
 * refused rather than "warned about".
 */
function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new WhmcsInvalidConfigError('WHMCS_BASE_URL must be an absolute URL');
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new WhmcsInvalidConfigError('WHMCS_BASE_URL must use https (http is allowed only for loopback)');
  }
  if (url.username || url.password) {
    throw new WhmcsInvalidConfigError('WHMCS_BASE_URL must not embed credentials');
  }
  if (url.search || url.hash) {
    throw new WhmcsInvalidConfigError('WHMCS_BASE_URL must not carry a query string or fragment');
  }
  // Operators paste the API endpoint by habit; accept it and reduce to the install root.
  const path = url.pathname.replace(/\/+$/, '').replace(/\/includes\/api\.php$/, '');
  return `${url.origin}${path}`;
}

/**
 * An opt-out boolean. Anything other than an explicit `false`/`0` keeps the safe default, so a typo
 * in the deployment environment cannot quietly weaken the SSO policy.
 */
function boolSetting(raw: string | undefined, fallback: boolean, name: string): boolean {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '') return fallback;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new WhmcsInvalidConfigError(`${name} must be "true" or "false"`);
}

function pathSetting(raw: string | undefined, fallback: string, name: string): string {
  const value = (raw ?? '').trim() || fallback;
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) {
    throw new WhmcsInvalidConfigError(`${name} must be a relative path`);
  }
  return value.replace(/^\/+/, '');
}

export function loadWhmcsConfig(env: NodeJS.ProcessEnv = process.env): WhmcsConfigResult {
  const baseUrl = (env.WHMCS_BASE_URL ?? '').trim();
  const identifier = (env.WHMCS_API_IDENTIFIER ?? '').trim();
  const secret = (env.WHMCS_API_SECRET ?? '').trim();

  const missing: string[] = [];
  if (!baseUrl) missing.push('WHMCS_BASE_URL');
  if (!identifier) missing.push('WHMCS_API_IDENTIFIER');
  if (!secret) missing.push('WHMCS_API_SECRET');
  if (missing.length > 0) {
    return {
      enabled: false,
      config: null,
      reason: `WHMCS is not connected: ${missing.join(', ')} not set`,
    };
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new WhmcsInvalidConfigError(`WHMCS_API_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  if (!/^[A-Za-z0-9._-]{4,191}$/.test(identifier)) {
    throw new WhmcsInvalidConfigError('WHMCS_API_IDENTIFIER looks invalid');
  }

  const modeRaw = (env.WHMCS_MODE ?? 'read-only').trim();
  if (modeRaw !== 'read-only' && modeRaw !== 'full') {
    throw new WhmcsInvalidConfigError('WHMCS_MODE must be "read-only" or "full"');
  }

  const normalizedBase = normalizeBaseUrl(baseUrl);

  return {
    enabled: true,
    reason: null,
    config: {
      baseUrl: normalizedBase,
      identifier,
      secret,
      apiUrl: `${normalizedBase}/includes/api.php`,
      cartPath: pathSetting(env.WHMCS_CART_PATH, 'cart.php', 'WHMCS_CART_PATH'),
      clientAreaPath: pathSetting(env.WHMCS_CLIENTAREA_PATH, 'clientarea.php', 'WHMCS_CLIENTAREA_PATH'),
      timeoutMs: intInRange(env.WHMCS_API_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS, 'WHMCS_API_TIMEOUT_MS'),
      maxAttempts: intInRange(env.WHMCS_MAX_ATTEMPTS, DEFAULT_ATTEMPTS, 1, MAX_ATTEMPTS, 'WHMCS_MAX_ATTEMPTS'),
      mode: modeRaw,
      ssoRequireMfa: boolSetting(env.WHMCS_SSO_REQUIRE_MFA, true, 'WHMCS_SSO_REQUIRE_MFA'),
    },
  };
}

/**
 * Write-capable actions are refused unless the deployment explicitly opted into `full` mode.
 * Discovery, catalogue reads and cart hand-off all work in `read-only`; this guard is what keeps a
 * staging clone from creating invoices or provisioning a service because a route was exercised.
 */
export function assertWriteAllowed(config: WhmcsConfig, action: string): void {
  if (config.mode !== 'full') {
    throw new WhmcsInvalidConfigError(
      `${action} creates or changes data in WHMCS and is disabled while WHMCS_MODE is "read-only"`,
    );
  }
}
