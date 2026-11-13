import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import bwipjs from 'bwip-js';
import Fastify from 'fastify';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';

import type { Env } from '../src/config/env';
import { registerSecurityPlugins } from '../src/plugins/security';
import { TOOL_CATALOG } from '../src/tools/catalog';
import { renderSymbolPng } from '../src/tools/design-studio/barcode/encoder';
import { symbologyById } from '../src/tools/design-studio/barcode/symbologies';

/**
 * Barcode Scanner in a real browser, against the production bundle.
 *
 * The barcodes are drawn by the Barcode Generator's encoder and read by the scanner's own decoder
 * running in the page, so a pass means the page, its lazily loaded decoder and the browser's canvas
 * and camera plumbing all work together. The camera is Chromium's stand-in: a video file played as
 * if it were a camera, showing a barcode. A real lens, with its blur and glare, is the one thing
 * this cannot stand in for.
 *
 * The page has two decoders (see frontend/src/lib/scan-engine.ts). The full one is WebAssembly, and
 * whether a browser runs it depends on the Content-Security-Policy the page is served with. The
 * preview server these specs run against sends no policy, so two tests add one to the page: the
 * policy the application itself sends, read from its own security plugin, and that policy without
 * the one word that allows WebAssembly.
 *
 * The preview server has no API behind it. The scanner needs none: the test fails if the page posts
 * anything.
 */

const MEDIA = mkdtempSync(join(tmpdir(), 'ch247-scanner-'));
const CAMERA_FILE = join(MEDIA, 'camera.y4m');
const CAMERA_TEXT = 'CAMERA-0042';

async function barcodePng(id: string, data?: string, quarterTurns = 0): Promise<Buffer> {
  const symbology = symbologyById(id);
  if (!symbology) throw new Error(`no barcode type ${id}`);
  const bitmap = await renderSymbolPng({ symbology, data: data ?? symbology.sample, dpi: 300, quietZone: true, background: '#ffffff', quarterTurns });
  return Buffer.from(bitmap.png);
}

async function pngFile(name: string, id: string, data?: string, quarterTurns = 0): Promise<string> {
  const path = join(MEDIA, name);
  writeFileSync(path, await barcodePng(id, data, quarterTurns));
  return path;
}

/** A few frames of 1280 x 720 video showing one barcode on a light background, as Y4M. */
async function writeCameraFile(): Promise<void> {
  const source = PNG.sync.read(await barcodePng('code128', CAMERA_TEXT));
  const width = 1280;
  const height = 720;
  const luma = Buffer.alloc(width * height, 235);
  const left = Math.floor((width - source.width) / 2);
  const top = Math.floor((height - source.height) / 2);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const offset = (y * source.width + x) * 4;
      const brightness = ((source.data[offset] as number) * 299 + (source.data[offset + 1] as number) * 587 + (source.data[offset + 2] as number) * 114) / 1000;
      luma[(top + y) * width + left + x] = Math.round(16 + (brightness / 255) * 219);
    }
  }
  const chroma = Buffer.alloc((width / 2) * (height / 2), 128);
  const parts: Buffer[] = [Buffer.from(`YUV4MPEG2 W${width} H${height} F10:1 Ip A1:1 C420jpeg\n`)];
  for (let frame = 0; frame < 5; frame += 1) parts.push(Buffer.from('FRAME\n'), luma, chroma, chroma);
  writeFileSync(CAMERA_FILE, Buffer.concat(parts));
}

/** An rMQR Code, which the Barcode Generator does not draw: straight from the encoder library. */
async function rmqrFile(name: string, text: string): Promise<string> {
  const draw = bwipjs as unknown as { toBuffer(options: Record<string, unknown>): Promise<Buffer> };
  const path = join(MEDIA, name);
  writeFileSync(path, await draw.toBuffer({ bcid: 'rectangularmicroqrcode', text, version: 'R11x77', scale: 4, paddingwidth: 12, paddingheight: 12, backgroundcolor: 'ffffff' }));
  return path;
}

/** A barcode the Barcode Generator would not draw this way, drawn by the same encoder library directly. */
async function drawnFile(name: string, options: Record<string, unknown>): Promise<string> {
  const draw = bwipjs as unknown as { toBuffer(options: Record<string, unknown>): Promise<Buffer> };
  const path = join(MEDIA, name);
  writeFileSync(path, await draw.toBuffer({ scale: 4, paddingwidth: 12, paddingheight: 12, backgroundcolor: 'ffffff', ...options }));
  return path;
}

/**
 * The Content-Security-Policy the application sends with every page, taken from the plugin that
 * sends it and not copied here.
 *
 * One directive is left out: `upgrade-insecure-requests` turns the page's own http:// requests into
 * https:// ones, and the preview server speaks plain HTTP. It has no bearing on what scripts may do.
 */
async function sitePolicy(): Promise<string> {
  const app = Fastify();
  await registerSecurityPlugins(app, { APP_URL: 'http://127.0.0.1' } as Env);
  app.get('/', async () => 'ok');
  const response = await app.inject({ method: 'GET', url: '/' });
  await app.close();
  const policy = String(response.headers['content-security-policy'] ?? '');
  if (!policy.includes("script-src 'self'")) throw new Error(`The application sent no usable policy: "${policy}"`);
  return policy
    .split(';')
    .map((directive) => directive.trim())
    .filter((directive) => directive !== '' && directive !== 'upgrade-insecure-requests')
    .join('; ');
}

type WithViolations = { __violations: string[] };

/**
 * Serve the page's document with a Content-Security-Policy, as the application does, and record
 * what the browser then refuses and every address it asks for. Call before the page opens.
 */
async function underPolicy(page: Page, policy: string): Promise<{ requested: string[]; refused: () => Promise<string[]> }> {
  const requested: string[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.resourceType() !== 'document') return route.fallback();
    const response = await route.fetch();
    return route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': policy } });
  });
  page.on('request', (request) => requested.push(request.url()));
  await page.addInitScript(() => {
    const violations: string[] = [];
    (window as unknown as { __violations: string[] }).__violations = violations;
    document.addEventListener('securitypolicyviolation', (event) => violations.push(`${event.effectiveDirective} ${event.blockedURI}`));
  });
  return { requested, refused: () => page.evaluate(() => (window as unknown as WithViolations).__violations) };
}

// The browser is started with a camera that plays the file above, so the file is named before it starts
// and written before the first test opens the page.
test.use({
  launchOptions: {
    ...(process.env.CH247_CHROMIUM_PATH ? { executablePath: process.env.CH247_CHROMIUM_PATH } : {}),
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${CAMERA_FILE}`],
  },
  permissions: ['camera', 'clipboard-read', 'clipboard-write'],
});

test.beforeAll(async () => {
  await writeCameraFile();
});

const catalogue = { success: true, count: TOOL_CATALOG.length, tools: TOOL_CATALOG.map((tool) => ({ ...tool, notes: tool.notes ?? [], status: 'ACTIVE', statusMessage: null })) };

/** Serve the catalogue, and record anything else the page asks an API for. */
async function open(page: Page): Promise<string[]> {
  const posted: string[] = [];
  await page.route('**/api/tools/catalog*', (route) => route.fulfill({ json: catalogue }));
  page.on('request', (request) => {
    if (request.method() !== 'GET' && request.url().includes('/api/')) posted.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  await page.goto('/tools/barcode-scanner');
  await expect(page.getByRole('heading', { level: 1, name: 'Barcode Scanner' })).toBeVisible();
  return posted;
}

async function choose(page: Page, path: string): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(path);
}

const contents = (page: Page) => page.locator('.scanner-record__text');

type WithStreams = { __streams: MediaStream[] };

/** Keep every camera stream the page is given, so a test can see afterwards whether one is still running. Call before the page opens. */
async function recordCameras(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const streams: MediaStream[] = [];
    (window as unknown as { __streams: MediaStream[] }).__streams = streams;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      streams.push(stream);
      return stream;
    };
  });
}

/** The state of every camera track handed to the page so far: `live` is a camera that is on, `ended` one that was switched off. */
const cameraTracks = (page: Page): Promise<string[][]> =>
  page.evaluate(() => (window as unknown as WithStreams).__streams.map((stream) => stream.getTracks().map((track) => track.readyState)));

const LOAD_PROBLEM = 'The scanner could not be loaded. Check your connection, then refresh the page and try again.';
const NO_BARCODE = 'No barcode was read from that picture.';
const BASIC_NOTICE =
  'This browser did not start the scanner’s full decoder, which needs WebAssembly, so a smaller one is in use. It reads the first 13 types below and not the 8 marked “not in this browser”.';

/** The eight types only the full decoder reads: file, generator type, type shown, content shown. */
const FULL_ONLY: Array<[string, string, string, string]> = [
  ['upce.png', 'upce', 'UPC-E', '01234558'],
  ['databar-limited.png', 'databar-limited', 'GS1 DataBar Limited', '0109521234543213'],
  ['databar-expanded.png', 'databar-expanded', 'GS1 DataBar Expanded', '01095212345432133103000123'],
  ['microqr.png', 'microqr', 'Micro QR Code', '12345678'],
  ['micropdf417.png', 'micropdf417', 'MicroPDF417', 'MicroPDF417'],
  ['telepen.png', 'telepen', 'Telepen', 'ABC-123'],
  ['maxicode.png', 'maxicode', 'MaxiCode', 'CloudHost247 MaxiCode'],
];

/** Types both decoders read, with what each must show. */
const BOTH: Array<[string, string, string, string]> = [
  ['both-code128.png', 'code128', 'Code 128', 'CH247-000123'],
  ['both-qr.png', 'qrcode', 'QR Code', 'https://cloudhost247.com/tools'],
  ['both-ean13.png', 'ean13', 'EAN-13', '9520123456788'],
  ['both-ean8.png', 'ean8', 'EAN-8', '95200002'],
  ['both-upca.png', 'upca', 'UPC-A', '012345000058'],
  ['both-datamatrix.png', 'datamatrix', 'Data Matrix', 'CH247-DM-0001'],
  ['both-pdf417.png', 'pdf417', 'PDF417', 'CloudHost247 PDF417 sample'],
  ['both-aztec.png', 'aztec', 'Aztec Code', 'CH247 Aztec 0001'],
  ['both-code39.png', 'code39', 'Code 39', 'PART-1234'],
  ['both-code93.png', 'code93', 'Code 93', 'CODE 93'],
  ['both-itf14.png', 'itf14', 'Interleaved 2 of 5', '09521234543213'],
  ['both-codabar.png', 'codabar', 'Codabar', 'A0123456789B'],
  ['both-databar.png', 'databar', 'GS1 DataBar', '0109521234543213'],
];

const firstRow = (page: Page) => page.locator('.scanner-records li').first();

test.describe('Barcode Scanner', () => {
  test('reads barcodes from chosen pictures, one type after another, without uploading them', async ({ page }) => {
    const posted = await open(page);
    await expect(page.locator('.scanner-count')).toHaveText('Nothing yet');

    const cases: Array<[string, string, string | undefined, string, string]> = [
      ['code128.png', 'code128', undefined, 'Code 128', 'CH247-000123'],
      ['qr.png', 'qrcode', undefined, 'QR Code', 'https://cloudhost247.com/tools'],
      ['ean13.png', 'ean13', undefined, 'EAN-13', '9520123456788'],
      ['datamatrix.png', 'datamatrix', undefined, 'Data Matrix', 'CH247-DM-0001'],
      ['pdf417.png', 'pdf417', undefined, 'PDF417', 'CloudHost247 PDF417 sample'],
      ['code39.png', 'code39', undefined, 'Code 39', 'PART-1234'],
      ['itf14.png', 'itf14', undefined, 'Interleaved 2 of 5', '09521234543213'],
      ['codabar.png', 'codabar', undefined, 'Codabar', 'A0123456789B'],
      ['aztec.png', 'aztec', undefined, 'Aztec Code', 'CH247 Aztec 0001'],
    ];
    for (const [index, [file, id, data, type, text]] of cases.entries()) {
      await choose(page, await pngFile(file, id, data));
      // Newest first.
      await expect(contents(page).first()).toHaveText(text);
      await expect(page.locator('.scanner-records li').first().locator('strong')).toHaveText(type);
      await expect(page.locator('.scanner-records li')).toHaveCount(index + 1);
    }
    await expect(page.locator('.scanner-count')).toHaveText('9 barcodes');

    // A linear barcode photographed on its side is read as well.
    await choose(page, await pngFile('sideways.png', 'code128', 'SIDEWAYS-7', 1));
    await expect(contents(page).first()).toHaveText('SIDEWAYS-7');

    // The same picture again is a second scan of the same barcode, not a second row.
    await choose(page, join(MEDIA, 'code128.png'));
    await expect(page.locator('.scanner-count')).toHaveText('10 barcodes, 11 scans');
    await expect(page.locator('.scanner-records li', { hasText: 'CH247-000123' }).locator('.scanner-record__times')).toHaveText('× 2');

    // A web address is shown as text, with a caution, and is not a link.
    const web = page.locator('.scanner-records li', { hasText: 'https://cloudhost247.com/tools' });
    await expect(web).toContainText('Web address');
    await expect(web).toContainText('Check the address before you open it. A code can point anywhere.');
    await expect(web.locator('a')).toHaveCount(0);

    expect(posted).toEqual([]);
  });

  test('reads the eight types that need the full decoder, and a UPC-E as the digits printed under it', async ({ page }) => {
    const posted = await open(page);
    for (const [index, [file, id, type, text]] of FULL_ONLY.entries()) {
      await choose(page, await pngFile(file, id));
      await expect(contents(page).first()).toHaveText(text);
      await expect(firstRow(page).locator('strong')).toHaveText(type);
      await expect(page.locator('.scanner-records li')).toHaveCount(index + 1);
    }
    await choose(page, await rmqrFile('rmqr.png', 'CH247 rMQR 0001'));
    await expect(contents(page).first()).toHaveText('CH247 rMQR 0001');
    await expect(firstRow(page).locator('strong')).toHaveText('rMQR Code');
    await expect(page.locator('.scanner-count')).toHaveText('8 barcodes');

    // A UPC-E is a product number, like the other retail barcodes.
    await expect(page.locator('.scanner-records li', { hasText: '01234558' })).toContainText('Product number');
    // A Telepen cannot say whether it holds text or a number, so the number is offered beside the text.
    await expect(page.locator('.scanner-records li', { hasText: 'ABC-123' })).toContainText('Read as text. If this is a numeric Telepen, the same bars are the number 38394018222324.');

    // The full decoder reads bars printed light on dark, and a barcode lying on its side, in a still picture.
    const dark = PNG.sync.read(await barcodePng('upce', '01234565'));
    for (let offset = 0; offset < dark.data.length; offset += 4) {
      dark.data[offset] = 255 - (dark.data[offset] as number);
      dark.data[offset + 1] = 255 - (dark.data[offset + 1] as number);
      dark.data[offset + 2] = 255 - (dark.data[offset + 2] as number);
    }
    const darkPath = join(MEDIA, 'upce-dark.png');
    writeFileSync(darkPath, PNG.sync.write(dark));
    await choose(page, darkPath);
    await expect(contents(page).first()).toHaveText('01234565');
    await choose(page, await pngFile('databar-side.png', 'databar-expanded', '(01)09521234543213(10)SIDE7', 1));
    await expect(contents(page).first()).toHaveText('010952123454321310SIDE7');

    // All twenty-one types are listed, none marked as missing, and no notice is shown.
    await expect(page.locator('.scanner-formats li')).toHaveCount(21);
    await expect(page.locator('.scanner-formats li.is-missing')).toHaveCount(0);
    await expect(page.locator('.scanner-basic')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(posted).toEqual([]);
  });

  test('runs the full decoder under the security policy the application sends, with nothing refused and nothing fetched elsewhere', async ({ page }) => {
    const policy = await sitePolicy();
    // The allowance this depends on, and the one it must not be mistaken for.
    const script = policy.split('; ').find((directive) => directive.startsWith('script-src ')) ?? '';
    expect(script.split(' ')).toContain("'wasm-unsafe-eval'");
    expect(script.split(' ')).not.toContain("'unsafe-eval'");

    const { requested, refused } = await underPolicy(page, policy);
    const posted = await open(page);
    // The page is under the policy: running text as code is refused, as it must stay. (Asked from a
    // timer, because a browser lets the code a test injects do what the page's own code may not.)
    const evaluated = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          setTimeout(() => {
            try {
              resolve(String(new Function('return 6 * 7')()));
            } catch (error) {
              resolve((error as Error).name);
            }
          }, 0);
        })
    );
    expect(evaluated).toBe('EvalError');
    const before = await refused();
    expect(before).toEqual(['script-src eval']);

    await expect(page.locator('.scanner-basic')).toHaveCount(0);
    for (const [file, id, type, text] of [...FULL_ONLY.slice(0, 4), ...BOTH.slice(0, 4)]) {
      await choose(page, await pngFile(`policy-${file}`, id));
      await expect(contents(page).first()).toHaveText(text);
      await expect(firstRow(page).locator('strong')).toHaveText(type);
    }
    await page.getByRole('button', { name: 'Start camera' }).click();
    await expect(contents(page).first()).toHaveText(CAMERA_TEXT, { timeout: 20_000 });
    await page.getByRole('button', { name: 'Stop camera' }).click();

    // It was the full decoder: all types offered, and its binary was fetched while the basic one was not.
    await expect(page.locator('.scanner-formats li.is-missing')).toHaveCount(0);
    await expect(page.locator('.scanner-basic')).toHaveCount(0);
    const assets = requested.map((url) => new URL(url)).filter((url) => url.pathname.startsWith('/assets/'));
    expect(assets.filter((url) => url.pathname.endsWith('.wasm')).map((url) => url.pathname)).toEqual([expect.stringMatching(/^\/assets\/zxing_reader-[\w-]+\.wasm$/)]);
    expect(assets.filter((url) => /\/decode-[\w-]+\.js$/.test(url.pathname))).toEqual([]);
    // Everything the page asked for came from the site itself.
    const origin = new URL(page.url()).origin;
    expect([...new Set(requested.map((url) => (url.startsWith('data:') ? origin : new URL(url).origin)))]).toEqual([origin]);
    // The policy refused nothing the scanner did.
    expect(await refused()).toEqual(before);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(posted).toEqual([]);
  });

  test('where WebAssembly is refused, says so from the start, marks the eight types it cannot read and reads the other thirteen', async ({ page }) => {
    // The application's policy without the one allowance: what a browser too old to know the word
    // sees, and much the same as a browser with WebAssembly switched off.
    const allowed = await sitePolicy();
    const policy = allowed.replace(" 'wasm-unsafe-eval'", '');
    expect(policy).not.toBe(allowed);
    expect(policy).not.toContain('wasm');

    const { requested } = await underPolicy(page, policy);
    const posted = await open(page);
    // Said before anything is scanned, so the list of types is right when it is first read.
    await expect(page.locator('.scanner-basic')).toHaveText(BASIC_NOTICE);
    await expect(page.locator('.scanner-formats li')).toHaveCount(21);
    await expect(page.locator('.scanner-formats li.is-missing')).toHaveText(
      ['UPC-E', 'GS1 DataBar Limited', 'GS1 DataBar Expanded', 'Micro QR Code', 'rMQR Code', 'MicroPDF417', 'Telepen', 'MaxiCode'].map((name) => `${name} not in this browser`)
    );
    // The mark is a word and not a colour alone, and the notice is not an error.
    await expect(page.getByRole('alert')).toHaveCount(0);

    // The thirteen types are read, with the same type and the same content as the full decoder gives.
    for (const [index, [file, id, type, text]] of BOTH.entries()) {
      await choose(page, await pngFile(`basic-${file}`, id));
      await expect(contents(page).first()).toHaveText(text);
      await expect(firstRow(page).locator('strong')).toHaveText(type);
      await expect(page.locator('.scanner-records li')).toHaveCount(index + 1);
    }
    // The other eight are not, and the page says no barcode was read rather than guess.
    for (const [file, id] of FULL_ONLY) {
      await choose(page, await pngFile(`basic-${file}`, id));
      await expect(page.getByRole('alert')).toContainText(NO_BARCODE);
      await choose(page, join(MEDIA, 'basic-both-code128.png'));
      await expect(page.getByRole('alert')).toHaveCount(0);
    }
    await expect(page.locator('.scanner-records li')).toHaveCount(13);

    // The camera works with the basic decoder as it did before.
    await page.getByRole('button', { name: 'Start camera' }).click();
    await expect(contents(page).first()).toHaveText(CAMERA_TEXT, { timeout: 20_000 });
    await page.getByRole('button', { name: 'Stop camera' }).click();

    // The binary was never asked for: a browser that cannot run it is not made to download it.
    const assets = requested.map((url) => new URL(url).pathname).filter((path) => path.startsWith('/assets/'));
    expect(assets.filter((path) => path.endsWith('.wasm'))).toEqual([]);
    expect(assets.filter((path) => /\/decode-[\w-]+\.js$/.test(path))).toHaveLength(1);
    expect(posted).toEqual([]);
  });

  test('gives text beyond ASCII, GS1 marks and bytes that are not text in the same words with either decoder', async ({ page }) => {
    // Bytes, written the way the encoder library takes them.
    const bytes = (values: Iterable<number>): string => Array.from(values, (value) => `^${String(value).padStart(3, '0')}`).join('');
    const pictures: Array<[string, Record<string, unknown>, string, string]> = [
      // Latin-1 with nothing to say so. The basic decoder's library reads this in a browser and not under Node.
      ['latin1-qr.png', { bcid: 'qrcode', text: bytes(Buffer.from('Café München', 'latin1')), parse: true, binarytext: true }, 'QR Code', 'Café München'],
      // UTF-8 with nothing to say so. The same library reads this under Node and garbles it in a browser.
      ['utf8-matrix.png', { bcid: 'datamatrix', text: bytes(Buffer.from('Ọláyínká ₦5', 'utf8')), parse: true, binarytext: true }, 'Data Matrix', 'Ọláyínká ₦5'],
      ['utf8-pdf417.png', { bcid: 'pdf417', text: bytes(Buffer.from('Adéwálé ₦7', 'utf8')), parse: true, binarytext: true }, 'PDF417', 'Adéwálé ₦7'],
      ['utf8-aztec.png', { bcid: 'azteccode', text: bytes(Buffer.from('Jos ₦9 · Plateau', 'utf8')), parse: true, binarytext: true }, 'Aztec Code', 'Jos ₦9 · Plateau'],
      // A character set stated in the symbol: Cyrillic, which nothing but the statement reveals.
      ['stated-pdf417.png', { bcid: 'pdf417', text: `^ECI000007${bytes([0xbf, 0xe0, 0xd8, 0xd2, 0xd5, 0xe2])}`, parse: true, parsefnc: true, binarytext: true }, 'PDF417', 'Привет'],
      ['stated-matrix.png', { bcid: 'datamatrix', text: `^ECI000026${bytes(Buffer.from('Ọlá 26', 'utf8'))}`, parse: true, parsefnc: true, binarytext: true }, 'Data Matrix', 'Ọlá 26'],
      // A GS1 Aztec Code: the opening mark is not data, the one between the fields is shown as a separator.
      ['gs1-aztec.png', { bcid: 'azteccode', text: '^FNC1010952123454321310AB123^FNC121SER99', parsefnc: true }, 'Aztec Code', '010952123454321310AB123␝21SER99'],
      // Bytes that are text in no character set: one character each, the unprintable ones as a picture.
      ['data-matrix.png', { bcid: 'datamatrix', text: bytes(Buffer.from('d32f846b86608772884c', 'hex')), parse: true, binarytext: true }, 'Data Matrix', 'Ó/␦k␦`␦r␦L'],
    ];
    const files: Array<[string, string, string]> = [];
    for (const [name, options, type, text] of pictures) files.push([await drawnFile(name, options), type, text]);

    const readAll = async (): Promise<void> => {
      for (const [index, [file, type, text]] of files.entries()) {
        await choose(page, file);
        await expect(contents(page).first()).toHaveText(text);
        await expect(firstRow(page).locator('strong')).toHaveText(type);
        await expect(page.locator('.scanner-records li')).toHaveCount(index + 1);
      }
    };

    // The full decoder.
    await open(page);
    await readAll();
    await expect(page.locator('.scanner-basic')).toHaveCount(0);

    // The basic decoder, in the same browser: the application's policy without the allowance for WebAssembly.
    await underPolicy(page, (await sitePolicy()).replace(" 'wasm-unsafe-eval'", ''));
    await open(page);
    await expect(page.locator('.scanner-basic')).toHaveText(BASIC_NOTICE);
    await expect(page.locator('.scanner-records li')).toHaveCount(0);
    await readAll();
  });

  test('falls back to the basic decoder when the binary is not delivered, and says so once it knows', async ({ page }) => {
    await open(page);
    // A network that will not pass a .wasm file, as some filtering proxies will not.
    await page.route('**/*.wasm', (route) => route.fulfill({ status: 403, contentType: 'text/html', body: '<h1>Blocked by policy</h1>' }));
    // Nothing is known yet: the browser can run WebAssembly, so the page has not said otherwise.
    await expect(page.locator('.scanner-basic')).toHaveCount(0);

    await choose(page, await pngFile('proxy-code128.png', 'code128', 'PROXY-0001'));
    await expect(contents(page).first()).toHaveText('PROXY-0001');
    await expect(page.locator('.scanner-basic')).toHaveText(BASIC_NOTICE);
    await expect(page.locator('.scanner-formats li.is-missing')).toHaveCount(8);
    await expect(page.getByRole('alert')).toHaveCount(0);

    await choose(page, await pngFile('proxy-upce.png', 'upce'));
    await expect(page.getByRole('alert')).toContainText(NO_BARCODE);
  });

  test('says so when a picture holds no barcode, and when a file is not a picture', async ({ page }) => {
    await open(page);
    const blank = new PNG({ width: 800, height: 600 });
    blank.data.fill(255);
    const blankPath = join(MEDIA, 'blank.png');
    writeFileSync(blankPath, PNG.sync.write(blank));
    await choose(page, blankPath);
    await expect(page.getByRole('alert')).toContainText('No barcode was read from that picture.');
    await expect(page.locator('.scanner-records li')).toHaveCount(0);

    const notPicture = join(MEDIA, 'notes.png');
    writeFileSync(notPicture, 'these are words, not pixels');
    await choose(page, notPicture);
    await expect(page.getByRole('alert')).toHaveText('That file could not be opened as a picture. Choose a PNG, JPEG or WebP image.');

    // A good picture afterwards clears the message.
    await choose(page, await pngFile('after.png', 'code128'));
    await expect(contents(page).first()).toHaveText('CH247-000123');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('reads JPEG and WebP pictures as well as PNG', async ({ page }) => {
    // The page names all three formats, and the upload API sends JPEG users here. The files are made
    // by the browser's own encoders at a lossy quality, so they are real JPEG and WebP files with
    // the smearing those formats add around sharp edges.
    await open(page);
    const convert = async (name: string, png: Buffer, mime: 'image/jpeg' | 'image/webp', quality: number): Promise<string> => {
      const encoded = await page.evaluate(
        async ({ source, type, level }) => {
          const image = new Image();
          image.src = `data:image/png;base64,${source}`;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('no canvas');
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0);
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, level));
          if (!blob || blob.type !== type) throw new Error(`the browser did not encode ${type}`);
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let binary = '';
          for (const byte of bytes) binary += String.fromCharCode(byte);
          return btoa(binary);
        },
        { source: png.toString('base64'), type: mime, level: quality }
      );
      const path = join(MEDIA, name);
      writeFileSync(path, Buffer.from(encoded, 'base64'));
      return path;
    };

    const jpeg = await convert('code128.jpg', await barcodePng('code128', 'JPEG-0001'), 'image/jpeg', 0.5);
    // The file is what its name says: a JPEG starts FF D8 FF.
    expect(readFileSync(jpeg).subarray(0, 3).toString('hex')).toBe('ffd8ff');
    await choose(page, jpeg);
    await expect(contents(page).first()).toHaveText('JPEG-0001');
    await expect(page.locator('.scanner-records li').first().locator('strong')).toHaveText('Code 128');

    const webp = await convert('qr.webp', await barcodePng('qrcode', 'https://cloudhost247.com/webp'), 'image/webp', 0.5);
    // A WebP is a RIFF file whose form type is WEBP.
    expect(readFileSync(webp).subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(readFileSync(webp).subarray(8, 12).toString('latin1')).toBe('WEBP');
    await choose(page, webp);
    await expect(contents(page).first()).toHaveText('https://cloudhost247.com/webp');
    await expect(page.locator('.scanner-records li').first().locator('strong')).toHaveText('QR Code');

    const retail = await convert('ean13.jpg', await barcodePng('ean13'), 'image/jpeg', 0.4);
    await choose(page, retail);
    await expect(contents(page).first()).toHaveText('9520123456788');
    await expect(page.locator('.scanner-count')).toHaveText('3 barcodes');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('scans with the camera, lists a barcode held in view once, and releases the camera', async ({ page }) => {
    const posted = await open(page);
    await page.getByRole('button', { name: 'Start camera' }).click();
    await expect(page.locator('.scanner-view.is-on')).toBeVisible();
    await expect(contents(page).first()).toHaveText(CAMERA_TEXT, { timeout: 20_000 });
    await expect(page.locator('.scanner-records li').first().locator('strong')).toHaveText('Code 128');

    // The camera goes on seeing the same barcode several times a second: still one row, one scan.
    await page.waitForTimeout(2500);
    await expect(page.locator('.scanner-count')).toHaveText('1 barcode');
    await expect(page.locator('.scanner-record__times')).toHaveCount(0);
    expect(await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Stop camera' }).click();
    await expect(page.getByRole('button', { name: 'Start camera' })).toBeVisible();
    // Stopped means released: the page holds no live camera track.
    expect(await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).srcObject)).toBeNull();
    expect(posted).toEqual([]);
  });

  test('switches the camera off again when the decoder cannot be loaded, and scans after a refresh', async ({ page }) => {
    await recordCameras(page);
    await open(page);
    // The decoders are files of their own, fetched when scanning is first asked for. Here every
    // request made from now on fails, as it does on a connection that drops: the full decoder
    // cannot be fetched, and neither can the basic one that would take its place.
    const failed: string[] = [];
    await page.route('**/assets/**', (route) => {
      failed.push(new URL(route.request().url()).pathname.replace(/-[\w-]{8}\./, '.'));
      return route.abort('failed');
    });

    await page.getByRole('button', { name: 'Start camera' }).click();
    await expect(page.getByRole('alert')).toHaveText(LOAD_PROBLEM);
    await expect(page.getByRole('button', { name: 'Start camera' })).toBeEnabled();
    // The browser did hand over a camera. It is not left running behind an error message.
    expect(await cameraTracks(page)).toEqual([['ended']]);
    expect(await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).srcObject)).toBeNull();

    // A picture meets the same failure and gets the same explanation, not "that file is not a picture".
    await choose(page, await pngFile('retry.png', 'code128', 'RETRY-0001'));
    await expect(page.getByRole('alert')).toHaveText(LOAD_PROBLEM);
    await expect(page.locator('.scanner-records li')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Choose a picture' })).toBeEnabled();

    // Pressing Start camera again before refreshing fails the same way, and that camera is switched off too.
    await page.getByRole('button', { name: 'Start camera' }).click();
    await expect(page.getByRole('alert')).toHaveText(LOAD_PROBLEM);
    await expect(page.getByRole('button', { name: 'Start camera' })).toBeEnabled();
    expect(await cameraTracks(page)).toEqual([['ended'], ['ended']]);
    // What failed was the full decoder's two files and then the basic decoder's one.
    expect([...new Set(failed)].sort()).toEqual(['/assets/decode.js', '/assets/index.js', '/assets/zxing_reader.wasm']);
    // A decoder that could not be fetched is not reported as a browser without WebAssembly.
    await expect(page.locator('.scanner-basic')).toHaveCount(0);

    // The connection is back and the page is refreshed, as the message asks. (Chromium does not ask
    // for a script again that failed to load, so nothing short of a refresh would do.)
    await page.unroute('**/assets/**');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Barcode Scanner' })).toBeVisible();
    await choose(page, join(MEDIA, 'retry.png'));
    await expect(contents(page).first()).toHaveText('RETRY-0001');
    await expect(page.getByRole('alert')).toHaveCount(0);

    await page.getByRole('button', { name: 'Start camera' }).click();
    await expect(page.locator('.scanner-view.is-on')).toBeVisible();
    await expect(contents(page).first()).toHaveText(CAMERA_TEXT, { timeout: 20_000 });
    expect(await cameraTracks(page)).toEqual([['live']]);
    await page.getByRole('button', { name: 'Stop camera' }).click();
    await expect(page.getByRole('button', { name: 'Start camera' })).toBeVisible();
    expect(await cameraTracks(page)).toEqual([['ended']]);
  });

  test('does not start a camera for a tab that has gone into the background', async ({ page }) => {
    await recordCameras(page);
    await open(page);
    // The visitor moves to another tab while the camera is starting. A page learns that from
    // `document.hidden`; the change event has already passed by the time the camera arrives.
    await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
    await page.getByRole('button', { name: 'Start camera' }).click();
    await expect(page.locator('.scanner-status [role="status"]')).toHaveText('The camera was not started because this tab is in the background. Press Start camera when you are back.');
    expect(await cameraTracks(page)).toEqual([['ended']]);
    await expect(page.locator('.scanner-view.is-on')).toHaveCount(0);

    // Back on the tab, the camera starts as usual.
    await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }));
    await page.getByRole('button', { name: 'Start camera' }).click();
    await expect(page.locator('.scanner-view.is-on')).toBeVisible();
    await expect(contents(page).first()).toHaveText(CAMERA_TEXT, { timeout: 20_000 });
    await page.getByRole('button', { name: 'Stop camera' }).click();
    expect(await cameraTracks(page)).toEqual([['ended'], ['ended']]);
  });

  test('gives the list as a CSV file and as text, and empties it on request', async ({ page }) => {
    await open(page);
    await choose(page, await pngFile('csv-1.png', 'code128'));
    await expect(contents(page).first()).toHaveText('CH247-000123');
    // A barcode whose content a spreadsheet would run as a formula.
    await choose(page, await pngFile('csv-2.png', 'qrcode', '=HYPERLINK("https://evil.example","Click")'));
    await expect(contents(page).first()).toHaveText('=HYPERLINK("https://evil.example","Click")');

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()]);
    expect(download.suggestedFilename()).toBe('scanned-barcodes.csv');
    const path = await download.path();
    if (!path) throw new Error('the CSV was not saved');
    const rows = readFileSync(path, 'utf8').split('\r\n');
    expect(rows[0]).toBe('\uFEFF"Number","First scanned (UTC)","Type","Content","Kind","Times scanned"');
    expect(rows[1]).toMatch(/^"1","\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z","Code 128","CH247-000123","Text","1"$/);
    // The formula is written as text: a leading apostrophe, and its quotation marks doubled.
    expect(rows[2]).toMatch(/^"2","[^"]+","QR Code","'=HYPERLINK\(""https:\/\/evil\.example"",""Click""\)","Text","1"$/);
    expect(rows).toHaveLength(4);

    await page.getByRole('button', { name: 'Copy all' }).click();
    await expect(page.locator('.scanner-status [role="status"]')).toHaveText('The list copied.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('CH247-000123\n=HYPERLINK("https://evil.example","Click")');

    await page.getByRole('button', { name: 'Clear list' }).click();
    await expect(page.locator('.scanner-count')).toHaveText('Nothing yet');
    await expect(page.getByRole('button', { name: 'Download CSV' })).toHaveCount(0);
  });

  test('fits a phone screen without sideways scrolling, with the list below the camera', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await choose(page, await pngFile('phone.png', 'qrcode', 'https://cloudhost247.com/a/very/long/address/that/has/to/wrap/on/a/narrow/screen/without/pushing/the/page/sideways'));
    await expect(contents(page).first()).toBeVisible();
    const overflow = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const outside = Array.from(document.querySelectorAll<HTMLElement>('.scanner button, .scanner video, .scanner-record__text, .scanner-formats li'))
        .filter((node) => node.offsetParent !== null)
        .filter((node) => {
          const box = node.getBoundingClientRect();
          return box.left < -0.5 || box.right > width + 0.5;
        })
        .map((node) => `${node.tagName.toLowerCase()}.${node.className}`);
      return { page: document.documentElement.scrollWidth - width, outside };
    });
    expect(overflow).toEqual({ page: 0, outside: [] });
  });

  test('has no serious or critical WCAG 2.1 AA violations, empty or with a list', async ({ page }, testInfo) => {
    await open(page);
    const blocking = async (label: string): Promise<string[]> => {
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      await testInfo.attach(`axe-scanner-${label}.json`, { body: JSON.stringify(results.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.slice(0, 5).map((n) => n.target) })), null, 2), contentType: 'application/json' });
      return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
    };
    expect(await blocking('empty')).toEqual([]);
    await choose(page, await pngFile('axe.png', 'qrcode'));
    await expect(contents(page).first()).toBeVisible();
    expect(await blocking('list')).toEqual([]);
  });
});
