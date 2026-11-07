/**
 * Real-Chromium acceptance check for the homepage "3D Experience".
 *
 *   BASE_URL=http://127.0.0.1:3000 node scripts/check-3d-experience.mjs
 *
 * Verifies the interactive layer controls, the CSS 3D depth, pointer-driven tilt from the shared
 * motion controller, the reduced-motion / small-screen static fallback, and that the section never
 * makes the page scroll sideways. No WebGL and no external dependency is involved.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

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

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const browser = await launch();

  // ---- Desktop: real 3D + interaction ----
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  const initial = await page.evaluate(() => {
    const section = document.querySelector('.hg-exp3d');
    const planes = [...(section?.querySelectorAll('.hg-exp3d__plane') ?? [])];
    return {
      section: !!section,
      heading: section?.querySelector('h2')?.textContent?.trim(),
      planes: planes.length,
      controls: section?.querySelectorAll('.hg-exp3d__control').length ?? 0,
      activePlane: section?.querySelectorAll('.hg-exp3d__plane.is-active').length ?? 0,
      planeTransform: planes[2] ? getComputedStyle(planes[2]).transform : 'none',
      stageTilt: !!section?.querySelector('[data-tilt]'),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  check('3D Experience section renders on the homepage', initial.section && /three dimensions/i.test(initial.heading ?? ''), initial.heading);
  check('four layered 3D planes and four controls', initial.planes === 4 && initial.controls === 4);
  check('planes carry real CSS 3D depth', initial.planeTransform !== 'none' && initial.planeTransform.includes('matrix3d'), initial.planeTransform.slice(0, 60));
  check('one layer highlighted by default', initial.activePlane === 1);
  check('stage is wired to the shared tilt controller', initial.stageTilt);
  check('no horizontal overflow at 1440px', !initial.overflow);

  // Pointer tilt: motion.js writes --tilt-x / --tilt-y on the [data-tilt] stage.
  const stage = page.locator('.hg-exp3d__stage');
  // The section sits below the fold, so it must be scrolled into view before a real mouse move
  // can land on it (boundingBox coordinates are viewport-relative).
  await stage.scrollIntoViewIfNeeded();
  const box = await stage.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.22);
    await page.waitForTimeout(180);
  }
  const tilt = await page.evaluate(() => {
    const el = document.querySelector('.hg-exp3d__stage');
    return { x: el?.style.getPropertyValue('--tilt-x') ?? '', y: el?.style.getPropertyValue('--tilt-y') ?? '' };
  });
  check('pointer movement drives the 3D tilt', tilt.x !== '' && tilt.x !== '0deg' && tilt.y !== '', `x=${tilt.x} y=${tilt.y}`);

  // Layer controls switch the live detail, the highlighted plane and the destination.
  const before = await page.locator('#hg-exp3d-detail').innerText();
  await page.locator('.hg-exp3d__control').nth(2).click();
  await page.waitForTimeout(180);
  const after = await page.evaluate(() => {
    const detail = document.querySelector('#hg-exp3d-detail');
    const active = [...document.querySelectorAll('.hg-exp3d__control')].findIndex((b) => b.getAttribute('aria-pressed') === 'true');
    return {
      text: detail?.textContent ?? '',
      href: detail?.querySelector('a')?.getAttribute('href'),
      active,
      activePlanes: document.querySelectorAll('.hg-exp3d__plane.is-active').length,
      live: detail?.getAttribute('aria-live'),
    };
  });
  check('choosing a layer updates the live detail and destination',
    after.text !== before && after.href === '/cloud' && after.active === 2 && after.live === 'polite',
    `href=${after.href} active=${after.active}`);
  check('exactly one plane stays highlighted', after.activePlanes === 1);
  check('no uncaught page errors', errors.length === 0, errors.join('; '));
  await page.close();

  // ---- Reduced motion: flat, readable list ----
  const reduced = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await reduced.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await reduced.waitForTimeout(300);
  const reducedState = await reduced.evaluate(() => {
    const stage = document.querySelector('.hg-exp3d__stage');
    const plane = document.querySelector('.hg-exp3d__plane');
    return {
      stageTransform: stage ? getComputedStyle(stage).transform : null,
      planePosition: plane ? getComputedStyle(plane).position : null,
      planeTransform: plane ? getComputedStyle(plane).transform : null,
      visible: plane ? plane.getBoundingClientRect().height > 0 : false,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  check('reduced motion disables tilt', reducedState.stageTransform === 'none', String(reducedState.stageTransform));
  check('reduced motion shows a flat stacked list', reducedState.planePosition === 'relative' && reducedState.planeTransform === 'none' && reducedState.visible);
  check('no horizontal overflow under reduced motion', !reducedState.overflow);
  await reduced.close();

  // ---- Phone: static list, no overflow ----
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await phone.waitForTimeout(300);
  const mobile = await phone.evaluate(() => {
    const plane = document.querySelector('.hg-exp3d__plane');
    return {
      position: plane ? getComputedStyle(plane).position : null,
      transform: plane ? getComputedStyle(plane).transform : null,
      controls: document.querySelectorAll('.hg-exp3d__control').length,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  check('phone shows the static list with working controls', mobile.position === 'relative' && mobile.transform === 'none' && mobile.controls === 4);
  check('no horizontal overflow at 390px', !mobile.overflow);
  await phone.close();

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 3D Experience checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(2); });
