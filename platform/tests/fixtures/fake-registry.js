/**
 * A real-HTTP fake of an RDAP registry + the IANA bootstrap file, plus a GoValue-shaped API.
 *
 * Same construction as `tests/fixtures/fake-cloudflare.js`: a genuine `node:http` server on
 * `127.0.0.1:0`, so the *real* adapter code — bootstrap parsing, TLD resolution, RDAP projection,
 * error classification, the GoValue mapping — is exercised end to end over a socket rather than
 * against a stubbed adapter. Nothing here is imported by production code.
 *
 * Usage:
 *   const fake = startFakeRegistry();
 *   const { baseUrl } = await fake.listen();      // stands in for data.iana.org/rdap/dns.json
 *   fake.seedDomain('example.com', {...});        // a registered name
 *   fake.failWith('GET', '/domain/foo.test', 500); // force a failure on one path
 */
'use strict';

const http = require('node:http');

const DEFAULT_NAMESERVERS = ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com'];

/** One registered domain, in the shape an authoritative registry answers with. */
function rdapResponseFor(domainName, overrides = {}) {
  return {
    objectClassName: 'domain',
    handle: overrides.handle ?? `REG-${domainName.toUpperCase().replace(/\./g, '-')}`,
    ldhName: domainName.toUpperCase(),
    status: overrides.status ?? ['client transfer prohibited'],
    events: [
      { eventAction: 'registration', eventDate: overrides.registeredAt ?? '2011-04-12T04:00:00Z' },
      { eventAction: 'last changed', eventDate: overrides.changedAt ?? '2024-02-01T09:30:00Z' },
      { eventAction: 'expiration', eventDate: overrides.expiresAt ?? '2027-04-12T04:00:00Z' },
    ],
    nameservers: (overrides.nameservers ?? DEFAULT_NAMESERVERS).map((ldhName) => ({ ldhName })),
    entities: overrides.entities ?? [
      {
        roles: ['registrar'],
        handle: '1517',
        vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', overrides.registrar ?? 'Fake Registrar, Inc.']]],
      },
      // A registrant entity whose own field is marked redacted: the registry is telling us it is
      // protected, and the adapter must report it as protected rather than as visible data.
      {
        roles: ['registrant'],
        vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', 'REDACTED FOR PRIVACY']]],
      },
    ],
    remarks: overrides.remarks ?? [{ title: 'REDACTED FOR PRIVACY', description: ['Redacted by registry policy'] }],
    ...(overrides.extra ?? {}),
  };
}

function startFakeRegistry(options = {}) {
  const domains = new Map();        // lowercased name -> rdap response body
  const overrides = options.overrides ?? {};

  // Every TLD answers from this one server, which is how a single loopback port stands in for the
  // whole registry system: the bootstrap file below points each TLD at this same base URL.
  const tlds = options.tlds ?? ['com', 'net', 'org', 'example', 'test', 'dev'];
  // The bootstrap file maps each TLD to a registry *base*; the adapter appends `/domain/<name>` to
  // it, exactly as it does for the real IANA file.
  const registryBase = options.registryBase ?? '/rdap';
  const domainPrefix = `${registryBase}/domain/`;

  const state = {
    domains,
    requests: [],
    sequence: 0,
    get bootstrapped() { return state.requests.filter((r) => r.path === '/rdap/dns.json').length; },
  };

  function record(req, body) {
    state.sequence += 1;
    state.requests.push({
      method: req.method,
      path: req.url.split('?')[0],
      query: Object.fromEntries(new URL(req.url, 'http://x').searchParams),
      authorization: req.headers.authorization ?? null,
      body: body ?? null,
    });
  }

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      record(req, raw || null);
      const path = req.url.split('?')[0];
      const url = new URL(req.url, 'http://x');
      const key = `${req.method} ${path}`;
      const send = (status, body, contentType = 'application/json') => {
        res.writeHead(status, { 'Content-Type': contentType });
        res.end(typeof body === 'string' ? body : JSON.stringify(body));
      };

      // --- forced outcomes -------------------------------------------------------------------
      const forced = overrides[key];
      if (forced) {
        if (forced.delayMs) { setTimeout(() => send(forced.status, forced.body ?? { errorCode: forced.code ?? 9999, message: forced.message ?? 'forced' }), forced.delayMs); return; }
        return send(forced.status, forced.body ?? { errorCode: forced.code ?? 9999, message: forced.message ?? 'forced' });
      }

      // --- IANA bootstrap --------------------------------------------------------------------
      if (path === (options.bootstrapPath ?? '/rdap/dns.json')) {
        const base = options.publicBase ?? `http://127.0.0.1:${server.address()?.port ?? 0}`;
        const services = tlds.map((tld) => [[tld], [`${base}${registryBase}`]]);
        return send(200, { description: 'Fake IANA RDAP bootstrap', publication: '2026-01-01T00:00:00Z', services });
      }

      // --- RDAP domain lookup ---------------------------------------------------------------
      if (path.startsWith(domainPrefix)) {
        const domainName = decodeURIComponent(path.slice(domainPrefix.length)).toLowerCase();
        const body = domains.get(domainName);
        if (!body) return send(404, { errorCode: 404, title: 'Not Found' }, 'application/rdap+json');
        return send(200, body, 'application/rdap+json');
      }

      // --- GoValue-shaped appraisal ---------------------------------------------------------
      if (path === '/v1/domains/govalues') {
        const domainName = url.searchParams.get('domainName') ?? '';
        const appraisal = (options.appraisals ?? {})[domainName.toLowerCase()];
        if (appraisal) return send(200, appraisal);
        return send(200, {
          domainName,
          goValue: 2450,
          listPrice: 3999,
          goValueWholesale: 1980,
          minPrice: 1500,
          maxPrice: 4200,
          salesProbability: 0.42,
          salesProbability500: 0.18,
        });
      }

      return send(404, { errorCode: 404, message: `no fake route for ${path}` });
    });
  });

  return {
    state,
    /** Register a domain that the registry will answer for with a real RDAP document. */
    seedDomain(domainName, overridesForDomain) {
      domains.set(String(domainName).toLowerCase(), rdapResponseFor(String(domainName).toLowerCase(), overridesForDomain ?? {}));
    },
    /** Register a domain whose RDAP document is supplied verbatim (for malformed/edge cases). */
    seedDomainRaw(domainName, body) {
      domains.set(String(domainName).toLowerCase(), body);
    },
    setOverride(method, path, value) {
      overrides[`${method} ${path}`] = value;
    },
    requestsFor(path) {
      return state.requests.filter((request) => request.path === path);
    },
    listen() {
      return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const { port } = server.address();
          resolve({ port, baseUrl: `http://127.0.0.1:${port}` });
        });
      });
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

/** A port-43 WHOIS transport for tests: no socket, just scripted registry text. */
function fakeWhoisTransport(script = {}) {
  const calls = [];
  const transport = async (server, query) => {
    calls.push({ server, query });
    if (script[server] === undefined) throw new Error(`no fake WHOIS server '${server}'`);
    const value = script[server];
    return typeof value === 'function' ? value(query) : value;
  };
  transport.calls = calls;
  return transport;
}

module.exports = { startFakeRegistry, rdapResponseFor, fakeWhoisTransport };
