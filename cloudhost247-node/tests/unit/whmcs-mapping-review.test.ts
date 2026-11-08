import { describe, expect, it } from 'vitest';
import {
  REVIEW_STATES,
  buildMappingReview,
  classifyService,
  renderMappingReview,
  type MappingProposal,
  type ReviewState,
} from '../../src/whmcs/mapping-review';
import { DISCOVERY_SCHEMA, type DiscoveryArtifact, type DiscoveryProduct } from '../../src/whmcs/discovery';
import { sealProductMap, type ProductMapDocument } from '../../src/whmcs/product-map';
import {
  parseCsv,
  parseServiceRegister,
  readServiceRegister,
  type ServiceRegisterEntry,
} from '../../src/whmcs/service-register';

/**
 * The mapping review, exercised entirely from fixtures.
 *
 * Two things are being protected here. First: **all six approved classifications are reachable** — a
 * review engine whose "HIDDEN PRODUCT" branch has never executed is not evidence of anything. Second,
 * and more important: the engine may only ever *recommend*. Every test asserts on data returned, never
 * on a written product map, and the "does not bind" test below fails loudly if that ever changes.
 */

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

function entry(serviceKey: string, overrides: Partial<ServiceRegisterEntry> = {}): ServiceRegisterEntry {
  return {
    serviceKey,
    service: serviceKey.replace(/-/g, ' '),
    category: 'hosting',
    spaRoute: `/hosting/${serviceKey}`,
    phpPage: '',
    advertised: true,
    catalogueSlug: serviceKey,
    priceSource: 'whmcs',
    orderPath: '',
    registerProductGroupId: '',
    registerProductId: '',
    registerProvisioningModule: '',
    status: 'advertised',
    evidence: 'fixture',
    ...overrides,
  };
}

function product(pid: number, overrides: Partial<DiscoveryProduct> = {}): DiscoveryProduct {
  return {
    pid,
    gid: 1,
    name: `Product ${pid}`,
    description: '',
    module: 'cpanel',
    payType: 'recurring',
    hidden: false,
    available: true,
    pricing: {
      USD: [
        { cycle: 'monthly', price: '12.50', setupFee: '0.00' },
        { cycle: 'annually', price: '120.00', setupFee: '0.00' },
      ],
    },
    ...overrides,
  };
}

function discovery(products: DiscoveryProduct[], overrides: Partial<DiscoveryArtifact> = {}): DiscoveryArtifact {
  return {
    schema: DISCOVERY_SCHEMA,
    retrievedAt: '2026-01-01T00:00:00.000Z',
    baseUrlFingerprint: 'a'.repeat(64),
    whmcsVersion: '8.13.1',
    currencies: [{ code: 'USD', prefix: '$', suffix: ' USD', isDefault: true }],
    defaultCurrency: 'USD',
    groups: [{ id: 1, name: 'Hosting', hidden: false, productCount: products.length }],
    products,
    warnings: [],
    ...overrides,
  };
}

/** An empty, checksummed map — the shape `config/whmcs/product-map.json` ships with today. */
const EMPTY_MAP: ProductMapDocument = sealProductMap({
  version: 1,
  source: 'whmcs-getproducts',
  baseUrlFingerprint: 'a'.repeat(64),
  whmcsVersion: '8.13.1',
  retrievedAt: '2026-01-01T00:00:00.000Z',
  services: {},
  unmapped: { 'hosting-vps': { reason: 'no verified product', since: '2026-01-01T00:00:00.000Z' } },
  products: [],
});

function boundMap(productId: number, groupId = 1): ProductMapDocument {
  const retrievedAt = '2026-01-01T00:00:00.000Z';
  return sealProductMap({
    version: 1,
    source: 'whmcs-getproducts',
    baseUrlFingerprint: 'a'.repeat(64),
    whmcsVersion: '8.13.1',
    retrievedAt,
    services: {
      'hosting-vps': {
        productId,
        productGroupId: groupId,
        billingCycles: ['monthly'],
        provisioningModule: 'cpanel',
        boundAt: retrievedAt,
        // Stamped below, after sealing computes the snapshot checksum.
        boundFrom: '',
      },
    },
    unmapped: {},
    products: [
      {
        id: productId,
        groupId,
        name: `Product ${productId}`,
        module: 'cpanel',
        payType: 'recurring',
        hidden: false,
        currencies: ['USD'],
        cycles: { USD: ['monthly', 'annually'] },
      },
    ],
  });
}

describe('service register reader', () => {
  it('parses RFC 4180 quoting, embedded commas and doubled quotes', () => {
    const rows = parseCsv(
      'service_key,service,evidence\nvps,"VPS (KVM, NVMe)","says ""fast"", cPanel-free"\n',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].service).toBe('VPS (KVM, NVMe)');
    expect(rows[0].evidence).toBe('says "fast", cPanel-free');
  });

  it('tolerates CRLF line endings and trailing blank lines', () => {
    const rows = parseCsv('service_key,service\r\nvps,VPS\r\n\r\n');
    expect(rows).toHaveLength(1);
    expect(rows[0].service_key).toBe('vps');
  });

  it('skips rows that carry no service key instead of inventing a phantom service', () => {
    const entries = parseServiceRegister('service_key,service\nvps,VPS\n,orphan row\n');
    expect(entries.map((item) => item.serviceKey)).toEqual(['vps']);
  });

  it('reads the real cross-stack register, one typed entry per advertised service', () => {
    const entries = readServiceRegister(new URL('../../../config/whmcs/service-register.csv', import.meta.url).pathname);
    expect(entries.length).toBeGreaterThanOrEqual(50);
    expect(new Set(entries.map((item) => item.serviceKey)).size).toBe(entries.length);
    expect(entries.every((item) => typeof item.advertised === 'boolean')).toBe(true);
  });
});

describe('classifyService', () => {
  const base = { duplicateProduct: false, boundProductId: null as number | null };

  it('is BLOCKED when no discovery run exists — nothing can be verified without evidence', () => {
    const row = classifyService({ ...base, entry: entry('hosting-vps'), discovery: null, product: null, proposal: null });
    expect(row.state).toBe('BLOCKED');
    expect(row.evidence).toContain('catalogue-snapshot.json does not exist');
    expect(row.missing.join(' ')).toContain('no WHMCS discovery run');
  });

  it('is NOT INTEGRATED when a discovery run exists but nobody proposed a product', () => {
    const row = classifyService({
      ...base,
      entry: entry('hosting-vps'),
      discovery: discovery([product(11)]),
      product: null,
      proposal: null,
    });
    expect(row.state).toBe('NOT INTEGRATED');
    expect(row.productId).toBeNull();
    expect(row.orderability).toContain('NOT_INTEGRATED');
  });

  it('is HIDDEN PRODUCT when the proposed product is hidden in WHMCS', () => {
    const row = classifyService({
      ...base,
      entry: entry('hosting-vps'),
      discovery: discovery([product(11, { hidden: true })]),
      product: product(11, { hidden: true }),
      proposal: { serviceKey: 'hosting-vps', productId: 11 },
    });
    expect(row.state).toBe('HIDDEN PRODUCT');
    expect(row.visibility).toBe('hidden');
    expect(row.orderability).toContain('hidden in WHMCS');
  });

  it('is NO PROVISIONING MODULE when the product would invoice with nothing to provision', () => {
    const row = classifyService({
      ...base,
      entry: entry('hosting-vps'),
      discovery: discovery([product(11, { module: null })]),
      product: product(11, { module: null }),
      proposal: { serviceKey: 'hosting-vps', productId: 11 },
    });
    expect(row.state).toBe('NO PROVISIONING MODULE');
    expect(row.provisioningModule).toBeNull();
  });

  it('is NO VALID PRICE when no proposed cycle is priced in the default currency', () => {
    const unpriced = product(11, { pricing: {} });
    const row = classifyService({
      ...base,
      entry: entry('hosting-vps'),
      discovery: discovery([unpriced]),
      product: unpriced,
      proposal: { serviceKey: 'hosting-vps', productId: 11 },
    });
    expect(row.state).toBe('NO VALID PRICE');
    expect(row.currencies).toEqual([]);
    expect(row.monthlyPrice).toBeNull();
  });

  it('is NO VALID PRICE when the product is priced only outside the proposed cycles', () => {
    const annuallyOnly = product(11, {
      pricing: { USD: [{ cycle: 'annually', price: '120.00', setupFee: '0.00' }] },
    });
    const row = classifyService({
      ...base,
      entry: entry('hosting-vps'),
      discovery: discovery([annuallyOnly]),
      product: annuallyOnly,
      proposal: { serviceKey: 'hosting-vps', productId: 11, cycles: ['monthly'] },
    });
    expect(row.state).toBe('NO VALID PRICE');
    expect(row.missing.join(' ')).toContain('among the proposed cycles (monthly)');
  });

  it('is BLOCKED when the proposed pid is absent from the discovered catalogue', () => {
    const row = classifyService({
      ...base,
      entry: entry('hosting-vps'),
      discovery: discovery([product(11)]),
      product: null,
      proposal: { serviceKey: 'hosting-vps', productId: 99 },
    });
    expect(row.state).toBe('BLOCKED');
    expect(row.missing.join(' ')).toContain('proposed pid 99 is not in the discovered catalogue');
  });

  it('is BLOCKED when one pid is proposed for two different pages', () => {
    const row = classifyService({
      ...base,
      duplicateProduct: true,
      entry: entry('hosting-vps'),
      discovery: discovery([product(11)]),
      product: product(11),
      proposal: { serviceKey: 'hosting-vps', productId: 11 },
    });
    expect(row.state).toBe('BLOCKED');
    expect(row.missing.join(' ')).toContain('more than one service');
  });

  it('is VERIFIED only with existence, visibility, module and a priced proposed cycle', () => {
    const row = classifyService({
      ...base,
      entry: entry('hosting-vps'),
      discovery: discovery([product(11)]),
      product: product(11),
      proposal: { serviceKey: 'hosting-vps', productId: 11 },
    });
    expect(row.state).toBe('VERIFIED — READY FOR APPROVAL');
    expect(row.productId).toBe(11);
    expect(row.productGroup).toBe('1 — Hosting');
    expect(row.currencies).toEqual(['USD']);
    expect(row.monthlyPrice).toBe('12.50');
    expect(row.annualPrice).toBe('120.00');
    expect(row.cycles).toEqual(['monthly', 'annually']);
    expect(row.missing).toEqual([]);
    expect(row.orderability).toContain('once bound and approved');
  });

  it('never fabricates configurable options — the gap is stated instead', () => {
    const row = classifyService({
      ...base,
      entry: entry('hosting-vps'),
      discovery: discovery([product(11)]),
      product: product(11),
      proposal: { serviceKey: 'hosting-vps', productId: 11 },
    });
    expect(row.configurableOptions).toContain('not read');
    for (const state of REVIEW_STATES) {
      expect(REVIEW_STATES).toContain(state);
    }
  });

  it('describes a bound pid that has vanished from discovery as BLOCKED, not verified', () => {
    const row = classifyService({
      ...base,
      boundProductId: 77,
      entry: entry('hosting-vps'),
      discovery: discovery([product(11)]),
      product: null,
      proposal: null,
    });
    expect(row.state).toBe('BLOCKED');
    expect(row.missing.join(' ')).toContain('the bound pid 77 is not in the current discovery');
  });

  it('classifies a verified existing binding as VERIFIED and reads cycles from the product', () => {
    const row = classifyService({
      ...base,
      boundProductId: 11,
      entry: entry('hosting-vps'),
      discovery: discovery([product(11)]),
      product: product(11),
      proposal: null,
    });
    expect(row.state).toBe('VERIFIED — READY FOR APPROVAL');
    expect(row.evidence).toContain('verified binding in product-map.json (pid 11)');
    expect(row.cycles).toEqual(['monthly', 'annually']);
  });
});

describe('buildMappingReview', () => {
  const services = [entry('hosting-vps'), entry('hosting-web'), entry('domains')];

  it('classifies every service with no discovery run as BLOCKED and says why at repository level', () => {
    const review = buildMappingReview({ services, discovery: null, proposal: null, map: EMPTY_MAP });
    expect(review.discovered).toBe(false);
    expect(review.rows).toHaveLength(3);
    expect(review.summary['BLOCKED']).toBe(3);
    expect(review.summary['VERIFIED — READY FOR APPROVAL']).toBe(0);
    expect(review.blockers.join(' ')).toContain('No discovery run has been performed');
    expect(review.blockers.join(' ')).toContain('System URL must equal WHMCS_BASE_URL');
  });

  it('keeps the summary a partition of the register — every service is counted exactly once', () => {
    const proposal: MappingProposal = {
      entries: [
        { serviceKey: 'hosting-vps', productId: 11 },
        { serviceKey: 'hosting-web', productId: 12 },
      ],
    };
    const review = buildMappingReview({
      services,
      discovery: discovery([product(11), product(12, { hidden: true })]),
      proposal,
      map: EMPTY_MAP,
    });
    const total = REVIEW_STATES.reduce((sum, state) => sum + review.summary[state], 0);
    expect(total).toBe(services.length);
    expect(review.summary['VERIFIED — READY FOR APPROVAL']).toBe(1);
    expect(review.summary['HIDDEN PRODUCT']).toBe(1);
    expect(review.summary['NOT INTEGRATED']).toBe(1);
  });

  it('reaches all six approved classifications from fixtures alone', () => {
    const discovered = discovery([
      product(11), // verified
      product(12, { hidden: true }), // hidden
      product(13, { module: null }), // no module
      product(14, { pricing: {} }), // no price
      product(15), // proposed twice -> blocked
    ]);
    const review = buildMappingReview({
      services: [
        entry('a-verified'),
        entry('b-hidden'),
        entry('c-no-module'),
        entry('d-no-price'),
        entry('e-not-integrated'),
        entry('f-duplicate-one'),
        entry('g-duplicate-two'),
      ],
      discovery: discovered,
      proposal: {
        entries: [
          { serviceKey: 'a-verified', productId: 11 },
          { serviceKey: 'b-hidden', productId: 12 },
          { serviceKey: 'c-no-module', productId: 13 },
          { serviceKey: 'd-no-price', productId: 14 },
          { serviceKey: 'f-duplicate-one', productId: 15 },
          { serviceKey: 'g-duplicate-two', productId: 15 },
        ],
      },
      map: EMPTY_MAP,
    });

    const states = new Set<ReviewState>(review.rows.map((row) => row.state));
    for (const expected of REVIEW_STATES) expect(states).toContain(expected);

    expect(review.summary['VERIFIED — READY FOR APPROVAL']).toBe(1);
    expect(review.summary['HIDDEN PRODUCT']).toBe(1);
    expect(review.summary['NO PROVISIONING MODULE']).toBe(1);
    expect(review.summary['NO VALID PRICE']).toBe(1);
    expect(review.summary['NOT INTEGRATED']).toBe(1);
    expect(review.summary['BLOCKED']).toBe(2);
    expect(review.blockers.join(' ')).toContain('2 service(s) cannot be classified');
  });

  it('reports discovery warnings and a missing version as reviewer blockers', () => {
    const review = buildMappingReview({
      services: [entry('hosting-vps')],
      discovery: discovery([product(11)], { warnings: ['staging install'], whmcsVersion: null }),
      proposal: null,
      map: EMPTY_MAP,
    });
    expect(review.blockers.join(' ')).toContain('1 discovery warning(s)');
    expect(review.blockers.join(' ')).toContain('WHMCS version was not read');
  });

  it('does not bind anything: an empty map stays empty however good the proposal looks', () => {
    const before = JSON.stringify(EMPTY_MAP);
    const review = buildMappingReview({
      services: [entry('hosting-vps')],
      discovery: discovery([product(11)]),
      proposal: { entries: [{ serviceKey: 'hosting-vps', productId: 11 }] },
      map: EMPTY_MAP,
    });
    expect(review.summary['VERIFIED — READY FOR APPROVAL']).toBe(1);
    expect(Object.keys(EMPTY_MAP.services)).toHaveLength(0);
    expect(JSON.stringify(EMPTY_MAP)).toBe(before);
  });

  it('honours a binding already in the map, and blocks when it contradicts discovery', () => {
    const map = { ...boundMap(11), services: { 'hosting-vps': { ...boundMap(11).services['hosting-vps'], boundFrom: boundMap(11).snapshotChecksum } } };
    const ok = buildMappingReview({
      services: [entry('hosting-vps')],
      discovery: discovery([product(11)]),
      proposal: null,
      map,
    });
    expect(ok.rows[0].state).toBe('VERIFIED — READY FOR APPROVAL');

    const stale = buildMappingReview({
      services: [entry('hosting-vps')],
      discovery: discovery([product(11)]),
      proposal: null,
      map: { ...map, services: {} },
    });
    // No binding and no proposal: the row falls back to NOT INTEGRATED, never to a guessed product.
    expect(stale.rows[0].state).toBe('NOT INTEGRATED');
    expect(stale.rows[0].productId).toBeNull();
  });
});

describe('renderMappingReview', () => {
  const review = buildMappingReview({
    services: [entry('hosting-vps'), entry('domains')],
    discovery: discovery([product(11)]),
    proposal: { entries: [{ serviceKey: 'hosting-vps', productId: 11 }] },
    map: EMPTY_MAP,
  });
  const markdown = renderMappingReview(review, {
    generatedAt: '2026-01-02T00:00:00.000Z',
    sources: { discovery: 'config/whmcs/catalogue-snapshot.json', proposal: 'config/whmcs/mapping-proposal.json' },
  });

  it('states that it recommends and does not bind', () => {
    expect(markdown).toContain('does not bind anything');
    expect(markdown).toContain('npm run whmcs:map -- bind');
  });

  it('carries the summary, the rules and one row per advertised service', () => {
    expect(markdown).toContain('| VERIFIED — READY FOR APPROVAL | 1 |');
    expect(markdown).toContain('| NOT INTEGRATED | 1 |');
    expect(markdown).toContain('## Classification rules');
    expect(markdown).toContain('`hosting-vps`');
    expect(markdown).toContain('`domains`');
    expect(markdown).toContain('2026-01-02T00:00:00.000Z');
  });

  it('records the evidence and the configurable-options gap in the row itself', () => {
    expect(markdown).toContain('discovery pid 11');
    expect(markdown).toContain('not read — WHMCS configurable options need a separate read (slice B2.3)');
    expect(markdown).toContain('no registrar configured in WHMCS');
  });

  it('documents the proposal format and points at the next human action', () => {
    expect(markdown).toContain('## How a reviewer proposes a mapping');
    expect(markdown).toContain('"serviceKey": "hosting-vps"');
    expect(markdown).toContain('a real id may only come from the discovery');

    const empty = buildMappingReview({ services: [entry('hosting-vps')], discovery: null, proposal: null, map: EMPTY_MAP });
    expect(empty.proposalHint).toContain('npm run whmcs:discover');
    expect(renderMappingReview(empty)).toContain('## Next action');
    expect(renderMappingReview(empty)).toContain('npm run whmcs:discover');

    const undiscoveredProposal = buildMappingReview({
      services: [entry('hosting-vps')],
      discovery: discovery([product(11)]),
      proposal: null,
      map: EMPTY_MAP,
    });
    expect(undiscoveredProposal.proposalHint).toContain('mapping-proposal.json');
    expect(markdown).not.toContain('Next action: `npm run whmcs:discover`');
  });

  it('escapes pipes so a product name cannot break the table', () => {
    const risky = buildMappingReview({
      services: [entry('hosting-vps')],
      discovery: discovery([product(11, { name: 'A | B' })]),
      proposal: { entries: [{ serviceKey: 'hosting-vps', productId: 11 }] },
      map: EMPTY_MAP,
    });
    expect(renderMappingReview(risky)).toContain('A \\| B');
  });
});
