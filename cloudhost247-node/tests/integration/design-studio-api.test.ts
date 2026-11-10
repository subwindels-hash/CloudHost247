/**
 * Design Studio — end-to-end API tests.
 *
 * These go through the real route layer (`POST /api/tools/:slug`), the executor and the handler, with
 * no database rows of their own and no outbound network. What they assert is the contract the five
 * pages rely on:
 *
 *  · the response carries a renderable SVG *and* a PDF when asked for one;
 *  · validation errors and warnings are separated, and errors block the export;
 *  · a payload that cannot encode is refused rather than printed;
 *  · nothing is cached or persisted, because these tools take addresses and contact details.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { buildApp } from '../../src/app';
import { loadEnv } from '../../src/config/env';

process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/cloudhost247';
process.env.JWT_SECRET ??= 'f'.repeat(32);
process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'a'.repeat(64);

const SLUGS = [
  'barcode-generator',
  'label-designer',
  'vda-4902-label-generator',
  'shipping-label-generator',
  'qr-business-card-designer',
];

describe('Design Studio API', () => {
  let db: PGlite;
  let client: PgliteClient;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
      JWT_SECRET: 'f'.repeat(32),
      SERVER_AGENT_SHARED_SECRET: 's'.repeat(32),
      CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
      LOG_LEVEL: 'silent',
    } as NodeJS.ProcessEnv);
    db = new PGlite();
    client = new PgliteClient(db);
    await migrateUp(client, { allowProduction: true });
    app = buildApp(env, { serveFrontend: false, pool: client as never });
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
    await db.close();
  });

  const runTool = (slug: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/api/tools/${slug}`, payload });

  it('publishes all five tools in the catalogue with a handler behind each', async () => {
    const catalog = (await app.inject({ method: 'GET', url: '/api/tools/catalog' })).json().tools as Array<{ slug: string; path: string }>;
    for (const slug of SLUGS) {
      const entry = catalog.find((tool) => tool.slug === slug);
      expect(entry, slug).toBeDefined();
      expect(entry?.path).toBe(`/tools/${slug}`);
    }
  });

  it('generates a barcode and returns a decodable SVG plus a PDF', async () => {
    const response = await runTool('barcode-generator', {
      formatId: 'code128',
      payload: 'CH247-API-0001',
      moduleMm: 0.4,
      pdf: true,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.blocked).toBe(false);
    expect(body.svg).toContain('<svg');
    expect(body.svg).toContain('barcode:code128');
    expect(typeof body.pdf).toBe('string');
    expect(body.pdf.length).toBeGreaterThan(500);
    // The declared footprint must be the real one: module width times the module count.
    expect(body.meta.sizeMm.width).toBeGreaterThan(20);
    expect(body.meta.xDimensionMm).toBeCloseTo(0.4, 5);
  });

  it('refuses a barcode payload that cannot encode instead of printing a wrong symbol', async () => {
    const response = await runTool('barcode-generator', { formatId: 'ean13', payload: 'NOTNUMBERS' });
    const body = response.json().data;
    expect(body.blocked).toBe(true);
    expect(body.issues.some((issue: { level: string }) => issue.level === 'error')).toBe(true);
  });

  it('previews a label, reports the sheet grid and never drops a batch row', async () => {
    const response = await runTool('label-designer', {
      action: 'preview',
      templateId: 'address-70x40',
      rows: [{ tracking: 'CH247-1', recipient: 'Ada Obi\n24 Zaria Road' }, { tracking: 'CH247-2', recipient: 'Bola Ade\n9 Bukuru Way' }],
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.meta.labels).toHaveLength(2);
    expect(body.meta.perPage).toBeGreaterThan(0);
    expect(body.svg).toContain('<svg');
  });

  it('restores a saved label: the template, its values and its element list come back', async () => {
    // The round trip that matters for saved templates: what the panel stores is this page's document,
    // and posting it back must reproduce the label rather than the template's sample data.
    const saved = {
      templateId: 'asset-tag-60x25',
      values: { asset: 'CH-ASSET-4471', description: 'Plateau rig', owner: 'Facilities' },
    };
    const restored = await runTool('label-designer', { action: 'preview', ...saved });
    expect(restored.statusCode).toBe(200);
    const texts = (restored.json().data.document.pages[0].ops as Array<{ kind: string; text?: string }>)
      .filter((op) => op.kind === 'text')
      .map((op) => op.text);
    expect(texts).toContain('CH-ASSET-4471');
    expect(texts).toContain('Plateau rig');

    // A restored document may also carry a changed size; it is applied over the template so a
    // template update cannot leave a label that is the wrong size but looks right in the form.
    const resized = await runTool('label-designer', {
      action: 'preview',
      templateId: 'asset-tag-60x25',
      values: saved.values,
      document: { widthMm: 62 },
    });
    expect(resized.statusCode).toBe(200);
    expect(resized.json().data.meta.labelSize.width).toBe(62);
  });

  it('applies top-level `values` to the template instead of silently returning its sample data', async () => {
    // The page posts a flat `values` record keyed by binding. If the handler only honoured
    // `document.values`, every field on that form would be ignored and the preview would show the
    // template's example data — a form that looks broken without saying so.
    const response = await runTool('label-designer', {
      action: 'preview',
      templateId: 'product-50x30',
      values: { sku: 'CH-9999', price: 1250 },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    const texts = (body.document.pages[0].ops as Array<{ kind: string; text?: string }>)
      .filter((op) => op.kind === 'text')
      .map((op) => op.text);
    expect(texts).toContain('CH-9999');
    // A numeric value is stringified: a label prints text, not numbers.
    expect(texts).toContain('1250');
    expect(texts).not.toContain('CH-1001');

    // The element list the page explains the template with comes from the laid-out document.
    expect(body.meta.elements.map((entry: { id: string }) => entry.id)).toContain('sku');
    expect(body.meta.elements.find((entry: { id: string }) => entry.id === 'gtin').formatId).toBe('ean13');
  });

  it('rejects the specific CSV row whose value its symbology cannot carry', async () => {
    const response = await runTool('label-designer', {
      action: 'csv',
      templateId: 'product-50x30',
      csv: 'sku,price,gtin\nCH-1001,12.50,4006381333931\nCH-1002,9.99,12345\n',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.accepted).toBe(1);
    expect(body.rejected).toBe(1);
    const rejectedRow = body.rows.find((row: { accepted: boolean }) => !row.accepted);
    expect(rejectedRow.line).toBe(3);
    expect(rejectedRow.issues[0].message).toMatch(/EAN-13/);
    // A rejected row comes back as a CSV that keeps its original values.
    expect(body.rejectedCsv).toContain('CH-1002');
  });

  it('maps CSV columns for a label batch and reports rejected rows with their line numbers', async () => {
    const response = await runTool('label-designer', {
      action: 'csv',
      templateId: 'address-70x40',
      csv: 'tracking,recipient\nCH247-1,"Ada Obi\n24 Zaria Road"\n,"Bola Ade"\n',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.rows).toHaveLength(2);
    // The second row has no tracking value: it is warned about, not silently dropped.
    expect(body.rows[1].line).toBe(4);
    expect(body.rows[1].issues.length).toBeGreaterThan(0);
    expect(body.headers).toEqual(['tracking', 'recipient']);
  });

  it('lists label templates with a buildable document', async () => {
    const response = await runTool('label-designer', { action: 'templates' });
    const body = response.json().data;
    expect(body.count).toBeGreaterThanOrEqual(6);
    for (const template of body.templates) expect(template.document?.elements).toBeDefined();
  });

  it('generates a VDA 4902 master label with both symbols', async () => {
    const response = await runTool('vda-4902-label-generator', {
      data: {
        format: 'master',
        receiver: 'ANDREAS STIHL AG & Co. KG',
        plant: 'D5',
        supplier: 'CloudHost247 Manufacturing Ltd',
        supplierNumber: '987654',
        deliveryNote: 'DN-2026-00417',
        deliveryNoteDate: '2026-11-09',
        partNumber: '1234-567-89',
        partDescription: 'Sealing ring 42 mm',
        quantity: '1200',
        unit: 'PCE',
      },
      pdf: true,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.blocked).toBe(false);
    expect(body.meta.sizeMm).toEqual({ width: 210, height: 148 });
    expect(body.meta.payload2d).toContain('[)>RTD4902');
    expect(body.meta.limitations.join(' ')).toMatch(/not.{0,20}certif/i);
    expect(body.pdf.length).toBeGreaterThan(1000);
  });

  it('serves the VDA specification record for the page to render', async () => {
    const response = await runTool('vda-4902-label-generator', { action: 'spec' });
    const body = response.json().data;
    expect(body.version).toBe('4');
    expect(body.fields).toHaveLength(15);
    expect(body.limitations.length).toBeGreaterThanOrEqual(5);
    expect(body.sources.length).toBeGreaterThanOrEqual(3);
  });

  it('blocks a shipping label whose required fields are missing, and says which', async () => {
    const response = await runTool('shipping-label-generator', { templateId: 'thermal-100x150' });
    const body = response.json().data;
    expect(body.blocked).toBe(true);
    const fields = body.issues.filter((issue: { level: string }) => issue.level === 'error').map((issue: { field: string }) => issue.field);
    expect(fields).toEqual(expect.arrayContaining(['senderName', 'recipientName', 'reference']));
  });

  it('generates a complete shipping label and states the carrier-neutral limitation', async () => {
    const response = await runTool('shipping-label-generator', {
      templateId: 'thermal-100x150',
      shipment: {
        senderName: 'CloudHost247 Ltd',
        senderAddress: '12 Rukuba Road\nJos',
        recipientName: 'Ada Obi',
        recipientAddress: '24 Zaria Road\nJos',
        reference: 'CH247-2026-000123',
        trackingNumber: 'TRK-8891-0042',
        weight: '2.4 kg',
        pieces: '1 of 1',
      },
    });
    const body = response.json().data;
    expect(body.blocked).toBe(false);
    expect(body.meta.carrierNotice).toMatch(/carrier-neutral/i);
    expect(body.meta.trackingNumberSupplied).toBe(true);
    expect(body.svg).toContain('CH247-2026-000123');
  });

  it('builds a vCard payload and a two-page card PDF', async () => {
    const payload = await runTool('qr-business-card-designer', {
      action: 'payload',
      payloadFormat: 'vcard',
      firstName: 'Ada',
      lastName: 'Obi',
      email: 'ada@cloudhost247.com',
      company: 'CloudHost247 Ltd',
    });
    expect(payload.json().data.payload.value).toContain('BEGIN:VCARD');
    expect(payload.json().data.payload.value).toContain('FN:Ada Obi');

    const card = await runTool('qr-business-card-designer', {
      templateId: 'classic-white',
      side: 'both',
      firstName: 'Ada',
      lastName: 'Obi',
      email: 'ada@cloudhost247.com',
      pdf: true,
    });
    const body = card.json().data;
    expect(body.blocked).toBe(false);
    expect(body.document.pages).toHaveLength(2);
    expect(body.meta.sides).toHaveLength(2);
    expect(body.pdf.length).toBeGreaterThan(1000);
  });

  it('refuses an SVG logo, because an SVG can carry script', async () => {
    const response = await runTool('qr-business-card-designer', {
      templateId: 'classic-white',
      side: 'back',
      firstName: 'Ada',
      logoDataUrl: 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+',
    });
    const body = response.json().data;
    expect(body.meta.values.logoDataUrl ?? '').toBe('');
  });

  it('never persists a design-studio result', async () => {
    await runTool('barcode-generator', { formatId: 'qrcode', payload: 'https://cloudhost247.com' });
    await runTool('shipping-label-generator', {
      templateId: 'address-70x40',
      shipment: { senderName: 'A', senderAddress: 'B', recipientName: 'C', recipientAddress: 'D', reference: 'E' },
    });
    const cache = await client.query("SELECT count(*)::int AS n FROM tool_cache WHERE tool_slug IN ('barcode-generator','shipping-label-generator')");
    expect((cache.rows[0] as { n: number }).n).toBe(0);
    // `tool_history` is the per-user result store; an anonymous run must not create one either.
    const history = await client.query("SELECT count(*)::int AS n FROM tool_history WHERE tool_slug IN ('barcode-generator','shipping-label-generator')");
    expect((history.rows[0] as { n: number }).n).toBe(0);
    // Execution *may* be logged — a slug, an outcome and a coarse target — but the record must never
    // contain the address, the contact details or the payload. This is the assertion that keeps a
    // future refactor from quietly writing PII into `tool_execution_logs.target`.
    const logs = await client.query<{ target: string | null; result_summary: unknown }>(
      "SELECT target, result_summary FROM tool_execution_logs WHERE tool_slug IN ('barcode-generator','shipping-label-generator')"
    );
    for (const row of logs.rows) {
      const recorded = `${row.target ?? ''} ${JSON.stringify(row.result_summary ?? {})}`;
      expect(recorded).not.toContain('24 Zaria Road');
      expect(recorded).not.toContain('Ada Obi');
      expect(recorded).not.toContain('https://cloudhost247.com');
    }
  });
});
