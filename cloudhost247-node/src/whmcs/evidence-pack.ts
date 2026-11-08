/**
 * The approval pack — C1.7 step 6, produced by machine rather than by copy-paste.
 *
 * A discovery run produces three artifacts (the catalogue snapshot, its validation, the mapping
 * review). The owner reviewing a proposal needs all of them in one place, with the provenance that
 * makes them checkable: the capture time, the installation fingerprint, the sha256 of the artifact
 * they were derived from, and an explicit statement of everything that was *not* verified.
 *
 * Two properties are deliberate:
 *
 *  - **It cannot leak a credential.** Secrets are supplied only so they can be removed; the pack
 *    function takes their *values* and never renders them. Every line of captured console output goes
 *    through `redact()` first, so a doctor transcript that printed an identifier somewhere cannot
 *    carry it into a document that gets emailed around.
 *  - **It cannot imply verification that did not happen.** Configurable options and provisioning
 *    module *capability* are reported as `NOT VERIFIED` in every row, because neither was read —
 *    `module` names a configuration, not proof that a server answers. The attestations the tool
 *    cannot check (staging not production, role is read-only, no writes issued) are left as unchecked
 *    boxes for the owner, not ticked on their behalf.
 */

import type { DiscoveryArtifact } from './discovery';
import type { DiscoveryValidation } from './discovery-validation';
import type { MappingProposal, MappingReview, ReviewRow } from './mapping-review';
import type { ProductMapDocument } from './product-map';

/** What the deployment can say about itself, measured — never asserted. */
export interface EvidenceEnvironment {
  /** Host only. The full base URL adds nothing to a review and is one less thing to leak. */
  baseUrlHost: string | null;
  baseUrlFingerprint: string | null;
  mode: string | null;
  mfaRequired: boolean | null;
  /** True when both credential variables are present. Their values are never read here. */
  credentialsPresent: boolean;
}

export interface EvidenceDiscovery {
  artifact: DiscoveryArtifact;
  /** sha256 of the artifact file as committed, so the pack is bound to the bytes reviewed. */
  sha256: string;
  source: string;
}

export interface EvidenceInput {
  now: string;
  environment: EvidenceEnvironment;
  discovery: EvidenceDiscovery | null;
  validation: DiscoveryValidation | null;
  review: MappingReview;
  map: ProductMapDocument;
  proposal: MappingProposal | null;
  /** Captured `whmcs:doctor` output, if the operator saved it. Redacted before rendering. */
  doctorOutput: string | null;
  /** Values that must never appear in the pack. */
  secrets: string[];
}

export interface EvidenceSummary {
  generatedAt: string;
  stagingOnly: true;
  environment: EvidenceEnvironment;
  discovery: {
    source: string;
    sha256: string;
    retrievedAt: string;
    baseUrlFingerprint: string;
    whmcsVersion: string | null;
    defaultCurrency: string | null;
    currencies: string[];
    groups: number;
    products: number;
    hiddenProducts: number;
    modulelessProducts: number;
    unpricedProducts: number;
    warnings: string[];
  } | null;
  validation: { usable: boolean; critical: string[]; warnings: string[] } | null;
  review: { summary: Record<string, number>; blockers: string[]; discovered: boolean };
  map: { bindings: number; dispositions: number; baseUrlFingerprint: string; retrievedAt: string };
  proposal: { entries: number; fingerprint: string | null } | null;
  products: Array<{
    productId: number;
    productGroup: string;
    name: string;
    visibility: 'visible' | 'hidden';
    currencies: string[];
    prices: Record<string, Record<string, string>>;
    provisioningModule: string | null;
    provisioningModuleVerification: 'NOT VERIFIED';
    configurableOptions: 'NOT VERIFIED';
  }>;
  services: Array<{
    serviceKey: string;
    service: string;
    page: string;
    state: string;
    productId: number | null;
    productGroup: string | null;
    productName: string | null;
    cycles: string[];
    missing: string[];
  }>;
  /** Whether the review was built from the artifact bytes now on disk. */
  artifactIntegrity: { reviewedSha256: string | null; currentSha256: string | null; consistent: boolean };
  /** Always false: no code path in this tool records an owner approval. */
  ownerApproved: false;
  /** Everything the pack cannot claim, stated once, in one place. */
  notVerified: string[];
}

const REDACTED = '[redacted]';

/** Removes secret values and credential-shaped key/value pairs from captured console text. */
export function redact(text: string, secrets: string[]): string {
  let output = text;
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 4) {
      output = output.split(secret).join(REDACTED);
    }
  }
  // 1. HTTP auth schemes. These run first: otherwise the pair rule below would treat the word
  //    "Bearer"/"Basic" as the value and leave the token itself in place.
  output = output.replace(/\b(Bearer|Basic|Digest|Negotiate)\s+[A-Za-z0-9+/._\-=]+/gi, (_m, scheme: string) => `${scheme} ${REDACTED}`);

  // 2. Credential-shaped pairs in every shape they actually occur: query strings (`?secret=…`),
  //    env dumps (`WHMCS_API_SECRET=…`), headers (`X-Api-Secret: …`), JSON (`"secret": "…"`) and
  //    prose (`secret: …`).
  const KEYS =
    '(?:x[-_]?api[-_]?secret|x[-_]?api[-_]?identifier|whmcs_api_secret|whmcs_api_identifier|api[-_]?secret|api[-_]?key|apikey|access[-_]?token|identifier|secret|password|passwd|passphrase|token)';
  const quoted = new RegExp(`(["']?)(${KEYS})(["']?\\s*[:=]\\s*)(["'])((?!\\4).)*\\4`, 'gi');
  output = output.replace(quoted, (_m, quote: string, key: string, separator: string, valueQuote: string) =>
    `${quote}${key}${separator}${valueQuote}${REDACTED}${valueQuote}`);
  const bare = new RegExp(`(\\b${KEYS})(\\s*[:=]\\s*)([^\\s,;&"'\\}\\]]+)`, 'gi');
  output = output.replace(bare, (_m, key: string, separator: string) => `${key}${separator}${REDACTED}`);

  // 3. Absolute URLs are reduced to their host: a transcript shows *which* installation answered,
  //    never the full path or a query that might carry a signed parameter.
  output = output.replace(/\bhttps?:\/\/([^\s/]+)(\/\S*)?/gi, '$1');
  return output;
  return output;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function pricesByCurrency(product: DiscoveryArtifact['products'][number]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [currency, rows] of Object.entries(product.pricing)) {
    const perCycle: Record<string, string> = {};
    for (const row of rows) perCycle[row.cycle] = row.price;
    out[currency] = perCycle;
  }
  return out;
}

function groupLabel(artifact: DiscoveryArtifact, gid: number): string {
  const group = artifact.groups.find((candidate) => candidate.id === gid);
  return group ? `${group.id} — ${group.name}` : `${gid} — (absent from the groups response)`;
}

/** The JSON the pack carries, so a reviewer can diff two evidence packs mechanically. */
export function buildEvidenceSummary(input: EvidenceInput): EvidenceSummary {
  const { discovery, validation, review, map, proposal, environment } = input;
  const artifact = discovery?.artifact ?? null;

  const reviewedSha256 = review.artifactSha256 ?? null;
  const currentSha256 = discovery?.sha256 ?? null;

  return {
    generatedAt: input.now,
    stagingOnly: true,
    environment,
    discovery: artifact && discovery
      ? {
          source: discovery.source,
          sha256: discovery.sha256,
          retrievedAt: artifact.retrievedAt,
          baseUrlFingerprint: artifact.baseUrlFingerprint,
          whmcsVersion: artifact.whmcsVersion,
          defaultCurrency: artifact.defaultCurrency,
          currencies: artifact.currencies.map((currency) => currency.code),
          groups: artifact.groups.length,
          products: artifact.products.length,
          hiddenProducts: artifact.products.filter((product) => product.hidden).length,
          modulelessProducts: artifact.products.filter((product) => !product.module).length,
          unpricedProducts: artifact.products.filter((product) => !product.available).length,
          warnings: [...artifact.warnings],
        }
      : null,
    validation: validation ? { usable: validation.usable, critical: [...validation.critical], warnings: [...validation.warnings] } : null,
    review: {
      summary: { ...review.summary },
      blockers: [...review.blockers],
      discovered: review.discovered,
    },
    map: {
      bindings: Object.keys(map.services).length,
      dispositions: Object.keys(map.unmapped).length,
      baseUrlFingerprint: map.baseUrlFingerprint,
      retrievedAt: map.retrievedAt,
    },
    proposal: proposal
      ? { entries: proposal.entries.length, fingerprint: proposal.baseUrlFingerprint ?? null }
      : null,
    products: artifact
      ? artifact.products.map((product) => ({
          productId: product.pid,
          productGroup: groupLabel(artifact, product.gid),
          name: product.name,
          visibility: product.hidden ? 'hidden' : 'visible',
          currencies: Object.keys(product.pricing).sort(),
          prices: pricesByCurrency(product),
          provisioningModule: product.module,
          provisioningModuleVerification: 'NOT VERIFIED',
          configurableOptions: 'NOT VERIFIED',
        }))
      : [],
    services: review.rows.map((row: ReviewRow) => ({
      serviceKey: row.serviceKey,
      service: row.service,
      page: row.spaRoute,
      state: row.state,
      productId: row.productId,
      productGroup: row.productGroup,
      productName: row.productName,
      cycles: [...row.cycles],
      missing: [...row.missing],
    })),
    artifactIntegrity: {
      reviewedSha256,
      currentSha256,
      consistent: reviewedSha256 !== null && currentSha256 !== null && reviewedSha256 === currentSha256,
    },
    ownerApproved: false,
    notVerified: [
      'configurable options were not read (slice B2.3)',
      'provisioning module capability was not exercised — a configured module is not a working server',
      'no order, invoice, payment or provisioning action was issued',
      'the installation was treated as staging on the owner\'s attestation, which this tool cannot check',
      'an owner approval was recorded — this tool has no code path that records one, so the pack is a request',
      'nothing was bound, priced or made orderable by this pack',
    ],
  };
}

/** The human-readable pack. Recommends only; binds nothing. */
export function renderEvidencePack(input: EvidenceInput): string {
  const summary = buildEvidenceSummary(input);
  const lines: string[] = [];
  const add = (...items: string[]) => lines.push(...items);

  add('# WHMCS staging discovery — approval pack (C1.7)');
  add('');
  add('> Generated by `npm run whmcs:evidence` from the artifacts on disk. **It recommends only: nothing is bound.**');
  add('> Every credential-shaped value is redacted before rendering; the pack contains no API secret, no auth header');
  add('> and no customer data. Products are made orderable solely by a reviewed `npm run whmcs:map -- bind`.');
  add('');
  add('| Field | Value |');
  add('| --- | --- |');
  add(`| Generated at | ${summary.generatedAt} |`);
  add(`| Installation (host only) | ${summary.environment.baseUrlHost ?? '**not configured**'} |`);
  add(`| Installation fingerprint | ${summary.environment.baseUrlFingerprint ? `\`${summary.environment.baseUrlFingerprint}\`` : '**none**'} |`);
  add(`| Credentials present | ${summary.environment.credentialsPresent ? 'yes (values never read into this pack)' : '**no**'} |`);
  add(`| Mode | ${summary.environment.mode ?? '**not configured**'} |`);
  add(`| MFA required for SSO | ${summary.environment.mfaRequired === null ? '**unknown**' : summary.environment.mfaRequired ? 'yes' : 'NO — explicit downgrade'} |`);
  add(`| Bindings in the product map | **${summary.map.bindings}** |`);
  add(`| Dispositions in the product map | ${summary.map.dispositions} |`);
  const artifactState = !summary.discovery
    ? '**none — no discovery run has been captured**'
    : summary.validation === null
      ? '**NOT VALIDATED — this file is not evidence until `npm run whmcs:validate` passes**'
      : !summary.validation.usable
        ? '**UNUSABLE — validation failed; nothing here may be reviewed or bound**'
        : 'validated';
  add(`| Discovery artifact | ${summary.discovery ? `\`${summary.discovery.source}\` (sha256 \`${summary.discovery.sha256}\`) — ${artifactState}` : artifactState} |`);
  if (summary.artifactIntegrity.reviewedSha256 && !summary.artifactIntegrity.consistent) {
    add(`| **Artifact integrity** | **EVIDENCE INVALIDATED** — the review was built from \`${summary.artifactIntegrity.reviewedSha256}\`, but the file on disk is \`${summary.artifactIntegrity.currentSha256 ?? 'absent'}\`. The mapping evidence no longer describes this snapshot: re-run \`npm run whmcs:review\`.`);
  }
  add('| Owner approval | **not recorded — this pack is a request, not an approval** |');
  add(`| Proposal | ${summary.proposal ? `${summary.proposal.entries} entr(y/ies), fingerprint ${summary.proposal.fingerprint ? `\`${summary.proposal.fingerprint}\`` : '**absent**'}` : '**none**'} |`);
  add('');

  // -- Step 1 / Step 2: prerequisites and preflight -------------------------------------------
  add('## 1. Prerequisites and preflight');
  add('');
  add('Measured by the deployment:');
  add('');
  add('| Prerequisite | State |');
  add('| --- | --- |');
  add(`| Base URL configured | ${summary.environment.baseUrlHost ? `yes — ${summary.environment.baseUrlHost}` : '**no**'} |`);
  add(`| API identifier and secret available | ${summary.environment.credentialsPresent ? 'yes (values not captured)' : '**no**'} |`);
  add(`| Mode is read-only | ${summary.environment.mode === 'read-only' ? 'yes' : summary.environment.mode ? `**NO — ${summary.environment.mode}**` : '**unknown**'} |`);
  add('');
  add('These cannot be measured from here and are the owner\'s attestation. They stay unchecked until the owner');
  add('signs them off — the tool does not tick boxes on anyone\'s behalf:');
  add('');
  add('- [ ] the installation is **staging**, not production');
  add('- [ ] the API credential\'s role is read-only (no client, order, invoice or payment permissions)');
  add('- [ ] the System URL matches `WHMCS_BASE_URL` exactly');
  add('- [ ] no credential was pasted into chat, a ticket, a commit or this document');
  add('');

  if (input.doctorOutput) {
    add('Captured `npm run whmcs:doctor` output (redacted):');
    add('');
    add('```text');
    for (const line of redact(input.doctorOutput, input.secrets).split('\n')) add(line);
    add('```');
  } else {
    add('**No `whmcs:doctor` output captured.** Run it and pass the transcript with `--doctor <file>` so this pack');
    add('carries the preflight result rather than a claim about it.');
  }
  add('');

  // -- Step 3 / Step 4: discovery and validation ----------------------------------------------
  add('## 2. Discovery and snapshot validation');
  add('');
  if (!summary.discovery) {
    add('**No discovery artifact exists.** Nothing below can be reviewed, and no service may be classified from');
    add('anything other than `BLOCKED`. Run `npm run whmcs:doctor`, then `npm run whmcs:discover`.');
    add('');
  } else {
    add('| Field | Value |');
    add('| --- | --- |');
    add(`| Captured at | ${summary.discovery.retrievedAt} |`);
    add(`| Installation fingerprint | \`${summary.discovery.baseUrlFingerprint}\` |`);
    add(`| Artifact sha256 | \`${summary.discovery.sha256}\` |`);
    add(`| WHMCS version | ${summary.discovery.whmcsVersion ?? '**not read** (`WHMCS_DISCOVERY_VERSION=1`)'} |`);
    add(`| Currencies | ${summary.discovery.currencies.join(', ') || '**none**'} (default ${summary.discovery.defaultCurrency ?? '**none**'}) |`);
    add(`| Product groups | ${summary.discovery.groups} |`);
    add(`| Products | ${summary.discovery.products} (${summary.discovery.hiddenProducts} hidden, ${summary.discovery.modulelessProducts} without a module, ${summary.discovery.unpricedProducts} unpriced) |`);
    add(`| Run warnings | ${summary.discovery.warnings.length === 0 ? 'none' : summary.discovery.warnings.length} |`);
    add('');
    if (summary.discovery.warnings.length > 0) {
      add('Warnings recorded by the run:');
      add('');
      for (const warning of summary.discovery.warnings) add(`- ${warning}`);
      add('');
    }
    add('Snapshot validation (`npm run whmcs:validate`):');
    add('');
    if (!summary.validation) {
      add('**Not run.** The artifact was not validated, so it is not yet evidence.');
    } else if (summary.validation.usable) {
      add(`**Usable** — no critical check failed; ${summary.validation.warnings.length} warning(s) for the reviewer.`);
    } else {
      add(`**NOT USABLE** — ${summary.validation.critical.length} critical check(s) failed. Nothing may be reviewed or`);
      add('bound from this artifact. Preserve the report, find the cause, re-run discovery:');
      for (const failure of summary.validation.critical) add(`- ${failure}`);
    }
    add('');
    add('Artifact integrity:');
    add('');
    if (summary.artifactIntegrity.reviewedSha256 === null) {
      add('The mapping review does not record the digest it was built from, so it cannot be tied to this snapshot.');
      add('Re-run `npm run whmcs:review` and `npm run whmcs:evidence` so the chain is complete.');
    } else if (summary.artifactIntegrity.consistent) {
      add(`Consistent — the review records \`${summary.artifactIntegrity.reviewedSha256}\`, which is the digest of the`);
      add('file on disk. The evidence below describes exactly these bytes.');
    } else {
      add(`**EVIDENCE INVALIDATED.** The review was built from \`${summary.artifactIntegrity.reviewedSha256}\` but the`);
      add(`artifact on disk is \`${summary.artifactIntegrity.currentSha256 ?? 'absent'}\`: the snapshot changed after the`);
      add('review. Nothing below may be treated as evidence until `npm run whmcs:review` is re-run against the current file.');
    }
    add('');
  }

  // -- Step 5: mapping review -----------------------------------------------------------------
  add('## 3. Mapping review');
  add('');
  add('| Classification | Services |');
  add('| --- | --- |');
  for (const [state, count] of Object.entries(summary.review.summary)) add(`| ${state} | ${count} |`);
  add('');
  add('`VERIFIED — READY FOR APPROVAL` means the row meets the discovery evidence requirements. It is **not**');
  add('production certification, and it authorises nothing until the owner approves it.');
  add('');
  if (summary.review.blockers.length > 0) {
    add('Blockers a reviewer must clear first:');
    add('');
    for (const blocker of summary.review.blockers) add(`- ${blocker}`);
    add('');
  }

  add('## 4. Products on the installation');
  add('');
  if (!summary.discovery || summary.products.length === 0) {
    add('**Nothing to list** — no captured catalogue, so there are no groups, pids, names, currencies, cycles or');
    add('modules to review. This section stays empty rather than being filled from anything other than an artifact.');
    add('');
  } else {
    add('');
    add('| Group | pid | Name | Visibility | Currencies | Prices | Provisioning module | Module verified | Configurable options |');
    add('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const product of summary.products) {
      const prices = Object.entries(product.prices)
        .map(([currency, cycles]) => `${currency}: ${Object.entries(cycles).map(([cycle, price]) => `${cycle} ${price}`).join(', ')}`)
        .join('; ');
      add(
        `| ${escapeCell(product.productGroup)} | ${product.productId} | ${escapeCell(product.name)} | ${product.visibility} | ` +
          `${product.currencies.join(', ') || '—'} | ${escapeCell(prices || '—')} | ${product.provisioningModule ?? '**none**'} | ` +
          `${product.provisioningModuleVerification} | ${product.configurableOptions} |`,
      );
    }
    add('');
    add('`Module verified: NOT VERIFIED` is not a formality. A product configured with a module is a product whose');
    add('*configuration* names a module; whether that module can reach a server, hold a licence and provision a');
    add('service was not exercised here, and may not be inferred from the product existing.');
    add('');
  }

  add('## 5. Service-to-product evidence');
  add('');
  add('| Service | Key | Page | State | pid | Group | Product | Cycles | Missing dependencies |');
  add('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const service of summary.services) {
    add(
      `| ${escapeCell(service.service)} | \`${service.serviceKey}\` | ${escapeCell(service.page)} | ${service.state} | ` +
        `${service.productId ?? '—'} | ${escapeCell(service.productGroup ?? '—')} | ${escapeCell(service.productName ?? '—')} | ` +
        `${service.cycles.join(', ') || '—'} | ${escapeCell(service.missing.join('; ') || '—')} |`,
    );
  }
  add('');

  add('## 6. What this pack does not verify');
  add('');
  for (const item of summary.notVerified) add(`- ${item}`);
  add('');
  add('## 7. Owner decision');
  add('');
  add('Binding stays a separate, reviewed command per service. Approving this pack authorises the bindings the owner');
  add('names explicitly — nothing else: no price in the SPA, no purchase button, no checkout, no payment, no');
  add('provisioning, no customer migration.');
  add('');
  add('| Decision | Owner | Date | Services approved |');
  add('| --- | --- | --- | --- |');
  add('| pending | — | — | — |');
  add('');
  return lines.join('\n');
}
