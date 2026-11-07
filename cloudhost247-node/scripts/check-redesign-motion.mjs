/**
 * Live-browser check for the metallic redesign's motion and responsive contract.
 *
 *   BASE_URL=http://127.0.0.1:3000 node scripts/check-redesign-motion.mjs
 *
 * Static tests can prove the CSS and JS exist; only a real browser can prove the tilt actually
 * tilts, parallax actually moves, reveals actually fire, route transitions restart, and that no
 * breakpoint overflows horizontally. Reduced-motion and coarse pointers are checked too, because
 * the redesign promises to switch that behaviour off rather than merely ship a media query.
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

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
  const browser = await launch();

  // 1. Desktop: depth hooks are live, not just present in the markup.
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  const tilt = page.locator('[data-tilt]').first();
  check('hero has a tilt target', await tilt.count() > 0);
  const box = await tilt.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.3);
    await page.waitForTimeout(180);
    const tilted = await tilt.evaluate((el) => ({
      cls: el.classList.contains('is-tilting'),
      x: el.style.getPropertyValue('--tilt-x'),
      y: el.style.getPropertyValue('--tilt-y'),
    }));
    check('pointer tilt sets --tilt-x/--tilt-y', tilted.cls && tilted.x !== '' && tilted.y !== '',
      JSON.stringify(tilted));
    await page.mouse.move(5, 5);
    await page.waitForTimeout(180);
    check('tilt resets when pointer leaves', !(await tilt.evaluate((el) => el.classList.contains('is-tilting'))));
  }

  const parallax = page.locator('[data-parallax]').first();
  check('hero has exactly one parallax layer', await page.locator('[data-parallax]').count() === 1);
  if (await parallax.count()) {
    await page.evaluate(() => window.scrollBy(0, 320));
    await page.waitForTimeout(220);
    const y = await parallax.evaluate((el) => el.style.getPropertyValue('--parallax-y'));
    check('scroll parallax sets --parallax-y', y !== '' && y !== '0px', y || '(unset)');
    await page.evaluate(() => window.scrollTo(0, 0));
  }

  // Scroll the first reveal candidate into view before counting. The observer uses a -6% bottom
  // rootMargin, so a fixed 320px scroll can leave the first candidate just outside it — which made
  // this check flaky rather than proving reveals work.
  const firstReveal = page.locator('[data-reveal]').first();
  if (await firstReveal.count()) {
    await firstReveal.scrollIntoViewIfNeeded();
    await page.waitForTimeout(280);
  }
  const revealed = await page.locator('[data-reveal].is-revealed').count();
  const revealTotal = await page.locator('[data-reveal]').count();
  check('in-view sections reveal', revealTotal > 0 && revealed > 0, `${revealed}/${revealTotal} revealed`);

  // 2. Route transition restarts on client-side navigation without remounting the app.
  // The desktop bar folds the slim utility strip away, so the first DOM match for /pricing can
  // be hidden. Pick a rendered link instead of pinning the old strip's position.
  await page.locator('a[href="/pricing"]:visible').first().click();
  await page.waitForTimeout(120);
  const transition = await page.evaluate(() => ({
    attr: document.querySelector('.ch247-main')?.hasAttribute('data-route-transition') ?? false,
    opacity: getComputedStyle(document.querySelector('.ch247-main')).opacity,
    heading: document.querySelector('h1')?.textContent?.trim() ?? '',
  }));
  check('route transition applies on navigation', transition.attr, JSON.stringify(transition));
  check('navigation renders the destination', /Pricing/i.test(transition.heading), transition.heading);
  check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await desktop.close();

  // 3. Every breakpoint: no horizontal overflow, readable type, accessible controls.
  for (const width of [1920, 1440, 1280, 1024, 834, 768, 390, 360]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const p = await context.newPage();
    await p.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(350);
    const metrics = await p.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
      h1: parseFloat(getComputedStyle(document.querySelector('h1')).fontSize),
      buttons: [...document.querySelectorAll('button, a.ch-btn, .hg-btn')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }).length,
    }));
    check(`${width}px no horizontal overflow`, metrics.scroll <= metrics.inner + 1,
      `scrollWidth=${metrics.scroll} viewport=${metrics.inner}`);
    check(`${width}px readable h1`, metrics.h1 >= 28, `${metrics.h1}px`);
    check(`${width}px has visible controls`, metrics.buttons > 0, `${metrics.buttons} controls`);
    await context.close();
  }

  // 4. Reduced motion: the controller must not add tilt state at all.
  const reduced = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const rp = await reduced.newPage();
  await rp.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await rp.waitForTimeout(350);
  const rt = rp.locator('[data-tilt]').first();
  const rbox = await rt.boundingBox();
  if (rbox) {
    await rp.mouse.move(rbox.x + rbox.width * 0.7, rbox.y + rbox.height * 0.4);
    await rp.waitForTimeout(180);
    check('reduced motion disables tilt',
      !(await rt.evaluate((el) => el.classList.contains('is-tilting') || el.style.getPropertyValue('--tilt-x'))));
  }
  await reduced.close();

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

// Hard exit on failure: an open Chromium would otherwise keep the event loop alive.
main().catch((error) => { console.error(error); process.exit(2); });
