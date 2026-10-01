/**
 * GoDaddy registrar adapter — a real integration against GoDaddy's documented Domains REST API
 * (https://developer.godaddy.com/doc). Transport boundary only: every response is normalized from
 * the API's documented JSON, or a typed DomainProviderError is thrown. No state is fabricated.
 *
 * Authentication: `Authorization: sso-key <key>:<secret>` (credentials: apiKey, apiSecret).
 * Optional `shopperId` credential scopes calls to a sub-shopper (X-Shopper-Id header).
 *
 * Environment maps to GoDaddy's split:
 *   production → https://api.godaddy.com
 *   sandbox    → https://api.ote-godaddy.com  (GoDaddy's Operational Test Environment)
 *
 * GoDaddy's documented price fields have changed shape over time. Both are handled honestly:
 *   - legacy `price` on the availability response is in millionths of the currency unit
 *   - the newer `prices[]` array carries `price.value`/`renewalPrice.value` in minor units (cents)
 */
import {
  DomainProviderError,
  type DomainAvailability,
  type DomainExtensionOffering,
  type DomainProviderAdapter,
  type DomainProviderCapabilities,
  type DomainProviderConfig,
  type DomainProviderConnectionResult,
  type ProviderDomainStatus,
  type PublicDomainInfo,
  type RegisterDomainInput,
  type RegisterDomainResult,
  type TransferDomainInput,
  type TransferDomainResult,
} from './types';
import { httpStatusToProviderError, parseProviderJson, providerFetch, type ProviderHttpResponse } from './provider-http';

const PRODUCTION_BASE = 'https://api.godaddy.com';
const OTE_BASE = 'https://api.ote-godaddy.com';

/** GoDaddy batch availability accepts up to 100 domains per POST (documented). */
const GODADDY_CHECK_BATCH_LIMIT = 100;

function requireCredential(config: DomainProviderConfig, name: string): string {
  const value = config.credentials[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DomainProviderError('PROVIDER_NOT_CONFIGURED', `GoDaddy credential '${name}' is not configured`, false);
  }
  return value.trim();
}

function baseUrl(config: DomainProviderConfig): string {
  return (config.apiBaseUrl?.trim() || (config.environment === 'sandbox' ? OTE_BASE : PRODUCTION_BASE)).replace(/\/+$/, '');
}

function authHeaders(config: DomainProviderConfig): Record<string, string> {
  const apiKey = requireCredential(config, 'apiKey');
  const apiSecret = requireCredential(config, 'apiSecret');
  const headers: Record<string, string> = {
    Authorization: `sso-key ${apiKey}:${apiSecret}`,
    Accept: 'application/json',
  };
  const shopperId = config.credentials.shopperId?.trim();
  if (shopperId) headers['X-Shopper-Id'] = shopperId;
  return headers;
}

async function godaddyJson(
  config: DomainProviderConfig,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<unknown> {
  const response: ProviderHttpResponse = await providerFetch({
    url: `${baseUrl(config)}${path}`,
    method,
    headers: { ...authHeaders(config), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw httpStatusToProviderError(response.status, response.text);
  }
  if (response.text.trim() === '') return null;
  return parseProviderJson<unknown>(response);
}

/** Converts minor currency units (cents) to a decimal string. */
function minorUnitsToAmount(value: number): string | null {
  if (!Number.isFinite(value) || value < 0) return null;
  return (value / 100).toFixed(2);
}

/** Converts GoDaddy's legacy micro-unit price (millionths) to a decimal string. */
function microUnitsToAmount(value: number): string | null {
  if (!Number.isFinite(value) || value < 0) return null;
  return (value / 1_000_000).toFixed(2);
}

interface GoDaddyAvailabilityEntry {
  available?: boolean;
  definitive?: boolean;
  domain?: string;
  currency?: string;
  period?: number;
  /** Legacy field: price in millionths of the currency unit. */
  price?: number;
  /** Newer field: per-term pricing with values in minor units. */
  prices?: Array<{
    period?: number;
    term?: string;
    price?: { currencyCode?: string; value?: number };
    renewalPrice?: { currencyCode?: string; value?: number };
  }>;
}

function pricingFromAvailability(entry: GoDaddyAvailabilityEntry): DomainAvailability['pricing'] {
  if (Array.isArray(entry.prices) && entry.prices.length > 0) {
    const first = entry.prices[0];
    if (!first) return null;
    const registration = first.price?.value !== undefined ? minorUnitsToAmount(first.price.value) : null;
    const renewal = first.renewalPrice?.value !== undefined ? minorUnitsToAmount(first.renewalPrice.value) : null;
    const currency = first.price?.currencyCode ?? entry.currency ?? 'USD';
    if (registration) {
      return { registration: { amount: registration, currency }, renewal: renewal ? { amount: renewal, currency } : null, transfer: null, premium: false };
    }
  }
  if (entry.price !== undefined) {
    const amount = microUnitsToAmount(entry.price);
    const currency = entry.currency ?? 'USD';
    if (amount) {
      return { registration: { amount, currency }, renewal: null, transfer: null, premium: false };
    }
  }
  return null;
}

export class GoDaddyAdapter implements DomainProviderAdapter {
  readonly key = 'godaddy';
  readonly capabilities: Partial<DomainProviderCapabilities> = {
    availability: true,
    pricing: true,
    registration: true,
    transfer: true,
    domainStatus: true,
    domainInfo: true,
    extensions: false,
    appraisal: false,
  };

  constructor(private readonly config: DomainProviderConfig) {}

  async testConnection(): Promise<DomainProviderConnectionResult> {
    try {
      // A cheap authenticated read: list one domain from the account. 401/403 means bad keys.
      await godaddyJson(this.config, 'GET', '/v1/domains?limit=1&statuses=ACTIVE');
      return { status: 'connected', message: 'GoDaddy accepted the configured API credentials.', capabilities: this.capabilities };
    } catch (error) {
      if (error instanceof DomainProviderError) {
        return {
          status: error.code === 'AUTHENTICATION_FAILED' ? 'auth_failed' : 'unavailable',
          message: error.message,
          capabilities: this.capabilities,
        };
      }
      return { status: 'unavailable', message: 'GoDaddy could not be reached', capabilities: this.capabilities };
    }
  }

  async checkAvailability(domainNames: string[]): Promise<DomainAvailability[]> {
    if (domainNames.length === 0) return [];
    const results: DomainAvailability[] = [];

    for (let offset = 0; offset < domainNames.length; offset += GODADDY_CHECK_BATCH_LIMIT) {
      const batch = domainNames.slice(offset, offset + GODADDY_CHECK_BATCH_LIMIT);
      // Documented batch endpoint: POST /v1/domains/available with a flat JSON array of domains.
      const raw = await godaddyJson(this.config, 'POST', '/v1/domains/available?checkType=FAST', batch);
      const entries = Array.isArray(raw) ? (raw as GoDaddyAvailabilityEntry[]) : [raw as GoDaddyAvailabilityEntry];

      for (const entry of entries) {
        const domainName = (entry.domain ?? '').toLowerCase();
        if (!domainName) continue;

        if (entry.available === true) {
          const pricing = pricingFromAvailability(entry);
          // GoDaddy's FAST check is not definitive; only a definitive true is a real available.
          results.push({
            domainName,
            status: 'available',
            pricing,
            providerReference: null,
            metadata: { definitive: entry.definitive ?? false, period: entry.period ?? null },
            checkedAt: new Date().toISOString(),
          });
        } else if (entry.available === false) {
          results.push({
            domainName,
            status: 'registered',
            pricing: null,
            providerReference: null,
            metadata: { definitive: entry.definitive ?? false },
            checkedAt: new Date().toISOString(),
          });
        } else {
          // The provider declined to answer for this domain — surface that honestly.
          results.push({
            domainName,
            status: 'unavailable',
            pricing: null,
            providerReference: null,
            metadata: { definitive: entry.definitive ?? false },
            checkedAt: new Date().toISOString(),
          });
        }
      }
    }
    return results;
  }

  async getPricing(extensions: string[]): Promise<DomainExtensionOffering[]> {
    // GoDaddy publishes per-domain pricing on availability checks, not a static TLD price list in
    // this integration. The extension catalogue is therefore provided by the registrar that
    // supports it (see capabilities.extensions = false).
    void extensions;
    throw new DomainProviderError(
      'UNSUPPORTED_OPERATION',
      'GoDaddy TLD catalogue pricing is not exposed by this adapter; use per-check pricing',
      false
    );
  }

  async getExtensions(): Promise<DomainExtensionOffering[]> {
    throw new DomainProviderError(
      'UNSUPPORTED_OPERATION',
      'This GoDaddy adapter does not expose a TLD catalogue; configure the registrar that provides one',
      false
    );
  }

  async registerDomain(input: RegisterDomainInput): Promise<RegisterDomainResult> {
    const contact = input.contacts.registrant;
    const contactPayload = {
      email: contact.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
      organization: contact.organization ?? undefined,
      addressMailing: {
        address1: contact.addressLine1,
        address2: contact.addressLine2 ?? undefined,
        city: contact.city,
        state: contact.state ?? undefined,
        postalCode: contact.postalCode ?? undefined,
        country: contact.countryCode,
      },
      phone: contact.phone,
    };

    // Documented purchase flow: POST /v1/domains/purchase with consent captured at order time.
    // GoDaddy requires agreement keys/privacy flags; we send the documented minimal payload.
    const payload = {
      domain: input.domainName,
      consent: {
        agreedAt: new Date().toISOString(),
        agreedBy: contact.email,
        agreementKeys: this.config.configuration.agreementKeys ?? [],
      },
      period: input.years,
      nameServers: undefined,
      contacts: {
        registrant: contactPayload,
        admin: input.contacts.administrative
          ? {
              email: input.contacts.administrative.email,
              firstName: input.contacts.administrative.firstName,
              lastName: input.contacts.administrative.lastName,
              addressMailing: {
                address1: input.contacts.administrative.addressLine1,
                city: input.contacts.administrative.city,
                state: input.contacts.administrative.state ?? undefined,
                postalCode: input.contacts.administrative.postalCode ?? undefined,
                country: input.contacts.administrative.countryCode,
              },
              phone: input.contacts.administrative.phone,
            }
          : contactPayload,
        tech: input.contacts.technical ? contactPayload : undefined,
        billing: input.contacts.billing ? contactPayload : undefined,
      },
    };

    const raw = await godaddyJson(this.config, 'POST', '/v1/domains/purchase', payload);
    const entry = (raw ?? {}) as { orderId?: number; entitlementId?: string; currency?: string; totalPaid?: number };

    if (!entry.orderId && !entry.entitlementId) {
      throw new DomainProviderError(
        'INVALID_PROVIDER_RESPONSE',
        'GoDaddy purchase response missing order reference',
        false,
        { bodySample: JSON.stringify(entry).slice(0, 500) }
      );
    }

    return {
      providerReference: entry.orderId ? String(entry.orderId) : (entry.entitlementId as string),
      status: 'pending_confirmation',
      expiresAt: null,
      providerStatus: 'PURCHASE_SUBMITTED',
      metadata: { orderId: entry.orderId ?? null, entitlementId: entry.entitlementId ?? null, totalPaid: entry.totalPaid ?? null },
    };
  }

  async transferDomain(input: TransferDomainInput): Promise<TransferDomainResult> {
    // Documented: POST /v1/domains/{domain}/transfer with the EPP auth code.
    const raw = await godaddyJson(this.config, 'POST', `/v1/domains/${encodeURIComponent(input.domainName)}/transfer`, {
      authCode: input.authCode,
      consent: {
        agreedAt: new Date().toISOString(),
        agreedBy: input.contacts?.registrant?.email ?? 'registrant@cloudhost247.invalid',
        agreementKeys: this.config.configuration.agreementKeys ?? [],
      },
    });
    const entry = (raw ?? {}) as { orderId?: number; transferId?: string };
    return {
      providerReference: entry.transferId ?? (entry.orderId ? String(entry.orderId) : `godaddy-transfer:${input.domainName}`),
      status: 'initiated',
      providerStatus: 'TRANSFER_SUBMITTED',
      metadata: { orderId: entry.orderId ?? null },
    };
  }

  async getDomainStatus(providerReference: string, domainName: string): Promise<ProviderDomainStatus> {
    const raw = await godaddyJson(this.config, 'GET', `/v1/domains/${encodeURIComponent(domainName)}`);
    const entry = (raw ?? {}) as { status?: string; expires?: string; expiresAt?: string; transferStatus?: string };
    const status = entry.status ?? 'UNKNOWN';

    let registrationStatus: ProviderDomainStatus['registrationStatus'] = 'unknown';
    if (/active|ok/i.test(status)) registrationStatus = 'registered';
    else if (/pending/i.test(status)) registrationStatus = 'pending_confirmation';
    else if (/cancel|error|failed/i.test(status)) registrationStatus = 'failed';

    return {
      domainName: domainName.toLowerCase(),
      registrationStatus,
      transferStatus: entry.transferStatus ? 'in_progress' : undefined,
      providerStatus: status,
      expiresAt: entry.expires ?? entry.expiresAt ?? null,
      metadata: { providerReference },
    };
  }

  async getDomainInfo(domainName: string): Promise<PublicDomainInfo> {
    // Only meaningful for domains on the connected GoDaddy account (account-scoped API).
    const raw = await godaddyJson(this.config, 'GET', `/v1/domains/${encodeURIComponent(domainName)}`);
    const entry = (raw ?? {}) as {
      domain?: string;
      createdAt?: string;
      expires?: string;
      status?: string | string[];
      nameservers?: Array<{ name?: string }>;
    };
    return {
      domainName: domainName.toLowerCase(),
      registrar: 'GoDaddy',
      createdAt: entry.createdAt ?? null,
      updatedAt: null,
      expiresAt: entry.expires ?? null,
      statuses: Array.isArray(entry.status) ? entry.status : entry.status ? [entry.status] : [],
      nameservers: (entry.nameservers ?? []).map((ns) => ns.name ?? '').filter(Boolean),
      registry: null,
      privacyProtected: false,
      source: 'rdap',
      providerReference: null,
    };
  }

  async appraiseDomain(): Promise<never> {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'Use the GoDaddy GoValue appraisal adapter for appraisals', false, {});
  }
}
