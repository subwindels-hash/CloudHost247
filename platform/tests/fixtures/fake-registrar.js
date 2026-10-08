/**
 * A loopback stand-in for a registrar's API, so the ported registrar adapters can be exercised
 * end-to-end — real HTTP, real request parsing, real credentials in the request — without any
 * provider account and without a single byte of fabricated production data. The same precedent as
 * `fake-cloudflare.js` (module 1) and `fake-registry.js` (module 2).
 *
 * It serves **both documented shapes** the platform now speaks:
 *
 *   - Namecheap: form-encoded POSTs to `/xml.response`, answered with the real XML envelope,
 *     including the detail that makes Namecheap distinctive — **application errors arrive as HTTP
 *     200 with `Status="ERROR"`**, so an adapter that only checks the HTTP status cannot pass here.
 *   - GoDaddy: JSON under `/v1/...` with `sso-key` auth, including the FAST-check `definitive` flag
 *     and the two documented price-unit shapes.
 *
 * Everything is driven by the test: `seedDomain`, `seedTld`, `seedGoDaddyDomain`, `setOverride`.
 * Nothing is answered unless it was seeded, so a test cannot accidentally pass on a default.
 */
'use strict';

const http = require('node:http');

/** Escape text for XML text nodes and attribute values. */
function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** One `<DomainCheckResult .../>` element, in Namecheap's documented attribute set. */
function domainCheckResultXml(entry) {
  const attributes = {
    Domain: entry.domain,
    Available: entry.available === true ? 'true' : 'false',
    ErrorNo: entry.errorNo ?? '0',
    Description: entry.description ?? '',
    IsPremiumName: entry.premium === true ? 'true' : 'false',
  };
  if (entry.premium === true) {
    if (entry.premiumRegistrationPrice !== undefined) attributes.PremiumRegistrationPrice = entry.premiumRegistrationPrice.toFixed(2);
    if (entry.premiumRenewalPrice !== undefined) attributes.PremiumRenewalPrice = entry.premiumRenewalPrice.toFixed(2);
    if (entry.premiumTransferPrice !== undefined) attributes.PremiumTransferPrice = entry.premiumTransferPrice.toFixed(2);
    if (entry.premiumPricingType !== undefined) attributes.PremiumPricingType = entry.premiumPricingType;
  }
  return `<DomainCheckResult ${Object.entries(attributes).map(([k, v]) => `${k}="${xmlEscape(v)}"`).join(' ')} />`;
}

/** One `<TLD .../>` element, in Namecheap's documented attribute set. */
function tldXml(entry) {
  const attributes = {
    Name: entry.name,
    RegistrationPrice: Number(entry.registrationPrice ?? 0).toFixed(2),
    RenewalPrice: Number(entry.renewalPrice ?? 0).toFixed(2),
    TransferPrice: Number(entry.transferPrice ?? 0).toFixed(2),
    IsPremiumTLD: entry.premium === true ? 'true' : 'false',
    MinRegistrationYears: entry.minRegistrationYears ?? 1,
    Type: entry.type ?? 'GTLD',
  };
  return `<TLD ${Object.entries(attributes).map(([k, v]) => `${k}="${xmlEscape(v)}"`).join(' ')} />`;
}

function startFakeRegistrar(options = {}) {
  /** domain (lowercase) → Namecheap check result. */
  const namecheapDomains = new Map();
  /** domain (lowercase) → GoDaddy availability entry. */
  const goDaddyDomains = new Map();
  /** tld (bare label) → catalogue entry. */
  const tlds = new Map();
  /** `"METHOD /path"` → `{ status, body, delayMs, text, headers }`. */
  const overrides = new Map();
  const requests = [];
  /** Domain names that were actually looked up, so a test can assert what was asked. */
  const checked = [];

  const state = {
    /** Every request, in order: `{ method, path, query, body, headers, form }`. */
    get requests() { return requests.slice(); },
    get checked() { return checked.slice(); },
    /** Namecheap `getInfo` status per domain. */
    infoStatus: new Map(),
    /** GoDaddy `transferStatus` per domain; `null` means the field is absent, not empty. */
    goDaddyTransfer: new Map(),
  };

  function seedDomain(domain, entry = {}) {
    namecheapDomains.set(String(domain).toLowerCase(), { domain, ...entry });
  }
  function seedGoDaddyDomain(domain, entry = {}) {
    goDaddyDomains.set(String(domain).toLowerCase(), { domain, ...entry });
  }
  function seedTld(name, entry = {}) {
    tlds.set(String(name).toLowerCase().replace(/^\./, ''), { name, ...entry });
  }
  /** `null` clears an override. */
  function setOverride(key, value) {
    if (value === null) overrides.delete(key);
    else overrides.set(key, value);
  }

  function errorEnvelope(number, message) {
    return `<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="ERROR" xmlns="http://api.namecheap.com/xml.response">
  <Errors><Error Number="${xmlEscape(number)}">${xmlEscape(message)}</Error></Errors>
  <CommandResponse />
</ApiResponse>`;
  }

  function okXml(commandResponseXml) {
    return `<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK" xmlns="http://api.namecheap.com/xml.response">
  <Errors />
  <CommandResponse Type="namecheap">
    ${commandResponseXml}
  </CommandResponse>
</ApiResponse>`;
  }

  function handleNamecheap(form) {
    if (!form.ApiUser || !form.ApiKey || !form.UserName || !form.ClientIp) {
      // Namecheap's own refusal when the IP allowlist credential is missing.
      return { status: 200, text: errorEnvelope('1011102', 'API Key is invalid or API access has not been enabled') };
    }
    if (form.ApiKey === 'revoked-key') {
      return { status: 200, text: errorEnvelope('1011102', 'API Key is invalid or API access has not been enabled') };
    }

    switch (form.Command) {
      case 'namecheap.users.getBalance':
        return {
          status: 200,
          text: okXml(`<UserGetBalanceResult Currency="USD" AvailableBalance="${options.balance !== undefined ? Number(options.balance).toFixed(2) : '120.00'}" AccountBalance="150.00" />`),
        };

      case 'namecheap.domains.check': {
        const requested = String(form.DomainList ?? '').split(',').map((d) => d.trim()).filter(Boolean);
        checked.push(...requested.map((d) => d.toLowerCase()));
        const results = requested.map((domain) => {
          const seeded = namecheapDomains.get(domain.toLowerCase());
          if (!seeded) {
            // A domain nobody seeded is a check the fake cannot answer — deliberately an error rather
            // than a default, so a test that forgets to seed fails loudly instead of reading "free".
            return domainCheckResultXml({ domain, errorNo: '2019166', description: 'Domain not found in this fixture' });
          }
          return domainCheckResultXml(seeded);
        });
        return { status: 200, text: okXml(results.join('\n    ')) };
      }

      case 'namecheap.domains.gettldlist': {
        const rows = [...tlds.values()].map(tldXml);
        return { status: 200, text: okXml(rows.join('\n    ')) };
      }

      case 'namecheap.domains.create': {
        const domain = String(form.DomainName ?? '').toLowerCase();
        if (!form.RegistrantEmailAddress) return { status: 200, text: errorEnvelope('2011170', 'Registrant email address is required') };
        return {
          status: 200,
          text: okXml(`<DomainCreateResult Domain="${xmlEscape(domain)}" Registered="true" ChargedAmount="10.8700" DomainID="1234567" OrderID="${options.createOrderId ?? '9000001'}" TransactionID="5550001" WhoisguardEnable="true" />`),
        };
      }

      case 'namecheap.domains.transfer': {
        const domain = String(form.DomainName ?? '').toLowerCase();
        if (!form.EPPCode) return { status: 200, text: errorEnvelope('2011187', 'EPP code is required') };
        return {
          status: 200,
          text: okXml(`<TransferCreateResult Domain="${xmlEscape(domain)}" TransferID="${options.transferId ?? '7770001'}" OrderID="9000002" TransactionID="5550002" Status="${options.transferStatus ?? 'OK'}" />`),
        };
      }

      case 'namecheap.domains.getInfo': {
        const domain = String(form.DomainName ?? '').toLowerCase();
        const info = state.infoStatus.get(domain) ?? { status: options.infoStatus ?? 'OK' };
        const transferStatus = info.transferStatus
          ? `<TransferStatus>${xmlEscape(info.transferStatus)}</TransferStatus>`
          : '';
        return {
          status: 200,
          text: okXml(`<DomainGetInfoResult Status="${xmlEscape(info.status)}" DomainName="${xmlEscape(domain)}" ExpiredDate="${xmlEscape(info.expiresAt ?? '2027-04-01')}" IsOwner="true">${transferStatus}</DomainGetInfoResult>`),
        };
      }

      default:
        return { status: 200, text: errorEnvelope('2000000', `Command ${form.Command} is not supported by this fixture`) };
    }
  }

  function handleGoDaddy(method, path, body) {
    const authorization = arguments[3] ?? null;
    if (!authorization || !String(authorization).startsWith('sso-key ')) {
      return { status: 401, json: { code: 'UNABLE_TO_AUTHENTICATE', message: 'Unauthorized' } };
    }
    if (String(authorization).includes('bad-secret')) {
      return { status: 403, json: { code: 'FORBIDDEN', message: 'Authenticated user is not allowed access' } };
    }

    const listMatch = /^\/v1\/domains(\?.*)?$/.exec(path);
    if (listMatch && method === 'GET') {
      return { status: 200, json: [...goDaddyDomains.values()].filter((d) => d.onAccount).map((d) => ({ domain: d.domain, status: 'ACTIVE' })) };
    }

    const availableMatch = /^\/v1\/domains\/available$/.exec(path);
    if (availableMatch && method === 'POST') {
      const requested = Array.isArray(body) ? body : [];
      checked.push(...requested.map((d) => String(d).toLowerCase()));
      const payload = requested.map((domain) => {
        const seeded = goDaddyDomains.get(String(domain).toLowerCase());
        if (!seeded) {
          // GoDaddy's documented shape says it always answers; a fixture that invents an answer for
          // an unseeded domain would let a pricing/cents bug through, so it refuses instead.
          return { domain, available: false, definitive: true, error: 'Unsupported domain' };
        }
        const entry = {
          domain: seeded.domain,
          available: seeded.available === true,
          definitive: seeded.definitive !== false,
          currency: seeded.currency ?? 'USD',
        };
        if (seeded.centsPrice !== undefined) {
          entry.prices = [{ price: { value: seeded.centsPrice, currencyCode: entry.currency }, renewalPrice: { value: seeded.centsRenewal ?? seeded.centsPrice, currencyCode: entry.currency } }];
        }
        if (seeded.microPrice !== undefined) entry.price = seeded.microPrice;
        if (seeded.period !== undefined) entry.period = seeded.period;
        return entry;
      });
      // Documented as a flat array; the adapter must tolerate both, so `options.objectWrap` exercises
      // the wrapped shape deliberately.
      return { status: 200, json: options.objectWrap ? payload[0] : payload };
    }

    const purchaseMatch = /^\/v1\/domains\/purchase$/.exec(path);
    if (purchaseMatch && method === 'POST') {
      const domain = String(body?.domain ?? '');
      const agreed = Array.isArray(body?.consent?.agreementKeys);
      if (!agreed) return { status: 422, json: { code: 'CONTRACT_REQUIRED', message: 'Agreement consent is required' } };
      return { status: 200, json: { orderId: options.purchaseOrderId ?? 424242, totalPaid: { currency: 'USD', value: 1087 } , domain } };
    }

    const transferMatch = /^\/v1\/domains\/([^/]+)\/transfer$/.exec(path);
    if (transferMatch && method === 'POST') {
      const domain = decodeURIComponent(transferMatch[1]).toLowerCase();
      if (!body?.authCode) return { status: 422, json: { code: 'MISSING_AUTH_CODE', message: 'authCode is required' } };
      state.goDaddyTransfer.set(domain, 'SUBMITTED');
      return { status: 200, json: { transferId: options.goDaddyTransferId ?? 880011, orderId: 424243 } };
    }

    const domainMatch = /^\/v1\/domains\/([^/]+)$/.exec(path);
    if (domainMatch && method === 'GET') {
      const domain = decodeURIComponent(domainMatch[1]).toLowerCase();
      const seeded = goDaddyDomains.get(domain);
      if (!seeded) return { status: 404, json: { code: 'NOT_FOUND', message: 'Domain not found' } };
      const transferStatus = state.goDaddyTransfer.get(domain);
      return {
        status: 200,
        json: {
          domain: seeded.domain,
          status: seeded.status ?? 'ACTIVE',
          // `null` means "the API does not report it", which must stay absent from the adapter's map.
          ...(transferStatus ? { transferStatus } : {}),
          expires: seeded.expires ?? '2027-04-01T00:00:00.000Z',
          createdAt: '2019-04-01T00:00:00.000Z',
          nameservers: seeded.nameservers ?? [{ name: 'ns1.example.net' }],
        },
      };
    }

    return { status: 404, json: { code: 'NOT_FOUND', message: `No fixture route for ${method} ${path}` } };
  }

  let server = null;
  let baseUrl = null;

  async function listen() {
    server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const url = new URL(req.url, 'http://127.0.0.1');
        const form = {};
        if ((req.headers['content-type'] ?? '').includes('application/x-www-form-urlencoded')) {
          for (const [key, value] of new URLSearchParams(raw)) form[key] = value;
        }
        let json = null;
        if ((req.headers['content-type'] ?? '').includes('application/json') && raw) {
          try { json = JSON.parse(raw); } catch { json = null; }
        }

        requests.push({
          method: req.method, path: url.pathname, query: url.search, raw, form, body: json,
          headers: { ...req.headers }, authorization: req.headers.authorization ?? null,
        });

        const key = `${req.method} ${url.pathname}`;
        const override = overrides.get(key) ?? overrides.get(url.pathname);
        let answer;
        if (override) {
          answer = {
            status: override.status ?? 200,
            text: override.text !== undefined ? override.text
              : override.body !== undefined ? (typeof override.body === 'string' ? override.body : JSON.stringify(override.body))
                : '',
            headers: override.headers ?? {},
          };
        } else if (url.pathname === '/xml.response') {
          answer = handleNamecheap(form);
        } else {
          answer = handleGoDaddy(req.method, url.pathname, json, req.headers.authorization ?? null);
        }

        const finish = () => {
          if (answer.json !== undefined) {
            res.writeHead(answer.status, { 'Content-Type': 'application/json', ...(answer.headers ?? {}) });
            res.end(JSON.stringify(answer.json));
            return;
          }
          res.writeHead(answer.status, { 'Content-Type': answer.text?.trim().startsWith('{') ? 'application/json' : 'application/xml', ...(answer.headers ?? {}) });
          res.end(answer.text ?? '');
        };
        if (override?.delayMs) setTimeout(finish, override.delayMs);
        else finish();
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    return { baseUrl, port: server.address().port };
  }

  async function close() {
    if (server) await new Promise((resolve) => server.close(resolve));
    server = null;
  }

  /** Namecheap's real endpoint path is `/xml.response`; the adapter is pointed at `${baseUrl}/xml.response`. */
  function endpoint() {
    if (!baseUrl) throw new Error('startFakeRegistrar: listen() first');
    return `${baseUrl}/xml.response`;
  }

  function requestsFor(path) {
    return requests.filter((entry) => entry.path === path).map((entry) => ({
      method: entry.method, query: entry.query, form: entry.form, body: entry.body, authorization: entry.authorization,
    }));
  }

  return {
    state, seedDomain, seedGoDaddyDomain, seedTld, setOverride, requestsFor, endpoint,
    get baseUrl() { return baseUrl; }, listen, close,
  };
}

module.exports = { startFakeRegistrar, xmlEscape };
