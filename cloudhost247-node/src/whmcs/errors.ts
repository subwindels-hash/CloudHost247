/**
 * One error taxonomy for the whole WHMCS layer.
 *
 * The point is that a route handler never has to guess what went wrong: each error carries a stable
 * `code` (safe to show a customer), a `retryable` flag (safe for a caller to act on) and nothing
 * that could leak credentials. `details` is filtered by `redactForLog` before it is logged.
 */

export type WhmcsErrorCode =
  | 'WHMCS_NOT_CONFIGURED'
  | 'WHMCS_INVALID_CONFIG'
  | 'WHMCS_TIMEOUT'
  | 'WHMCS_UNREACHABLE'
  | 'WHMCS_HTTP_ERROR'
  | 'WHMCS_MALFORMED_RESPONSE'
  | 'WHMCS_API_ERROR'
  | 'WHMCS_SCHEMA_ERROR'
  | 'WHMCS_CIRCUIT_OPEN'
  | 'WHMCS_PRODUCT_NOT_MAPPED'
  | 'WHMCS_CYCLE_NOT_OFFERED'
  | 'WHMCS_CURRENCY_UNAVAILABLE'
  | 'WHMCS_MAP_INVALID'
  | 'WHMCS_MAP_CHECKSUM_MISMATCH'
  | 'WHMCS_OPERATION_CONFLICT'
  | 'WHMCS_SSO_NOT_VERIFIED'
  | 'WHMCS_SSO_ALREADY_LINKED'
  | 'WHMCS_SSO_CLIENT_NOT_FOUND'
  | 'WHMCS_SSO_CLIENT_AMBIGUOUS'
  | 'WHMCS_SSO_EMAIL_MISMATCH'
  | 'WHMCS_SSO_MFA_REQUIRED'
  | 'WHMCS_SSO_BLOCKED'
  | 'WHMCS_SSO_RATE_LIMITED'
  | 'WHMCS_SSO_UNSAFE_REDIRECT'
  | 'WHMCS_SSO_LINK_CONFLICT';

export class WhmcsError extends Error {
  constructor(
    public readonly code: WhmcsErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'WhmcsError';
  }
}

export class WhmcsNotConfiguredError extends WhmcsError {
  constructor(reason: string) {
    super('WHMCS_NOT_CONFIGURED', reason, false);
    this.name = 'WhmcsNotConfiguredError';
  }
}

export class WhmcsInvalidConfigError extends WhmcsError {
  constructor(reason: string) {
    super('WHMCS_INVALID_CONFIG', reason, false);
    this.name = 'WhmcsInvalidConfigError';
  }
}

export class WhmcsTimeoutError extends WhmcsError {
  constructor(action: string, timeoutMs: number) {
    super('WHMCS_TIMEOUT', `WHMCS did not answer ${action} within ${timeoutMs} ms`, true, { action });
    this.name = 'WhmcsTimeoutError';
  }
}

export class WhmcsUnreachableError extends WhmcsError {
  constructor(action: string, cause: string) {
    // The cause is a transport-level string (DNS, TLS, connection reset). It never contains the
    // request body, and the body is the only place a secret travels.
    super('WHMCS_UNREACHABLE', `WHMCS could not be reached for ${action}`, true, { action, cause });
    this.name = 'WhmcsUnreachableError';
  }
}

export class WhmcsHttpError extends WhmcsError {
  constructor(action: string, status: number) {
    super(
      'WHMCS_HTTP_ERROR',
      `WHMCS answered ${action} with HTTP ${status}`,
      status === 429 || status >= 500,
      { action, status },
    );
    this.name = 'WhmcsHttpError';
  }
}

export class WhmcsMalformedResponseError extends WhmcsError {
  constructor(action: string, reason: string) {
    super('WHMCS_MALFORMED_RESPONSE', `WHMCS returned an unreadable response for ${action}`, false, {
      action,
      reason,
    });
    this.name = 'WhmcsMalformedResponseError';
  }
}

export class WhmcsApiError extends WhmcsError {
  constructor(action: string, message: string) {
    // WHMCS `result=error` messages are operator-facing. They are truncated and logged, but never
    // been shown to a customer verbatim (see `safeMessage` on the error).
    super('WHMCS_API_ERROR', `WHMCS rejected ${action}: ${message.slice(0, 200)}`, false, { action });
    this.name = 'WhmcsApiError';
  }
}

export class WhmcsSchemaError extends WhmcsError {
  constructor(action: string, issues: string[]) {
    super('WHMCS_SCHEMA_ERROR', `WHMCS response for ${action} did not match the expected shape`, false, {
      action,
      issues: issues.slice(0, 10),
    });
    this.name = 'WhmcsSchemaError';
  }
}

export class WhmcsCircuitOpenError extends WhmcsError {
  constructor(retryAfterMs: number) {
    super(
      'WHMCS_CIRCUIT_OPEN',
      'WHMCS is currently unavailable; requests are paused after repeated failures',
      true,
      { retryAfterMs },
    );
    this.name = 'WhmcsCircuitOpenError';
  }
}

export class WhmcsProductNotMappedError extends WhmcsError {
  constructor(serviceKey: string) {
    super(
      'WHMCS_PRODUCT_NOT_MAPPED',
      `No verified WHMCS product is mapped to "${serviceKey}"`,
      false,
      { serviceKey },
    );
    this.name = 'WhmcsProductNotMappedError';
  }
}

export class WhmcsCycleNotOfferedError extends WhmcsError {
  constructor(serviceKey: string, cycle: string) {
    super(
      'WHMCS_CYCLE_NOT_OFFERED',
      `WHMCS does not offer the ${cycle} cycle for "${serviceKey}"`,
      false,
      { serviceKey, cycle },
    );
    this.name = 'WhmcsCycleNotOfferedError';
  }
}

export class WhmcsCurrencyUnavailableError extends WhmcsError {
  constructor(requested: string, available: string[]) {
    super(
      'WHMCS_CURRENCY_UNAVAILABLE',
      `WHMCS has no ${requested} pricing for this product`,
      false,
      { requested, available },
    );
    this.name = 'WhmcsCurrencyUnavailableError';
  }
}

export class WhmcsMapInvalidError extends WhmcsError {
  constructor(reason: string, issues: string[] = []) {
    super('WHMCS_MAP_INVALID', `The product map is not usable: ${reason}`, false, { issues });
    this.name = 'WhmcsMapInvalidError';
  }
}

export class WhmcsMapChecksumError extends WhmcsError {
  constructor(expected: string, actual: string) {
    super(
      'WHMCS_MAP_CHECKSUM_MISMATCH',
      'The product map was modified after it was generated; refusing to use it',
      false,
      { expected, actual },
    );
    this.name = 'WhmcsMapChecksumError';
  }
}

export class WhmcsOperationConflictError extends WhmcsError {
  constructor(operationKey: string, state: string) {
    super(
      'WHMCS_OPERATION_CONFLICT',
      `Operation "${operationKey}" is already recorded in state "${state}"`,
      false,
      { operationKey, state },
    );
    this.name = 'WhmcsOperationConflictError';
  }
}

/**
 * Every B5.1 identity/session failure, with the same `code` contract as the rest of the taxonomy.
 *
 * A separate class rather than a dozen subclasses: the route needs one `instanceof` check and a
 * `code` switch to choose a status, and `details` stays empty on purpose so an upstream message can
 * never ride along by accident.
 */
export class WhmcsSsoError extends WhmcsError {
  constructor(code: WhmcsErrorCode, message: string) {
    super(code, message, false);
    this.name = 'WhmcsSsoError';
  }
}

/** Customer-safe sentence for any error in this layer. Never includes upstream text. */
export function safeCustomerMessage(error: unknown): string {
  if (error instanceof WhmcsError) {
    switch (error.code) {
      case 'WHMCS_NOT_CONFIGURED':
        return 'Hosting checkout is not connected on this deployment yet.';
      case 'WHMCS_PRODUCT_NOT_MAPPED':
      case 'WHMCS_CYCLE_NOT_OFFERED':
      case 'WHMCS_CURRENCY_UNAVAILABLE':
        return 'This service is not available to order online right now.';
      case 'WHMCS_CIRCUIT_OPEN':
      case 'WHMCS_TIMEOUT':
      case 'WHMCS_UNREACHABLE':
      case 'WHMCS_HTTP_ERROR':
        return 'Our billing system is temporarily unreachable. Please try again shortly.';
      case 'WHMCS_SSO_NOT_VERIFIED':
        return 'Verify your email address before connecting your billing account.';
      case 'WHMCS_SSO_CLIENT_NOT_FOUND':
        return 'We could not find a billing account with this email address. Please contact support.';
      case 'WHMCS_SSO_CLIENT_AMBIGUOUS':
        return 'More than one billing account matches this email address. Please contact support.';
      case 'WHMCS_SSO_EMAIL_MISMATCH':
        return 'Your billing account uses a different email address. Please contact support.';
      case 'WHMCS_SSO_MFA_REQUIRED':
        return 'Enable two-factor authentication on your account before opening the billing area.';
      case 'WHMCS_SSO_BLOCKED':
        return 'Single sign-on is switched off in your billing profile. Please sign in to the billing area directly.';
      case 'WHMCS_SSO_RATE_LIMITED':
        return 'You have opened the billing area several times in the last few minutes. Please wait a moment.';
      case 'WHMCS_SSO_ALREADY_LINKED':
      case 'WHMCS_SSO_LINK_CONFLICT':
        return 'This billing account is already connected to an account. Please contact support.';
      default:
        return 'We could not complete that request. No order or payment was created.';
    }
  }
  return 'We could not complete that request. No order or payment was created.';
}

const REDACTED_KEYS = /secret|password|token|identifier|apikey|api_key|auth/i;

/**
 * Strip anything that could be a credential out of an object before logging it. Keys are matched
 * case-insensitively; values under a matching key are replaced, and strings that look like the
 * configured secret are replaced too (defence in depth for nested provider payloads).
 */
export function redactForLog(
  value: unknown,
  secretValues: readonly string[] = [],
  depth = 0,
): unknown {
  if (depth > 6) return '[depth-limit]';
  if (typeof value === 'string') {
    return secretValues.some((s) => s.length > 0 && value.includes(s)) ? '[redacted]' : value;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactForLog(v, secretValues, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACTED_KEYS.test(k) ? '[redacted]' : redactForLog(v, secretValues, depth + 1);
    }
    return out;
  }
  return value;
}
