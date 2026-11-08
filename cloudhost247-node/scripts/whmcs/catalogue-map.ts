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
import { collectDiscovery, renderDiscoveryReport } from '../../src/whmcs/discovery';

const DEFAULT_MAP_PATH = path.join(process.cwd(), 'config', 'whmcs', 'product-map.json');
const DEFAULT_REGISTER_PATH = path.resolve(process.cwd(), '..', 'config', 'whmcs', 'service-register.csv');
const DEFAULT_DISCOVERY_PATH = path.join(process.cwd(), 'config', 'whmcs', 'catalogue-snapshot.json');
const DEFAULT_REPORT_PATH = path.resolve(process.cwd(), '..', 'docs', 'WHMCS-DISCOVERY-REPORT.md');

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
}

function parseArgs(argv: string[]): Args {
  const [command = 'help', ...rest] = argv;
  const out: Args = {
    command,
    mapPath: DEFAULT_MAP_PATH,
    registerPath: DEFAULT_REGISTER_PATH,
    discoveryPath: DEFAULT_DISCOVERY_PATH,
    reportPath: DEFAULT_REPORT_PATH,
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
        args.discoveryPath = value();
        break;
      case '--report':
        args.reportPath = value();
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
function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((key) => key.trim());
  return body
    .filter((cells) => cells.some((cell) => cell.trim() !== ''))
    .map((cells) => Object.fromEntries(keys.map((key, index) => [key, (cells[index] ?? '').trim()])));
}

/**
 * Seeds a disposition for every advertised service that has none.
 *
 * A disposition is not a binding: it records *why* a service is not orderable, so "no price, no buy
 * button" is a documented decision rather than an omission, and the completeness test can require
 * one for every service the site advertises.
 */
function seedDispositions(args: Args): void {
  if (!existsSync(args.registerPath)) fail(`no service register at ${args.registerPath}`, 2);
  const rows = parseCsv(readFileSync(args.registerPath, 'utf8'));
  if (rows.length === 0) fail('the service register is empty', 2);

  const document = existsSync(args.mapPath) ? readDocument(args.mapPath) : emptyDocument(fingerprintBaseUrl('unconfigured'));
  // The register is derived from the website itself, so it is authoritative for which services need
  // a disposition: an entry for a service that no longer exists is pruned rather than left to rot.
  const advertised = new Set(rows.map((row) => row.service_key ?? '').filter(Boolean));
  const unmapped: Record<string, { reason: string; since: string }> = {};
  let pruned = 0;
  for (const [key, entry] of Object.entries(document.unmapped)) {
    if (advertised.has(key)) unmapped[key] = entry;
    else pruned += 1;
  }
  let added = 0;
  for (const row of rows) {
    const serviceKey = row.service_key ?? '';
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

function help(): void {
  console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 36).join('\n').replace(/^ \* ?/gm, ''));
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
    case 'doctor':
      await doctor();
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
