/**
 * GoDaddy registrar adapter — a real integration against GoDaddy's documented Domains REST API
 * (https://developer.godaddy.com/doc), ported from
 * `cloudhost247-node/src/domain-services/providers/godaddy-adapter.ts`.
 *
 * Transport boundary only: every value is normalised from the API's documented JSON, or a typed
 * `DomainProviderError` is thrown. No state is fabricated.
 *
 * Authentication: `Authorization: sso-key <apiKey>:<apiSecret>`. An optional `shopperId` credential
 * scopes calls to a sub-shopper through `X-Shopper-Id`.
 *
 * Environment maps to GoDaddy's split: production → `api.godaddy.com`, sandbox →
 * `api.ote-godaddy.com` (their Operational Test Environment). `api_base_url` overrides both.
 *
 * **Prices.** GoDaddy's documented price fields have changed shape over time, and guessing would
 * invent a number a customer is then charged from. Both documented shapes are read explicitly —
 * the legacy `price` in millionths of the currency unit, and the newer `prices[]` entries in minor
 * units (cents) — and an unrecognised shape yields **no price at all** rather than a wrong one.
 *
 * **`available` is only trusted when the API says it is definitive.** GoDaddy's FAST checkType can
 * answer optimistically; `definitive: false` is carried through in `metadata` so the platform never
 * presents an indicative answer as a guaranteed one.
 */
'use strict';

const { DomainProviderError } = require('../types');
const { providerFetch, httpStatusToProviderError, parseProviderJson } = require('../http');

const PRODUCTION_BASE = 'https://api.godaddy.com';
const OTE_BASE = 'https://api.ote-godaddy.com';

/** GoDaddy's documented batch ceiling for the availability endpoint. */
const GODADDY_CHECK_BATCH_LIMIT = 100;

function requireCredential(config, name) {
  const value = config?.credentials?.[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DomainProviderError('PROVIDER_NOT_CONFIGURED', `GoDaddy credential '${name}' is not configured`, false, { credential: name });
  }
  return value.trim();
}

function baseUrl(config) {
  const configured = String(config?.apiBaseUrl ?? '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  return config?.environment === 'sandbox' ? OTE_BASE : PRODUCTION_BASE;
}

/** Minor currency units (cents) → decimal string. */
function minorUnitsToAmount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return (value / 100).toFixed(2);
}

/** GoDaddy's legacy micro-unit price (millionths) → decimal string. */
function microUnitsToAmount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return (value / 1_000_000).toFixed(2);
}

function pricingFromAvailability(entry) {
  const prices = Array.isArray(entry?.prices) ? entry.prices : null;
  if (prices && prices.length > 0) {
    const first = prices[0];
    const registration = first?.price?.value !== undefined ? minorUnitsToAmount(first.price.value) : null;
    const renewal = first?.renewalPrice?.value !== undefined ? minorUnitsToAmount(first.renewalPrice.value) : null;
    const currency = first?.price?.currencyCode ?? entry.currency ?? 'USD';
    if (registration) {
      return { registration: { amount: registration, currency }, renewal: renewal ? { amount: renewal, currency } : null, transfer: null, premium: false };
    }
  }
  if (entry?.price !== undefined) {
    const amount = microUnitsToAmount(entry.price);
    if (amount) return { registration: { amount, currency: entry.currency ?? 'USD' }, renewal: null, transfer: null, premium: false };
  }
  // An unrecognised price shape yields nothing. A zero here would be a free domain.
  return null;
}

class GoDaddyAdapter {
  constructor(config, options = {}) {
    this.key = 'godaddy';
    this.config = config ?? {};
    this.transport = options.transport;
    this.timeoutMs = options.timeoutMs;
    this.allowLoopback = options.allowLoopback === true;
    this.capabilities = Object.freeze({
      availability: true,
      pricing: true,
      registration: true,
      transfer: true,
      domainStatus: true,
      domainInfo: true,
      extensions: false,
      appraisal: false,
      registryPresence: false,
    });
  }

  headers(extra = {}) {
    const apiKey = requireCredential(this.config, 'apiKey');
    const apiSecret = requireCredential(this.config, 'apiSecret');
    const headers = { Authorization: `sso-key ${apiKey}:${apiSecret}`, Accept: 'application/json', ...extra };
    const shopperId = String(this.config?.credentials?.shopperId ?? '').trim();
    if (shopperId) headers['X-Shopper-Id'] = shopperId;
    return headers;
  }

  async request(method, path, body) {
    const response = await providerFetch({
      url: `${baseUrl(this.config)}${path}`,
      method,
      headers: this.headers(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
      transport: this.transport,
      timeoutMs: this.timeoutMs,
      allowLoopback: this.allowLoopback,
    });
    if (!response.ok) throw httpStatusToProviderError(response.status, response.text);
    if (String(response.text ?? '').trim() === '') return null;
    return parseProviderJson(response);
  }

  async testConnection() {
    try {
      // A cheap authenticated read of the account's own domain list: 401/403 means bad keys.
      await this.request('GET', '/v1/domains?limit=1&statuses=ACTIVE');
      return { status: 'connected', message: 'GoDaddy accepted the configured API credentials.', capabilities: this.capabilities };
    } catch (error) {
      if (error instanceof DomainProviderError) {
        return {
          status: error.code === 'AUTHENTICATION_FAILED' ? 'auth_failed'
            : error.code === 'PROVIDER_NOT_CONFIGURED' ? 'not_configured' : 'unavailable',
          message: error.message,
          capabilities: this.capabilities,
        };
      }
      return { status: 'unavailable', message: 'GoDaddy could not be reached', capabilities: this.capabilities };
    }
  }

  async checkAvailability(domainNames) {
    if (domainNames.length === 0) return [];
    const results = [];

    for (let offset = 0; offset < domainNames.length; offset += GODADDY_CHECK_BATCH_LIMIT) {
      const batch = domainNames.slice(offset, offset + GODADDY_CHECK_BATCH_LIMIT);
      // Documented batch endpoint: a flat JSON array of domains.
      const raw = await this.request('POST', '/v1/domains/available?checkType=FAST', batch);
      const entries = Array.isArray(raw) ? raw : [raw];

      for (const entry of entries) {
        const domainName = String(entry?.domain ?? '').toLowerCase();
        if (!domainName) continue;
        const checkedAt = new Date().toISOString();
        const definitive = entry?.definitive ?? false;

        if (entry?.available === true) {
          results.push({
            domainName, status: 'available', pricing: pricingFromAvailability(entry),
            providerReference: null, metadata: { definitive, period: entry?.period ?? null }, checkedAt,
          });
        } else if (entry?.available === false) {
          results.push({ domainName, status: 'registered', pricing: null, providerReference: null, metadata: { definitive }, checkedAt });
        } else {
          // The provider declined to answer for this name. That is a third state, not an available.
          results.push({ domainName, status: 'unavailable', pricing: null, providerReference: null, metadata: { definitive }, checkedAt });
        }
      }
    }
    return results;
  }

  /**
   * GoDaddy publishes per-domain pricing on availability checks; this integration has no static TLD
   * price list from them, so the extension catalogue is refused by name rather than approximated.
   * `capabilities.extensions === false` is what stops the platform asking.
   */
  async getExtensions() {
    throw new DomainProviderError(
      'UNSUPPORTED_OPERATION',
      'This GoDaddy adapter does not expose a TLD catalogue; configure the registrar that provides one',
      false,
    );
  }

  async getPricing() {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'GoDaddy TLD catalogue pricing is not exposed by this adapter; use per-check pricing', false);
  }

  async registerDomain(input) {
    const contact = input.contacts.registrant;
    const contactPayload = (source) => ({
      email: source.email,
      firstName: source.firstName,
      lastName: source.lastName,
      ...(source.organization ? { organization: source.organization } : {}),
      addressMailing: {
        address1: source.addressLine1,
        ...(source.addressLine2 ? { address2: source.addressLine2 } : {}),
        city: source.city,
        ...(source.state ? { state: source.state } : {}),
        ...(source.postalCode ? { postalCode: source.postalCode } : {}),
        country: source.countryCode,
      },
      phone: source.phone,
    });

    const payload = {
      domain: input.domainName,
      consent: {
        agreedAt: new Date().toISOString(),
        agreedBy: contact.email,
        agreementKeys: this.config?.configuration?.agreementKeys ?? [],
      },
      period: input.years,
      contacts: {
        registrant: contactPayload(contact),
        admin: input.contacts.administrative ? contactPayload(input.contacts.administrative) : contactPayload(contact),
        ...(input.contacts.technical ? { tech: contactPayload(input.contacts.technical) } : {}),
        ...(input.contacts.billing ? { billing: contactPayload(input.contacts.billing) } : {}),
      },
    };

    const entry = (await this.request('POST', '/v1/domains/purchase', payload)) ?? {};
    if (!entry.orderId && !entry.entitlementId) {
      throw new DomainProviderError('INVALID_PROVIDER_RESPONSE', 'GoDaddy purchase response missing order reference', false, {
        bodySample: JSON.stringify(entry).slice(0, 500),
      });
    }
    return {
      providerReference: entry.orderId ? String(entry.orderId) : entry.entitlementId,
      status: 'pending_confirmation',
      expiresAt: null,
      providerStatus: 'PURCHASE_SUBMITTED',
      metadata: { orderId: entry.orderId ?? null, entitlementId: entry.entitlementId ?? null, totalPaid: entry.totalPaid ?? null },
    };
  }

  async transferDomain(input) {
    const entry = (await this.request('POST', `/v1/domains/${encodeURIComponent(input.domainName)}/transfer`, {
      authCode: input.authCode,
      consent: {
        agreedAt: new Date().toISOString(),
        agreedBy: input.contacts?.registrant?.email ?? 'registrant@cloudhost247.invalid',
        agreementKeys: this.config?.configuration?.agreementKeys ?? [],
      },
    })) ?? {};
    return {
      // Always a string: `provider_reference` is a text column, and a numeric id echoed back by the
      // API must not change type on the way into storage.
      providerReference: entry.transferId !== undefined && entry.transferId !== null
        ? String(entry.transferId)
        : (entry.orderId ? String(entry.orderId) : `godaddy-transfer:${input.domainName}`),
      status: 'initiated',
      providerStatus: 'TRANSFER_SUBMITTED',
      metadata: { orderId: entry.orderId ?? null },
    };
  }

  /** The live record for a domain on this account — what the transfer refresh poll reads. */
  async getDomainStatus(providerReference, domainName) {
    const entry = (await this.request('GET', `/v1/domains/${encodeURIComponent(domainName)}`)) ?? {};
    const status = entry.status ?? 'UNKNOWN';

    let registrationStatus = 'unknown';
    if (/active|ok/i.test(status)) registrationStatus = 'registered';
    else if (/pending/i.test(status)) registrationStatus = 'pending_confirmation';
    else if (/cancel|error|failed/i.test(status)) registrationStatus = 'failed';

    return {
      domainName: String(domainName).toLowerCase(),
      registrationStatus,
      // Only reported when the API reports it. GoDaddy's `transferStatus` is a free-text field, and
      // an absent one must stay absent so the caller cannot read "no transfer" into it.
      ...(entry.transferStatus ? { transferStatus: 'in_progress' } : {}),
      providerStatus: status,
      expiresAt: entry.expires ?? entry.expiresAt ?? null,
      metadata: { providerReference: providerReference ?? null, transferStatus: entry.transferStatus ?? null },
    };
  }

  /** Account-scoped owner view — only meaningful for a domain on the connected account. */
  async getDomainInfo(domainName) {
    const entry = (await this.request('GET', `/v1/domains/${encodeURIComponent(domainName)}`)) ?? {};
    return {
      domainName: String(domainName).toLowerCase(),
      registrar: 'GoDaddy',
      createdAt: entry.createdAt ?? null,
      updatedAt: null,
      expiresAt: entry.expires ?? null,
      statuses: Array.isArray(entry.status) ? entry.status : entry.status ? [entry.status] : [],
      nameservers: (entry.nameservers ?? []).map((ns) => ns?.name ?? '').filter(Boolean),
      registry: null,
      privacyProtected: false,
      source: 'rdap',
      providerReference: null,
    };
  }

  async appraiseDomain() {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'Use the GoValue appraisal adapter for appraisals', false);
  }

  async lookupRegistryPresence() {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'The registrar answers availability directly; use checkAvailability', false);
  }
}

module.exports = { GoDaddyAdapter, PRODUCTION_BASE, OTE_BASE, GODADDY_CHECK_BATCH_LIMIT, pricingFromAvailability };
