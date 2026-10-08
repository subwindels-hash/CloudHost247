/**
 * Domain-provider contract — ported from `cloudhost247-node/src/domain-services/providers/types.ts`.
 *
 * The domain services layer owns business rules, customer ownership, price snapshots, payment gates,
 * state transitions and auditing. Provider adapters are deliberately narrow transport boundaries:
 * they turn an authenticated registrar/RDAP/appraisal API into normalised facts. **They never
 * manufacture availability, price, WHOIS, appraisal or auction data.**
 *
 * That sentence is the whole reason this module exists. Before it, `domains/domain-services.js`
 * answered an availability search with a regular expression over the domain name
 * (`/google|facebook/` → "taken", everything else → "available") and labelled the answer an
 * "estimate". A guess presented as a lookup is worse than a refusal, because the customer acts on
 * it: they register a domain that was never available, or abandon one that was.
 *
 * So a lookup that cannot reach a registry now returns **no answer at all** — `available: null`
 * plus a code naming what is missing — and the customer-facing sentence is derived from the failure
 * code, never from the provider's own error text (which can name internal hosts and accounts).
 */
'use strict';

/**
 * Every way a provider call can fail, with the retryability of each. A code is stable API surface:
 * the customer response carries it, and runbooks and admin screens key off it.
 */
const FAILURE_CODES = Object.freeze([
  'PROVIDER_NOT_CONFIGURED',
  'ADAPTER_NOT_INSTALLED',
  'AUTHENTICATION_FAILED',
  'RATE_LIMITED',
  'NETWORK_TEMPORARY_FAILURE',
  'PROVIDER_UNAVAILABLE',
  'UNSUPPORTED_OPERATION',
  'INVALID_PROVIDER_RESPONSE',
  'NO_REGISTRY_RECORD',
  'PROVIDER_ERROR',
]);

/** Capabilities an adapter may claim. A capability it does not claim is refused by name, never faked. */
const CAPABILITY_KEYS = Object.freeze([
  'availability', 'pricing', 'registration', 'transfer', 'domainStatus',
  'domainInfo', 'extensions', 'appraisal', 'registryPresence',
]);

class DomainProviderError extends Error {
  /**
   * @param {string} code    one of FAILURE_CODES
   * @param {string} message server-side diagnostic. Never shown to a customer.
   * @param {boolean} retryable
   * @param {object} [providerDetail] sanitised provider detail; never carries credentials
   */
  constructor(code, message, retryable = false, providerDetail = null) {
    super(message);
    if (!FAILURE_CODES.includes(code)) {
      throw new Error(`DomainProviderError: '${code}' is not a known failure code`);
    }
    this.name = 'DomainProviderError';
    this.code = code;
    this.retryable = retryable === true;
    this.providerDetail = providerDetail ?? null;
  }

  /** The shape stored on an audit row or a `domain_*` table's error columns. */
  toEvidence() {
    return { code: this.code, retryable: this.retryable, message: String(this.message).slice(0, 500) };
  }
}

/**
 * The one sentence it is safe to show a customer for a failure code.
 *
 * Deliberately derived from the *code* and not from `error.message`: an adapter's message can carry
 * provider internals (a hostname, an account id, a partially-parsed body). The same split
 * `lib/providers/error-mapping.js` applies to infrastructure providers.
 */
const CUSTOMER_MESSAGES = Object.freeze({
  PROVIDER_NOT_CONFIGURED: 'Domain lookups are not available on this deployment yet — no domain provider is connected.',
  ADAPTER_NOT_INSTALLED: 'Domain lookups are not available on this deployment yet — the configured provider is not supported by this build.',
  AUTHENTICATION_FAILED: 'The domain provider could not be authenticated. Please try again later.',
  RATE_LIMITED: 'The domain provider is rate limiting this deployment. Please try again shortly.',
  NETWORK_TEMPORARY_FAILURE: 'The domain provider is temporarily unreachable. Please try again.',
  PROVIDER_UNAVAILABLE: 'The domain provider is temporarily unavailable. Please try again.',
  UNSUPPORTED_OPERATION: 'This domain provider cannot perform that lookup.',
  INVALID_PROVIDER_RESPONSE: 'The domain provider returned a response that could not be read.',
  NO_REGISTRY_RECORD: 'No registry record exists for that domain name.',
  PROVIDER_ERROR: 'The domain provider could not complete this request.',
});

const FALLBACK_MESSAGE = 'The domain provider could not complete this request.';

function safeDomainProviderMessage(error) {
  const code = error instanceof DomainProviderError ? error.code : null;
  return CUSTOMER_MESSAGES[code] ?? FALLBACK_MESSAGE;
}

/** The public, non-throwing projection of a failure: enough for the UI, no provider internals. */
function domainFailure(error) {
  const code = error instanceof DomainProviderError ? error.code : 'PROVIDER_ERROR';
  return {
    code,
    retryable: error instanceof DomainProviderError ? error.retryable : false,
    message: safeDomainProviderMessage(error),
  };
}

module.exports = {
  FAILURE_CODES,
  CAPABILITY_KEYS,
  CUSTOMER_MESSAGES,
  FALLBACK_MESSAGE,
  DomainProviderError,
  safeDomainProviderMessage,
  domainFailure,
};
