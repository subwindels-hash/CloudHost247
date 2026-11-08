import { describe, expect, it } from 'vitest';
import { buildEvidenceSummary, redact, renderEvidencePack, type EvidenceInput } from '../../src/whmcs/evidence-pack';
import { DISCOVERY_SCHEMA, type DiscoveryArtifact } from '../../src/whmcs/discovery';
import { validateDiscoveryArtifact } from '../../src/whmcs/discovery-validation';
import { buildMappingReview } from '../../src/whmcs/mapping-review';
import { sealProductMap, type ProductMapDocument } from '../../src/whmcs/product-map';
import type { ServiceRegisterEntry } from '../../src/whmcs/service-register';

/**
 * The approval pack (C1.7 step 6).
 *
 * Two properties are tested harder than formatting: it never carries a credential, and it never claims a
 * verification that did not happen. A pack that quietly omitted "module NOT VERIFIED" would turn a
 * configuration into a capability, and it would be the document a decision got made from.
 */

const SECRET = 'super-secret-value-that-must-not-leak';
const IDENTIFIER = 'cloudhost247-readonly-id';

function entry(serviceKey: string): ServiceRegisterEntry {
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
  };
}

const EMPTY_MAP: ProductMapDocument = sealProductMap({
  version: 1,
  source: 'whmcs-getproducts',
  baseUrlFingerprint: 'a'.repeat(64),
  whmcsVersion: null,
  retrievedAt: '2026-01-01T00:00:00.000Z',
  services: {},
  unmapped: { 'hosting-vps': { reason: 'no verified product', since: '2026-01-01T00:00:00.000Z' } },
  products: [],
});

function artifact(overrides: Partial<DiscoveryArtifact> = {}): DiscoveryArtifact {
  return {
    schema: DISCOVERY_SCHEMA,
    retrievedAt: '2026-01-01T00:00:00.000Z',
    baseUrlFingerprint: 'c'.repeat(64),
    whmcsVersion: '8.13.1',
    currencies: [{ code: 'USD', prefix: '$', suffix: ' USD', isDefault: true }],
    defaultCurrency: 'USD',
    groups: [{ id: 1, name: 'Hosting', hidden: false, productCount: 2 }],
    products: [
      {
        pid: 11,
        gid: 1,
        name: 'Business Hosting',
        description: '',
        module: 'cpanel',
        payType: 'recurring',
        hidden: false,
        available: true,
        pricing: { USD: [{ cycle: 'monthly', price: '12.50', setupFee: '0.00' }] },
      },
      {
        pid: 12,
        gid: 1,
        name: 'Draft Product',
        description: '',
        module: null,
        payType: 'recurring',
        hidden: true,
        available: false,
        pricing: {},
      },
    ],
    warnings: ['1 product is hidden'],
    ...overrides,
  };
}

function baseInput(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  const discovery = artifact();
  const services = [entry('hosting-vps'), entry('hosting-business')];
  const proposal = { baseUrlFingerprint: 'c'.repeat(64), entries: [{ serviceKey: 'hosting-business', productId: 11 }] };
  const review = buildMappingReview({ services, discovery, proposal, map: EMPTY_MAP });
  return {
    now: '2026-02-03T04:05:06.000Z',
    environment: {
      baseUrlHost: 'billing.staging.example.com',
      baseUrlFingerprint: 'c'.repeat(64),
      mode: 'read-only',
      mfaRequired: true,
      credentialsPresent: true,
    },
    discovery: { artifact: discovery, sha256: 'd'.repeat(64), source: 'config/whmcs/catalogue-snapshot.json' },
    validation: validateDiscoveryArtifact(discovery),
    review,
    map: EMPTY_MAP,
    proposal,
    doctorOutput: null,
    secrets: [SECRET, IDENTIFIER],
    ...overrides,
  };
}

function summaryOf(input: EvidenceInput) {
  return buildEvidenceSummary(input);
}

describe('redact', () => {
  it('removes secret values wherever they appear', () => {
    const text = `using ${SECRET} for ${IDENTIFIER}`;
    const out = redact(text, [SECRET, IDENTIFIER]);
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain(IDENTIFIER);
    expect(out).toContain('[redacted]');
  });

  it('removes credential-shaped pairs even when the value was never supplied as a secret', () => {
    const out = redact(
      'POST /includes/api.php?identifier=abc123&secret=def456\nAuthorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload\ntoken=xyz789',
      [],
    );
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('def456');
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(out).not.toContain('xyz789');
  });

  it('leaves ordinary console text readable', () => {
    const text = '  products      23\n  mode          read-only (writes refused)';
    expect(redact(text, [SECRET])).toBe(text);
  });
});

describe('renderEvidencePack', () => {
  it('produces an honest pack when no discovery has ever run', () => {
    const input = baseInput({
      discovery: null,
      validation: null,
      environment: {
        baseUrlHost: null,
        baseUrlFingerprint: null,
        mode: null,
        mfaRequired: null,
        credentialsPresent: false,
      },
      proposal: null,
      review: buildMappingReview({ services: [entry('hosting-vps')], discovery: null, proposal: null, map: EMPTY_MAP }),
    });
    const markdown = renderEvidencePack(input);

    expect(markdown).toContain('**No discovery artifact exists.**');
    expect(markdown).toContain('**no**');
    expect(markdown).toContain('not configured');
    expect(markdown).toContain('| pending | — | — | — |');
    expect(markdown).toContain('**Nothing to list**');
    expect(markdown).not.toContain('## 4. Products on the installation\n\n| Group |');
  });

  it('lists every product with prices, visibility and an explicit NOT VERIFIED for what was not read', () => {
    const markdown = renderEvidencePack(baseInput());
    expect(markdown).toContain('| 1 — Hosting | 11 | Business Hosting | visible |');
    expect(markdown).toContain('USD: monthly 12.50');
    expect(markdown).toContain('| Draft Product | hidden |');
    expect(markdown).toContain('| cpanel | NOT VERIFIED | NOT VERIFIED |');
    expect(markdown).toContain('| 12 | Draft Product | hidden |');
    expect(markdown).toContain('provisioning module capability was not exercised');
    expect(markdown).toContain('configurable options were not read');
  });

  it('records provenance: capture time, fingerprint and the artifact digest', () => {
    const markdown = renderEvidencePack(baseInput());
    expect(markdown).toContain('| Captured at | 2026-01-01T00:00:00.000Z |');
    expect(markdown).toContain('c'.repeat(64));
    expect(markdown).toContain('d'.repeat(64));
    expect(markdown).toContain('config/whmcs/catalogue-snapshot.json');
    expect(markdown).toContain('8.13.1');
  });

  it('never carries a credential, and never the full base URL', () => {
    const markdown = renderEvidencePack(
      baseInput({ doctorOutput: `base URL https://billing.staging.example.com\nsecret ${SECRET}\ntoken=abc123` }),
    );
    expect(markdown).not.toContain(SECRET);
    expect(markdown).not.toContain('abc123');
    expect(markdown).not.toContain('https://billing.staging.example.com');
    expect(markdown).toContain('billing.staging.example.com');
    expect(markdown).toContain('[redacted]');
  });

  it('cannot report a validated discovery without a validated artifact', () => {
    const unvalidated = renderEvidencePack(baseInput({ validation: null }));
    expect(unvalidated).toContain('**NOT VALIDATED');
    expect(unvalidated).toContain('does not record the digest');

    const validated = renderEvidencePack(baseInput());
    expect(validated).not.toContain('**NOT VALIDATED');
  });

  it('invalidates its own evidence when the artifact changed after the review', () => {
    const input = baseInput();
    const stale = buildMappingReview({
      services: [entry('hosting-vps')],
      discovery: input.discovery!.artifact,
      proposal: null,
      map: EMPTY_MAP,
      artifactSha256: 'f'.repeat(64),
    });
    const markdown = renderEvidencePack({ ...input, review: stale });
    expect(markdown).toContain('**EVIDENCE INVALIDATED**');
    expect(markdown).toContain('f'.repeat(64));
    expect(summaryOf({ ...input, review: stale }).artifactIntegrity.consistent).toBe(false);
  });

  it('records a consistent digest chain when the review was built from this artifact', () => {
    const input = baseInput();
    const reviewed = buildMappingReview({
      services: [entry('hosting-vps')],
      discovery: input.discovery!.artifact,
      proposal: null,
      map: EMPTY_MAP,
      artifactSha256: input.discovery!.sha256,
    });
    const markdown = renderEvidencePack({ ...input, review: reviewed });
    expect(markdown).toContain('Consistent — the review records');
    expect(markdown).not.toContain('EVIDENCE INVALIDATED');
    expect(summaryOf({ ...input, review: reviewed }).artifactIntegrity.consistent).toBe(true);
  });

  it('carries the project-wide verification status line', () => {
    const markdown = renderEvidencePack(baseInput());
    const empty = renderEvidencePack(baseInput({ discovery: null, validation: null }));
    const sentence = 'Verified locally — not WHMCS-integrated in a live staging environment.';
    expect(markdown).toContain(sentence);
    expect(empty).toContain(sentence);
    expect(summaryOf(baseInput()).verificationStatus).toBe(sentence);
  });

  it('never claims an owner approval', () => {
    const markdown = renderEvidencePack(baseInput());
    expect(markdown).toContain('not recorded — this pack is a request, not an approval');
    expect(markdown).toContain('an owner approval was recorded — this tool has no code path');
    expect(summaryOf(baseInput()).ownerApproved).toBe(false);
  });

  it('redacts JSON, header, env and Basic-auth credential shapes', () => {
    const out = redact(
      [
        '{"secret": "json-secret-value", "identifier": "json-id"}',
        'X-Api-Secret: header-secret-value',
        'WHMCS_API_SECRET=env-secret-value',
        'Authorization: Basic YmFzZTY0LWNyZWRz',
        '#!/bin/sh\npassword=hunter2',
      ].join('\n'),
      [],
    );
    for (const secret of ['json-secret-value', 'json-id', 'header-secret-value', 'env-secret-value', 'YmFzZTY0LWNyZWRz', 'hunter2']) {
      expect(out).not.toContain(secret);
    }
  });

  it('marks an unusable artifact as unusable instead of reviewing it anyway', () => {
    const broken = artifact({ currencies: [], defaultCurrency: null });
    const input = baseInput({
      discovery: { artifact: broken, sha256: 'e'.repeat(64), source: 'config/whmcs/catalogue-snapshot.json' },
      validation: validateDiscoveryArtifact(broken),
      review: buildMappingReview({
        services: [entry('hosting-vps')],
        discovery: broken,
        proposal: null,
        map: EMPTY_MAP,
      }),
    });
    const markdown = renderEvidencePack(input);
    expect(markdown).toContain('**NOT USABLE**');
    expect(markdown).toContain('Nothing may be reviewed or');
    expect(markdown).toContain('currencies.present');
  });

  it('leaves the owner attestations unticked', () => {
    const markdown = renderEvidencePack(baseInput());
    expect(markdown).toContain('- [ ] the installation is **staging**, not production');
    expect(markdown).toContain('- [ ] the API credential\'s role is read-only');
    expect(markdown).not.toContain('- [x]');
  });
});

describe('buildEvidenceSummary', () => {
  it('counts the facts a reviewer checks first, from the artifact rather than from a claim', () => {
    const summary = buildEvidenceSummary(baseInput());
    expect(summary.stagingOnly).toBe(true);
    expect(summary.map.bindings).toBe(0);
    expect(summary.map.dispositions).toBe(1);
    expect(summary.discovery?.products).toBe(2);
    expect(summary.discovery?.hiddenProducts).toBe(1);
    expect(summary.discovery?.modulelessProducts).toBe(1);
    expect(summary.discovery?.unpricedProducts).toBe(1);
    expect(summary.validation?.usable).toBe(true);
    expect(summary.proposal?.entries).toBe(1);
    expect(summary.products.map((product) => product.productId)).toEqual([11, 12]);
    expect(summary.products.every((product) => product.configurableOptions === 'NOT VERIFIED')).toBe(true);
    expect(summary.products.every((product) => product.provisioningModuleVerification === 'NOT VERIFIED')).toBe(true);
    expect(summary.notVerified.length).toBeGreaterThanOrEqual(5);
  });

  it('reports the review summary unchanged, so two packs can be diffed', () => {
    const summary = buildEvidenceSummary(baseInput());
    const total = Object.values(summary.review.summary).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(summary.services.length);
    expect(summary.services[0]).toMatchObject({ serviceKey: 'hosting-vps', state: 'NOT INTEGRATED' });
  });

  it('carries no secret values in the JSON form either', () => {
    const summary = JSON.stringify(buildEvidenceSummary(baseInput({ doctorOutput: `secret ${SECRET}` })));
    expect(summary).not.toContain(SECRET);
    expect(summary).not.toContain(IDENTIFIER);
  });
});
