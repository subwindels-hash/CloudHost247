/**
 * Capture the real rendered menu and footer chrome.
 *
 *   EVIDENCE_DIR=docs/evidence/professional/after BASE_URL=http://127.0.0.1:3000 \
 *     node scripts/capture-chrome-benchmark.mjs
 *
 * The ordinary page screenshots stop at the fold, so they cannot show either area this task
 * changes. This captures the header bar, the flat menu area, the full footer element and the
 * homepage 3D Experience at three breakpoints. Nothing is deployed or mutated.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const OUT_DIR = path.resolve(REPO_ROOT, process.env.EVIDENCE_DIR ?? 'docs/evidence/chrome/after');
const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 390, height: 844 },
];

async function launch() {
  const pkg = await import('@sparticuz/chromium');
  const binDir = path.join(HERE, '..', 'node_modules', '@sparticuz', 'chromium', 'bin');
  const libDir = path.join(tmpdir(), 'al2023', 'lib');
  if (!existsSync(libDir) && existsSync(path.join(binDir, 'al2023.tar.br'))) {
    await pkg.inflate(path.join(binDir, 'al2023.tar.br'));
  }
  const executablePath = await pkg.default.executablePath(binDir);
  return chromium.launch({
    executablePath, headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    env: { ...process.env, LD_LIBRARY_PATH: `${libDir}${process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : ''}` },
  });
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await launch();
  const report = { capturedAt: new Date().toISOString(), baseUrl: BASE_URL, shots: [] };

  for (const viewport of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    const header = page.locator('header').first();
    if (await header.count()) {
      await header.screenshot({ path: path.join(OUT_DIR, `header-${viewport.name}.png`) });
      report.shots.push(`header-${viewport.name}.png`);
    }

    // The slim utility/account line that sits directly under the announcement bar.
    const utilityRow = page.locator('.hg-bar__top').first();
    if (await utilityRow.count()) {
      await utilityRow.screenshot({ path: path.join(OUT_DIR, `utility-row-${viewport.name}.png`) });
      report.shots.push(`utility-row-${viewport.name}.png`);
    }

    const footer = page.locator('footer').first();
    if (await footer.count()) {
      // The marketing header is sticky; an element screenshot of a full-height footer otherwise
      // has the header painted across it. Unstick it just for this capture, then restore.
      await page.evaluate(() => {
        const header = document.querySelector('header.hg-header, header.ch-header');
        if (header) header.style.position = 'static';
      });
      await footer.screenshot({ path: path.join(OUT_DIR, `footer-${viewport.name}.png`) });
      await page.evaluate(() => {
        const header = document.querySelector('header.hg-header, header.ch-header');
        if (header) header.style.removeProperty('position');
      });
      report.shots.push(`footer-${viewport.name}.png`);
      report[`footer-${viewport.name}`] = await footer.evaluate((el) => ({
        height: Math.round(el.getBoundingClientRect().height),
        links: el.querySelectorAll('a').length,
        columns: el.querySelectorAll('[class*="column"]').length,
      }));
    }

    // The homepage 3D Experience (when present) is captured as its own element so the layered
    // scene is visible without a full-page shot.
    const experience = page.locator('.hg-exp3d').first();
    if (viewport.name === 'desktop' && await experience.count()) {
      // Scrolling the section into view starts its one-shot reveal animation; let it finish so
      // the evidence shows the finished section rather than a half-faded heading.
      await experience.scrollIntoViewIfNeeded();
      await page.waitForTimeout(900);
      await experience.screenshot({ path: path.join(OUT_DIR, 'experience-3d-desktop.png') });
      report.shots.push('experience-3d-desktop.png');
    }

    if (viewport.name === 'desktop') {
      // The menu is now flat: there is no dropdown to open. Capture the whole menu area with all
      // links visible beside the logo, after scrolling back to the top (the 3D shot scrolls down).
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(200);
      await page.screenshot({
        path: path.join(OUT_DIR, 'menu-flat-desktop.png'),
        clip: { x: 0, y: 0, width: viewport.width, height: 220 },
      });
      report.shots.push('menu-flat-desktop.png');
      report.flatMenuLinks = await page.locator('.hg-menu__link').count();
      report.dropdownTriggers = await page.locator('.hg-nav__trigger, .hg-mega, .hg-nav__toggle').count();
    }
    await page.close();
  }

  await browser.close();
  writeFileSync(path.join(OUT_DIR, 'chrome-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`captured ${report.shots.length} chrome views → ${OUT_DIR}`);
  console.log(JSON.stringify({ desktop: report['footer-desktop'], mobile: report['footer-mobile'], flatMenuLinks: report.flatMenuLinks, dropdownTriggers: report.dropdownTriggers }));
}

main().catch((error) => { console.error(error); process.exitCode = 2; });
