/**
 * GoDaddy GoValue appraisal adapter — a real integration with GoDaddy's documented GoValue API
 * (https://www.godaddy.com/help/make-a-call-to-the-govalue-api-41963):
 *
 *   GET {base}/v1/domains/govalues?domainName=<domain>
 *   Authorization: sso-key <key>:<secret>
 *
 * Response (documented): { domainName, goValue, listPrice, goValueWholesale, minPrice, maxPrice,
 * salesProbability, salesProbability500 }.
 *
 * The adapter maps only what the API actually returns. Comparable sales are NOT synthesized —
 * GoValue returns no comparable-sales list, so `comparableSales` stays empty unless a future
 * provider supplies one. Domain facts (TLD, length) are derived from the domain name itself.
 */
import {
  DomainProviderError,
  type DomainAppraisalResult,
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
import { httpStatusToProviderError, parseProviderJson, providerFetch } from './provider-http';

const PRODUCTION_BASE = 'https://api.godaddy.com';
const OTE_BASE = 'https://api.ote-godaddy.com';

interface GoValueResponse {
  domainName?: string;
  goValue?: number;
  listPrice?: number;
  goValueWholesale?: number;
  minPrice?: number;
  maxPrice?: number;
  salesProbability?: number;
  salesProbability500?: number;
}

function requireCredential(config: DomainProviderConfig, name: string): string {
  const value = config.credentials[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DomainProviderError('PROVIDER_NOT_CONFIGURED', `Appraisal credential '${name}' is not configured`, false);
  }
  return value.trim();
}

function baseUrl(config: DomainProviderConfig): string {
  return (config.apiBaseUrl?.trim() || (config.environment === 'sandbox' ? OTE_BASE : PRODUCTION_BASE)).replace(/\/+$/, '');
}

export class GoValueAppraisalAdapter implements DomainProviderAdapter {
  readonly key = 'godaddy-govalue';
  readonly capabilities: Partial<DomainProviderCapabilities> = {
    availability: false,
    pricing: false,
    registration: false,
    transfer: false,
    domainStatus: false,
    domainInfo: false,
    extensions: false,
    appraisal: true,
  };

  constructor(private readonly config: DomainProviderConfig) {}

  async testConnection(): Promise<DomainProviderConnectionResult> {
    try {
      // A real authenticated call with a fixed, cheap probe domain. GoValue returns an appraisal
      // for any syntactically valid domain, making this a genuine credential test.
      const response = await providerFetch({
        url: `${baseUrl(this.config)}/v1/domains/govalues?domainName=example.com`,
        method: 'GET',
        headers: {
          Authorization: `sso-key ${requireCredential(this.config, 'apiKey')}:${requireCredential(this.config, 'apiSecret')}`,
          Accept: 'application/json',
        },
      });
      if (response.status === 401 || response.status === 403) {
        return { status: 'auth_failed', message: 'GoValue rejected the configured credentials', capabilities: this.capabilities };
      }
      if (!response.ok) {
        throw httpStatusToProviderError(response.status, response.text);
      }
      return { status: 'connected', message: 'GoValue accepted the configured API credentials.', capabilities: this.capabilities };
    } catch (error) {
      if (error instanceof DomainProviderError) {
        return {
          status: error.code === 'AUTHENTICATION_FAILED' ? 'auth_failed' : 'unavailable',
          message: error.message,
          capabilities: this.capabilities,
        };
      }
      return { status: 'unavailable', message: 'GoValue could not be reached', capabilities: this.capabilities };
    }
  }

  async appraiseDomain(domainName: string): Promise<DomainAppraisalResult> {
    const normalized = domainName.toLowerCase();
    const response = await providerFetch({
      url: `${baseUrl(this.config)}/v1/domains/govalues?domainName=${encodeURIComponent(normalized)}`,
      method: 'GET',
      headers: {
        Authorization: `sso-key ${requireCredential(this.config, 'apiKey')}:${requireCredential(this.config, 'apiSecret')}`,
        Accept: 'application/json',
      },
    });
    if (!response.ok) throw httpStatusToProviderError(response.status, response.text);

    const data = parseProviderJson<GoValueResponse>(response);
    const goValue = data.goValue;
    if (typeof goValue !== 'number' || !Number.isFinite(goValue) || goValue < 0) {
      throw new DomainProviderError(
        'INVALID_PROVIDER_RESPONSE',
        'Appraisal provider did not return a usable valuation',
        false,
        { bodySample: response.text.slice(0, 500) }
      );
    }

    const tld = normalized.slice(normalized.lastIndexOf('.') + 1);

    return {
      estimatedValue: { amount: goValue.toFixed(2), currency: 'USD' },
      // GoValue does not publish a confidence band; min/max range is carried in factors instead.
      confidence: null,
      tld,
      domainLength: normalized.length,
      keywords: [],
      brandability: null,
      comparableSales: [],
      factors: {
        provider: 'godaddy-govalue',
        listPrice: data.listPrice ?? null,
        goValueWholesale: data.goValueWholesale ?? null,
        minPrice: data.minPrice ?? null,
        maxPrice: data.maxPrice ?? null,
        salesProbability: data.salesProbability ?? null,
        salesProbability500: data.salesProbability500 ?? null,
      },
      providerReference: null,
    };
  }

  async checkAvailability(): Promise<DomainAvailability[]> {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'The appraisal provider does not check availability', false, {});
  }
  async getPricing(): Promise<DomainExtensionOffering[]> {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'The appraisal provider does not provide pricing', false, {});
  }
  async getExtensions(): Promise<DomainExtensionOffering[]> {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'The appraisal provider does not provide extensions', false, {});
  }
  async registerDomain(): Promise<RegisterDomainResult> {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'The appraisal provider is read-only', false, {});
  }
  async transferDomain(): Promise<TransferDomainResult> {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'The appraisal provider is read-only', false, {});
  }
  async getDomainStatus(): Promise<ProviderDomainStatus> {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'The appraisal provider is read-only', false, {});
  }
  async getDomainInfo(): Promise<PublicDomainInfo> {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'The appraisal provider does not provide WHOIS data', false, {});
  }
}
