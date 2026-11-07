/**
 * Real-Chromium acceptance check for the single-row dark menu / professional footer chrome.
 *
 *   BASE_URL=http://127.0.0.1:3000 node scripts/check-chrome-benchmark.mjs
 *
 * CSS review alone cannot prove that every top-level section is visible inline, that the old
 * viewport-wide mega panel is gone, or that a 1280px laptop does not squeeze the right-hand
 * cluster into the nav. Every assertion below reads a computed style or a bounding box from a
 * real page, at desktop, laptop and phone widths.
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

/** Relative luminance of an rgb()/rgba() computed colour. */
function luminance(value) {
  const parts = (value.match(/[\d.]+/g) ?? []).map(Number);
  const [r, g, b] = parts.slice(0, 3);
  if ([r, g, b].some((n) => Number.isNaN(n))) return 1;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Shared measurements for the horizontal desktop bar. */
const BAR_PROBE = () => {
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
  };
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
  };
  const header = document.querySelector('header.hg-header');
  const brand = document.querySelector('.hg-nav__brand img');
  const strip = document.querySelector('.hg-utility');
  const triggers = [...document.querySelectorAll('.hg-nav__trigger')].filter(visible);
  const utility = [...document.querySelectorAll('.hg-nav__utility, .hg-nav__actions')].filter(visible);
  const quick = document.querySelector('.hg-nav__quick');
  let overlap = 0;
  for (const t of triggers) {
    const tb = box(t);
    for (const other of utility) {
      const ob = box(other);
      if (tb.top < ob.bottom && ob.top < tb.bottom) {
        overlap = Math.max(overlap, Math.min(tb.right, ob.right) - Math.max(tb.x, ob.x));
      }
    }
  }
  return {
    bg: header ? getComputedStyle(header).backgroundColor : null,
    sticky: header ? getComputedStyle(header).position : null,
    headerHeight: header ? Math.round(header.getBoundingClientRect().height) : 0,
    stripHidden: !visible(strip),
    brandWhite: (brand?.getAttribute('src') ?? '').includes('white'),
    triggerCount: triggers.length,
    sameRow: triggers.length > 0 && triggers.every((t) => Math.abs(box(t).top - box(triggers[0]).top) <= 1),
    carets: triggers.filter((t) => t.querySelector('.hg-nav__caret')).length,
    quickLinks: visible(quick) ? quick.querySelectorAll('a').length : 0,
    overlap: Math.round(overlap),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    topAnchor: !!document.querySelector('#ch247-top'),
  };
};

async function main() {
  const browser = await launch();

  // ---- Desktop (the width of the reference screenshot) ----
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  const bar = await page.evaluate(BAR_PROBE);
  check('dark single-row sticky header', luminance(bar.bg) < 0.2 && bar.sticky === 'sticky' && bar.stripHidden,
    `background ${bar.bg}, ${bar.headerHeight}px tall`);
  check('every top-level section is visible inline', bar.triggerCount >= 7 && bar.sameRow && bar.carets >= 7,
    `${bar.triggerCount} triggers, ${bar.carets} carets, one row`);
  check('white brand mark on the dark bar', bar.brandWhite);
  check('quick utility links sit on the bar itself', bar.quickLinks >= 3, `${bar.quickLinks} links`);
  check('back-to-top anchor target exists', bar.topAnchor);
  check('no header overlap at 1440px', bar.overlap === 0 && !bar.overflow, `${bar.overlap}px`);

  const trigger = page.locator('.hg-nav__trigger').first();
  // DOM click, not a pointer click: hover-open would otherwise race the toggle.
  await trigger.evaluate((el) => el.click());
  await page.waitForTimeout(200);
  const mega = await page.evaluate(() => {
    const el = document.querySelector('.hg-mega:not([hidden])');
    if (!el) return { open: false };
    const r = el.getBoundingClientRect();
    const t = document.querySelector('.hg-nav__trigger')?.getBoundingClientRect();
    const intro = el.querySelector('.hg-mega__intro');
    return {
      open: true,
      bg: getComputedStyle(el).backgroundColor,
      groups: el.querySelectorAll('.hg-mega__group').length,
      width: Math.round(r.width),
      left: Math.round(r.left),
      triggerLeft: Math.round(t?.left ?? -1),
      compact: el.classList.contains('hg-mega--compact'),
      introHidden: intro ? getComputedStyle(intro).display === 'none' : false,
      viewport: window.innerWidth,
    };
  });
  // The old panel spanned the whole viewport and had a promo column. The replacement is a
  // narrow, item-anchored dropdown; grouping and real links are preserved.
  check('compact dropdown replaces the full-width mega panel',
    mega.open && mega.compact && luminance(mega.bg) < 0.3 && mega.groups >= 2
      && mega.width > 200 && mega.width < 400 && mega.width < mega.viewport / 3
      && mega.introHidden && Math.abs(mega.left - mega.triggerLeft) <= 2,
    `background ${mega.bg}, ${mega.groups} groups, ${mega.width}px wide at x=${mega.left}`);
  await trigger.evaluate((el) => el.click());

  const footer = await page.evaluate(() => {
    const el = document.querySelector('footer.hg-footer');
    const top = el?.querySelector('.hg-footer__top');
    const bottom = el?.querySelector('.hg-footer__bottom');
    const columns = [...(el?.querySelectorAll('.hg-footer__column') ?? [])];
    return {
      topText: top?.textContent?.trim(),
      topHref: top?.getAttribute('href'),
      // A flex item's computed display is blockified, so `inline-flex` reports as `flex`.
      // Assert the things that actually distinguish an inline legal-bar link from the old
      // full-width retail band: no min-height, no background, and a content-sized box.
      topInline: top ? (getComputedStyle(top).minHeight === '0px'
        && getComputedStyle(top).backgroundColor === 'rgba(0, 0, 0, 0)'
        && top.getBoundingClientRect().width < 300) : false,
      topInBottom: !!bottom?.contains(top ?? null),
      footerBg: el ? getComputedStyle(el).backgroundColor : null,
      bottomBg: bottom ? getComputedStyle(bottom).backgroundColor : null,
      intro: !!el?.querySelector('.hg-footer__intro'),
      columns: columns.length,
      subgroups: el?.querySelectorAll('.hg-footer__subgroup').length ?? 0,
      links: el?.querySelectorAll('.hg-footer__column a').length ?? 0,
      counts: columns.map((c) => c.querySelectorAll('a').length),
      retailPills: el?.querySelectorAll('.hg-footer__locale-pill').length ?? 0,
      height: Math.round(el?.getBoundingClientRect().height ?? 0),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  check('brand intro row above the directory', footer.intro);
  check('deep slate directory with a darker legal bar',
    luminance(footer.footerBg) < 0.2 && luminance(footer.bottomBg) < luminance(footer.footerBg),
    `directory ${footer.footerBg}, bottom ${footer.bottomBg}`);
  check('four balanced columns with eight labelled sub-groups',
    footer.columns === 4 && footer.subgroups === 8 && Math.max(...footer.counts) <= Math.min(...footer.counts) * 2,
    `${footer.columns} columns / ${footer.subgroups} groups / counts ${footer.counts.join(',')}`);
  check('every registry destination still rendered', footer.links >= 90, `${footer.links} links`);
  check('back-to-top is an inline link in the legal bar',
    /Back to top/.test(footer.topText ?? '') && footer.topHref === '#ch247-top' && footer.topInline && footer.topInBottom);
  check('no retail locale pills remain', footer.retailPills === 0);
  check('footer stays compact', footer.height > 0 && footer.height < 1300, `${footer.height}px`);
  await page.close();

  // ---- Laptop: the horizontal bar must survive a narrower window ----
  const laptop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await laptop.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await laptop.waitForTimeout(300);
  const laptopBar = await laptop.evaluate(BAR_PROBE);
  check('horizontal bar with all sections at 1280px',
    laptopBar.triggerCount >= 7 && laptopBar.sameRow && laptopBar.overlap === 0 && !laptopBar.overflow,
    `${laptopBar.triggerCount} triggers, ${laptopBar.overlap}px overlap`);
  await laptop.close();

  // ---- Phone ----
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await phone.waitForTimeout(300);
  const mobile = await phone.evaluate(() => {
    const utility = document.querySelector('.hg-utility');
    const toggle = document.querySelector('.hg-nav__toggle');
    const footer = document.querySelector('footer.hg-footer');
    return {
      utilityHidden: utility ? getComputedStyle(utility).display === 'none' : true,
      toggleVisible: toggle ? getComputedStyle(toggle).display !== 'none' : false,
      columns: footer ? getComputedStyle(footer.querySelector('.hg-footer__columns')).gridTemplateColumns : '',
      footerLinks: footer?.querySelectorAll('.hg-footer__column a').length ?? 0,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  check('utility strip collapses, menu toggle remains on a phone', mobile.utilityHidden && mobile.toggleVisible);
  check('footer keeps two columns and all links on a phone', mobile.columns.split(' ').length === 2 && mobile.footerLinks >= 90,
    `${mobile.columns} / ${mobile.footerLinks} links`);
  check('no horizontal overflow at 390px', !mobile.overflow);
  await phone.close();

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} menu/footer chrome checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(2); });
