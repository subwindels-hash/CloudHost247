/**
 * Real-Chromium acceptance check for the Amazon/GoDaddy chrome benchmark.
 *
 *   BASE_URL=http://127.0.0.1:3000 node scripts/check-chrome-benchmark.mjs
 *
 * CSS review alone cannot prove that the menu is dark, that the four-column directory renders, or
 * that the extra utility strip did not reintroduce the 1440px overlap. Every assertion below reads
 * a computed style or a bounding box from a real page, at desktop and phone widths.
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

/** Relative luminance of an rgb()/rgba() computed colour; dark chrome must be below 0.16. */
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
    const bar = document.querySelector('.hg-nav__bar');
    const utility = document.querySelector('.hg-utility');
    const brand = document.querySelector('.hg-nav__brand img');
    const css = (node) => node ? getComputedStyle(node) : null;
    return {
      bg: css(el)?.backgroundColor,
      sticky: css(el)?.position,
      barHeight: bar?.getBoundingClientRect().height ?? 0,
      utilityVisible: utility ? getComputedStyle(utility).display !== 'none' : false,
      utilityLinks: document.querySelectorAll('.hg-utility a').length,
      brandWhite: (brand?.getAttribute('src') ?? '').includes('white'),
      topAnchor: !!document.querySelector('#ch247-top'),
    };
  });
  check('GoDaddy-style near-black sticky header', luminance(header.bg) < 0.16, `background ${header.bg}`);
  check('header stays sticky', header.sticky === 'sticky');
  check('slim utility strip renders with real links', header.utilityVisible && header.utilityLinks >= 5, `${header.utilityLinks} links`);
  check('white brand mark on the dark bar', header.brandWhite);
  check('back-to-top anchor target exists', header.topAnchor);

  const trigger = page.locator('.hg-nav__trigger').first();
  await trigger.click();
  await page.waitForTimeout(200);
  const mega = await page.evaluate(() => {
    const el = document.querySelector('.hg-mega:not([hidden])');
    const groups = el?.querySelectorAll('.hg-mega__group').length ?? 0;
    return {
      bg: el ? getComputedStyle(el).backgroundColor : null,
      groups, open: !!el,
      width: Math.round(el?.getBoundingClientRect().width ?? 0),
      viewport: window.innerWidth,
    };
  });
  // The first registry section has two groups; every section has at least two. Width is pinned so
  // the panel cannot quietly shrink back into a small dropdown.
  check('full-width dark mega panel opens with grouped links',
    mega.open && luminance(mega.bg) < 0.2 && mega.groups >= 2 && mega.width >= mega.viewport - 2,
    `background ${mega.bg}, ${mega.groups} groups, ${mega.width}px wide`);
  await trigger.click();

  const footer = await page.evaluate(() => {
    const el = document.querySelector('footer.hg-footer');
    const top = el?.querySelector('.hg-footer__top');
    const directory = el?.querySelector('.hg-footer__directory');
    const legal = el?.querySelector('.hg-footer__legal');
    const columns = el?.querySelectorAll('.hg-footer__column').length ?? 0;
    const links = el?.querySelectorAll('.hg-footer__column a').length ?? 0;
    const pills = el?.querySelectorAll('.hg-footer__locale-pill').length ?? 0;
    return {
      topText: top?.textContent?.trim(),
      topHref: top?.getAttribute('href'),
      dirBg: directory ? getComputedStyle(directory).backgroundColor : null,
      footerBg: el ? getComputedStyle(el).backgroundColor : null,
      legalBg: legal ? getComputedStyle(legal).backgroundColor : null,
      columns, links, pills,
      height: Math.round(el?.getBoundingClientRect().height ?? 0),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  check('Amazon "Back to top" strip links to the header', footer.topText === 'Back to top' && footer.topHref === '#ch247-top');
  check('deep navy directory band', luminance(footer.footerBg) > luminance(footer.legalBg) && luminance(footer.footerBg) < 0.3,
    `directory ${footer.footerBg}, legal ${footer.legalBg}`);
  check('darkest legal band below the directory', luminance(footer.legalBg) < 0.1);
  check('four topic columns with every registry link', footer.columns === 4 && footer.links >= 90,
    `${footer.columns} columns / ${footer.links} links`);
  check('brand/locale pill row', footer.pills === 3, `${footer.pills} pills`);
  check('footer is more compact than the pre-benchmark 1173px', footer.height > 0 && footer.height < 1000, `${footer.height}px`);
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
  console.log(`\n${results.length - failed.length}/${results.length} chrome benchmark checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(2); });
