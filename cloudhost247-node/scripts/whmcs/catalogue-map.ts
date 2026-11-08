#!/usr/bin/env tsx
/**
 * WHMCS catalogue map — discovery and binding.
 *
 * This is the only supported way a WHMCS product id enters this codebase. It reads the catalogue
 * from the installation itself, writes a checksummed snapshot, and binds a website service key to a
 * product that exists in that snapshot. Nothing here guesses: `bind` refuses a product id that the
 * snapshot does not contain, and `verify` refuses a document whose checksum or provenance drifted.
 *
 * Usage (from the application root):
 *
 *   npm run whmcs:map -- doctor                    # read-only preflight: can this deployment read WHMCS?
 *   npm run whmcs:map -- discover                  # C1: catalogue JSON + review report, binds nothing
 *   npm run whmcs:map -- review                    # classify every advertised service (binds nothing)
 *   npm run whmcs:map -- verify
 *   npm run whmcs:map -- snapshot                  # read-only; needs WHMCS_BASE_URL + API credentials
 *   npm run whmcs:map -- bind --service hosting-vps --product 12
 *   npm run whmcs:map -- bind --service hosting-vps --product 12 --cycles monthly,annually
 *   npm run whmcs:map -- dispose --service hosting-plesk --reason "no Plesk product in WHMCS"
 *
 * `discover` writes config/whmcs/catalogue-snapshot.json and docs/WHMCS-DISCOVERY-REPORT.md
 * (override with --out and --report). It never binds: mapping a page to a product is a reviewed
 * `bind`, one service at a time.
 *
 * Exit codes: 0 success, 1 verification failure, 2 configuration/usage problem.
 *
 * `snapshot` is read-only in every mode: it calls GetProducts / GetProductGroups / GetCurrencies and
 * nothing else. It never creates, prices, orders or provisions anything.
 */

import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { loadWhmcsConfig } from '../../src/whmcs/config';
import { WhmcsClient, consoleLogger } from '../../src/whmcs/client';
import { buildCatalogue } from '../../src/whmcs/catalogue';
import {
  computeSnapshotChecksum,
  fingerprintBaseUrl,
  openProductMap,
  readProductMapFile,
  sealProductMap,
  type ProductMapDocument,
  type SnapshotProduct,
} from '../../src/whmcs/product-map';
import {
  getCurrenciesSchema,
  getProductGroupsSchema,
  getProductsSchema,
  toArray,
} from '../../src/whmcs/schemas';
import { BILLING_CYCLES, type BillingCycle } from '../../src/whmcs/types';
import { collectDiscovery, renderDiscoveryReport, type DiscoveryArtifact } from '../../src/whmcs/discovery';
import { readServiceRegister } from '../../src/whmcs/service-register';
import { buildMappingReview, renderMappingReview, type MappingProposal } from '../../src/whmcs/mapping-review';
import { validateDiscoveryArtifact } from '../../src/whmcs/discovery-validation';
import { renderEvidencePack, buildEvidenceSummary, type EvidenceEnvironment } from '../../src/whmcs/evidence-pack';
import {
  assessReadiness,
  probeTooling,
  readinessRouteTarget,
  renderReadinessReport,
  type RouteProbe,
} from '../../src/whmcs/readiness';

const DEFAULT_MAP_PATH = path.join(process.cwd(), 'config', 'whmcs', 'product-map.json');
const DEFAULT_REGISTER_PATH = path.resolve(process.cwd(), '..', 'config', 'whmcs', 'service-register.csv');
const DEFAULT_DISCOVERY_PATH = path.join(process.cwd(), 'config', 'whmcs', 'catalogue-snapshot.json');
const DEFAULT_REPORT_PATH = path.resolve(process.cwd(), '..', 'docs', 'WHMCS-DISCOVERY-REPORT.md');
const DEFAULT_REVIEW_PATH = path.resolve(process.cwd(), '..', 'docs', 'WHMCS-MAPPING-REVIEW.md');
const DEFAULT_REVIEW_JSON_PATH = path.join(process.cwd(), 'config', 'whmcs', 'mapping-review.json');
const DEFAULT_PROPOSAL_PATH = path.join(process.cwd(), 'config', 'whmcs', 'mapping-proposal.json');
const DEFAULT_PACK_PATH = path.resolve(process.cwd(), '..', 'docs', 'WHMCS-APPROVAL-PACK.md');
const DEFAULT_PACK_JSON_PATH = path.join(process.cwd(), 'config', 'whmcs', 'approval-pack.json');

interface Args {
  command: string;
  service?: string;
  product?: string;
  cycles?: string;
  reason?: string;
  mapPath: string;
  registerPath: string;
  discoveryPath: string;
  reportPath: string;
  reviewPath: string;
  reviewJsonPath: string;
  proposalPath: string;
  doctorPath?: string;
}

function parseArgs(argv: string[]): Args {
  const [command = 'help', ...rest] = argv;
  const out: Args = {
    command,
    mapPath: DEFAULT_MAP_PATH,
    registerPath: DEFAULT_REGISTER_PATH,
    discoveryPath: DEFAULT_DISCOVERY_PATH,
    reportPath: DEFAULT_REPORT_PATH,
    reviewPath: DEFAULT_REVIEW_PATH,
    reviewJsonPath: DEFAULT_REVIEW_JSON_PATH,
    proposalPath: DEFAULT_PROPOSAL_PATH,
  };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    const value = rest[i + 1];
    switch (token) {
      case '--service':
        out.service = value;
        i += 1;
        break;
      case '--product':
        out.product = value;
        i += 1;
        break;
      case '--cycles':
        out.cycles = value;
        i += 1;
        break;
      case '--reason':
        out.reason = value;
        i += 1;
        break;
      case '--map':
        out.mapPath = path.resolve(value ?? DEFAULT_MAP_PATH);
        i += 1;
        break;
      case '--out':
        out.discoveryPath = path.resolve(value ?? out.discoveryPath);
        i += 1;
        break;
      case '--json':
        out.reviewJsonPath = path.resolve(value ?? out.reviewJsonPath);
        i += 1;
        break;
      case '--proposal':
        out.proposalPath = path.resolve(value ?? out.proposalPath);
        i += 1;
        break;
      case '--report':
        out.reportPath = path.resolve(value ?? out.reportPath);
        i += 1;
        break;
      case '--doctor':
        out.doctorPath = path.resolve(value ?? 'whmcs-doctor.txt');
        i += 1;
        break;
      case '--register':
        out.registerPath = path.resolve(value ?? DEFAULT_REGISTER_PATH);
        i += 1;
        break;
      default:
        break;
    }
  }
  return out;
}

function fail(message: string, code = 1): never {
  console.error(`✗ ${message}`);
  process.exit(code);
}

function readDocument(mapPath: string): ProductMapDocument {
  if (!existsSync(mapPath)) fail(`no product map at ${mapPath} (run "snapshot" first)`, 2);
  try {
    return readProductMapFile(mapPath);
  } catch (error) {
    fail((error as Error).message);
  }
}

function writeDocument(mapPath: string, document: ProductMapDocument): void {
  mkdirSync(path.dirname(mapPath), { recursive: true });
  writeFileSync(mapPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

/** Empty document for a fresh install: no products, no bindings, and nothing claimed. */
function emptyDocument(baseUrlFingerprint: string): ProductMapDocument {
  return sealProductMap({
    version: 1,
    source: 'whmcs-getproducts',
    baseUrlFingerprint,
    whmcsVersion: null,
    retrievedAt: new Date().toISOString(),
    services: {},
    unmapped: {},
    products: [],
  });
}

async function snapshot(args: Args): Promise<void> {
  const loaded = loadWhmcsConfig();
  if (!loaded.enabled) fail(`${loaded.reason}. Set WHMCS_BASE_URL, WHMCS_API_IDENTIFIER and WHMCS_API_SECRET.`, 2);

  const client = new WhmcsClient({ config: loaded.config, logger: consoleLogger });
  console.log(`Reading the catalogue from ${loaded.config.baseUrl} (read-only) …`);

  const [groupsPayload, productsPayload, currenciesPayload] = await Promise.all([
    client.call('GetProductGroups', {}, getProductGroupsSchema),
    client.call('GetProducts', {}, getProductsSchema),
    client.call('GetCurrencies', {}, getCurrenciesSchema),
  ]);

  const rawGroups = toArray(groupsPayload.productgroups as unknown[] | Record<string, unknown> | undefined);
  const rawProducts = toArray(productsPayload.products as unknown[] | Record<string, unknown> | undefined);
  const currencies = toArray(currenciesPayload.currencies as unknown[] | Record<string, unknown> | undefined)
    .map((row) => String((row as { code?: unknown }).code ?? ''))
    .filter((code) => code.length > 0);

  const primaryCurrency =
    currencies.find((code) => {
      const match = toArray(currenciesPayload.currencies as unknown[] | Record<string, unknown> | undefined).find(
        (row) => String((row as { code?: unknown }).code ?? '') === code,
      ) as { default?: unknown } | undefined;
      return match ? String(match.default) === '1' : false;
    }) ?? currencies[0] ?? 'USD';

  // Normalise once with no currency filter so the snapshot keeps every currency WHMCS reported.
  const catalogue = buildCatalogue(rawGroups, rawProducts, { currency: primaryCurrency });

  const products: SnapshotProduct[] = catalogue.products.map((product) => ({
    id: product.id,
    groupId: product.groupId,
    name: product.name,
    module: product.module,
    payType: product.payType,
    hidden: product.hidden,
    currencies: Object.keys(product.currencies),
    cycles: Object.fromEntries(
      Object.entries(product.currencies).map(([code, pricing]) => [
        code,
        BILLING_CYCLES.filter((cycle) => pricing.cycles[cycle] !== undefined),
      ]),
    ),
  }));

  const existing = existsSync(args.mapPath) ? readDocument(args.mapPath) : null;
  const previousFingerprint = existing?.baseUrlFingerprint ?? null;
  const fingerprint = fingerprintBaseUrl(loaded.config.baseUrl);
  if (previousFingerprint && previousFingerprint !== fingerprint) {
    fail(
      'the existing map was generated against a different WHMCS installation. Move it aside deliberately before snapshotting another install.',
      1,
    );
  }

  const body = {
    version: 1 as const,
    source: 'whmcs-getproducts' as const,
    baseUrlFingerprint: fingerprint,
    whmcsVersion: null,
    retrievedAt: new Date().toISOString(),
    products,
    // Bindings and dispositions survive a re-snapshot; they are re-validated on load and `verify`
    // reports any that no longer match the catalogue.
    services: existing?.services ?? {},
    unmapped: existing?.unmapped ?? {},
  };
  const sealed = sealProductMap(body);
  writeDocument(args.mapPath, sealed);

  console.log(`✓ snapshot written to ${args.mapPath}`);
  console.log(`  groups: ${catalogue.groups.length} · products: products ${products.length} · currencies: ${currencies.join(', ') || 'none reported'}`);
  console.log(`  snapshot checksum: ${sealed.snapshotChecksum}`);
  console.log(`  bindings kept: ${Object.keys(sealed.services).length}`);
  console.log('  next: bind each advertised service, e.g. npm run whmcs:map -- bind --service hosting-vps --product 12');
}

function bind(args: Args): void {
  if (!args.service || !args.product) fail('bind needs --service <key> --product <pid>', 2);
  const productId = Number(args.product);
  if (!Number.isInteger(productId) || productId <= 0) fail('--product must be a positive integer product id', 2);

  const document = readDocument(args.mapPath);
  const product = document.products.find((row) => row.id === productId);
  if (!product) {
    fail(
      `product ${productId} is not in the snapshot. Re-run "snapshot" against the installation that sells it, or check the id.`,
    );
  }

  const availableCycles = new Set<BillingCycle>(
    product.cycles[product.currencies[0] ?? ''] ?? [],
  );
  let cycles: BillingCycle[] = [...availableCycles];
  if (args.cycles) {
    const requested = args.cycles.split(',').map((value) => value.trim()).filter(Boolean) as BillingCycle[];
    const invalid = requested.filter((cycle) => !BILLING_CYCLES.includes(cycle));
    if (invalid.length > 0) fail(`unknown billing cycle(s): ${invalid.join(', ')}`, 2);
    const notOffered = requested.filter((cycle) => !availableCycles.has(cycle));
    if (notOffered.length > 0) {
      fail(`product ${productId} does not offer: ${notOffered.join(', ')} (offered: ${[...availableCycles].join(', ') || 'none'})`);
    }
    cycles = requested;
  }
  if (cycles.length === 0) {
    fail(`product ${productId} has no configured billing cycle; configure pricing in WHMCS first`);
  }
  if (product.hidden) {
    console.warn(`! product ${productId} is hidden in WHMCS; binding it will not make it visible in cart.php`);
  }

  const next = sealProductMap({
    version: document.version,
    source: document.source,
    baseUrlFingerprint: document.baseUrlFingerprint,
    whmcsVersion: document.whmcsVersion,
    retrievedAt: document.retrievedAt,
    products: document.products,
    services: {
      ...document.services,
      [args.service]: {
        productId,
        productGroupId: product.groupId,
        billingCycles: cycles,
        provisioningModule: product.module,
        boundAt: new Date().toISOString(),
        boundFrom: document.snapshotChecksum,
      },
    },
    unmapped: Object.fromEntries(Object.entries(document.unmapped).filter(([key]) => key !== args.service)),
  });
  openProductMap(next); // fail before writing, never after
  writeDocument(args.mapPath, next);

  console.log(`✓ bound "${args.service}" → product ${productId} (group ${product.groupId}, module ${product.module ?? 'none'})`);
  console.log(`  cycles: ${cycles.join(', ')}`);
}

function dispose(args: Args): void {
  if (!args.service || !args.reason) fail('dispose needs --service <key> --reason "<why it is not orderable>"', 2);
  const document = readDocument(args.mapPath);
  const next = sealProductMap({
    version: document.version,
    source: document.source,
    baseUrlFingerprint: document.baseUrlFingerprint,
    whmcsVersion: document.whmcsVersion,
    retrievedAt: document.retrievedAt,
    products: document.products,
    services: Object.fromEntries(Object.entries(document.services).filter(([key]) => key !== args.service)),
    unmapped: {
      ...document.unmapped,
      [args.service]: { reason: args.reason, since: new Date().toISOString() },
    },
  });
  openProductMap(next);
  writeDocument(args.mapPath, next);
  console.log(`✓ "${args.service}" marked not orderable: ${args.reason}`);
}

/** Minimal RFC 4180 reader: the register quotes fields that contain commas. */
/**
 * Seeds a disposition for every advertised service that has none.
 *
 * A disposition is not a binding: it records *why* a service is not orderable, so "no price, no buy
 * button" is a documented decision rather than an omission, and the completeness test can require
 * one for every service the site advertises.
 */
function seedDispositions(args: Args): void {
  if (!existsSync(args.registerPath)) fail(`no service register at ${args.registerPath}`, 2);
  const rows = readServiceRegister(args.registerPath);
  if (rows.length === 0) fail('the service register is empty', 2);

  const document = existsSync(args.mapPath) ? readDocument(args.mapPath) : emptyDocument(fingerprintBaseUrl('unconfigured'));
  // The register is derived from the website itself, so it is authoritative for which services need
  // a disposition: an entry for a service that no longer exists is pruned rather than left to rot.
  const advertised = new Set(rows.map((row) => row.serviceKey).filter(Boolean));
  const unmapped: Record<string, { reason: string; since: string }> = {};
  let pruned = 0;
  for (const [key, entry] of Object.entries(document.unmapped)) {
    if (advertised.has(key)) unmapped[key] = entry;
    else pruned += 1;
  }
  let added = 0;
  for (const row of rows) {
    const serviceKey = row.serviceKey;
    if (!serviceKey || document.services[serviceKey] || unmapped[serviceKey]) continue;
    const reason =
      row.category === 'domains'
        ? 'No domain registrar is configured in WHMCS; ordering stays disabled until one is and availability is verified.'
        : 'Not bound: no WHMCS discovery run has been performed on this deployment (WHMCS_BASE_URL and API credentials unset).';
    unmapped[serviceKey] = { reason, since: new Date().toISOString() };
    added += 1;
  }

  const next = sealProductMap({
    version: document.version,
    source: document.source,
    baseUrlFingerprint: document.baseUrlFingerprint,
    whmcsVersion: document.whmcsVersion,
    retrievedAt: document.retrievedAt,
    products: document.products,
    services: document.services,
    unmapped,
  });
  openProductMap(next);
  writeDocument(args.mapPath, next);
  console.log(
    `✓ dispositions: ${added} added, ${pruned} pruned, ${Object.keys(unmapped).length} not orderable, ${Object.keys(document.services).length} bound`,
  );
}

function verify(args: Args): void {
  let document: ProductMapDocument;
  try {
    document = readProductMapFile(args.mapPath);
  } catch (error) {
    fail((error as Error).message);
  }
  const bindings = Object.entries(document.services);
  console.log(`✓ map is valid · ${args.mapPath}`);
  console.log(`  snapshot: ${document.retrievedAt} · ${document.products.length} products · checksum ${document.snapshotChecksum.slice(0, 12)}…`);
  console.log(`  bound services: ${bindings.length}`);
  for (const [serviceKey, binding] of bindings) {
    const product = document.products.find((row) => row.id === binding.productId);
    console.log(
      `    ${serviceKey} → pid ${binding.productId} · gid ${binding.productGroupId} · ${product?.module ?? 'no module'} · ${binding.billingCycles.join('/')}`,
    );
  }
  const unmapped = Object.entries(document.unmapped);
  if (unmapped.length > 0) {
    console.log(`  not orderable: ${unmapped.length}`);
    for (const [serviceKey, entry] of unmapped) console.log(`    ${serviceKey}: ${entry.reason}`);
  }
}

/**
 * C1 — read the installation and write the two review artifacts.
 *
 * Read-only: `collectDiscovery` issues `GetProductGroups`, `GetProducts` and `GetCurrencies` only.
 * It writes a JSON snapshot and a Markdown report and binds nothing — mapping a service to a product
 * stays a separate, reviewed `bind` command.
 */
async function discover(args: Args): Promise<void> {
  const loaded = loadWhmcsConfig();
  if (!loaded.enabled) fail(`${loaded.reason}. Set WHMCS_BASE_URL, WHMCS_API_IDENTIFIER and WHMCS_API_SECRET.`, 2);

  const client = new WhmcsClient({ config: loaded.config, logger: consoleLogger });
  console.log(`Discovering the catalogue at ${loaded.config.baseUrl} (read-only, no writes to WHMCS) …`);

  const artifact = await collectDiscovery(client, {
    baseUrl: loaded.config.baseUrl,
    includeVersion: process.env.WHMCS_DISCOVERY_VERSION === '1',
  });

  mkdirSync(path.dirname(args.discoveryPath), { recursive: true });
  writeFileSync(args.discoveryPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

  mkdirSync(path.dirname(args.reportPath), { recursive: true });
  writeFileSync(args.reportPath, renderDiscoveryReport(artifact), 'utf8');

  const priced = artifact.products.filter((product) => product.available).length;
  console.log(`✓ ${artifact.groups.length} group(s), ${artifact.products.length} product(s), ${priced} priced`);
  console.log(`✓ ${args.discoveryPath}`);
  console.log(`✓ ${args.reportPath}`);
  if (artifact.warnings.length > 0) {
    console.log(`! ${artifact.warnings.length} warning(s) — read them before approving any mapping:`);
    for (const warning of artifact.warnings) console.log(`    ${warning}`);
  }
  console.log('  nothing was bound. Review the report, then bind service by service with "bind".');
}

/**
 * Preflight for C1: what the deployment can and cannot verify from here.
 *
 * Every line is either measured or marked as NOT VERIFIABLE. Nothing is asserted that was not read,
 * because a false "connected" is worse than an honest "cannot tell".
 */
async function doctor(): Promise<void> {
  const loaded = loadWhmcsConfig();
  if (!loaded.enabled) {
    console.log(`✗ configuration: ${loaded.reason}`);
    console.log('  Set WHMCS_BASE_URL, WHMCS_API_IDENTIFIER and WHMCS_API_SECRET, then run this again.');
    process.exit(2);
  }

  const { baseUrl, mode, apiUrl } = loaded.config;
  console.log('WHMCS preflight (read-only)');
  console.log(`  base URL      ${baseUrl}`);
  console.log(`  API endpoint  ${apiUrl}`);
  console.log(`  mode          ${mode}${mode === 'read-only' ? ' (writes refused)' : ' (WRITES ENABLED)'}`);
  console.log(`  MFA for SSO   ${loaded.config.ssoRequireMfa ? 'required (default)' : 'NOT REQUIRED — explicit downgrade'}`);

  const client = new WhmcsClient({ config: loaded.config, logger: silence() });
  const checks: Array<{ label: string; run: () => Promise<string> }> = [
    {
      label: 'currencies',
      run: async () => {
        const payload = await client.call('GetCurrencies', {}, getCurrenciesSchema);
        const rows = toArray(payload.currencies as unknown[] | Record<string, unknown> | undefined);
        const codes = rows.map((row) => String((row as { code?: unknown }).code ?? '')).filter(Boolean);
        return codes.length === 0 ? 'FAILED — no currencies configured' : `${codes.length}: ${codes.join(', ')}`;
      },
    },
    {
      label: 'product groups',
      run: async () => {
        const payload = await client.call('GetProductGroups', {}, getProductGroupsSchema);
        const rows = toArray(payload.productgroups as unknown[] | Record<string, unknown> | undefined);
        return `${rows.length}`;
      },
    },
    {
      label: 'products',
      run: async () => {
        const payload = await client.call('GetProducts', {}, getProductsSchema);
        const rows = toArray(payload.products as unknown[] | Record<string, unknown> | undefined);
        return rows.length === 0 ? 'FAILED — no products visible to this API role' : `${rows.length}`;
      },
    },
  ];

  let failed = false;
  for (const check of checks) {
    try {
      console.log(`  ${check.label.padEnd(13)} ${await check.run()}`);
    } catch (error) {
      failed = true;
      console.log(`  ${check.label.padEnd(13)} FAILED — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Honest limits of a read-only preflight.
  console.log('  SSO origin    NOT VERIFIABLE read-only. The SSO redirect must be on the origin above; if the');
  console.log('                install\'s System URL differs (e.g. www vs apex), the hand-off is refused. Confirm');
  console.log('                Setup > General Settings > System URL matches exactly before enabling SSO.');
  console.log('  client 2FA    NOT VERIFIABLE over the API. SSO redemption bypasses WHMCS 2FA by design, which is');
  console.log('                why CloudHost247 requires MFA on its own account before minting a hand-off.');
  console.log('  registrar     NOT CHECKED here — domain providers are verified in their own phase.');

  if (failed) {
    console.log('✗ preflight failed: the deployment cannot read the catalogue with these credentials.');
    process.exit(1);
  }
  console.log('✓ preflight passed: read-only catalogue access works.');
  console.log('  next: npm run whmcs:discover');
}

/** A logger that writes nothing — preflight output is the report, not HTTP noise. */
function silence() {
  return { info: () => undefined, warn: () => undefined, error: () => undefined };
}

/**
 * The product mapping review: every advertised service, classified, with evidence.
 *
 * Reads (never writes) three inputs: the service register (what the site advertises), the discovery
 * artifact (what WHMCS actually sells, if C1 has run) and an optional human proposal. Writes a
 * Markdown review and a JSON copy for diffing. It binds nothing — a VERIFIED row is a recommendation
 * that still needs a reviewed `bind`.
 */
function validate(args: Args): void {
  if (!existsSync(args.discoveryPath)) {
    fail(
      `no discovery artifact at ${path.relative(process.cwd(), args.discoveryPath)} — run \`npm run whmcs:discover\` first`,
      2,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(args.discoveryPath, 'utf8'));
  } catch {
    fail(`${path.relative(process.cwd(), args.discoveryPath)} is not valid JSON`, 2);
  }

  const result = validateDiscoveryArtifact(parsed);
  for (const check of result.checks) {
    const mark = check.ok ? '✓' : check.critical ? '✗' : '!';
    const type = check.critical ? 'critical' : 'warning ';
    console.log(`  ${mark} ${type} ${check.id.padEnd(28)} ${check.detail}`);
  }
  console.log('');
  if (!result.usable) {
    console.log(`✗ the artifact is not usable: ${result.critical.length} critical check(s) failed.`);
    console.log('  Do not review or bind from it. Re-run `npm run whmcs:discover` and investigate the failures.');
    process.exit(1);
  }
  console.log(`✓ the artifact is usable — ${result.warnings.length} warning(s) for the reviewer, nothing was bound.`);
}

function review(args: Args): void {
  if (!existsSync(args.registerPath)) fail(`no service register at ${args.registerPath}`, 2);
  const services = readServiceRegister(args.registerPath);
  if (services.length === 0) fail('the service register is empty', 2);

  const document = existsSync(args.mapPath) ? readDocument(args.mapPath) : emptyDocument(fingerprintBaseUrl('unconfigured'));

  let discovery: DiscoveryArtifact | null = null;
  let discoverySource: string | null = null;
  let artifactSha256: string | null = null;
  if (existsSync(args.discoveryPath)) {
    const bytes = readFileSync(args.discoveryPath);
    discovery = JSON.parse(bytes.toString('utf8')) as DiscoveryArtifact;
    artifactSha256 = createHash('sha256').update(bytes).digest('hex');
    discoverySource = path.relative(process.cwd(), args.discoveryPath);
  }

  let proposal: MappingProposal | null = null;
  let proposalSource: string | null = null;
  if (existsSync(args.proposalPath)) {
    const parsed = JSON.parse(readFileSync(args.proposalPath, 'utf8')) as MappingProposal;
    if (!Array.isArray(parsed.entries)) fail(`${args.proposalPath} must contain an "entries" array`, 2);
    for (const entry of parsed.entries) {
      if (!entry.serviceKey || !Number.isInteger(entry.productId) || entry.productId <= 0) {
        fail(`${args.proposalPath}: every entry needs a serviceKey and a positive integer productId`, 2);
      }
    }
    proposal = parsed;
    proposalSource = path.relative(process.cwd(), args.proposalPath);
  }

  const result = buildMappingReview({ services, discovery, proposal, map: document, artifactSha256 });

  mkdirSync(path.dirname(args.reviewPath), { recursive: true });
  writeFileSync(
    args.reviewPath,
    renderMappingReview(result, {
      sources: {
        discovery: discoverySource,
        proposal: proposalSource,
        map: path.relative(process.cwd(), args.mapPath),
        register: path.relative(process.cwd(), args.registerPath),
      },
    }),
    'utf8',
  );
  mkdirSync(path.dirname(args.reviewJsonPath), { recursive: true });
  writeFileSync(args.reviewJsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  console.log(`Service mapping review — ${services.length} advertised service(s)`);
  for (const [state, count] of Object.entries(result.summary)) {
    console.log(`  ${state.padEnd(30)} ${count}`);
  }
  console.log(`✓ ${args.reviewPath}`);
  console.log(`✓ ${args.reviewJsonPath}`);
  if (!result.discovered) {
    console.log('  ! no discovery artifact: every service is BLOCKED until C1 runs against staging.');
  }
  if (proposalSource === null) {
    console.log('  ! no proposal file: nothing is proposed, so nothing is recommended for binding.');
  }
  console.log('  nothing was bound. Approve rows first, then bind one service at a time.');
}

/**
 * C1.7 step 6: assemble the approval pack from what is actually on disk.
 *
 * Reads the map, the discovery artifact (and its sha256), the validation, the review and the optional proposal;
 * writes one Markdown pack plus a JSON copy. It never runs discovery itself and never binds — the pack is a
 * *reading* of evidence that already exists, which is why it is safe to regenerate at any time.
 */
function evidence(args: Args): void {
  if (!existsSync(args.registerPath)) fail(`no service register at ${args.registerPath}`, 2);
  const services = readServiceRegister(args.registerPath);
  const document = existsSync(args.mapPath) ? readDocument(args.mapPath) : emptyDocument(fingerprintBaseUrl('unconfigured'));

  let discovery: DiscoveryArtifact | null = null;
  let discoverySha: string | null = null;
  let discoverySource: string | null = null;
  if (existsSync(args.discoveryPath)) {
    const bytes = readFileSync(args.discoveryPath);
    discovery = JSON.parse(bytes.toString('utf8')) as DiscoveryArtifact;
    discoverySha = createHash('sha256').update(bytes).digest('hex');
    discoverySource = path.relative(process.cwd(), args.discoveryPath);
  }

  // The environment is read through the same loader the application uses, so the pack cannot claim a
  // configuration the server would refuse.
  const environment: EvidenceEnvironment = {
    baseUrlHost: null,
    baseUrlFingerprint: null,
    mode: null,
    mfaRequired: null,
    credentialsPresent: Boolean(process.env.WHMCS_API_IDENTIFIER && process.env.WHMCS_API_SECRET),
  };
  const loaded = loadWhmcsConfig();
  if (loaded.enabled) {
    environment.baseUrlHost = new URL(loaded.config.baseUrl).host;
    environment.baseUrlFingerprint = fingerprintBaseUrl(loaded.config.baseUrl);
    environment.mode = loaded.config.mode;
    environment.mfaRequired = loaded.config.ssoRequireMfa;
  }

  let proposal: MappingProposal | null = null;
  if (existsSync(args.proposalPath)) {
    const parsed = JSON.parse(readFileSync(args.proposalPath, 'utf8')) as MappingProposal;
    proposal = Array.isArray(parsed.entries) ? parsed : null;
  }

  const validation = discovery ? validateDiscoveryArtifact(discovery) : null;

  // Prefer the review that is *on disk*: that is the document the owner read. Rebuilding it here would silently
  // repair any drift between the artifact and the evidence, which is the exact failure the digest chain exists to
  // detect. Rebuilding is only a fallback for the first run, and it says so.
  let review: ReturnType<typeof buildMappingReview> | null = null;
  if (existsSync(args.reviewJsonPath)) {
    try {
      const parsed = JSON.parse(readFileSync(args.reviewJsonPath, 'utf8')) as ReturnType<typeof buildMappingReview>;
      if (Array.isArray(parsed.rows) && parsed.summary) review = parsed;
    } catch {
      review = null;
    }
  }
  const reviewSource = review ? 'config/whmcs/mapping-review.json (as reviewed)' : 'rebuilt from the current artifact';
  if (!review) {
    review = buildMappingReview({ services, discovery, proposal, map: document, artifactSha256: discoverySha });
  }

  const doctorOutput = args.doctorPath && existsSync(args.doctorPath) ? readFileSync(args.doctorPath, 'utf8') : null;
  const secrets = [process.env.WHMCS_API_SECRET, process.env.WHMCS_API_IDENTIFIER].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );

  const input = {
    now: new Date().toISOString(),
    environment,
    discovery: discovery && discoverySha && discoverySource
      ? { artifact: discovery, sha256: discoverySha, source: discoverySource }
      : null,
    validation,
    review,
    map: document,
    proposal,
    doctorOutput,
    secrets,
  };

  mkdirSync(path.dirname(DEFAULT_PACK_PATH), { recursive: true });
  writeFileSync(DEFAULT_PACK_PATH, renderEvidencePack(input), 'utf8');
  mkdirSync(path.dirname(DEFAULT_PACK_JSON_PATH), { recursive: true });
  writeFileSync(DEFAULT_PACK_JSON_PATH, `${JSON.stringify(buildEvidenceSummary(input), null, 2)}\n`, 'utf8');

  console.log('Approval pack — C1.7 evidence review');
  console.log(`  review               ${reviewSource}`);
  console.log(`  discovery artifact   ${discoverySha ? discoverySha.slice(0, 12) + '…' : 'none captured'}`);
  const validationLabel = !validation
    ? 'not run'
    : validation.usable
      ? 'usable'
      : `NOT USABLE (${validation.critical.length} critical)`;
  console.log(`  snapshot validation  ${validationLabel}`);
  console.log(`  bindings             ${Object.keys(document.services).length}`);
  console.log(`  services             ${services.length} (${review.summary['VERIFIED — READY FOR APPROVAL']} verified, ${review.summary['BLOCKED']} blocked)`);
  console.log(`✓ ${path.relative(process.cwd(), DEFAULT_PACK_PATH)}`);
  console.log(`✓ ${path.relative(process.cwd(), DEFAULT_PACK_JSON_PATH)}`);
  console.log('  nothing was bound. The pack recommends; the owner approves; bind stays a separate step.');
}

/**
 * C1.8 staging access readiness.
 *
 * Answers "what would stop a discovery run right now?" without sending a single authenticated request: the only
 * network activity is an unauthenticated TCP connect, which proves a route exists and carries nothing.
 */
async function readiness(): Promise<void> {
  const env = process.env;
  const credentialsInEnv = Boolean((env.WHMCS_API_IDENTIFIER ?? '').trim() && (env.WHMCS_API_SECRET ?? '').trim());

  // Which channel supplied the credential — key presence only, never values.
  let channel: 'environment' | 'dotenv-file' | 'none' = 'none';
  if (credentialsInEnv) channel = 'environment';
  if (existsSync(path.join(process.cwd(), '.env'))) {
    const dotenvText = readFileSync(path.join(process.cwd(), '.env'), 'utf8');
    if (/^\s*WHMCS_API_SECRET\s*=/m.test(dotenvText)) channel = 'dotenv-file';
  }

  // Never throws: an invalid configuration is one of the states this command reports, not a crash.
  const target = readinessRouteTarget(env);
  const route: RouteProbe = target
    ? await probeRoute(target)
    : { state: 'skipped', reason: 'no valid install URL, so there is nothing to probe' };

  const report = assessReadiness({
    env,
    secretsChannel: channel,
    route,
    tooling: probeTooling({
      registerPath: path.resolve(process.cwd(), '..', 'config', 'whmcs', 'service-register.csv'),
      mapPath: DEFAULT_MAP_PATH,
    }),
  });

  console.log('WHMCS staging access readiness (read-only, no authenticated requests)');
  console.log(renderReadinessReport(report));
  console.log('');
  console.log(
    `  ${report.checks.filter((check) => check.state === 'READY').length}/${report.checks.length} check(s) ready` +
      (report.summary['NOT CHECKED'] > 0 ? `, ${report.summary['NOT CHECKED']} not checkable here` : ''),
  );
  console.log('  no credential value, base URL path or API response is printed by this command');
  if (!report.ready) {
    console.log('');
    for (const blocker of report.blockers) console.log(`  ! ${blocker}`);
    console.log('');
    console.log('✗ not ready for staging discovery — see docs/WHMCS-STAGING-ACCESS-HANDOFF.md');
    process.exit(1);
  }
  console.log('');
  console.log('✓ ready: run `npm run whmcs:doctor`, then `npm run whmcs:discover` (runbook §1).');
}

/** Unauthenticated TCP connect. No TLS handshake, no HTTP request, no credential. */
function probeRoute(target: { host: string; port: number }): Promise<RouteProbe> {
  return new Promise((resolve) => {
    const { host, port } = target;
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = (result: RouteProbe) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ state: 'unreachable', host, port, reason: 'timed out after 5000 ms' }), 5000);
    socket.once('connect', () => {
      clearTimeout(timer);
      finish({ state: 'ok', host, port });
    });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      finish({ state: 'unreachable', host, port, reason: error.code ?? error.message });
    });
  });
}

const USAGE = `WHMCS catalogue map — discovery and binding.

  npm run whmcs:map -- readiness     what would stop a discovery run here (no authenticated requests)
  npm run whmcs:map -- doctor        read-only preflight against the installation (writes nothing)
  npm run whmcs:map -- discover      C1: catalogue JSON + discovery report (writes nothing else)
  npm run whmcs:map -- validate      validate a captured catalogue snapshot (exit 1 if unusable)
  npm run whmcs:map -- review        classify every advertised service (binds nothing)
  npm run whmcs:map -- evidence      C1.7 approval pack from the artifacts on disk
  npm run whmcs:map -- snapshot      checksummed product-map snapshot from GetProducts
  npm run whmcs:map -- verify        re-check map checksums, provenance and integrity
  npm run whmcs:map -- bind --service <key> --product <pid> [--cycles monthly,annually]
  npm run whmcs:map -- dispose --service <key> --reason "<why it is not orderable>"
  npm run whmcs:map -- dispositions  seed a reason for every unbound advertised service
  npm run whmcs:map -- init --map <path>  create an empty checksummed map

Flags: --map, --register, --out, --report, --json, --proposal.
Exit codes: 0 success, 1 verification failure, 2 configuration/usage problem.`;

function help(): void {
  console.log(USAGE);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case 'snapshot':
      await snapshot(args);
      break;
    case 'bind':
      bind(args);
      break;
    case 'dispose':
      dispose(args);
      break;
    case 'dispositions':
      seedDispositions(args);
      break;
    case 'verify':
      verify(args);
      break;
    case 'discover':
      await discover(args);
      break;
    case 'readiness':
      await readiness();
      break;
    case 'doctor':
      await doctor();
      break;
    case 'validate':
      validate(args);
      break;
    case 'evidence':
      evidence(args);
      break;
    case 'review':
      review(args);
      break;
    case 'init': {
      const loaded = loadWhmcsConfig();
      const fingerprint = loaded.enabled ? fingerprintBaseUrl(loaded.config.baseUrl) : fingerprintBaseUrl('unconfigured');
      const document = existsSync(args.mapPath) ? readDocument(args.mapPath) : emptyDocument(fingerprint);
      writeDocument(args.mapPath, document);
      console.log(`✓ ${args.mapPath} (${Object.keys(document.services).length} bindings, ${document.products.length} products)`);
      console.log(`  checksum ${computeSnapshotChecksum(document).slice(0, 12)}…`);
      break;
    }
    default:
      help();
      break;
  }
}

main().catch((error: unknown) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
