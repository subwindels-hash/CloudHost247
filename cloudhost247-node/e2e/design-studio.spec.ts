import { expect, test, type Download, type Locator, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

import { TOOL_CATALOG } from '../src/tools/catalog';
import { ToolError } from '../src/tools/core/errors';
import { pngDimensions, readPngDpi } from '../src/tools/design-studio/render/png-meta';
import { designStudioHandlers } from '../src/tools/handlers/design-studio';
import { decodePng } from '../tests/helpers/barcode-reader';

/**
 * Barcode Generator, Online Label Printing, VDA 4902 labels, Shipping Labels and QR Code Business
 * Cards, in a real browser against the production bundle.
 *
 * The preview server has no API behind it. A request to one of the five tools is therefore answered
 * here by the handler the server registers for it, in the envelope the server sends, so the artwork
 * on the page and in every download is the server's own and nothing in this file invents a result.
 * What the browser adds is checked for real: the form, the previews, the saved files, and the PNG
 * it draws itself, which is read back with a barcode decoder.
 */
interface StudioFile {
  name: string;
  mime: string;
  base64: string;
  bytes: number;
  label: string;
}
interface StudioData {
  previews: Array<{ title: string; widthMm: number; heightMm: number }>;
  files: StudioFile[];
  facts: Array<{ label: string; value: string }>;
  notices: string[];
}
interface Served {
  slug: string;
  request: Record<string, unknown>;
  data: StudioData;
}

const TOOLS = [
  { slug: 'barcode-generator', name: 'Barcode Generator', submit: 'Generate barcode' },
  { slug: 'label-designer', name: 'Online Label Printing', submit: 'Generate labels' },
  { slug: 'vda-4902-label-generator', name: 'VDA 4902 Label Generator', submit: 'Generate label' },
  { slug: 'shipping-label-generator', name: 'Shipping Label Generator', submit: 'Generate labels' },
  { slug: 'qr-business-card-designer', name: 'QR Code Business Cards', submit: 'Generate card' },
  { slug: 'qr-code-maker', name: 'QR Code Maker', submit: 'Make QR code' },
] as const;

const catalogue = {
  success: true,
  count: TOOL_CATALOG.length,
  tools: TOOL_CATALOG.map((tool) => ({ ...tool, notes: tool.notes ?? [], status: 'ACTIVE', statusMessage: null })),
};

/** Answer the catalogue and the five tools the way the server does; record what was drawn. */
async function serveStudio(page: Page): Promise<Served[]> {
  const served: Served[] = [];
  await page.route('**/api/tools/catalog*', (route) => route.fulfill({ json: catalogue }));
  await page.route(/\/api\/tools\/[a-z0-9-]+$/, async (route) => {
    const request = route.request();
    const slug = new URL(request.url()).pathname.split('/').pop() ?? '';
    const handler = designStudioHandlers[slug];
    if (request.method() !== 'POST' || !handler) return route.fallback();
    const input = (request.postDataJSON() ?? {}) as Record<string, unknown>;
    try {
      const data = (await handler(input, {} as never)) as StudioData;
      served.push({ slug, request: input, data });
      await route.fulfill({ json: { success: true, tool: slug, status: 'ACTIVE', generatedAt: new Date().toISOString(), data, meta: { durationMs: 1, cached: false, sources: [], warnings: [] } } });
    } catch (error) {
      if (!(error instanceof ToolError)) throw error;
      await route.fulfill({ status: error.statusCode, json: { success: false, code: error.code, message: error.message, retryable: false, tool: slug } });
    }
  });
  return served;
}

async function saveVia(page: Page, button: Locator): Promise<Download> {
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  return download;
}

async function bytesOf(download: Download): Promise<Buffer> {
  const path = await download.path();
  if (!path) throw new Error('download has no file on disk');
  return readFile(path);
}

/** The form's own action button. The preview panel repeats it, so the form is the scope. */
function formSubmit(page: Page, name: string): Locator {
  return page.locator('.studio-form').getByRole('button', { name, exact: true });
}

async function drawExample(page: Page, slug: string): Promise<void> {
  await page.goto(`/tools/${slug}`);
  await page.getByRole('button', { name: 'Show me an example' }).click();
  const image = page.locator('.studio-preview img').first();
  await expect(image).toBeVisible();
  // A picture that failed to decode has no natural size, however visible its box is.
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
}

function latest(served: Served[]): Served {
  const entry = served[served.length - 1];
  if (!entry) throw new Error('the page has not asked for any artwork');
  return entry;
}

const fact = (data: StudioData, label: string): string | undefined => data.facts.find((entry) => entry.label === label)?.value;

test.describe('Design Studio tools', () => {
  for (const tool of TOOLS) {
    test(`${tool.name}: draws the example and saves the PDF the server made`, async ({ page }) => {
      const served = await serveStudio(page);
      await page.goto(`/tools/${tool.slug}`);
      await expect(page.getByRole('heading', { level: 1, name: tool.name })).toBeVisible();
      await expect(formSubmit(page, tool.submit)).toBeEnabled();
      // Opening the page draws nothing.
      expect(served).toHaveLength(0);

      await drawExample(page, tool.slug);
      expect(served).toHaveLength(1);
      const { data } = latest(served);
      await expect(page.locator('.studio-preview img')).toHaveCount(data.previews.length);
      await expect(page.locator('.studio-facts > div')).toHaveCount(data.facts.length);

      const pdf = data.files.find((file) => file.mime === 'application/pdf');
      if (!pdf) throw new Error('the example returned no PDF');
      const download = await saveVia(page, page.getByRole('button', { name: pdf.label, exact: true }));
      expect(download.suggestedFilename()).toBe(pdf.name);
      const bytes = await bytesOf(download);
      expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      // Byte for byte the file the handler produced: the browser neither re-renders nor rescales it.
      expect(bytes.equals(Buffer.from(pdf.base64, 'base64'))).toBe(true);
    });
  }

  test('Barcode Generator: the PNG and SVG downloads are the server’s files, and the PNG scans', async ({ page }) => {
    const served = await serveStudio(page);
    await drawExample(page, 'barcode-generator');
    const { data } = latest(served);

    const png = data.files.find((file) => file.mime === 'image/png');
    const svg = data.files.find((file) => file.mime === 'image/svg+xml');
    if (!png || !svg) throw new Error('the example returned no PNG or no SVG');
    const pngBytes = await bytesOf(await saveVia(page, page.getByRole('button', { name: png.label, exact: true })));
    expect(pngBytes.equals(Buffer.from(png.base64, 'base64'))).toBe(true);
    expect(readPngDpi(pngBytes)).toBe(300);
    expect((await decodePng(pngBytes)).map((symbol) => `${symbol.format}:${symbol.text}`)).toEqual(['Code128:CH247-000123']);

    const svgBytes = await bytesOf(await saveVia(page, page.getByRole('button', { name: svg.label, exact: true })));
    expect(svgBytes.equals(Buffer.from(svg.base64, 'base64'))).toBe(true);
    // The SVG states its size in millimetres, so it is placed at true size without anyone measuring.
    expect(svgBytes.toString('utf8')).toMatch(/^<svg[^>]* width="54\.45mm" height="24\.255mm"/);
    // The server already made a PNG, so the page does not offer to draw another.
    await expect(page.getByRole('button', { name: 'Save as PNG image (300 dpi)' })).toHaveCount(0);
  });

  /**
   * Labels and cards have no server PNG: the page draws one from the preview. A canvas writes
   * pixels only, so the page has to add the resolution itself, or the file prints three times too
   * large. Each picture is checked for its size in pixels, the resolution it declares, and that a
   * decoder reads from it exactly what the server says the symbols carry.
   */
  const PICTURES: Array<{ slug: string; expects: (data: StudioData) => string[] }> = [
    { slug: 'label-designer', expects: () => ['Code128:CH-000123'] },
    {
      slug: 'vda-4902-label-generator',
      expects: (data) => data.facts.filter((entry) => /^Field \d+ encodes$/.test(entry.label)).map((entry) => `Code39:${entry.value}`),
    },
    { slug: 'shipping-label-generator', expects: () => ['Code128:ORD-2026-001542'] },
    {
      slug: 'qr-business-card-designer',
      expects: (data) => {
        const card = data.files.find((file) => file.mime === 'text/vcard');
        if (!card) throw new Error('the example returned no contact file');
        // The code on the card is the contact file itself, less the line break that closes a file.
        const file = Buffer.from(card.base64, 'base64').toString('utf8');
        expect(file.endsWith('END:VCARD\r\n')).toBe(true);
        return [`QRCode:${file.slice(0, -2)}`];
      },
    },
  ];
  for (const picture of PICTURES) {
    test(`${picture.slug}: the PNG the browser draws is true to size, declares 300 dpi and scans`, async ({ page }) => {
      const served = await serveStudio(page);
      await drawExample(page, picture.slug);
      const { data } = latest(served);
      const preview = data.previews[0];
      if (!preview) throw new Error('the example returned no preview');

      const download = await saveVia(page, page.getByRole('button', { name: 'Save as PNG image (300 dpi)' }));
      expect(download.suggestedFilename()).toMatch(/^[a-z0-9.-]+-300dpi\.png$/);
      const bytes = await bytesOf(download);
      expect(pngDimensions(bytes)).toEqual({ width: Math.round((preview.widthMm / 25.4) * 300), height: Math.round((preview.heightMm / 25.4) * 300) });
      expect(readPngDpi(bytes)).toBe(300);
      await expect(page.locator('.studio-result__message')).toHaveCount(0);

      const expected = picture.expects(data);
      expect(expected.length).toBeGreaterThan(0);
      const found = (await decodePng(bytes)).map((symbol) => `${symbol.format}:${symbol.text}`);
      expect([...found].sort()).toEqual([...expected].sort());
    });
  }

  test('QR Code Maker: the fields follow the kind of code, and the PNG saved carries the format a phone expects', async ({ page }) => {
    const served = await serveStudio(page);
    await page.goto('/tools/qr-code-maker');
    // The kind of code is a picker, not a dropdown: each choice is a card carrying its value.
    const kind = page.getByRole('group', { name: 'When someone scans it' });
    await expect(page.locator('.studio-choice[data-value="url"]')).toHaveClass(/is-selected/);
    await expect(page.getByLabel('Web address')).toBeVisible();

    // Choosing Wi-Fi replaces the address field with the network's fields.
    await kind.locator('.studio-choice[data-value="wifi"]').click();
    await expect(page.getByLabel('Web address')).toHaveCount(0);
    await page.getByLabel('Network name').fill('Guest; Lounge');
    await page.getByLabel('Password', { exact: true }).fill('welcome-2026');
    await formSubmit(page, 'Make QR code').click();
    await expect(page.locator('.studio-preview img').first()).toBeVisible();

    const { request, data } = latest(served);
    expect(request).toMatchObject({ kind: 'wifi', ssid: 'Guest; Lounge', wifiPassword: 'welcome-2026', wifiSecurity: 'WPA' });
    // On screen the password is dots; in the file it is the password, with the semicolon escaped.
    await expect(page.locator('.studio-facts > div', { hasText: 'The code carries' }).locator('dd')).toHaveText('WIFI:T:WPA;S:Guest\\; Lounge;P:••••••••;;');
    await expect(page.locator('.studio-result')).not.toContainText('welcome-2026');
    const png = data.files.find((file) => file.mime === 'image/png');
    if (!png) throw new Error('the code has no PNG');
    const bytes = await bytesOf(await saveVia(page, page.getByRole('button', { name: png.label, exact: true })));
    expect(bytes.equals(Buffer.from(png.base64, 'base64'))).toBe(true);
    expect(readPngDpi(bytes)).toBe(300);
    expect((await decodePng(bytes)).map((symbol) => `${symbol.format}:${symbol.text}`)).toEqual(['QRCode:WIFI:T:WPA;S:Guest\\; Lounge;P:welcome-2026;;']);

    // A date and a time are entered with the browser's own pickers and arrive as plain text.
    await page.getByRole('group', { name: 'When someone scans it' }).locator('.studio-choice[data-value="event"]').click();
    await page.getByLabel('Event name').fill('Open day');
    await page.getByLabel('Start date').fill('2026-12-12');
    await page.getByLabel('Start time').fill('10:00');
    await expect(page.getByLabel('Start date')).toHaveAttribute('type', 'date');
    await expect(page.getByLabel('Start time')).toHaveAttribute('type', 'time');
    await formSubmit(page, 'Make QR code').click();
    await expect(page.locator('.studio-facts > div', { hasText: 'When scanned' }).locator('dd')).toHaveText('Add a calendar event');
    expect(latest(served).request).toMatchObject({ kind: 'event', eventTitle: 'Open day', eventStart: '2026-12-12', eventStartTime: '10:00' });
    await expect(page.locator('.studio-facts > div', { hasText: 'The code carries' }).locator('dd')).toHaveText('BEGIN:VEVENT ↵ SUMMARY:Open day ↵ DTSTART:20261212T100000 ↵ DTEND:20261212T110000 ↵ END:VEVENT');
  });

  test('artwork on screen is current, marked as older than the form, or gone', async ({ page }) => {
    const served = await serveStudio(page);
    await page.goto('/tools/barcode-generator');
    const data = page.locator('#studio-barcode-generator-data');
    const generate = page.locator('.studio-form').getByRole('button', { name: 'Generate barcode', exact: true });
    const drawn = page.locator('.studio-facts > div', { hasText: 'Your data' }).locator('dd');
    const changed = page.locator('.studio-changed');

    await data.fill('FIRST-0001');
    await generate.click();
    await expect(drawn).toHaveText('FIRST-0001');
    await expect(changed).toHaveCount(0);

    // Edited but not sent: the first artwork stays and says it is older than the form.
    await data.fill('SECOND-0002');
    await expect(changed).toHaveText('You have changed the details since this was drawn. Press Generate barcode to update the preview and the files.');
    await expect(drawn).toHaveText('FIRST-0001');
    expect(served).toHaveLength(1);

    await generate.click();
    await expect(drawn).toHaveText('SECOND-0002');
    await expect(changed).toHaveCount(0);

    // A request the server refuses leaves no earlier artwork or files under its message.
    await page.getByRole('group', { name: 'Barcode type' }).locator('.studio-choice[data-value="ean13"]').click();
    await generate.click();
    await expect(page.getByRole('alert')).toContainText('That is not valid EAN-13 data. Expected: 12 digits (the check digit is added) or 13 digits including it.');
    await expect(page.locator('.studio-preview')).toHaveCount(0);
    await expect(page.locator('.studio-downloads')).toHaveCount(0);
    await expect(data).toHaveValue('SECOND-0002');

    await data.fill('952012345678');
    await generate.click();
    await expect(page.locator('.studio-facts > div', { hasText: 'The symbol carries' }).locator('dd')).toHaveText('9520123456788 (check digit 8 added)');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('a product label follows its template: retail barcode, name and price', async ({ page }) => {
    const served = await serveStudio(page);
    await page.goto('/tools/label-designer');
    await page.getByRole('group', { name: 'Template' }).locator('.studio-choice[data-value="product-label"]').click();
    await expect(page.getByLabel('Barcode type')).toHaveValue('ean13');
    await page.getByRole('button', { name: 'Fill with an example' }).click();
    await expect(page.locator('.studio-preview img').first()).toBeVisible();
    const { request, data } = latest(served);
    expect(request).toMatchObject({ template: 'product-label', symbology: 'ean13', code: '9520123456788', price: 'NGN 4,500' });
    expect(fact(data, 'Template')).toBe('Product label');
    expect(fact(data, 'Barcode')).toMatch(/^EAN-13, 0\.\d+ mm module, encodes “9520123456788”$/);
  });

  /** Where the output panel's parts are on screen, and where the site header ends if it stays put. */
  async function layout(page: Page): Promise<{ headerBottom: number; viewport: number; heading: number; firstButtonBottom: number | null; alertTop: number | null; pictures: Array<{ top: number; skew: number }> }> {
    return page.evaluate(() => {
      const header = document.querySelector<HTMLElement>('.hg-header');
      const pinned = header !== null && ['sticky', 'fixed'].includes(getComputedStyle(header).position);
      const top = (selector: string): number | null => document.querySelector(selector)?.getBoundingClientRect().top ?? null;
      return {
        headerBottom: pinned && header ? header.getBoundingClientRect().bottom : 0,
        viewport: window.innerHeight,
        heading: top('#studio-output-title') ?? Number.NaN,
        firstButtonBottom: document.querySelector('.studio-downloads button')?.getBoundingClientRect().bottom ?? null,
        alertTop: top('.studio-error'),
        pictures: Array.from(document.querySelectorAll<HTMLImageElement>('.studio-preview img')).map((node) => {
          const box = node.getBoundingClientRect();
          const ratio = Number(getComputedStyle(node).getPropertyValue('--studio-ratio'));
          return { top: box.top, skew: Math.abs(box.width / box.height / ratio - 1) };
        }),
      };
    });
  }

  for (const tool of TOOLS) {
    test(`${tool.name}: on a laptop the preview and the first download are on screen together, clear of the site header`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await serveStudio(page);
      await drawExample(page, tool.slug);
      await expect.poll(async () => (await layout(page)).heading).toBeLessThan(260);
      const seen = await layout(page);
      // The site header stays on screen at this width; nothing of the panel may sit underneath it.
      expect(seen.headerBottom).toBeGreaterThan(60);
      expect(seen.heading).toBeGreaterThanOrEqual(seen.headerBottom);
      expect(seen.pictures.length).toBeGreaterThan(0);
      for (const picture of seen.pictures) {
        expect(picture.top).toBeGreaterThanOrEqual(seen.headerBottom);
        // The picture's box has the artwork's own proportions: it is not centred in a wider box.
        expect(picture.skew).toBeLessThan(0.01);
      }
      expect(seen.firstButtonBottom).not.toBeNull();
      expect(seen.firstButtonBottom as number).toBeLessThanOrEqual(seen.viewport);
    });
  }

  test('down a long form the preview panel follows below the site header, not underneath it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await serveStudio(page);
    // The shipping form is far longer than its result, so the panel has room to follow.
    await drawExample(page, 'shipping-label-generator');
    await expect.poll(async () => (await layout(page)).heading).toBeLessThan(260);
    const settled = await layout(page);
    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(before + 290);
    const scrolled = await layout(page);
    expect(scrolled.heading).toBeGreaterThanOrEqual(scrolled.headerBottom);
    expect(Math.abs(scrolled.heading - settled.heading)).toBeLessThan(2);
    expect(scrolled.pictures[0]?.top ?? -1).toBeGreaterThanOrEqual(scrolled.headerBottom);
  });

  test('the button at the end of a long form brings the preview, or the refusal, into view', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await serveStudio(page);
    await drawExample(page, 'label-designer');
    const submit = formSubmit(page, 'Generate labels');

    // Edit a field and go to the button, as someone working down the form does. The panel is
    // taller than the screen here, so its top has scrolled away.
    await page.locator('#studio-label-designer-code').fill('CH-000777');
    await submit.evaluate((node) => node.scrollIntoView({ block: 'center' }));
    expect((await layout(page)).heading).toBeLessThan(0);

    await submit.click();
    await expect(page.locator('.studio-facts > div', { hasText: 'Barcode' }).locator('dd')).toContainText('CH-000777');
    await expect.poll(async () => (await layout(page)).heading).toBeGreaterThan(0);
    let seen = await layout(page);
    expect(seen.heading).toBeGreaterThanOrEqual(seen.headerBottom);
    expect(seen.heading).toBeLessThan(seen.viewport / 2);
    expect(seen.pictures[0]?.top ?? -1).toBeGreaterThanOrEqual(seen.headerBottom);
    expect(seen.pictures[0]?.top ?? seen.viewport).toBeLessThan(seen.viewport);

    // The same for a refusal: a label too small for its barcode.
    await page.getByLabel('Label stock').selectOption('custom');
    await page.getByLabel('Label width (mm)').fill('30');
    await page.getByLabel('Label height (mm)').fill('15');
    await page.locator('#studio-label-designer-code').fill('CH-000777-A-VALUE-TOO-LONG-FOR-THIS-LABEL');
    await submit.evaluate((node) => node.scrollIntoView({ block: 'center' }));
    await submit.click();
    await expect(page.getByRole('alert')).toContainText('That could not be generated.');
    await expect.poll(async () => (await layout(page)).alertTop ?? -1).toBeGreaterThan(0);
    seen = await layout(page);
    expect(seen.alertTop as number).toBeGreaterThanOrEqual(seen.headerBottom);
    expect(seen.alertTop as number).toBeLessThan(seen.viewport / 2);
  });

  for (const tool of TOOLS) {
    test(`${tool.name}: fits a phone screen without sideways scrolling`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await serveStudio(page);
      await drawExample(page, tool.slug);
      const overflow = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        const outside = Array.from(document.querySelectorAll<HTMLElement>('.studio input, .studio select, .studio textarea, .studio button, .studio-preview img, .studio-facts > div'))
          .filter((node) => node.offsetParent !== null)
          .filter((node) => {
            const box = node.getBoundingClientRect();
            return box.left < -0.5 || box.right > width + 0.5;
          })
          .map((node) => `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}.${node.className}`);
        return { page: document.documentElement.scrollWidth - width, outside };
      });
      expect(overflow).toEqual({ page: 0, outside: [] });
    });
  }
});

test.describe('Design Studio accessibility', () => {
  async function blocking(page: Page, label: string, testInfo: TestInfo): Promise<string[]> {
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    await testInfo.attach(`axe-${label}.json`, {
      body: JSON.stringify(results.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 5).map((n) => n.target) })), null, 2),
      contentType: 'application/json',
    });
    return results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')} :: ${v.nodes.map((n) => n.failureSummary ?? '').join(' | ').slice(0, 400)}`);
  }

  for (const tool of TOOLS) {
    test(`${tool.name} has no serious or critical WCAG 2.1 AA violations, empty or with artwork`, async ({ page }, testInfo) => {
      await serveStudio(page);
      await page.goto(`/tools/${tool.slug}`);
      await expect(page.getByRole('heading', { level: 1, name: tool.name })).toBeVisible();
      expect(await blocking(page, `${tool.slug}-empty`, testInfo)).toEqual([]);

      await drawExample(page, tool.slug);
      await expect(page.locator('.studio-output[aria-busy="false"]')).toBeVisible();
      expect(await blocking(page, `${tool.slug}-artwork`, testInfo)).toEqual([]);
    });
  }

  test('a refusal is announced and passes the same scan', async ({ page }, testInfo) => {
    await serveStudio(page);
    await page.goto('/tools/barcode-generator');
    await page.getByRole('group', { name: 'Barcode type' }).locator('.studio-choice[data-value="ean13"]').click();
    await page.locator('#studio-barcode-generator-data').fill('NOT-A-NUMBER');
    await formSubmit(page, 'Generate barcode').click();
    await expect(page.getByRole('alert')).toContainText('That could not be generated.');
    expect(await blocking(page, 'refusal', testInfo)).toEqual([]);
  });
});
