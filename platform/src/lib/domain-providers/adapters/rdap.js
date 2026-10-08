/**
 * RDAP adapter — a real integration with the Registry Data Access Protocol (RFC 9082/9083), ported
 * from `cloudhost247-node/src/domain-services/providers/rdap-adapter.ts`.
 *
 * RDAP is the modern, privacy-aware successor to WHOIS and is mandatory for gTLD registries, so the
 * authoritative registry is resolved per TLD from the IANA bootstrap registry
 * (`https://data.iana.org/rdap/dns.json`). For a TLD with no RDAP service, the adapter falls back to
 * classic port-43 WHOIS through the IANA referral chain. Whatever the transport, only the *public*
 * projection is produced: registrar, dates, statuses, nameservers. Raw registrant records are never
 * read into a field, logged, or stored — a privacy-protected registration is reported exactly as
 * protected and nothing attempts to see through it.
 *
 * Credentials: none. RDAP and WHOIS are public registry services. The provider row still has to
 * exist and pass a real connection test (which fetches the bootstrap file), because the platform's
 * fail-closed rule is that an operator decides whether this deployment talks to registries at all.
 *
 * Two seams exist so the adapter can be driven end to end in tests without a network:
 *   - `options.transport`  the fetch implementation used for HTTP (bootstrap + RDAP);
 *   - `options.whoisTransport`  `(server, query) => Promise<string>` for port-43 WHOIS.
 * Both default to the real thing.
 */
'use strict';

const net = require('node:net');
const dns = require('node:dns/promises');
const { DomainProviderError } = require('../types');
const { providerFetch, httpStatusToProviderError, parseProviderJson } = require('../http');
const { isPrivateIp } = require('../../tools-connectors');

const DEFAULT_BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';
const WHOIS_QUERY_TIMEOUT_MS = 10_000;
const WHOIS_MAX_BYTES = 256 * 1024;
/**
 * The bootstrap file changes rarely, and it is served by IANA as a public good. One adapter instance
 * is built per request, so an instance-level cache would re-fetch it on *every* search — the kind of
 * polite-looking abuse a public endpoint notices. Cached per process, keyed by URL, with a TTL, and
 * bypassable with `{ fresh: true }` (which is what Test Connection uses, so a connection test always
 * proves the file is reachable *now*).
 */
const BOOTSTRAP_TTL_MS = 6 * 60 * 60 * 1000;
const bootstrapCache = new Map();
/** Bounded fan-out for a bulk lookup: enough to be useful, not enough to look like an attack. */
const MAX_CONCURRENT_LOOKUPS = 5;

/**
 * Resolve a hostname to a public address, refusing anything private.
 *
 * The port-43 transport is a raw socket, so it cannot reuse the HTTP guard in `tools-connectors.js`
 * — but it must apply the same rule, and it uses the same `isPrivateIp` predicate rather than a
 * second copy that could drift.
 */
async function resolvePublicAddress(hostname) {
  const host = String(hostname).trim().toLowerCase();
  if (isPrivateIp(host)) {
    throw new DomainProviderError('PROVIDER_NOT_CONFIGURED', `WHOIS server "${host}" resolves to a private address`, false);
  }
  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    throw new DomainProviderError('NETWORK_TEMPORARY_FAILURE', `WHOIS server "${host}" could not be resolved`, true);
  }
  const publicAddresses = addresses.filter((entry) => !isPrivateIp(entry.address));
  if (publicAddresses.length === 0) {
    throw new DomainProviderError('PROVIDER_NOT_CONFIGURED', `WHOIS server "${host}" has no public address`, false);
  }
  // Prefer IPv4: several registry WHOIS servers still answer only on an IPv4 socket.
  const chosen = publicAddresses.find((entry) => entry.family === 4) ?? publicAddresses[0];
  return chosen.address;
}

/** One port-43 WHOIS exchange, bounded in time and in bytes. */
function realWhoisTransport() {
  return async (server, query) => {
    const address = await resolvePublicAddress(server);
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      let settled = false;
      const finish = (fn, value) => { if (!settled) { settled = true; fn(value); } };

      const socket = net.connect({ host: address, port: 43, timeout: WHOIS_QUERY_TIMEOUT_MS }, () => socket.write(`${query}\r\n`));
      const timer = setTimeout(() => socket.destroy(new Error('WHOIS query timed out')), WHOIS_QUERY_TIMEOUT_MS);
      if (typeof timer.unref === 'function') timer.unref();

      socket.on('data', (chunk) => {
        size += chunk.length;
        if (size > WHOIS_MAX_BYTES) { socket.destroy(new Error('WHOIS response exceeds limit')); return; }
        chunks.push(chunk);
      });
      socket.on('timeout', () => socket.destroy(new Error('WHOIS query timed out')));
      socket.on('error', (error) => { clearTimeout(timer); finish(reject, error); });
      socket.on('end', () => { clearTimeout(timer); finish(resolve, Buffer.concat(chunks).toString('utf8')); });
    });
  };
}

function eventName(events, action) {
  const found = (events ?? []).find((event) => String(event?.eventAction ?? '').toLowerCase() === action);
  return found?.eventDate ?? null;
}

/** Registrar display name from an RDAP entity's vCard — the `fn` field only, never contact data. */
function registrarNameFromVcard(entity) {
  const vcard = entity?.vcardArray;
  if (!Array.isArray(vcard) || vcard.length < 2 || !Array.isArray(vcard[1])) return null;
  for (const item of vcard[1]) {
    if (Array.isArray(item) && item[0] === 'fn' && typeof item[3] === 'string' && item[3].trim()) return item[3].trim();
  }
  return null;
}

/** True when the registry itself marked this entity redacted (privacy protection). */
function isRedacted(entity) {
  const vcard = entity?.vcardArray;
  if (!Array.isArray(vcard) || vcard.length < 2 || !Array.isArray(vcard[1])) return false;
  return vcard[1].some((item) => Array.isArray(item) && typeof item[3] === 'string' && /redact|privacy|withheld|not disclosed/i.test(item[3]));
}

/** First value of a case-insensitive `Key:` line in raw WHOIS text. */
function whoisValue(text, key) {
  const match = new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, 'im').exec(text);
  return match?.[1]?.trim() ?? null;
}

class RdapAdapter {
  constructor(config, options = {}) {
    this.key = 'rdap';
    this.config = config ?? {};
    this.transport = options.transport;
    this.whoisTransport = options.whoisTransport ?? realWhoisTransport();
    this.timeoutMs = options.timeoutMs;
    this.allowLoopback = options.allowLoopback === true;
    this.capabilities = Object.freeze({
      availability: false,
      pricing: false,
      registration: false,
      transfer: false,
      domainStatus: false,
      domainInfo: true,
      extensions: false,
      appraisal: false,
      // Added for this platform: "does the registry hold a record for this name?" is a real RDAP
      // fact, and it is the only availability evidence that can be obtained without a registrar
      // account. It is evidence of *registration*, never a promise of registrability or price.
      registryPresence: true,
    });
  }

  /**
   * Where the bootstrap file lives.
   *
   * The provider row's field is `api_base_url`, so an operator naturally enters an origin. A bare
   * origin therefore means "the IANA bootstrap at this host" and the standard path is appended,
   * while anything with an explicit path is used verbatim — which is what a mirror serving the file
   * somewhere else, or a test pointing at a loopback fake, needs.
   */
  bootstrapUrl() {
    const configured = String(this.config.apiBaseUrl ?? '').trim();
    if (!configured) return DEFAULT_BOOTSTRAP_URL;
    try {
      const url = new URL(configured);
      if (url.pathname === '' || url.pathname === '/') url.pathname = '/rdap/dns.json';
      return url.toString();
    } catch {
      return configured;
    }
  }

  /** tld -> authoritative RDAP base urls. Cached for the process; the file is near-static. */
  async loadBootstrap(options = {}) {
    const fresh = options.fresh === true;
    const url = this.bootstrapUrl();
    const cached = bootstrapCache.get(url);
    if (!fresh && cached && Date.now() - cached.at < BOOTSTRAP_TTL_MS) return cached.map;

    const response = await providerFetch({ url, method: 'GET', transport: this.transport, timeoutMs: this.timeoutMs, allowLoopback: this.allowLoopback });
    if (!response.ok) throw httpStatusToProviderError(response.status, response.text);
    const registry = parseProviderJson(response);

    const map = new Map();
    for (const service of registry?.services ?? []) {
      const [tlds, urls] = service ?? [];
      for (const tld of tlds ?? []) map.set(String(tld).toLowerCase(), urls ?? []);
    }
    if (map.size === 0) {
      throw new DomainProviderError('INVALID_PROVIDER_RESPONSE', 'RDAP bootstrap registry listed no TLD services', false);
    }
    bootstrapCache.set(url, { map, at: Date.now() });
    return map;
  }

  /** Drop any cached bootstrap file. Only used to reason about a cold process. */
  static clearBootstrapCache() {
    bootstrapCache.clear();
  }

  /** Ask the public registry endpoint whether it holds a record. Never throws for one domain. */
  async testConnection() {
    try {
      const services = await this.loadBootstrap({ fresh: true });
      return {
        status: services.size > 0 ? 'connected' : 'unavailable',
        message: `RDAP bootstrap resolved ${services.size} TLD services.`,
        capabilities: this.capabilities,
      };
    } catch (error) {
      // Name the file. "Provider server error" tells an operator nothing; "the bootstrap could not
      // be loaded from <url>" tells them which row to fix and whether the URL is right.
      const reason = error instanceof Error ? error.message : 'unknown error';
      return {
        status: error instanceof DomainProviderError && error.code === 'PROVIDER_NOT_CONFIGURED' ? 'not_configured' : 'unavailable',
        message: `The RDAP bootstrap registry could not be loaded from ${this.bootstrapUrl()}: ${reason}`,
        capabilities: this.capabilities,
      };
    }
  }

  async rdapUrlForDomain(domainName) {
    const tld = domainName.slice(domainName.lastIndexOf('.') + 1).toLowerCase();
    const services = await this.loadBootstrap();
    const urls = services.get(tld);
    if (!urls || urls.length === 0) return null;
    const https = urls.find((url) => String(url).startsWith('https://'));
    const chosen = https ?? urls[0];
    if (!chosen) return null;
    return `${String(chosen).replace(/\/+$/, '')}/domain/${encodeURIComponent(domainName)}`;
  }

  /** The full public registry projection for one domain. Throws when there is nothing to report. */
  async getDomainInfo(domainName) {
    const normalized = String(domainName).toLowerCase();

    const rdapUrl = await this.rdapUrlForDomain(normalized);
    if (rdapUrl) {
      const response = await providerFetch({
        url: rdapUrl,
        method: 'GET',
        headers: { Accept: 'application/rdap+json, application/json' },
        transport: this.transport,
        timeoutMs: this.timeoutMs,
        allowLoopback: this.allowLoopback,
      });

      if (response.ok) {
        const data = parseProviderJson(response);
        const registrarEntity = (data?.entities ?? []).find((entity) => (entity?.roles ?? []).includes('registrar'));
        const registrantVisible = (data?.entities ?? []).some(
          (entity) => (entity?.roles ?? []).includes('registrant') && !isRedacted(entity),
        );
        const notices = (data?.remarks ?? []).map((remark) => remark?.title ?? '').join(' ');
        const redactedNotice = /redact|privacy|withheld/i.test(notices);

        return {
          domainName: String(data?.ldhName ?? normalized).toLowerCase(),
          registrar: registrarEntity ? (registrarNameFromVcard(registrarEntity) ?? registrarEntity.handle ?? null) : null,
          createdAt: eventName(data?.events, 'registration'),
          updatedAt: eventName(data?.events, 'last changed') ?? eventName(data?.events, 'last update of rdap database'),
          expiresAt: eventName(data?.events, 'expiration'),
          statuses: data?.status ?? [],
          // Lowercased to match the WHOIS projection: the same domain must not report its
          // nameservers differently depending on which transport answered.
          nameservers: (data?.nameservers ?? []).map((ns) => String(ns?.ldhName ?? '').toLowerCase()).filter(Boolean),
          registry: null,
          privacyProtected: !registrantVisible || redactedNotice,
          source: 'rdap',
          providerReference: data?.handle ?? null,
        };
      }

      // A 404 from the authoritative registry is a real answer, not a provider failure: the registry
      // holds no record for this name.
      if (response.status === 404) {
        throw new DomainProviderError('NO_REGISTRY_RECORD', `No registry record found for ${normalized}`, false, { status: 404 });
      }
      // Anything else: fall through to WHOIS, which may still answer.
    }

    return this.whoisLookup(normalized);
  }

  /**
   * Classic port-43 WHOIS through the IANA referral chain.
   *
   * An empty response is a **failure**, not an empty record. A socket that connects and closes
   * without sending anything — a firewall that terminates the connection, a server that resets after
   * accepting — used to produce a "successful" lookup whose every field was null, which the platform
   * then stored as a completed WHOIS. Refusing is the only honest reading: nothing was answered.
   */
  async whoisLookup(domainName) {
    let text;
    try {
      text = await this.whoisTransport('whois.iana.org', domainName);
    } catch (error) {
      throw new DomainProviderError('PROVIDER_UNAVAILABLE', 'WHOIS service could not be reached', true, {
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    const referral = whoisValue(text, 'refer') ?? whoisValue(text, 'whois server');
    if (referral && referral !== 'whois.iana.org') {
      try {
        text += `\n${await this.whoisTransport(referral, domainName)}`;
      } catch {
        // The registry referral failed; the IANA response alone still carries the TLD summary, and
        // reporting that is more useful than discarding a real answer.
      }
    }

    if (String(text ?? '').trim().length === 0) {
      throw new DomainProviderError('PROVIDER_UNAVAILABLE', 'WHOIS returned an empty response for this domain', true, {
        referral: referral ?? null,
      });
    }

    const statusValue = whoisValue(text, 'domain status') ?? '';
    // Every nameserver line, not just the first. The audited original read one `Name Server:` value
    // plus the IANA-style `nserver:` lines, so a domain registered with two nameservers reported
    // one — incomplete data presented as the whole answer.
    const nameServerValues = (text.match(/^\s*(?:name server|nserver)\s*:\s*(\S+)/gim) ?? [])
      .map((line) => line.replace(/^\s*(?:name server|nserver)\s*:\s*/i, '').trim());
    const nameservers = [...new Set(nameServerValues.map((ns) => String(ns).toLowerCase().split(' ')[0]).filter(Boolean))];
    const registrar = whoisValue(text, 'registrar') ?? null;
    const privacyNotice = /privacy|redacted|whoisguard|data protected|withheld/i.test(text);

    return {
      domainName,
      registrar,
      createdAt: whoisValue(text, 'creation date') ?? whoisValue(text, 'registered on'),
      updatedAt: whoisValue(text, 'updated date') ?? whoisValue(text, 'last updated'),
      expiresAt: whoisValue(text, 'registry expiry date') ?? whoisValue(text, 'expiry date'),
      statuses: statusValue.split(/\s+/).map((entry) => entry.trim()).filter(Boolean),
      nameservers,
      registry: referral,
      privacyProtected: !registrar || privacyNotice,
      source: 'whois',
      providerReference: null,
    };
  }

  /**
   * Registration evidence for a batch of names, from the authoritative registry.
   *
   * Returns one entry per input, in order, and never throws for a single name: a search over ten
   * domains where one TLD's registry is unreachable should still answer for the other nine. The
   * `status` is one of:
   *   - `registered`         the registry returned a record (definitive)
   *   - `no_registry_record` the registry answered 404 (evidence the name is unregistered)
   *   - `unknown`            nothing could be established; `reason` carries the failure code
   * `no_registry_record` deliberately does not claim the name is *purchasable*: reserved, premium
   * and policy-blocked names also have no record. Only a registrar account can price a name.
   */
  async lookupRegistryPresence(domainNames) {
    const names = domainNames.map((entry) => String(entry).toLowerCase());
    const results = new Array(names.length);
    let cursor = 0;

    const worker = async () => {
      for (;;) {
        const index = cursor++;
        if (index >= names.length) return;
        const domainName = names[index];
        try {
          const rdapUrl = await this.rdapUrlForDomain(domainName);
          if (!rdapUrl) {
            results[index] = { domainName, status: 'unknown', reason: 'NO_RDAP_SERVICE_FOR_TLD', responseStatus: null };
            continue;
          }
          const response = await providerFetch({
            url: rdapUrl,
            method: 'GET',
            headers: { Accept: 'application/rdap+json, application/json' },
            transport: this.transport,
            timeoutMs: this.timeoutMs,
            allowLoopback: this.allowLoopback,
          });
          if (response.ok) {
            const data = parseProviderJson(response);
            results[index] = {
              domainName,
              status: 'registered',
              reason: null,
              responseStatus: response.status,
              registryHandle: data?.handle ?? null,
              registryStatuses: data?.status ?? [],
            };
          } else if (response.status === 404) {
            results[index] = { domainName, status: 'no_registry_record', reason: null, responseStatus: response.status };
          } else {
            const failure = httpStatusToProviderError(response.status, response.text);
            results[index] = { domainName, status: 'unknown', reason: failure.code, responseStatus: response.status };
          }
        } catch (error) {
          results[index] = {
            domainName,
            status: 'unknown',
            reason: error instanceof DomainProviderError ? error.code : 'PROVIDER_ERROR',
            responseStatus: null,
          };
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_LOOKUPS, Math.max(1, names.length)) }, worker));
    return results;
  }

  /** Read-only: every mutating operation of the contract is refused by name. */
  async checkAvailability() {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'RDAP does not provide availability or pricing checks; use lookupRegistryPresence', false);
  }
  async getPricing() {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'RDAP does not provide pricing', false);
  }
  async getExtensions() {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'RDAP does not provide an extension catalogue', false);
  }
  async registerDomain() {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'RDAP is read-only', false);
  }
  async transferDomain() {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'RDAP is read-only', false);
  }
  async getDomainStatus() {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'RDAP does not track registration state for this platform', false);
  }
  async appraiseDomain() {
    throw new DomainProviderError('UNSUPPORTED_OPERATION', 'RDAP does not provide appraisals', false);
  }
}

module.exports = { RdapAdapter, DEFAULT_BOOTSTRAP_URL, realWhoisTransport, resolvePublicAddress };
