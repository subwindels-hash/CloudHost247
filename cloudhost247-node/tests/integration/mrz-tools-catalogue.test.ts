/**
 * MRZ tool — route, navigation, footer and privacy verification.
 *
 * The ePassport MRZ tool used to live beside the Tools Center without appearing in it: the pages
 * worked, but nothing in the catalogue, the menu, the footer, search or the sitemap pointed at
 * them, so a visitor could only reach them by knowing the URL. This suite pins the fix in place so
 * the footer link cannot silently become a broken or placeholder destination again:
 *
 *   1. the catalogue entry exists, is public, has a real handler and is never cached;
 *   2. the generated theme projection (the file the WHMCS/PHP shell and the React footer read) lists
 *      the tool and resolves *every* footer slug to a catalogue entry with an implementation;
 *   3. the SPA declares the canonical route, and the page it renders uses the catalogue's own name
 *      (a link that promises "MRZ Generator" must not land on a differently named page);
 *   4. `/api/tools/navigation` — the single source for both shells’ menus and footer — publishes it;
 *   5. the executor never persists what the tool processed: no cache row, no PII in the execution
 *      log summary or target, no PII in customer history, and reports/tickets are refused outright.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { buildApp } from '../../src/app';
import { loadEnv, type Env } from '../../src/config/env';
import { signAuthToken } from '../../src/lib/jwt';
import {
  NON_PERSISTABLE_TOOL_SLUGS,
  TOOL_CATALOG,
  TOOLS_FOOTER,
  catalogEntry,
} from '../../src/tools/catalog';
import { handlerFor, missingHandlers } from '../../src/tools/handlers';

process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/cloudhost247';
process.env.JWT_SECRET ??= 'f'.repeat(32);
process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'a'.repeat(64);

const REPO = path.resolve(__dirname, '../../..');
const PROJECTION = path.join(REPO, 'modules/addons/cloudhost247_theme/resources/tools.json');
const SPA_ROUTES = path.join(REPO, 'cloudhost247-node/frontend/src/App.tsx');
const MRZ_PAGE = path.join(REPO, 'cloudhost247-node/frontend/src/pages/tools/MrzToolPage.tsx');

/** ICAO Doc 9303 TD3 specimen (UTO / XXA are reserved test codes — not a real document). */
const SPECIMEN_LINE_1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<';
const SPECIMEN_LINE_2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';
const SPECIMEN_DOCUMENT_NUMBER = 'L898902C3';
const SPECIMEN_BIRTH_DATE = '740812';

const generatePayload = () => ({
  mode: 'generate',
  issuingState: 'UTO',
  surname: 'Eriksson',
  givenNames: 'Anna Maria',
  nationality: 'UTO',
  dateOfBirth: SPECIMEN_BIRTH_DATE,
  sex: 'F',
  documentNumber: SPECIMEN_DOCUMENT_NUMBER,
  expiryDate: '120415',
  optionalData: 'ZE184226B',
});

type Projection = {
  footer: string[];
  tools: Array<{ slug: string; path: string; legacyPaths?: string[]; name: string }>;
};
const projection = (): Projection => JSON.parse(readFileSync(PROJECTION, 'utf8'));

describe('MRZ tool — catalogue, footer and route wiring', () => {
  it('registers one public MRZ tool with an implementation, no cache and retained URLs', () => {
    const entry = catalogEntry('mrz-generator');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('MRZ Generator');
    expect(entry!.path).toBe('/tools/mrz-generator');
    expect(entry!.authRequired).toBe(false);
    expect(entry!.visibility).toBe('public');
    // A cached MRZ answer would be a stored identity string. It must never be cacheable.
    expect(entry!.cacheSeconds).toBe(0);
    expect(entry!.discoveryCategories).toContain('developer');
    expect(entry!.description).toMatch(/never caches, logs or persists/i);
    // The Document Tools URLs that predate the catalogue entry keep working.
    expect(entry!.legacyPaths).toEqual(
      expect.arrayContaining(['/tools/document/mrz', '/tools/document/mrz-parser'])
    );
    expect(typeof handlerFor('mrz-generator')).toBe('function');
    expect(missingHandlers()).toEqual([]);
  });

  it('ships the footer link through the generated projection, with every footer slug resolvable', () => {
    const data = projection();
    const slugs = data.tools.map((tool) => tool.slug);
    expect(slugs).toContain('mrz-generator');
    expect(data.footer).toContain('mrz-generator');
    expect(data.footer).toEqual([...TOOLS_FOOTER]);

    const entry = data.tools.find((tool) => tool.slug === 'mrz-generator')!;
    expect(entry.path).toBe('/tools/mrz-generator');

    // Every footer slug is a real tool with a runnable implementation and a clean internal route:
    // no placeholders, no external redirect and no query string carrying anyone's data.
    const installed = new Set(data.tools.map((tool) => tool.slug));
    for (const slug of data.footer) {
      expect(slug).toMatch(/^[a-z0-9-]+$/);
      expect(installed.has(slug)).toBe(true);
      expect(typeof handlerFor(slug)).toBe('function');
      const tool = catalogEntry(slug)!;
      expect(tool.path).toMatch(/^\/tools\/[a-z0-9/-]+$/);
      expect(tool.path).not.toMatch(/[?#]/);
      expect(tool.authRequired).toBe(false);
    }
    // The projection is presentation metadata: it must not contain a machine-readable zone, a
    // document number or a date of birth anywhere.
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain(SPECIMEN_DOCUMENT_NUMBER);
    expect(serialized).not.toMatch(/P<[A-Z]{3}[A-Z<]{5,}/);
  });

  it('keeps the specimen persona and its dates out of every shipped form placeholder', () => {
    // The form surfaces are public: they are generated into the PHP catalogue, projected into the
    // theme resources the footer/menus read, and compiled into the React bundle. A placeholder that
    // spells out the ICAO specimen's document number, birth date or name would publish a filled-in
    // identity string (and imply a real one is welcome). Placeholders state the expected shape only;
    // the ready-made specimen stays behind the page's "Generate test data" button, in the browser.
    const shipped = [
      path.join(REPO, 'config/tools.php'),
      path.join(REPO, 'modules/addons/cloudhost247_theme/resources/tools-public.json'),
      path.join(REPO, 'cloudhost247-node/frontend/src/lib/tools-api.ts'),
    ];
    for (const file of shipped) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toContain(SPECIMEN_DOCUMENT_NUMBER);
      expect(text, file).not.toContain(SPECIMEN_BIRTH_DATE);
      expect(text, file).not.toContain('120415');
      expect(text, file).not.toContain('ZE184226B');
      expect(text, file).not.toContain('Eriksson');
      expect(text, file).not.toMatch(/P<[A-Z]{3}[A-Z<]{5,}/);
    }
    // And the MRZ placeholders really are shape hints, not a filled-in specimen.
    const phpCatalogue = readFileSync(shipped[0], 'utf8');
    const mrzEntry = phpCatalogue.slice(phpCatalogue.indexOf("'mrz-generator'"));
    const mrzBlock = mrzEntry.slice(0, mrzEntry.indexOf("'smtp-test'"));
    expect(mrzBlock).toContain("'placeholder' => 'AB1234567'");
    expect(mrzBlock).toContain("'placeholder' => 'YYMMDD'");
  });

  it('declares the canonical SPA route and names the page exactly like the catalogue entry', () => {
    const routes = readFileSync(SPA_ROUTES, 'utf8');
    expect(routes).toContain('<Route path="/tools/mrz-generator"');
    // Retained URLs still render the tool rather than falling through to a 404.
    for (const legacy of ['/tools/document/mrz', '/tools/document/mrz-parser', '/tools/mrz-parser']) {
      expect(routes).toContain(`<Route path="${legacy}"`);
    }
    const name = catalogEntry('mrz-generator')!.name;
    expect(readFileSync(MRZ_PAGE, 'utf8')).toContain(`export const MRZ_TOOL_NAME = '${name}'`);
  });

  it('never allows MRZ results to be written to a durable store', () => {
    expect(NON_PERSISTABLE_TOOL_SLUGS.has('mrz-generator')).toBe(true);
  });
});

describe('MRZ tool — execution, navigation and privacy through the real API', () => {
  let db: PGlite;
  let client: PgliteClient;
  let app: ReturnType<typeof buildApp>;
  let env: Env;
  let customerToken: string;
  const customerId = randomUUID();

  beforeEach(async () => {
    env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
      JWT_SECRET: 'f'.repeat(32),
      CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
    } as NodeJS.ProcessEnv);
    db = new PGlite();
    client = new PgliteClient(db);
    await migrateUp(client, { allowProduction: true });
    await client.exec(`
      INSERT INTO users (id, email, password_hash, full_name, role, status)
      VALUES ('${customerId}', 'mrz-customer@example.com', 'hash', 'MRZ Customer', 'customer', 'active');
    `);
    customerToken = signAuthToken(env, {
      sub: customerId,
      email: 'mrz-customer@example.com',
      role: 'customer',
    });
    app = buildApp(env, { serveFrontend: false, pool: client as never });
  });

  afterEach(async () => {
    if (app) await app.close();
    await db.close();
  });

  const runMrz = (payload: Record<string, unknown>, token?: string) =>
    app.inject({
      method: 'POST',
      url: '/api/tools/mrz-generator',
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
      payload,
    });

  it('generates the ICAO specimen, validates it and parses it — the footer link is not a stub', async () => {
    const generated = await runMrz(generatePayload());
    expect(generated.statusCode).toBe(200);
    const generateBody = generated.json();
    expect(generateBody.success).toBe(true);
    expect(generateBody.data.lines.line1).toBe(SPECIMEN_LINE_1);
    expect(generateBody.data.lines.line2).toBe(SPECIMEN_LINE_2);
    expect(generateBody.data.status).toBe('VALID');

    const validated = await runMrz({
      mode: 'validate',
      mrz: `${SPECIMEN_LINE_1}\n${SPECIMEN_LINE_2}`,
    });
    expect(validated.statusCode).toBe(200);
    expect(validated.json().data.valid).toBe(true);

    const tampered = await runMrz({
      mode: 'validate',
      line1: SPECIMEN_LINE_1,
      line2: SPECIMEN_LINE_2.replace(SPECIMEN_DOCUMENT_NUMBER, 'L898902C4'),
    });
    expect(tampered.json().data.valid).toBe(false);

    const parsed = await runMrz({ mode: 'parse', mrz: `${SPECIMEN_LINE_1}\n${SPECIMEN_LINE_2}` });
    const parsedBody = parsed.json();
    expect(parsedBody.data.fields.surname).toBe('ERIKSSON');
    expect(parsedBody.data.fields.documentNumber).toBe(SPECIMEN_DOCUMENT_NUMBER);
    expect(parsedBody.data.authenticityVerified).toBe(false);
    expect(parsedBody.data.authenticityStatus).toMatch(/not verified/i);
  });

  it('publishes the tool through the navigation API both shells build their menus and footer from', async () => {
    const navigation = await app.inject({ method: 'GET', url: '/api/tools/navigation' });
    expect(navigation.statusCode).toBe(200);
    const body = navigation.json();
    const mrz = body.tools.find((tool: { slug: string }) => tool.slug === 'mrz-generator');
    expect(mrz).toBeDefined();
    expect(mrz.path).toBe('/tools/mrz-generator');
    expect(mrz.name).toBe('MRZ Generator');
    expect(body.footer).toContain('mrz-generator');
    expect(body.categories.developer).toBe('Developer');

    const catalog = await app.inject({ method: 'GET', url: '/api/tools/catalog' });
    const entry = catalog
      .json()
      .tools.find((tool: { slug: string }) => tool.slug === 'mrz-generator');
    expect(entry.status).toBe('ACTIVE');
    expect(entry.path).toBe('/tools/mrz-generator');
  });

  it('stores nothing that was submitted: no cache row, no PII in the log or the history entry', async () => {
    const generated = await runMrz(generatePayload(), customerToken);
    expect(generated.statusCode).toBe(200);

    const cache = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM tool_cache WHERE tool_slug = 'mrz-generator'`
    );
    expect(cache.rows[0]?.count).toBe('0');

    const logs = await client.query<{ target: string | null; result_summary: string }>(
      `SELECT target, result_summary::text AS result_summary FROM tool_execution_logs WHERE tool_slug = 'mrz-generator'`
    );
    expect(logs.rows.length).toBeGreaterThan(0);
    for (const row of logs.rows) {
      expect(row.target ?? '').not.toContain(SPECIMEN_DOCUMENT_NUMBER);
      expect(row.result_summary).not.toContain(SPECIMEN_DOCUMENT_NUMBER);
      expect(row.result_summary).not.toContain(SPECIMEN_BIRTH_DATE);
      expect(row.result_summary).not.toContain('P<UTO');
    }

    const history = await client.query<{ target: string | null; summary: string }>(
      `SELECT target, summary FROM tool_history WHERE tool_slug = 'mrz-generator'`
    );
    for (const row of history.rows) {
      expect(row.target).toBeNull();
      expect(row.summary).not.toContain(SPECIMEN_DOCUMENT_NUMBER);
      expect(row.summary).not.toContain(SPECIMEN_BIRTH_DATE);
      expect(row.summary).not.toContain('P<UTO');
    }
  });

  it('refuses to save or attach an MRZ result instead of persisting identity fields', async () => {
    const saved = await app.inject({
      method: 'POST',
      url: '/api/tools/mrz-generator/report',
      headers: { authorization: `Bearer ${customerToken}` },
      payload: generatePayload(),
    });
    expect(saved.statusCode).toBe(400);
    expect(saved.json().message).toMatch(/never written to the report store/i);

    const ticket = await app.inject({
      method: 'POST',
      url: '/api/tools/mrz-generator/ticket',
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { ...generatePayload(), note: 'please check' },
    });
    expect(ticket.statusCode).toBe(400);

    const reports = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM tool_reports WHERE tool_slug = 'mrz-generator'`
    );
    expect(reports.rows[0]?.count).toBe('0');
    const tickets = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM support_tickets WHERE subject ILIKE '%MRZ%'`
    );
    expect(tickets.rows[0]?.count).toBe('0');
  });

  it('keeps the tool out of the cache table but available in the catalogue for search and sitemap metadata', () => {
    const entry = TOOL_CATALOG.find((tool) => tool.slug === 'mrz-generator')!;
    // Search: the Tools Center matches name/summary/keywords, so the keywords must contain "mrz".
    expect(entry.keywords).toEqual(expect.arrayContaining(['mrz', 'passport', 'icao 9303']));
    // SEO metadata used by the sitemap/tool page projector.
    expect(entry.seoTitle).toContain('MRZ');
    expect(entry.cacheSeconds).toBe(0);
  });
});
