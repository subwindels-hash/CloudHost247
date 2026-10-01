/**
 * Namecheap registrar adapter — a real integration against Namecheap's documented XML API
 * (https://www.namecheap.com/support/api/). The adapter is a transport boundary only: it calls
 * the documented endpoints and normalizes their responses, or throws a typed DomainProviderError.
 * It never invents availability, pricing, registration or transfer state.
 *
 * Authentication (per Namecheap docs): every call posts ApiUser, ApiKey, UserName and ClientIp
 * alongside the Command. Those four values come from the encrypted provider credentials:
 *   apiKey    — Namecheap API key
 *   apiUser   — Namecheap API username
 *   userName  — the account to act on (usually identical to apiUser)
 *   clientIp  — the whitelisted public IP Namecheap requires on every request
 *
 * Environment maps to Namecheap's own split:
 *   production → https://api.namecheap.com/xml.response
 *   sandbox    → https://api.sandbox.namecheap.com/xml.response
 */
import {
  DomainProviderError,
  type DomainAvailability,
  type DomainContactInput,
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
import { findAll, findFirst, parseXml, type XmlNode } from './xml';
import { httpStatusToProviderError, providerFetch } from './provider-http';

const PRODUCTION_ENDPOINT = 'https://api.namecheap.com/xml.response';
const SANDBOX_ENDPOINT = 'https://api.sandbox.namecheap.com/xml.response';

const NAMECHEAP_CHECK_BATCH_LIMIT = 50;

function requireCredential(config: DomainProviderConfig, name: string): string {
  const value = config.credentials[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DomainProviderError(
      'PROVIDER_NOT_CONFIGURED',
      `Namecheap credential '${name}' is not configured`,
      false
    );
  }
  return value.trim();
}

function endpointFor(config: DomainProviderConfig): string {
  return config.apiBaseUrl?.trim() || (config.environment === 'sandbox' ? SANDBOX_ENDPOINT : PRODUCTION_ENDPOINT);
}

interface NamecheapApiResult {
  commandResponse: XmlNode;
}

/**
 * Posts one Namecheap API command and validates the envelope. Namecheap answers HTTP 200 for
 * application-level errors too — the real failure signal is `ApiResponse Status="ERROR"` plus an
 * `<Errors>` block, which this maps to typed provider errors (credentials/rate limit/other).
 */
async function callNamecheap(config: DomainProviderConfig, command: string, params: Record<string, string>): Promise<NamecheapApiResult> {
  const apiUser = requireCredential(config, 'apiUser');
  const apiKey = requireCredential(config, 'apiKey');
  const userName = requireCredential(config, 'userName') || apiUser;
  const clientIp = requireCredential(config, 'clientIp');

  const body = new URLSearchParams({
    ApiUser: apiUser,
    ApiKey: apiKey,
    UserName: userName,
    ClientIp: clientIp,
    Command: command,
    ...params,
  }).toString();

  const response = await providerFetch({
    url: endpointFor(config),
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw httpStatusToProviderError(response.status, response.text);
  }

  let root: XmlNode;
  try {
    root = parseXml(response.text);
  } catch (error) {
    throw new DomainProviderError(
      'INVALID_PROVIDER_RESPONSE',
      'Namecheap returned a malformed XML response',
      false,
      { cause: error instanceof Error ? error.message : String(error), bodySample: response.text.slice(0, 500) }
    );
  }

  if (root.attributes.Status !== 'OK') {
    const errorNodes = root.children.find((child) => child.name.toLowerCase().endsWith('errors'));
    const firstError = errorNodes?.children[0];
    const message = firstError?.text?.trim() || firstError?.attributes?.Description || 'Namecheap API request failed';
    const number = firstError?.attributes?.Number ?? '';

    // Namecheap error 1011102 = IP not whitelisted / bad API key → authentication problem.
    if (/api|key|password|ip|whitelist|login|access denied/i.test(message) || number === '1011102') {
      throw new DomainProviderError('AUTHENTICATION_FAILED', 'Namecheap rejected the configured credentials', false, { message, number });
    }
    if (/rate limit|too many requests/i.test(message)) {
      throw new DomainProviderError('RATE_LIMITED', 'Namecheap rate limit reached', true, { message, number });
    }
    throw new DomainProviderError('PROVIDER_ERROR', `Namecheap API error: ${message}`, false, { message, number });
  }

  const commandResponse = root.children.find((child) => child.name.toLowerCase().endsWith('commandresponse'));
  if (!commandResponse) {
    throw new DomainProviderError('INVALID_PROVIDER_RESPONSE', 'Namecheap response is missing CommandResponse', false, {
      bodySample: response.text.slice(0, 500),
    });
  }
  return { commandResponse };
}

function optionalPrice(value: string | undefined): { amount: string; currency: string } | null {
  if (value === undefined || value === null || value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return { amount: parsed.toFixed(2), currency: 'USD' };
}

function attr(node: XmlNode, ...names: string[]): string | undefined {
  for (const name of names) {
    if (node.attributes[name] !== undefined) return node.attributes[name];
  }
  return undefined;
}

export class NamecheapAdapter implements DomainProviderAdapter {
  readonly key = 'namecheap';
  readonly capabilities: Partial<DomainProviderCapabilities> = {
    availability: true,
    pricing: true,
    registration: true,
    transfer: true,
    domainStatus: true,
    domainInfo: false,
    extensions: true,
    appraisal: false,
  };

  constructor(private readonly config: DomainProviderConfig) {}

  async testConnection(): Promise<DomainProviderConnectionResult> {
    // namecheap.users.getBalance is a cheap, read-only, authenticated call — a real credential
    // and IP-allowlist verification, not a synthetic ping.
    try {
      await callNamecheap(this.config, 'namecheap.users.getBalance', {});
      return {
        status: 'connected',
        message: 'Namecheap accepted the configured API credentials.',
        capabilities: this.capabilities,
      };
    } catch (error) {
      if (error instanceof DomainProviderError) {
        return {
          status: error.code === 'AUTHENTICATION_FAILED' ? 'auth_failed' : 'unavailable',
          message: error.message,
          capabilities: this.capabilities,
        };
      }
      return { status: 'unavailable', message: 'Namecheap could not be reached', capabilities: this.capabilities };
    }
  }

  async checkAvailability(domainNames: string[]): Promise<DomainAvailability[]> {
    if (domainNames.length === 0) return [];
    const results: DomainAvailability[] = [];

    for (let offset = 0; offset < domainNames.length; offset += NAMECHEAP_CHECK_BATCH_LIMIT) {
      const batch = domainNames.slice(offset, offset + NAMECHEAP_CHECK_BATCH_LIMIT);
      const { commandResponse } = await callNamecheap(this.config, 'namecheap.domains.check', {
        DomainList: batch.join(','),
      });

      const checkResults = findAll(commandResponse, 'DomainCheckResult');
      for (const check of checkResults) {
        const domainName = attr(check, 'Domain') ?? '';
        const available = attr(check, 'Available')?.toLowerCase() === 'true';
        const errorNo = attr(check, 'ErrorNo') ?? '0';
        const isPremium = attr(check, 'IsPremiumName')?.toLowerCase() === 'true';
        const description = attr(check, 'Description') ?? '';

        // A check the provider could not answer must be surfaced as provider_error, never as a
        // registered/available answer.
        if (errorNo !== '0' && errorNo !== '') {
          results.push({
            domainName: domainName.toLowerCase(),
            status: 'unavailable',
            pricing: null,
            providerReference: null,
            metadata: { errorNo, description },
            checkedAt: new Date().toISOString(),
          });
          continue;
        }

        if (!available) {
          results.push({
            domainName: domainName.toLowerCase(),
            status: 'registered',
            pricing: null,
            providerReference: null,
            metadata: { isPremium },
            checkedAt: new Date().toISOString(),
          });
          continue;
        }

        const premiumPricing = isPremium
          ? {
              registration: optionalPrice(attr(check, 'PremiumRegistrationPrice')),
              renewal: optionalPrice(attr(check, 'PremiumRenewalPrice')),
              transfer: optionalPrice(attr(check, 'PremiumTransferPrice')),
              premium: true,
            }
          : null;

        results.push({
          domainName: domainName.toLowerCase(),
          status: isPremium ? 'premium' : 'available',
          pricing: premiumPricing,
          providerReference: null,
          metadata: isPremium
            ? { isPremium, premiumPricingType: attr(check, 'PremiumPricingType') ?? null }
            : {},
          checkedAt: new Date().toISOString(),
        });
      }
    }
    return results;
  }

  async getPricing(extensions: string[]): Promise<DomainExtensionOffering[]> {
    const catalog = await this.getExtensions();
    return catalog.filter((offering) =>
      extensions.some((extension) => offering.extension.toLowerCase() === extension.toLowerCase().replace(/^\./, ''))
    );
  }

  async getExtensions(): Promise<DomainExtensionOffering[]> {
    const { commandResponse } = await callNamecheap(this.config, 'namecheap.domains.gettldlist', {});
    const tldNodes = findAll(commandResponse, 'TLD');

    const offerings: DomainExtensionOffering[] = [];
    const now = new Date().toISOString();
    for (const tld of tldNodes) {
      const name = attr(tld, 'Name')?.toLowerCase();
      if (!name) continue;
      const registration = optionalPrice(attr(tld, 'RegistrationPrice', 'RegistrationCost'));
      const renewal = optionalPrice(attr(tld, 'RenewalPrice', 'RenewCost'));
      const transfer = optionalPrice(attr(tld, 'TransferPrice', 'TransferCost'));
      const type = attr(tld, 'Type') ?? null;

      offerings.push({
        extension: name.startsWith('.') ? name : `.${name}`,
        providerTld: name,
        description: null,
        restrictions: null,
        registrationRequirements: null,
        premiumSupported: attr(tld, 'IsPremiumTLD')?.toLowerCase() === 'true',
        pricing: { registration, renewal, transfer, premium: false },
        status: 'enabled',
        metadata: { type, minRegistrationYears: attr(tld, 'MinRegistrationYears') ?? null },
        sourcedAt: now,
      });
    }
    return offerings;
  }

  private static contactParams(prefix: string, contact: DomainContactInput): Record<string, string> {
    return {
      [`${prefix}FirstName`]: contact.firstName,
      [`${prefix}LastName`]: contact.lastName,
      [`${prefix}OrganizationName`]: contact.organization ?? '',
      [`${prefix}Address1`]: contact.addressLine1,
      [`${prefix}Address2`]: contact.addressLine2 ?? '',
      [`${prefix}City`]: contact.city,
      [`${prefix}StateProvince`]: contact.state ?? '',
      [`${prefix}PostalCode`]: contact.postalCode ?? '',
      [`${prefix}Country`]: contact.countryCode,
      [`${prefix}Phone`]: contact.phone,
      [`${prefix}EmailAddress`]: contact.email,
    };
  }

  async registerDomain(input: RegisterDomainInput): Promise<RegisterDomainResult> {
    const params: Record<string, string> = {
      DomainName: input.domainName,
      Years: String(input.years),
      AddFreeWhoisguard: 'yes',
      WGEnabled: 'yes',
      ...NamecheapAdapter.contactParams('Registrant', input.contacts.registrant),
    };

    if (input.contacts.administrative) {
      Object.assign(params, NamecheapAdapter.contactParams('Admin', input.contacts.administrative));
    }
    if (input.contacts.technical) {
      Object.assign(params, NamecheapAdapter.contactParams('Tech', input.contacts.technical));
    }
    if (input.contacts.billing) {
      Object.assign(params, NamecheapAdapter.contactParams('AuxBilling', input.contacts.billing));
    }

    const { commandResponse } = await callNamecheap(this.config, 'namecheap.domains.create', params);
    const result = findFirst(commandResponse, 'DomainCreateResult');
    if (!result) {
      throw new DomainProviderError('INVALID_PROVIDER_RESPONSE', 'Namecheap create response missing result', false, {});
    }

    const registered = attr(result, 'Registered')?.toLowerCase() === 'true';
    const orderId = attr(result, 'OrderID') ?? null;

    return {
      providerReference: orderId ?? `namecheap:${input.domainName}`,
      status: registered ? 'registered' : 'pending_confirmation',
      expiresAt: null,
      providerStatus: registered ? 'REGISTERED' : 'PENDING',
      metadata: {
        orderId,
        transactionId: attr(result, 'TransactionID') ?? null,
        chargedAmount: attr(result, 'ChargedAmount') ?? null,
      },
    };
  }

  async transferDomain(input: TransferDomainInput): Promise<TransferDomainResult> {
    const { commandResponse } = await callNamecheap(this.config, 'namecheap.domains.transfer', {
      DomainName: input.domainName,
      Years: '1',
      EPPCode: input.authCode,
    });
    const result = findFirst(commandResponse, 'TransferCreateResult');
    if (!result) {
      throw new DomainProviderError('INVALID_PROVIDER_RESPONSE', 'Namecheap transfer response missing result', false, {});
    }

    const transferId = attr(result, 'TransferID') ?? null;
    const status = attr(result, 'Status') ?? 'OK';

    return {
      providerReference: transferId ?? `namecheap-transfer:${input.domainName}`,
      status: status.toUpperCase() === 'OK' ? 'initiated' : 'authorization_required',
      providerStatus: status,
      metadata: {
        transferId,
        orderId: attr(result, 'OrderID') ?? null,
        transactionId: attr(result, 'TransactionID') ?? null,
      },
    };
  }

  async getDomainStatus(providerReference: string, domainName: string): Promise<ProviderDomainStatus> {
    // namecheap.domains.getInfo returns the authoritative live record for a domain on the account.
    const { commandResponse } = await callNamecheap(this.config, 'namecheap.domains.getInfo', {
      DomainName: domainName,
    });
    const result = findFirst(commandResponse, 'DomainGetInfoResult');
    const status = result?.attributes.Status ?? 'UNKNOWN';
    const expires = result?.attributes.ExpiredDate ?? null;

    let registrationStatus: ProviderDomainStatus['registrationStatus'] = 'unknown';
    if (/ok|active|registered/i.test(status)) registrationStatus = 'registered';
    else if (/pending/i.test(status)) registrationStatus = 'pending_confirmation';
    else if (/expired|error|failed/i.test(status)) registrationStatus = 'failed';

    return {
      domainName: domainName.toLowerCase(),
      registrationStatus,
      providerStatus: status,
      expiresAt: expires,
      metadata: { providerReference },
    };
  }

  async getDomainInfo(): Promise<PublicDomainInfo> {
    // Namecheap's API is account-scoped, not a public WHOIS service. Registrant lookups for
    // arbitrary domains are served by the RDAP provider type, not a registrar adapter.
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'Namecheap does not provide public WHOIS/RDAP lookups', false, {});
  }

  async appraiseDomain(): Promise<never> {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'Namecheap does not provide domain appraisals', false, {});
  }
}
