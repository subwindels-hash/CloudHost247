/**
 * Real-Chromium acceptance check for the professional menu/footer chrome.
 *
 *   BASE_URL=http://127.0.0.1:3000 node scripts/check-chrome-benchmark.mjs
 *
 * CSS review alone cannot prove that the menu is light, that the four balanced footer columns
 * render with their sub-groups, or that the extra utility strip did not reintroduce the 1440px
 * nav overlap. Every assertion below reads a computed style or a bounding box from a real page,
 * at desktop and phone widths.
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

async function main() {
  const browser = await launch();

  // ---- Desktop ----
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  const header = await page.evaluate(() => {
    const el = document.querySelector('header.hg-header');
    const utility = document.querySelector('.hg-utility');
    const brand = document.querySelector('.hg-nav__brand img');
    const css = (node) => node ? getComputedStyle(node) : null;
    return {
      bg: css(el)?.backgroundColor,
      sticky: css(el)?.position,
      utilityVisible: utility ? getComputedStyle(utility).display !== 'none' : false,
      utilityLinks: document.querySelectorAll('.hg-utility a').length,
      brandDark: (brand?.getAttribute('src') ?? '').includes('dark'),
      topAnchor: !!document.querySelector('#ch247-top'),
    };
  });
  check('professional light sticky header', luminance(header.bg) > 0.85 && header.sticky === 'sticky', `background ${header.bg}`);
  check('slim utility strip renders with real links', header.utilityVisible && header.utilityLinks >= 5, `${header.utilityLinks} links`);
  check('dark brand mark on the light bar', header.brandDark);
  check('back-to-top anchor target exists', header.topAnchor);

  const trigger = page.locator('.hg-nav__trigger').first();
  await trigger.click();
  await page.waitForTimeout(200);
  const mega = await page.evaluate(() => {
    const el = document.querySelector('.hg-mega:not([hidden])');
    return {
      bg: el ? getComputedStyle(el).backgroundColor : null,
      groups: el?.querySelectorAll('.hg-mega__group').length ?? 0,
      open: !!el,
      width: Math.round(el?.getBoundingClientRect().width ?? 0),
      viewport: window.innerWidth,
    };
  });
  // The first registry section has two groups; every section has at least two. Width is pinned so
  // the panel cannot quietly shrink back into a small dropdown.
  check('full-width light mega panel opens with grouped links',
    mega.open && luminance(mega.bg) > 0.85 && mega.groups >= 2 && mega.width >= mega.viewport - 2,
    `background ${mega.bg}, ${mega.groups} groups, ${mega.width}px wide`);
  await trigger.click();

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
  check('no horizontal overflow at 1440px', !footer.overflow);
  await page.close();

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
  console.log(`\n${results.length - failed.length}/${results.length} professional chrome checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(2); });
