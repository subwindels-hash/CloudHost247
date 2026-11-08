/**
 * The product mapping review — the deliverable that sits between a discovery run and C2.
 *
 * It answers one question per advertised service, with evidence, and it answers it in a way that
 * cannot flatter the installation:
 *
 *   VERIFIED — READY FOR APPROVAL   a proposed product exists, is visible, has a provisioning module
 *                                   and is priced for at least one cycle in the default currency
 *   NOT INTEGRATED                  no product has been proposed for this service
 *   NO PROVISIONING MODULE          the proposed product would invoice for nothing
 *   NO VALID PRICE                  the product sells no priced cycle (in any proposed cycle)
 *   HIDDEN PRODUCT                  the product is hidden in WHMCS, so cart.php cannot sell it
 *   BLOCKED                         cannot be decided: no discovery run, a proposal that does not
 *                                   match the catalogue, or two services claiming one product
 *
 * Classification order matters and is deliberate: existence, then ambiguity, then visibility, then
 * provisioning, then price. Each earlier state invalidates the later questions — there is no point
 * arguing about the price of a product that is hidden, and no point checking the module of one that
 * does not exist.
 *
 * **Nothing here writes the product map.** A review may recommend; only a reviewed
 * `npm run whmcs:map -- bind` changes what the storefront can sell. That is the whole reason this
 * module takes a *proposal* file as input instead of mutating bindings.
 */

import type { DiscoveryArtifact, DiscoveryProduct } from './discovery';
import { BILLING_CYCLES, type BillingCycle } from './types';
import type { ProductMapDocument } from './product-map';
import type { ServiceRegisterEntry } from './service-register';

export const REVIEW_STATES = [
  'VERIFIED — READY FOR APPROVAL',
  'NOT INTEGRATED',
  'NO PROVISIONING MODULE',
  'NO VALID PRICE',
  'HIDDEN PRODUCT',
  'BLOCKED',
] as const;

export type ReviewState = (typeof REVIEW_STATES)[number];

/** What a human proposes in `config/whmcs/mapping-proposal.json`. Never applied automatically. */
export interface ProposalEntry {
  serviceKey: string;
  productId: number;
  /** Cycles the page should offer. Omitted = every cycle WHMCS prices for the product. */
  cycles?: BillingCycle[];
  note?: string;
}

export interface MappingProposal {
  /** Free-text context for reviewers (who proposed what, against which discovery run). */
  notes?: string;
  /** Fingerprint of the discovery artifact this proposal was written against. */
  baseUrlFingerprint?: string;
  entries: ProposalEntry[];
}

export interface ReviewRow {
  serviceKey: string;
  service: string;
  spaRoute: string;
  phpPage: string;
  state: ReviewState;
  productGroup: string | null;
  productId: number | null;
  productName: string | null;
  currencies: string[];
  /** WHMCS's own strings for the default currency; null when not priced there. */
  monthlyPrice: string | null;
  annualPrice: string | null;
  cycles: BillingCycle[];
  configurableOptions: string;
  provisioningModule: string | null;
  visibility: 'visible' | 'hidden' | 'unknown';
  orderability: string;
  missing: string[];
  evidence: string;
}

export interface MappingReview {
  rows: ReviewRow[];
  summary: Record<ReviewState, number>;
  /** Repository-level facts a reviewer needs before approving any row. */
  blockers: string[];
  /** True when a discovery artifact was supplied. */
  discovered: boolean;
  /** One-line pointer to the next human action, so the document is never a dead end. */
  proposalHint: string | null;
}

export interface ReviewInput {
  services: ServiceRegisterEntry[];
  /** Null when `npm run whmcs:discover` has never run against an installation. */
  discovery: DiscoveryArtifact | null;
  /** Null when nobody has proposed anything yet. */
  proposal: MappingProposal | null;
  map: ProductMapDocument;
}

const CONFIG_OPTIONS_NOTE = 'not read — WHMCS configurable options need a separate read (slice B2.3)';

function humaniseGroup(groups: DiscoveryArtifact['groups'], gid: number): string {
  const group = groups.find((candidate) => candidate.id === gid);
  return group ? `${group.id} — ${group.name}` : `${gid} — (group not in discovery response)`;
}

function pricesFor(product: DiscoveryProduct, currency: string | null) {
  if (!currency) return [];
  return product.pricing[currency] ?? [];
}

function stateOrderability(state: ReviewState): string {
  switch (state) {
    case 'VERIFIED — READY FOR APPROVAL':
      return 'orderable once bound and approved';
    case 'NOT INTEGRATED':
      return 'not orderable — NOT_INTEGRATED';
    case 'NO PROVISIONING MODULE':
      return 'must stay off — an order would invoice with nothing to provision';
    case 'NO VALID PRICE':
      return 'not orderable — NO_CYCLES_OFFERED';
    case 'HIDDEN PRODUCT':
      return 'not orderable — hidden in WHMCS, cart.php cannot sell it';
    case 'BLOCKED':
      return 'unknown — do not enable';
  }
}

/** Dependencies that are missing regardless of the product, keyed by service family. */
function dependencyNotes(entry: ServiceRegisterEntry): string[] {
  const notes: string[] = [];
  if (entry.serviceKey.startsWith('domains')) {
    notes.push('no registrar configured in WHMCS — domain ordering stays disabled until one is and availability is verified');
  }
  if (entry.serviceKey.includes('ssl')) {
    notes.push('no SSL issuance provider verified — issuance cannot be claimed');
  }
  if (entry.serviceKey.startsWith('platforms') || entry.serviceKey.startsWith('developers')) {
    notes.push('platform/developer surface — WHMCS may not sell this at all; confirm before proposing a product');
  }
  return notes;
}

/**
 * Decides one row. Exported for the tests, which is also why it takes plain data rather than doing
 * its own I/O: every branch is reachable without a WHMCS installation.
 */
export function classifyService(input: {
  entry: ServiceRegisterEntry;
  discovery: DiscoveryArtifact | null;
  product: DiscoveryProduct | null;
  proposal: ProposalEntry | null;
  duplicateProduct: boolean;
  boundProductId: number | null;
}): ReviewRow {
  const { entry, discovery, product, proposal, duplicateProduct, boundProductId } = input;
  const defaultCurrency = discovery?.defaultCurrency ?? null;

  const base: ReviewRow = {
    serviceKey: entry.serviceKey,
    service: entry.service,
    spaRoute: entry.spaRoute || '—',
    phpPage: entry.phpPage || '—',
    state: 'BLOCKED',
    productGroup: null,
    productId: null,
    productName: null,
    currencies: [],
    monthlyPrice: null,
    annualPrice: null,
    cycles: [],
    configurableOptions: CONFIG_OPTIONS_NOTE,
    provisioningModule: null,
    visibility: 'unknown',
    orderability: stateOrderability('BLOCKED'),
    missing: dependencyNotes(entry),
    evidence: '',
  };

  // 1. No discovery run: nothing can be verified, and saying so is the point.
  if (!discovery) {
    return {
      ...base,
      state: 'BLOCKED',
      orderability: stateOrderability('BLOCKED'),
      missing: [...base.missing, 'no WHMCS discovery run — supply staging credentials, then run `npm run whmcs:discover`'],
      evidence: 'config/whmcs/catalogue-snapshot.json does not exist',
    };
  }

  // 2. Already bound (from the checksummed map) — the strongest evidence available.
  if (boundProductId !== null) {
    const bound = discovery.products.find((candidate) => candidate.pid === boundProductId) ?? null;
    if (!bound) {
      return {
        ...base,
        productId: boundProductId,
        state: 'BLOCKED',
        orderability: stateOrderability('BLOCKED'),
        missing: [...base.missing, `the bound pid ${boundProductId} is not in the current discovery — the product was deleted or the map is stale`],
        evidence: `product-map.json binds pid ${boundProductId}; absent from catalogue-snapshot.json`,
      };
    }
    if (bound.hidden) {
      return boundRow(base, bound, discovery, 'HIDDEN PRODUCT', ['product is hidden in WHMCS'],
        `product-map.json binds pid ${bound.pid}; discovery marks it hidden`);
    }
    if (!bound.module) {
      return boundRow(base, bound, discovery, 'NO PROVISIONING MODULE', ['no provisioning module'],
        `product-map.json binds pid ${bound.pid}; discovery reports no module`);
    }
    const boundCycles = Object.keys(bound.pricing).length > 0;
    if (!boundCycles) {
      return boundRow(base, bound, discovery, 'NO VALID PRICE', ['no priced cycle in any currency'],
        `product-map.json binds pid ${bound.pid}; discovery reports no priced cycle`);
    }
    return {
      ...boundRow(base, bound, discovery, 'VERIFIED — READY FOR APPROVAL', [], `verified binding in product-map.json (pid ${bound.pid})`),
      cycles: (Object.values(bound.pricing)[0] ?? []).map((row) => row.cycle),
      monthlyPrice: pricesFor(bound, defaultCurrency).find((row) => row.cycle === 'monthly')?.price ?? null,
      annualPrice: pricesFor(bound, defaultCurrency).find((row) => row.cycle === 'annually')?.price ?? null,
    };
  }

  // 3. No proposal → not integrated.
  if (!proposal) {
    return {
      ...base,
      state: 'NOT INTEGRATED',
      orderability: stateOrderability('NOT INTEGRATED'),
      missing: [...base.missing, 'no WHMCS product proposed for this service'],
      evidence: 'no entry in mapping-proposal.json',
    };
  }

  // 4. A proposal that cannot be resolved is blocked, not guessed at.
  if (duplicateProduct) {
    return {
      ...base,
      productId: proposal.productId,
      state: 'BLOCKED',
      orderability: stateOrderability('BLOCKED'),
      missing: [...base.missing, `pid ${proposal.productId} is proposed for more than one service — one product cannot sell two different pages`],
      evidence: `mapping-proposal.json entry for ${entry.serviceKey}`,
    };
  }
  if (!product) {
    return {
      ...base,
      productId: proposal.productId,
      state: 'BLOCKED',
      orderability: stateOrderability('BLOCKED'),
      missing: [...base.missing, `proposed pid ${proposal.productId} is not in the discovered catalogue — do not bind it`],
      evidence: `mapping-proposal.json proposes pid ${proposal.productId}; absent from catalogue-snapshot.json`,
    };
  }

  // 5. Visibility, then provisioning, then price — in that order, because each invalidates the next.
  if (product.hidden) {
    return boundRow(base, product, discovery, 'HIDDEN PRODUCT', ['product is hidden in WHMCS'],
      `discovery marks pid ${product.pid} hidden`);
  }
  if (!product.module) {
    return boundRow(base, product, discovery, 'NO PROVISIONING MODULE', ['no provisioning module'],
      `discovery reports no module for pid ${product.pid}`);
  }

  const proposedCycles = (proposal.cycles?.length ? proposal.cycles : BILLING_CYCLES) as BillingCycle[];
  const priced = pricesFor(product, defaultCurrency).filter((row) => proposedCycles.includes(row.cycle));
  if (priced.length === 0) {
    const pricedAnywhere = Object.values(product.pricing).flat().length;
    return boundRow(base, product, discovery, 'NO VALID PRICE',
      [
        pricedAnywhere === 0
          ? 'no priced cycle in any currency'
          : `no priced cycle in ${defaultCurrency} among the proposed cycles (${proposedCycles.join(', ')})`,
      ],
      `discovery reports ${pricedAnywhere} priced cycle(s) across ${Object.keys(product.pricing).length} currency(ies)`);
  }

  return {
    ...boundRow(base, product, discovery, 'VERIFIED — READY FOR APPROVAL', [],
      `discovery pid ${product.pid} · ${priced.length} priced cycle(s) in ${defaultCurrency}`),
    cycles: priced.map((row) => row.cycle),
    monthlyPrice: priced.find((row) => row.cycle === 'monthly')?.price ?? null,
    annualPrice: priced.find((row) => row.cycle === 'annually')?.price ?? null,
  };
}

function boundRow(
  base: ReviewRow,
  product: DiscoveryProduct,
  discovery: DiscoveryArtifact,
  state: ReviewState,
  missing: string[],
  evidence: string,
): ReviewRow {
  return {
    ...base,
    state,
    productGroup: humaniseGroup(discovery.groups, product.gid),
    productId: product.pid,
    productName: product.name,
    currencies: Object.keys(product.pricing).sort(),
    provisioningModule: product.module,
    visibility: product.hidden ? 'hidden' : 'visible',
    orderability: stateOrderability(state),
    missing: [...base.missing, ...missing],
    evidence,
  };
}

/** Builds the whole review. Ordering follows the register, so diffs between runs are readable. */
export function buildMappingReview(input: ReviewInput): MappingReview {
  const { services, discovery, proposal, map } = input;

  const proposals = new Map<string, ProposalEntry>();
  const productUseCount = new Map<number, number>();
  for (const entry of proposal?.entries ?? []) {
    proposals.set(entry.serviceKey, entry);
    productUseCount.set(entry.productId, (productUseCount.get(entry.productId) ?? 0) + 1);
  }

  const rows = services.map((entry) => {
    const binding = map.services[entry.serviceKey];
    const proposalEntry = proposals.get(entry.serviceKey) ?? null;
    const productId = binding?.productId ?? proposalEntry?.productId ?? null;
    const product = productId === null ? null : discovery?.products.find((candidate) => candidate.pid === productId) ?? null;

    return classifyService({
      entry,
      discovery,
      product,
      proposal: proposalEntry,
      duplicateProduct: proposalEntry ? (productUseCount.get(proposalEntry.productId) ?? 0) > 1 : false,
      boundProductId: binding?.productId ?? null,
    });
  });

  const summary = Object.fromEntries(REVIEW_STATES.map((state) => [state, 0])) as Record<ReviewState, number>;
  for (const row of rows) summary[row.state] += 1;

  const blockers: string[] = [];
  if (!discovery) {
    blockers.push(
      'No discovery run has been performed. Nothing can be approved from this document until ' +
        '`npm run whmcs:discover` has run against the staging installation.',
    );
  } else {
    if (discovery.warnings.length > 0) {
      blockers.push(`${discovery.warnings.length} discovery warning(s) — see docs/WHMCS-DISCOVERY-REPORT.md`);
    }
    if (!discovery.whmcsVersion) {
      blockers.push('WHMCS version was not read (set WHMCS_DISCOVERY_VERSION=1 for the next run)');
    }
  }
  blockers.push(
    'The install System URL must equal WHMCS_BASE_URL exactly, or SSO hand-offs are refused (B5.1 §9).',
  );
  if (!proposal) {
    blockers.push('No mapping proposal exists yet — every service is intentionally left NOT INTEGRATED.');
  }
  if (summary['BLOCKED'] > 0) {
    blockers.push(`${summary['BLOCKED']} service(s) cannot be classified and must not be enabled.`);
  }

  const proposalHint = !discovery
    ? 'Next action: `npm run whmcs:discover` against staging — this review has no evidence to classify with.'
    : !proposal
      ? 'Next action: write `config/whmcs/mapping-proposal.json` from the discovery artifact, then re-run `npm run whmcs:review`.'
      : null;

  return { rows, summary, blockers, discovered: Boolean(discovery), proposalHint };
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export interface RenderOptions {
  generatedAt?: string;
  /** Where the inputs came from, shown in the header so the document is self-describing. */
  sources?: { discovery?: string | null; proposal?: string | null; map?: string; register?: string };
}

export function renderMappingReview(review: MappingReview, options: RenderOptions = {}): string {
  const lines: string[] = [];
  const sources = options.sources ?? {};
  lines.push('# WHMCS product mapping review');
  lines.push('');
  lines.push(
    '> Generated by `npm run whmcs:review`. **This document recommends only — it does not bind anything.**',
  );
  lines.push('> Products become orderable solely through a reviewed `npm run whmcs:map -- bind`.');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Generated at | ${options.generatedAt ?? new Date().toISOString()} |`);
  lines.push(`| Discovery artifact | ${sources.discovery ? `\`${sources.discovery}\`` : '**none — C1 has not run**'} |`);
  lines.push(`| Proposal | ${sources.proposal ? `\`${sources.proposal}\`` : '**none**'} |`);
  lines.push(`| Product map | \`${sources.map ?? 'config/whmcs/product-map.json'}\` |`);
  lines.push(`| Service register | \`${sources.register ?? '../config/whmcs/service-register.csv'}\` |`);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push('| Classification | Services |');
  lines.push('| --- | --- |');
  for (const state of REVIEW_STATES) {
    lines.push(`| ${state} | ${review.summary[state]} |`);
  }
  lines.push('');

  lines.push('## Blockers a reviewer must clear first');
  lines.push('');
  for (const blocker of review.blockers) lines.push(`- ${blocker}`);
  lines.push('');

  lines.push('## Classification rules');
  lines.push('');
  lines.push('Checked in this order; each earlier state invalidates the later questions.');
  lines.push('');
  lines.push('| # | State | Meaning |');
  lines.push('| --- | --- | --- |');
  lines.push('| 1 | VERIFIED — READY FOR APPROVAL | proposed/bound product exists, is visible, has a provisioning module, and is priced for at least one proposed cycle in the default currency |');
  lines.push('| 2 | NOT INTEGRATED | no product proposed for this service |');
  lines.push('| 3 | NO PROVISIONING MODULE | the product would invoice with nothing to provision |');
  lines.push('| 4 | NO VALID PRICE | no priced cycle among the proposed cycles |');
  lines.push('| 5 | HIDDEN PRODUCT | hidden in WHMCS, so cart.php cannot sell it |');
  lines.push('| 6 | BLOCKED | no discovery run, an unresolvable proposal, or one pid proposed twice |');
  lines.push('');

  lines.push('## Every advertised service');
  lines.push('');
  lines.push(
    '| # | Service | Key | Page | Group | pid | Product | Currencies | Monthly | Annual | Cycles | Configurable options | Module | Visibility | State | Missing dependencies | Evidence |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  review.rows.forEach((row, index) => {
    lines.push(
      `| ${index + 1} | ${escapeCell(row.service)} | \`${row.serviceKey}\` | ${escapeCell(row.spaRoute)} | ` +
        `${escapeCell(row.productGroup ?? '—')} | ${row.productId ?? '—'} | ${escapeCell(row.productName ?? '—')} | ` +
        `${row.currencies.join(', ') || '—'} | ${row.monthlyPrice ?? '—'} | ${row.annualPrice ?? '—'} | ` +
        `${row.cycles.join(', ') || '—'} | ${escapeCell(row.configurableOptions)} | ${row.provisioningModule ?? '—'} | ${row.visibility} | ` +
        `**${row.state}** | ${escapeCell(row.missing.join('; ') || '—')} | ${escapeCell(row.evidence)} |`,
    );
  });
  lines.push('');
  lines.push('`—` means the value does not exist or was not read. It never means zero, free, or "assume".');
  lines.push('');
  lines.push('The **Configurable options** column says "not read" for every row on purpose: reading options is');
  lines.push('slice B2.3 and needs a WHMCS API surface this integration does not use yet. Treat every row as');
  lines.push('"options unknown" until that slice lands — the column exists so the gap is visible, not so it can');
  lines.push('be filled in with an assumption.');
  lines.push('');

  lines.push('## What approval would authorise');
  lines.push('');
  lines.push('Approving a VERIFIED row authorises exactly one `bind` command for that service, and nothing else:');
  lines.push('no price is copied into the SPA, no purchase button changes, and no checkout is enabled. Those are');
  lines.push('C2 decisions taken service by service after this review.');
  lines.push('');

  lines.push('## How a reviewer proposes a mapping');
  lines.push('');
  lines.push(
    'Write `config/whmcs/mapping-proposal.json` by hand from the discovery artifact — never from a guess.',
  );
  lines.push('Then re-run `npm run whmcs:review`, and only after this document is approved, bind one');
  lines.push('service at a time with `npm run whmcs:map -- bind --service <key> --product <pid>`.');
  lines.push('');
  lines.push('```json');
  lines.push('{');
  lines.push('  "notes": "who proposed this, against which discovery run",');
  lines.push('  "baseUrlFingerprint": "<copy from config/whmcs/catalogue-snapshot.json>",');
  lines.push('  "entries": [');
  lines.push('    { "serviceKey": "hosting-vps", "productId": 0, "cycles": ["monthly", "annually"], "note": "why" }');
  lines.push('  ]');
  lines.push('}');
  lines.push('```');
  lines.push('');
  lines.push('`productId` stays `0` in this example on purpose: a real id may only come from the discovery');
  lines.push('artifact. Omitting `cycles` offers every cycle WHMCS prices for the product.');
  if (review.proposalHint) {
    lines.push('');
    lines.push('## Next action');
    lines.push('');
    lines.push(review.proposalHint.replace(/^Next action: /, ''));
    lines.push('');
  }
  return lines.join('\n');
}
