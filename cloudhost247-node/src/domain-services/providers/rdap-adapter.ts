/**
 * RDAP adapter — a real integration with the Registry Data Access Protocol (RFC 9082/9083) using
 * the IANA RDAP bootstrap registry (https://data.iana.org/rdap/dns.json) to resolve each TLD's
 * authoritative registry service. RDAP is the modern, privacy-aware successor to WHOIS and is
 * mandatory for gTLD registries, so this is the platform's primary owner-lookup transport.
 *
 * For TLDs without an RDAP service in the bootstrap file, the adapter falls back to classic
 * port-43 WHOIS through the IANA referral chain (whois.iana.org → registry whois). The WHOIS
 * output is parsed into the same public projection; privacy-protected records are reported as
 * protected, never bypassed.
 *
 * Credentials: none required — RDAP and WHOIS are public registry services. The provider record
 * still has to exist and pass its connection test (fetching the bootstrap file), preserving the
 * platform's fail-closed provider model.
 */
import { connect as netConnect } from 'node:net';
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
import { httpStatusToProviderError, parseProviderJson, providerFetch } from './provider-http';

const DEFAULT_BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';
const WHOIS_QUERY_TIMEOUT_MS = 10_000;

interface BootstrapRegistry {
  description?: string;
  publication?: string;
  services?: Array<[string[], string[]]>;
}

/** Test seam for the port-43 WHOIS transport (the RDAP path is covered by the shared fetch seam). */
let whoisTransportOverride: ((server: string, query: string) => Promise<string>) | null = null;

export function setWhoisTransportForTesting(transport: ((server: string, query: string) => Promise<string>) | null): void {
  whoisTransportOverride = transport;
}

async function whoisQuery(server: string, query: string): Promise<string> {
  if (whoisTransportOverride) return whoisTransportOverride(server, query);
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = netConnect({ host: server, port: 43, timeout: WHOIS_QUERY_TIMEOUT_MS }, () => {
      socket.write(`${query}\r\n`);
    });
    socket.setTimeout(WHOIS_QUERY_TIMEOUT_MS);
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.on('timeout', () => socket.destroy(new Error('WHOIS query timed out')));
    socket.on('error', (err) => reject(err));
    socket.on('close', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

interface RdapEvent {
  eventAction?: string;
  eventDate?: string;
}
interface RdapEntity {
  roles?: string[];
  handle?: string;
  vcardArray?: unknown[];
  publicIds?: Array<{ type?: string; identifier?: string }>;
  entities?: RdapEntity[];
}
interface RdapResponse {
  objectClassName?: string;
  ldhName?: string;
  handle?: string;
  status?: string[];
  events?: RdapEvent[];
  entities?: RdapEntity[];
  nameservers?: Array<{ ldhName?: string }>;
  remarks?: Array<{ title?: string; description?: string[] }>;
  links?: Array<{ rel?: string; href?: string }>;
}

function eventName(events: RdapEvent[] | undefined, action: string): string | null {
  const found = events?.find((event) => event.eventAction?.toLowerCase() === action);
  return found?.eventDate ?? null;
}

/** Extracts a registrar display name from an RDAP entity's vcard, without exposing contact data. */
function registrarNameFromVcard(entity: RdapEntity): string | null {
  const vcard = entity.vcardArray;
  if (!Array.isArray(vcard) || vcard.length < 2 || !Array.isArray(vcard[1])) return null;
  for (const item of vcard[1] as unknown[]) {
    if (Array.isArray(item) && item[0] === 'fn' && typeof item[3] === 'string' && item[3].trim()) {
      return item[3].trim();
    }
  }
  return null;
}

/** Raw WHOIS line parser: returns the first value for a case-insensitive `Key:` line. */
function whoisValue(whoisText: string, key: string): string | null {
  const pattern = new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, 'im');
  const match = pattern.exec(whoisText);
  return match?.[1]?.trim() ?? null;
}

export class RdapAdapter implements DomainProviderAdapter {
  readonly key = 'rdap';
  readonly capabilities: Partial<DomainProviderCapabilities> = {
    availability: false,
    pricing: false,
    registration: false,
    transfer: false,
    domainStatus: false,
    domainInfo: true,
    extensions: false,
    appraisal: false,
  };

  constructor(private readonly config: DomainProviderConfig) {}

  private bootstrapUrl(): string {
    return this.config.apiBaseUrl?.trim() || DEFAULT_BOOTSTRAP_URL;
  }

  async loadBootstrap(): Promise<Map<string, string[]>> {
    const response = await providerFetch({ url: this.bootstrapUrl(), method: 'GET' });
    if (!response.ok) throw httpStatusToProviderError(response.status, response.text);
    const registry = parseProviderJson<BootstrapRegistry>(response);
    const map = new Map<string, string[]>();
    for (const service of registry.services ?? []) {
      const [tlds, urls] = service;
      for (const tld of tlds ?? []) {
        map.set(tld.toLowerCase(), urls ?? []);
      }
    }
    return map;
  }

  async testConnection(): Promise<DomainProviderConnectionResult> {
    try {
      const services = await this.loadBootstrap();
      return {
        status: services.size > 0 ? 'connected' : 'unavailable',
        message: services.size > 0
          ? `RDAP bootstrap resolved ${services.size} TLD services.`
          : 'RDAP bootstrap registry returned no services',
        capabilities: this.capabilities,
      };
    } catch (error) {
      return {
        status: 'unavailable',
        message: error instanceof Error ? error.message : 'RDAP bootstrap could not be reached',
        capabilities: this.capabilities,
      };
    }
  }

  private async rdapUrlForDomain(domainName: string): Promise<string | null> {
    const tld = domainName.slice(domainName.lastIndexOf('.') + 1).toLowerCase();
    const services = await this.loadBootstrap();
    const urls = services.get(tld);
    if (!urls || urls.length === 0) return null;
    // Prefer https endpoints, which every registry RDAP service offers.
    const https = urls.find((url) => url.startsWith('https://'));
    const chosen = https ?? urls[0];
    if (!chosen) return null;
    return `${chosen.replace(/\/+$/, '')}/domain/${encodeURIComponent(domainName)}`;
  }

  async getDomainInfo(domainName: string): Promise<PublicDomainInfo> {
    const normalized = domainName.toLowerCase();

    // --- Primary: RDAP ---
    const rdapUrl = await this.rdapUrlForDomain(normalized);
    if (rdapUrl) {
      const response = await providerFetch({ url: rdapUrl, method: 'GET', headers: { Accept: 'application/rdap+json, application/json' } });
      if (response.ok) {
        const data = parseProviderJson<RdapResponse>(response);
        const registrarEntity = data.entities?.find((entity) => entity.roles?.includes('registrar'));
        const registrantPresent = data.entities?.some((entity) => entity.roles?.includes('registrant') && !isRedacted(entity));
        const notices = (data.remarks ?? []).map((remark) => remark.title ?? '').join(' ');
        const redactedNotice = /redact|privacy| withheld/i.test(notices);

        return {
          domainName: (data.ldhName ?? normalized).toLowerCase(),
          registrar: registrarEntity ? (registrarNameFromVcard(registrarEntity) ?? registrarEntity.handle ?? null) : null,
          createdAt: eventName(data.events, 'registration'),
          updatedAt: eventName(data.events, 'last changed') ?? eventName(data.events, 'last update of rdap database'),
          expiresAt: eventName(data.events, 'expiration'),
          statuses: data.status ?? [],
          nameservers: (data.nameservers ?? []).map((ns) => ns.ldhName ?? '').filter(Boolean),
          registry: null,
          privacyProtected: !registrantPresent || redactedNotice,
          source: 'rdap',
          providerReference: data.handle ?? null,
        };
      }
      // A 404 from the authoritative registry means the domain does not exist — that is a real
      // answer, not a provider failure.
      if (response.status === 404) {
        throw new DomainProviderError('PROVIDER_ERROR', `No registry record found for ${normalized}`, false, { status: 404 });
      }
      // Other statuses fall through to WHOIS where possible.
    }

    // --- Fallback: port-43 WHOIS via the IANA referral chain ---
    return this.whoisLookup(normalized);
  }

  private async whoisLookup(domainName: string): Promise<PublicDomainInfo> {
    let text: string;
    try {
      text = await whoisQuery('whois.iana.org', domainName);
    } catch (error) {
      throw new DomainProviderError(
        'PROVIDER_UNAVAILABLE',
        'WHOIS service could not be reached',
        true,
        { cause: error instanceof Error ? error.message : String(error) }
      );
    }

    const referral = whoisValue(text, 'refer') ?? whoisValue(text, 'whois server');
    if (referral && referral !== 'whois.iana.org') {
      try {
        text += `\n${await whoisQuery(referral, domainName)}`;
      } catch {
        // The registry referral failed; the IANA response alone still carries the TLD summary.
      }
    }

    const registrar = whoisValue(text, 'registrar') ?? null;
    const creation = whoisValue(text, 'creation date') ?? whoisValue(text, 'registered on') ?? null;
    const updated = whoisValue(text, 'updated date') ?? whoisValue(text, 'last updated') ?? null;
    const expiration = whoisValue(text, 'registry expiry date') ?? whoisValue(text, 'expiry date') ?? null;
    const statuses = (whoisValue(text, 'domain status') ?? '')
      .split(/\s+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    const nameServerValue = whoisValue(text, 'name server');
    const nameservers = Array.from(
      new Set(
        [
          ...(nameServerValue ? [nameServerValue] : []),
          ...(text.match(/^\s*nserver:\s*(\S+)/gim) ?? []).map((line) => line.replace(/^\s*nserver:\s*/i, '').trim()),
        ].map((ns) => ns.toLowerCase().split(' ')[0] ?? '')
      )
    ).filter(Boolean);

    const privacyNotice = /privacy|redacted|whoisguard|data protected|withheld/i.test(text);

    return {
      domainName,
      registrar,
      createdAt: creation,
      updatedAt: updated,
      expiresAt: expiration,
      statuses,
      nameservers,
      registry: referral,
      privacyProtected: !registrar || privacyNotice,
      source: 'whois',
      providerReference: null,
    };
  }

  async checkAvailability(): Promise<DomainAvailability[]> {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'RDAP does not provide availability or pricing checks', false, {});
  }
  async getPricing(): Promise<DomainExtensionOffering[]> {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'RDAP does not provide pricing', false, {});
  }
  async getExtensions(): Promise<DomainExtensionOffering[]> {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'RDAP does not provide an extension catalogue', false, {});
  }
  async registerDomain(): Promise<RegisterDomainResult> {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'RDAP is read-only', false, {});
  }
  async transferDomain(): Promise<TransferDomainResult> {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'RDAP is read-only', false, {});
  }
  async getDomainStatus(): Promise<ProviderDomainStatus> {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'RDAP provider does not track registration state for this platform', false, {});
  }
  async appraiseDomain(): Promise<never> {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'RDAP does not provide appraisals', false, {});
  }
}

/** Detects an RDAP entity that the registry itself marked redacted (privacy protection). */
function isRedacted(entity: RdapEntity): boolean {
  const vcard = entity.vcardArray;
  if (!Array.isArray(vcard) || vcard.length < 2 || !Array.isArray(vcard[1])) return false;
  return vcard[1].some(
    (item) =>
      Array.isArray(item) &&
      typeof item[3] === 'string' &&
      /redact|privacy|withheld|not disclosed/i.test(item[3])
  );
}
