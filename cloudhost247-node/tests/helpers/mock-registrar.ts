/**
 * DEV/TEST ONLY — a simulated Namecheap XML-API registrar and a simulated RDAP registry,
 * running on local HTTP so the Domain Services platform can be exercised end to end without
 * real registrar credentials (mirrors tests/helpers/mock-cloudflare.ts).
 *
 * The production adapters (src/domain-services/providers/namecheap-adapter.ts, rdap-adapter.ts)
 * are transport boundaries with no test branches — they simply talk to whatever apiBaseUrl the
 * provider row points at. Pointing a provider at this server exercises the REAL adapter code.
 *
 * Simulated registry rules (deterministic, clearly not real registry data):
 *   - a domain is "registered" if its label contains "taken" or "registered"
 *   - `.ai` and `.io` are premium TLDs with provider-quoted premium prices
 *   - everything else is available at catalogue prices
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface MockRegistrarOptions {
  port?: number;
  host?: string;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function envelope(inner: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><ApiResponse Status="OK"><CommandResponse>${inner}</CommandResponse></ApiResponse>`;
}

/** Deterministic availability for the simulated registry. */
export function mockAvailability(domainName: string): 'registered' | 'available' | 'premium' {
  const label = domainName.slice(0, domainName.lastIndexOf('.'));
  const tld = domainName.slice(domainName.lastIndexOf('.') + 1);
  if (/taken|registered/.test(label)) return 'registered';
  if (tld === 'ai' || tld === 'io') return 'premium';
  return 'available';
}

/** The simulated TLD catalogue (mirrors namecheap.domains.gettldlist output). */
const MOCK_TLDS: Array<{ name: string; registration: string; renewal: string; transfer: string; premium: boolean }> = [
  { name: 'com', registration: '10.98', renewal: '14.98', transfer: '10.28', premium: false },
  { name: 'net', registration: '12.98', renewal: '15.98', transfer: '11.48', premium: false },
  { name: 'org', registration: '9.48', renewal: '13.98', transfer: '10.98', premium: false },
  { name: 'co', registration: '7.98', renewal: '29.98', transfer: '26.98', premium: false },
  { name: 'xyz', registration: '2.98', renewal: '12.98', transfer: '9.98', premium: false },
  { name: 'dev', registration: '13.98', renewal: '15.98', transfer: '12.98', premium: false },
  { name: 'app', registration: '14.98', renewal: '16.98', transfer: '13.98', premium: false },
  { name: 'io', registration: '39.98', renewal: '54.98', transfer: '48.98', premium: true },
  { name: 'ai', registration: '79.98', renewal: '99.98', transfer: '89.98', premium: true },
  { name: 'ng', registration: '24.98', renewal: '29.98', transfer: '27.98', premium: false },
  { name: 'com.ng', registration: '18.98', renewal: '22.98', transfer: '19.98', premium: false },
];

export class MockNamecheap {
  readonly server: Server;
  port = 0;
  /** Domains the simulated registrar has actually registered through namecheap.domains.create. */
  readonly registered = new Set<string>();

  constructor() {
    this.server = createServer((req, res) => void this.handle(req, res));
  }

  url(path = '/xml.response'): string {
    return `http://127.0.0.1:${this.port}${path}`;
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.server.address();
    if (address && typeof address === 'object') this.port = address.port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await new Promise<string>((resolve) => {
      let data = '';
      req.on('data', (chunk: Buffer) => (data += chunk.toString('utf-8')));
      req.on('end', () => resolve(data));
    });
    const params = new URLSearchParams(body);
    const command = params.get('Command') ?? '';
    const respond = (status: number, payload: string) => {
      res.writeHead(status, { 'Content-Type': 'text/xml; charset=utf-8' });
      res.end(payload);
    };

    switch (command) {
      case 'namecheap.users.getBalance':
        respond(200, envelope('<UserGetBalanceResult AvailableBalance="100.00" AccountBalance="100.00"/>'));
        return;

      case 'namecheap.domains.check': {
        const list = (params.get('DomainList') ?? '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
        const nodes = list.map((domain) => {
          const state = mockAvailability(domain);
          const label = domain.slice(0, domain.lastIndexOf('.'));
          const tld = domain.slice(domain.lastIndexOf('.') + 1);
          const catalogue = MOCK_TLDS.find((entry) => entry.name === tld);
          if (state === 'registered') {
            return `<DomainCheckResult Domain="${xmlEscape(domain)}" Available="false" ErrorNo="0" IsPremiumName="false" />`;
          }
          if (state === 'premium') {
            const base = catalogue ?? { registration: '79.98', renewal: '99.98', transfer: '89.98' };
            return `<DomainCheckResult Domain="${xmlEscape(domain)}" Available="true" ErrorNo="0" IsPremiumName="true" PremiumRegistrationPrice="${base.registration}" PremiumRenewalPrice="${base.renewal}" PremiumTransferPrice="${base.transfer}" PremiumPricingType="PREMIUM" />`;
          }
          void label;
          return `<DomainCheckResult Domain="${xmlEscape(domain)}" Available="true" ErrorNo="0" IsPremiumName="false" />`;
        });
        respond(200, envelope(nodes.join('')));
        return;
      }

      case 'namecheap.domains.gettldlist': {
        const nodes = MOCK_TLDS.map(
          (tld) =>
            `<TLD Name="${tld.name}" Type="gTLD" MinRegistrationYears="1" MaxRegistrationYears="10" RegistrationPrice="${tld.registration}" RenewalPrice="${tld.renewal}" TransferPrice="${tld.transfer}" IsPremiumTLD="${tld.premium}" />`
        );
        respond(200, envelope(nodes.join('')));
        return;
      }

      case 'namecheap.domains.create': {
        const domain = (params.get('DomainName') ?? '').toLowerCase();
        if (!domain) {
          respond(200, '<?xml version="1.0"?><ApiResponse Status="ERROR"><Errors><Error Number="2030280">DomainName is invalid</Error></Errors></ApiResponse>');
          return;
        }
        if (this.registered.has(domain) || mockAvailability(domain) === 'registered') {
          respond(200, '<?xml version="1.0"?><ApiResponse Status="ERROR"><Errors><Error Number="5024166">Domain is already registered</Error></Errors></ApiResponse>');
          return;
        }
        this.registered.add(domain);
        const years = params.get('Years') ?? '1';
        const tld = domain.slice(domain.lastIndexOf('.') + 1);
        const catalogue = MOCK_TLDS.find((entry) => entry.name === tld);
        const charged = (Number(catalogue?.registration ?? '12.98') * Number(years)).toFixed(2);
        respond(
          200,
          envelope(
            `<DomainCreateResult Domain="${xmlEscape(domain)}" Registered="true" OrderID="demo-order-${this.registered.size}" TransactionID="demo-txn-${this.registered.size}" ChargedAmount="${charged}" />`
          )
        );
        return;
      }

      case 'namecheap.domains.transfer': {
        const domain = (params.get('DomainName') ?? '').toLowerCase();
        if ((params.get('EPPCode') ?? '').length < 4) {
          respond(200, '<?xml version="1.0"?><ApiResponse Status="ERROR"><Errors><Error Number="1011102">Invalid EPP code</Error></Errors></ApiResponse>');
          return;
        }
        respond(
          200,
          envelope(`<TransferCreateResult Domain="${xmlEscape(domain)}" TransferID="demo-transfer-${Date.now()}" OrderID="demo-torder-1" Status="OK" />`)
        );
        return;
      }

      case 'namecheap.domains.getInfo': {
        const domain = (params.get('DomainName') ?? '').toLowerCase();
        const status = this.registered.has(domain) ? 'Ok' : 'UNKNOWN';
        respond(
          200,
          envelope(`<DomainGetInfoResult Domain="${xmlEscape(domain)}" Status="${status}" ExpiredDate="2027-10-01" />`)
        );
        return;
      }

      default:
        respond(200, `<?xml version="1.0"?><ApiResponse Status="ERROR"><Errors><Error Number="1">Unknown command ${xmlEscape(command)}</Error></Errors></ApiResponse>`);
    }
  }
}

/**
 * Simulated RDAP service. Serves an IANA-style bootstrap file and RFC 9083 domain responses.
 * Privacy demo rule: registrant data is redacted (privacy-protected) unless the label contains
 * "public" — exercising the adapter's redaction/privacy handling with both shapes.
 */
export class MockRdap {
  readonly server: Server;
  port = 0;

  constructor() {
    this.server = createServer((req, res) => void this.handle(req, res));
  }

  bootstrapUrl(): string {
    return `http://127.0.0.1:${this.port}/bootstrap`;
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.server.address();
    if (address && typeof address === 'object') this.port = address.port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '';
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    if (url === '/bootstrap') {
      send(200, {
        description: 'Simulated RDAP bootstrap (dev preview only)',
        publication: '2026-01-01T00:00:00Z',
        services: [
          [
            MOCK_TLDS.map((tld) => tld.name),
            [`http://127.0.0.1:${this.port}/rdap`],
          ],
        ],
      });
      return;
    }

    const match = /^\/rdap\/domain\/(.+)$/.exec(url);
    if (match) {
      const domain = decodeURIComponent(match[1] ?? '').toLowerCase();
      if (mockAvailability(domain) !== 'registered') {
        send(404, { errorCode: 404, title: 'Not found in simulated registry' });
        return;
      }
      const privacyProtected = !/public/.test(domain.slice(0, domain.lastIndexOf('.')));
      send(200, {
        objectClassName: 'domain',
        handle: `demo-${domain}`,
        ldhName: domain,
        status: ['clientTransferProhibited'],
        events: [
          { eventAction: 'registration', eventDate: '2020-01-01T00:00:00Z' },
          { eventAction: 'last changed', eventDate: '2025-06-01T00:00:00Z' },
          { eventAction: 'expiration', eventDate: '2027-01-01T00:00:00Z' },
        ],
        entities: [
          {
            roles: ['registrar'],
            handle: 'demo-registrar',
            vcardArray: ['vcard', [['fn', {}, {}, 'Simulated Registrar LLC']]],
          },
          ...(privacyProtected
            ? [
                {
                  roles: ['registrant'],
                  vcardArray: ['vcard', [['fn', {}, {}, 'REDACTED FOR PRIVACY']]],
                },
              ]
            : [
                {
                  roles: ['registrant'],
                  vcardArray: ['vcard', [['fn', {}, {}, 'Public Demo Owner']]],
                },
              ]),
        ],
        nameservers: [{ ldhName: 'ns1.simulated-registry.test' }, { ldhName: 'ns2.simulated-registry.test' }],
      });
      return;
    }

    send(404, { errorCode: 404, title: 'Not found' });
  }
}
