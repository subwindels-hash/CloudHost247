/**
 * Capture REAL rendered pages for phase evidence.
 *
 * The sandbox has no system browser and the Playwright CDN download is blocked, so this uses the
 * self-contained Chromium shipped inside the npm package @sparticuz/chromium (no external CDN),
 * driven by the already-installed playwright-core.
 *
 *   npm run evidence:screenshots                      # uses BASE_URL (default preview on :3000)
 *   BASE_URL=http://127.0.0.1:3000 node scripts/capture-rendered-pages.mjs / /pricing
 *
 * Output: docs/evidence/screenshots/*.png + docs/evidence/render-report.json
 * Nothing here deploys, changes data, or contacts a provider — it only renders the running site.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const OUT_DIR = path.resolve(REPO_ROOT, process.env.EVIDENCE_DIR ?? 'docs/evidence/screenshots');
const REPORT_FILE = process.env.EVIDENCE_DIR
  ? path.join(OUT_DIR, 'render-report.json')
  : path.join(REPO_ROOT, 'docs', 'evidence', 'render-report.json');
const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

const DEFAULT_ROUTES = ['/', '/pricing', '/hosting', '/domains', '/tools', '/about'];
const ROUTES = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_ROUTES;
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 390, height: 844 },
];

async function prepareChromium() {
  // The package is an optional dev dependency; explain clearly if it is missing.
  let pkg;
  try {
    pkg = await import('@sparticuz/chromium');
  } catch {
    throw new Error('Install @sparticuz/chromium (dev dependency) to capture rendered pages.');
  }
  const Chromium = pkg.default;
  const binDir = path.join(HERE, '..', 'node_modules', '@sparticuz', 'chromium', 'bin');
  const libDir = path.join(tmpdir(), 'al2023', 'lib');
  if (!existsSync(libDir) && existsSync(path.join(binDir, 'al2023.tar.br'))) {
    await pkg.inflate(path.join(binDir, 'al2023.tar.br')); // libnss3 / libnspr4 for Debian
  }
  const executablePath = await Chromium.executablePath(binDir);
  return { executablePath, libDir };
}

const slug = (route) => (route === '/' ? 'home' : route.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-'));

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const { executablePath, libDir } = await prepareChromium();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    env: { ...process.env, LD_LIBRARY_PATH: `${libDir}${process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : ''}` },
  });

  const report = {
    capturedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    browser: 'Chromium (npm @sparticuz/chromium) via playwright-core',
    screenshots: [],
  };

  for (const route of ROUTES) {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const consoleErrors = [];
      const failedRequests = [];
      page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300)); });
      page.on('requestfailed', (req) => failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText ?? 'failed'}`));
      let status = 0;
      try {
        const response = await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        status = response?.status() ?? 0;
        await page.waitForTimeout(900); // let the SPA mount and CSS settle
        const file = `${slug(route)}-${viewport.name}.png`;
        await page.screenshot({ path: path.join(OUT_DIR, file), fullPage: false });
        const meta = await page.evaluate(() => ({
          title: document.title,
          h1: document.querySelector('h1')?.textContent?.trim() ?? null,
          bodyTextLength: (document.body?.innerText ?? '').length,
          links: document.querySelectorAll('a').length,
          images: document.querySelectorAll('img').length,
          scrollHeight: document.documentElement.scrollHeight,
          hasAppShell: Boolean(document.querySelector('.hg-theme, .ch247-shell, #root > *')),
        }));
        report.screenshots.push({ route, viewport: viewport.name, width: viewport.width, height: viewport.height, status, file, ...meta, consoleErrors, failedRequests });
        console.log(`${String(status).padEnd(3)} ${route.padEnd(16)} ${viewport.name.padEnd(8)} h1=${JSON.stringify(meta.h1)} text=${meta.bodyTextLength} → ${file}`);
      } catch (error) {
        report.screenshots.push({ route, viewport: viewport.name, status, error: String(error), consoleErrors, failedRequests });
        console.log(`ERR ${route} ${viewport.name}: ${String(error).slice(0, 160)}`);
      }
      await context.close();
    }
  }

  // One full-page desktop capture of the homepage as extra evidence.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  try {
    await p.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await p.waitForTimeout(900);
    await p.screenshot({ path: path.join(OUT_DIR, 'home-desktop-full.png'), fullPage: true });
    report.fullPageCapture = 'home-desktop-full.png';
  } catch (error) { report.fullPageError = String(error); }
  await ctx.close();
  await browser.close();

  writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
  const ok = report.screenshots.filter((s) => s.status === 200 && !s.error);
  console.log(`\nCaptured ${ok.length}/${report.screenshots.length} successful renders → ${OUT_DIR}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
