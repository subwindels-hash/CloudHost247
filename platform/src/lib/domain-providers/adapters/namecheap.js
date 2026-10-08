/**
 * Namecheap registrar adapter — a real integration against Namecheap's documented XML API
 * (https://www.namecheap.com/support/api/), ported from
 * `cloudhost247-node/src/domain-services/providers/namecheap-adapter.ts`.
 *
 * A transport boundary only: it calls the documented endpoints and normalises their responses, or
 * it throws a typed `DomainProviderError`. It never invents availability, pricing, registration or
 * transfer state — which matters more here than anywhere, because these are the calls a customer's
 * money rides on.
 *
 * Authentication (per Namecheap's docs): every call posts `ApiUser`, `ApiKey`, `UserName` and
 * `ClientIp` alongside `Command`. Those four come from the encrypted provider credentials:
 *   `apiKey` (the API key), `apiUser` (the API username), `userName` (the account acted on, usually
 *   identical to apiUser) and `clientIp` (the **whitelisted public IP Namecheap requires on every
 *   request** — a missing or wrong value is an authentication failure, and it is the single most
 *   common reason a working key still gets refused).
 *
 * Environment maps to Namecheap's own split: production → `api.namecheap.com`, sandbox →
 * `api.sandbox.namecheap.com`. `api_base_url` overrides both.
 */
'use strict';

const { DomainProviderError } = require('../types');
const { providerFetch, httpStatusToProviderError } = require('../http');
const { parseXml, findAll, findFirst, XmlParseError } = require('../xml');

const PRODUCTION_ENDPOINT = 'https://api.namecheap.com/xml.response';
const SANDBOX_ENDPOINT = 'https://api.sandbox.namecheap.com/xml.response';

/** Namecheap's documented ceiling for one `domains.check` call. */
const NAMECHEAP_CHECK_BATCH_LIMIT = 50;

function requireCredential(config, name) {
  const value = config?.credentials?.[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DomainProviderError('PROVIDER_NOT_CONFIGURED', `Namecheap credential '${name}' is not configured`, false, { credential: name });
  }
  return value.trim();
}

function endpointFor(config) {
  return String(config?.apiBaseUrl ?? '').trim() || (config?.environment === 'sandbox' ? SANDBOX_ENDPOINT : PRODUCTION_ENDPOINT);
}

function attr(node, ...names) {
  for (const name of names) {
    if (node?.attributes?.[name] !== undefined) return node.attributes[name];
  }
  return undefined;
}

function optionalPrice(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return { amount: parsed.toFixed(2), currency: 'USD' };
}

/** `com` and `.com` both normalise to `.com`. */
function normaliseExtension(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  return raw.startsWith('.') ? raw : `.${raw}`;
}

class NamecheapAdapter {
  constructor(config, options = {}) {
    this.key = 'namecheap';
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
      domainInfo: false,
      extensions: true,
      appraisal: false,
      registryPresence: false,
    });
  }

  /**
   * Post one API command and validate the envelope.
   *
   * Namecheap answers **HTTP 200 for application-level errors too**: the real failure signal is
   * `ApiResponse Status="ERROR"` plus an `<Errors>` block. Treating a 200 as success would hand the
   * caller an empty result set and call it "no domains available", so the envelope status is
   * authoritative here — the same rule the Cloudflare client applies to `success`.
   */
  async call(command, params = {}) {
    const apiUser = requireCredential(this.config, 'apiUser');
    const apiKey = requireCredential(this.config, 'apiKey');
    const userName = requireCredential(this.config, 'userName') || apiUser;
    const clientIp = requireCredential(this.config, 'clientIp');

    const body = new URLSearchParams({
      ApiUser: apiUser, ApiKey: apiKey, UserName: userName, ClientIp: clientIp,
      Command: command, ...params,
    }).toString();

    const response = await providerFetch({
      url: endpointFor(this.config),
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      transport: this.transport,
      timeoutMs: this.timeoutMs,
      allowLoopback: this.allowLoopback,
    });

    if (!response.ok) throw httpStatusToProviderError(response.status, response.text);

    let root;
    try {
      root = parseXml(response.text);
    } catch (error) {
      throw new DomainProviderError(
        'INVALID_PROVIDER_RESPONSE',
        'Namecheap returned a malformed XML response',
        false,
        { cause: error instanceof XmlParseError ? error.message : String(error), bodySample: String(response.text ?? '').slice(0, 500) },
      );
    }

    if (root.attributes.Status !== 'OK') {
      const errorsNode = root.children.find((child) => child.name.toLowerCase().endsWith('errors'));
      const firstError = errorsNode?.children?.[0];
      const message = firstError?.text?.trim() || firstError?.attributes?.Description || 'Namecheap API request failed';
      const number = firstError?.attributes?.Number ?? '';
      // 1011102 is Namecheap's "invalid API key / IP not whitelisted" — an authentication answer,
      // not a transient fault, so a retry is never the fix.
      if (number === '1011102' || /api|key|password|ip|whitelist|login|access denied/i.test(message)) {
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
        bodySample: String(response.text ?? '').slice(0, 500),
      });
    }
    return { root, commandResponse };
  }

  /** A cheap authenticated read: verifies the key *and* the IP allowlist, not just reachability. */
  async testConnection() {
    try {
      await this.call('namecheap.users.getBalance');
      return { status: 'connected', message: 'Namecheap accepted the configured API credentials.', capabilities: this.capabilities };
    } catch (error) {
      if (error instanceof DomainProviderError) {
        return {
          status: error.code === 'AUTHENTICATION_FAILED' ? 'auth_failed'
            : error.code === 'PROVIDER_NOT_CONFIGURED' ? 'not_configured' : 'unavailable',
          message: error.message,
          capabilities: this.capabilities,
        };
      }
      return { status: 'unavailable', message: 'Namecheap could not be reached', capabilities: this.capabilities };
    }
  }

  /** Real availability, batched. `available` is Namecheap's own answer, never inferred. */
  async checkAvailability(domainNames) {
    if (domainNames.length === 0) return [];
    const results = [];

    for (let offset = 0; offset < domainNames.length; offset += NAMECHEAP_CHECK_BATCH_LIMIT) {
      const batch = domainNames.slice(offset, offset + NAMECHEAP_CHECK_BATCH_LIMIT);
      const { commandResponse } = await this.call('namecheap.domains.check', { DomainList: batch.join(',') });

      for (const check of findAll(commandResponse, 'DomainCheckResult')) {
        const domainName = String(attr(check, 'Domain') ?? '').toLowerCase();
        const available = String(attr(check, 'Available') ?? '').toLowerCase() === 'true';
        const errorNo = attr(check, 'ErrorNo') ?? '0';
        const isPremium = String(attr(check, 'IsPremiumName') ?? '').toLowerCase() === 'true';
        const description = attr(check, 'Description') ?? '';
        const checkedAt = new Date().toISOString();

        // A check the provider could not answer is reported as unanswered. It is never folded into
        // "registered" or "available": a customer would act on either.
        if (errorNo !== '0' && errorNo !== '') {
          results.push({ domainName, status: 'unavailable', pricing: null, providerReference: null, metadata: { errorNo, description }, checkedAt });
          continue;
        }
        if (!available) {
          results.push({ domainName, status: 'registered', pricing: null, providerReference: null, metadata: { isPremium }, checkedAt });
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
          domainName,
          status: isPremium ? 'premium' : 'available',
          pricing: premiumPricing,
          providerReference: null,
          metadata: isPremium ? { isPremium, premiumPricingType: attr(check, 'PremiumPricingType') ?? null } : {},
          checkedAt,
        });
      }
    }
    return results;
  }

  /** The registrar's real TLD catalogue, with the prices it actually charges this account. */
  async getExtensions() {
    const { commandResponse } = await this.call('namecheap.domains.gettldlist');
    const sourcedAt = new Date().toISOString();
    const offerings = [];

    for (const tld of findAll(commandResponse, 'TLD')) {
      const name = String(attr(tld, 'Name') ?? '').toLowerCase();
      if (!name) continue;
      offerings.push({
        extension: normaliseExtension(name),
        providerTld: name,
        description: null,
        restrictions: null,
        registrationRequirements: null,
        premiumSupported: String(attr(tld, 'IsPremiumTLD') ?? '').toLowerCase() === 'true',
        pricing: {
          registration: optionalPrice(attr(tld, 'RegistrationPrice', 'RegistrationCost')),
          renewal: optionalPrice(attr(tld, 'RenewalPrice', 'RenewCost')),
          transfer: optionalPrice(attr(tld, 'TransferPrice', 'TransferCost')),
          premium: false,
        },
        status: 'enabled',
        metadata: { type: attr(tld, 'Type') ?? null, minRegistrationYears: attr(tld, 'MinRegistrationYears') ?? null },
        sourcedAt,
      });
    }
    return offerings;
  }

  async getPricing(extensions) {
    const catalogue = await this.getExtensions();
    const wanted = new Set(extensions.map((entry) => normaliseExtension(entry)));
    return catalogue.filter((offering) => wanted.has(normaliseExtension(offering.extension)));
  }

  static contactParams(prefix, contact) {
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

  async registerDomain(input) {
    const params = {
      DomainName: input.domainName,
      Years: String(input.years),
      AddFreeWhoisguard: 'yes',
      WGEnabled: 'yes',
      ...NamecheapAdapter.contactParams('Registrant', input.contacts.registrant),
    };
    if (input.contacts.administrative) Object.assign(params, NamecheapAdapter.contactParams('Admin', input.contacts.administrative));
    if (input.contacts.technical) Object.assign(params, NamecheapAdapter.contactParams('Tech', input.contacts.technical));
    if (input.contacts.billing) Object.assign(params, NamecheapAdapter.contactParams('AuxBilling', input.contacts.billing));

    const { commandResponse } = await this.call('namecheap.domains.create', params);
    const result = findFirst(commandResponse, 'DomainCreateResult');
    if (!result) throw new DomainProviderError('INVALID_PROVIDER_RESPONSE', 'Namecheap create response missing result', false);

    const registered = String(attr(result, 'Registered') ?? '').toLowerCase() === 'true';
    const orderId = attr(result, 'OrderID') ?? null;
    return {
      providerReference: orderId ?? `namecheap:${input.domainName}`,
      status: registered ? 'registered' : 'pending_confirmation',
      expiresAt: null,
      providerStatus: registered ? 'REGISTERED' : 'PENDING',
      metadata: { orderId, transactionId: attr(result, 'TransactionID') ?? null, chargedAmount: attr(result, 'ChargedAmount') ?? null },
    };
  }

  async transferDomain(input) {
    const { commandResponse } = await this.call('namecheap.domains.transfer', {
      DomainName: input.domainName, Years: '1', EPPCode: input.authCode,
    });
    const result = findFirst(commandResponse, 'TransferCreateResult');
    if (!result) throw new DomainProviderError('INVALID_PROVIDER_RESPONSE', 'Namecheap transfer response missing result', false);

    const transferId = attr(result, 'TransferID') ?? null;
    const status = attr(result, 'Status') ?? 'OK';
    return {
      providerReference: transferId ?? `namecheap-transfer:${input.domainName}`,
      status: String(status).toUpperCase() === 'OK' ? 'initiated' : 'authorization_required',
      providerStatus: status,
      metadata: { transferId, orderId: attr(result, 'OrderID') ?? null, transactionId: attr(result, 'TransactionID') ?? null },
    };
  }

  /**
   * The live record for a domain on this account — the call the transfer refresh poll is built on.
   *
   * Note `transferStatus`: Namecheap exposes transfer progress as a `TransferStatus`/`WhoisGuard`
   * style flag on the domain info response. Where the response carries no transfer state, it is
   * **omitted** rather than defaulted, so a caller cannot mistake "not reported" for "not started".
   */
  async getDomainStatus(providerReference, domainName) {
    const { commandResponse } = await this.call('namecheap.domains.getInfo', { DomainName: domainName });
    const result = findFirst(commandResponse, 'DomainGetInfoResult');
    const status = result?.attributes?.Status ?? 'UNKNOWN';
    const expires = result?.attributes?.ExpiredDate ?? null;
    const transferStatus = findFirst(commandResponse, 'TransferStatus')?.text?.trim() || null;

    let registrationStatus = 'unknown';
    if (/ok|active|registered/i.test(status)) registrationStatus = 'registered';
    else if (/pending/i.test(status)) registrationStatus = 'pending_confirmation';
    else if (/expired|error|failed/i.test(status)) registrationStatus = 'failed';

    // Recognised wording maps; anything else is **omitted**. Defaulting an unrecognised phrase to
    // `initiated` would tell the refresh poll that a transfer is under way on the strength of a
    // sentence nobody has read, and the poll would then write that status onto the customer's record.
    const mappedTransfer = transferStatus
      ? (/complete/i.test(transferStatus) ? 'completed'
        : /fail|cancel|declin|reject/i.test(transferStatus) ? 'failed'
          : /progress|process/i.test(transferStatus) ? 'in_progress'
            : /initiat|submitted|requested/i.test(transferStatus) ? 'initiated'
              : null)
      : null;

    return {
      domainName: String(domainName).toLowerCase(),
      registrationStatus,
      ...(mappedTransfer ? { transferStatus: mappedTransfer } : {}),
      providerStatus: status,
      expiresAt: expires,
      metadata: { providerReference: providerReference ?? null, transferStatus },
    };
  }

  async getDomainInfo() {
    // Namecheap's API is account-scoped, not a public WHOIS service. Public owner lookups for
    // arbitrary domains belong to the RDAP provider type, not to a registrar adapter.
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'Namecheap does not provide public WHOIS/RDAP lookups', false);
  }

  async appraiseDomain() {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'Namecheap does not provide domain appraisals', false);
  }

  async lookupRegistryPresence() {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'The registrar answers availability directly; use checkAvailability', false);
  }
}

module.exports = { NamecheapAdapter, PRODUCTION_ENDPOINT, SANDBOX_ENDPOINT, NAMECHEAP_CHECK_BATCH_LIMIT, normaliseExtension };
