/**
 * GoDaddy GoValue appraisal adapter — a real integration with GoDaddy's documented GoValue API
 * (https://www.godaddy.com/help/make-a-call-to-the-govalue-api-41963), ported from
 * `cloudhost247-node/src/domain-services/providers/govalue-appraisal-adapter.ts`.
 *
 *   GET {base}/v1/domains/govalues?domainName=<domain>
 *   Authorization: sso-key <key>:<secret>
 *
 * Documented response: `{ domainName, goValue, listPrice, goValueWholesale, minPrice, maxPrice,
 * salesProbability, salesProbability500 }`.
 *
 * The adapter maps only what the API actually returns. **Comparable sales are never synthesised** —
 * GoValue publishes no comparable-sales list, so `comparableSales` stays empty rather than being
 * filled with invented transactions, which is the one thing an appraisal must not do: a fabricated
 * comparable is a fabricated price. The investment factors the API does return (list price, range,
 * sale probability) are carried through in `factors` so the number can be explained.
 *
 * Credentials are required. Without them every call refuses with PROVIDER_NOT_CONFIGURED and no
 * request is made.
 */
'use strict';

const { DomainProviderError } = require('../types');
const { providerFetch, httpStatusToProviderError, parseProviderJson } = require('../http');

const PRODUCTION_BASE = 'https://api.godaddy.com';
const OTE_BASE = 'https://api.ote-godaddy.com';
/** A syntactically valid, permanently registered probe domain: GoValue answers for any valid name. */
const PROBE_DOMAIN = 'example.com';

function requireCredential(config, name) {
  const value = config?.credentials?.[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DomainProviderError('PROVIDER_NOT_CONFIGURED', `Appraisal credential '${name}' is not configured`, false);
  }
  return value.trim();
}

function baseUrl(config) {
  const configured = String(config?.apiBaseUrl ?? '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  return (config?.environment === 'sandbox' ? OTE_BASE : PRODUCTION_BASE);
}

class GoValueAppraisalAdapter {
  constructor(config, options = {}) {
    this.key = 'govalue';
    this.config = config ?? {};
    this.transport = options.transport;
    this.timeoutMs = options.timeoutMs;
    this.allowLoopback = options.allowLoopback === true;
    this.capabilities = Object.freeze({
      availability: false,
      pricing: false,
      registration: false,
      transfer: false,
      domainStatus: false,
      domainInfo: false,
      extensions: false,
      appraisal: true,
      registryPresence: false,
    });
  }

  _headers() {
    const key = requireCredential(this.config, 'apiKey');
    const secret = requireCredential(this.config, 'apiSecret');
    return { Authorization: `sso-key ${key}:${secret}`, Accept: 'application/json' };
  }

  async _appraise(domainName) {
    const url = `${baseUrl(this.config)}/v1/domains/govalues?domainName=${encodeURIComponent(domainName)}`;
    const response = await providerFetch({ url, method: 'GET', headers: this._headers(), transport: this.transport, timeoutMs: this.timeoutMs, allowLoopback: this.allowLoopback });
    if (!response.ok) throw httpStatusToProviderError(response.status, response.text);

    const data = parseProviderJson(response);
    const goValue = data?.goValue;
    if (typeof goValue !== 'number' || !Number.isFinite(goValue) || goValue < 0) {
      // A missing valuation is not a zero valuation. Refuse rather than report $0.
      throw new DomainProviderError('INVALID_PROVIDER_RESPONSE', 'Appraisal provider did not return a usable valuation', false, {
        bodySample: String(response.text ?? '').slice(0, 500),
      });
    }
    return { data, goValue };
  }

  async testConnection() {
    try {
      // A real authenticated call. A 401/403 is an answer about the credentials, so it is reported
      // as `auth_failed` rather than thrown — the operator asked "does this work?", not "do it".
      const response = await providerFetch({
        url: `${baseUrl(this.config)}/v1/domains/govalues?domainName=${PROBE_DOMAIN}`,
        method: 'GET',
        headers: this._headers(),
        transport: this.transport,
        timeoutMs: this.timeoutMs,
        allowLoopback: this.allowLoopback,
      });
      if (response.status === 401 || response.status === 403) {
        return { status: 'auth_failed', message: 'GoValue rejected the configured credentials', capabilities: this.capabilities };
      }
      if (!response.ok) throw httpStatusToProviderError(response.status, response.text);
      return { status: 'connected', message: 'GoValue accepted the configured API credentials.', capabilities: this.capabilities };
    } catch (error) {
      if (error instanceof DomainProviderError) {
        return {
          status: error.code === 'AUTHENTICATION_FAILED' ? 'auth_failed' : (error.code === 'PROVIDER_NOT_CONFIGURED' ? 'not_configured' : 'unavailable'),
          message: error.message,
          capabilities: this.capabilities,
        };
      }
      return { status: 'unavailable', message: 'GoValue could not be reached', capabilities: this.capabilities };
    }
  }

  async appraiseDomain(domainName) {
    const normalized = String(domainName).toLowerCase();
    const { data, goValue } = await this._appraise(normalized);

    return {
      estimatedValue: { amount: goValue.toFixed(2), currency: 'USD' },
      // GoValue publishes no confidence band; the min/max range it does publish is carried in
      // `factors` rather than being dressed up as one.
      confidence: null,
      tld: normalized.slice(normalized.lastIndexOf('.') + 1),
      domainLength: normalized.length,
      keywords: [],
      brandability: null,
      comparableSales: [],
      factors: {
        provider: 'govalue',
        listPrice: data?.listPrice ?? null,
        goValueWholesale: data?.goValueWholesale ?? null,
        minPrice: data?.minPrice ?? null,
        maxPrice: data?.maxPrice ?? null,
        salesProbability: data?.salesProbability ?? null,
        salesProbability500: data?.salesProbability500 ?? null,
      },
      providerReference: null,
    };
  }

  async checkAvailability() {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'The appraisal provider does not check availability', false);
  }
  async lookupRegistryPresence() {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'The appraisal provider cannot answer registry-presence questions', false);
  }
  async getPricing() {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'The appraisal provider does not provide pricing', false);
  }
  async getExtensions() {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'The appraisal provider does not provide extensions', false);
  }
  async registerDomain() {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'The appraisal provider is read-only', false);
  }
  async transferDomain() {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'The appraisal provider is read-only', false);
  }
  async getDomainStatus() {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'The appraisal provider is read-only', false);
  }
  async getDomainInfo() {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'The appraisal provider does not provide WHOIS data', false);
  }
}

module.exports = { GoValueAppraisalAdapter, PRODUCTION_BASE, OTE_BASE };
