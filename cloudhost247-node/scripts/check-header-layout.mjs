/**
 * Rendered-layout regression check (Phase 3, 2026-11-07; flat bar 2026-11-07).
 *
 * A real Chromium render at 1440px once exposed desktop nav triggers overflowing their flex
 * track and colliding with the language/currency cluster. Now that the menu is a flat wrapping
 * list of links, this check measures those links against the inline settings/account groups at
 * several widths and FAILS on any horizontal overlap.
 *
 *   npm run evidence:layout
 *
 * Uses the self-contained npm Chromium (see scripts/capture-rendered-pages.mjs).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const WIDTHS = [1920, 1600, 1440, 1280, 1024, 834, 390];

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

const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x));

async function main() {
  const browser = await launch();
  const failures = [];
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(500);
    const result = await page.evaluate(() => {
      const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, right: r.right, top: r.top, bottom: r.bottom, w: r.width }; };
      const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
      const triggers = [...document.querySelectorAll('.hg-menu__link')].filter(visible).map(box);
      const utility = [...document.querySelectorAll('.hg-bar__locale, .hg-bar__quick')].filter(visible).map(box);
      const actions = [...document.querySelectorAll('.hg-bar__actions')].filter(visible).map(box);
      const bar = document.querySelector('.hg-nav__bar');
      return { triggers, utility, actions, bar: bar ? box(bar) : null, header: !!document.querySelector('.hg-header') };
    });
    let worst = 0;
    for (const t of result.triggers) {
      for (const other of [...result.utility, ...result.actions]) {
        if (t.top < other.bottom && other.top < t.bottom) worst = Math.max(worst, overlap(t, other));
      }
      if (result.bar) worst = Math.max(worst, Math.max(0, t.right - result.bar.right));
    }
    const compact = result.triggers.length === 0;
    const status = worst === 0 ? 'OK' : 'FAIL';
    console.log(`${status.padEnd(4)} ${String(width).padStart(4)}px  links=${result.triggers.length}  utility=${result.utility.length}  actions=${result.actions.length}  overlap=${worst.toFixed(1)}px  ${compact ? 'NO VISIBLE MENU LINKS' : 'flat inline bar'}`);
    if (worst > 0 || !result.header || compact) failures.push({ width, worst, links: result.triggers.length, header: result.header });
    await page.close();
  }
  await browser.close();
  if (failures.length) {
    console.error(`\nLayout regression: ${failures.length} width(s) overlap → ${JSON.stringify(failures)}`);
    process.exit(1);
  }
  console.log('\n✓ no header overlap at any tested width');
}

main().catch((e) => { console.error(e); process.exit(1); });
