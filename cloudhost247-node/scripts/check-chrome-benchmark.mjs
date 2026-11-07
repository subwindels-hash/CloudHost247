/**
 * Real-Chromium acceptance check for the flat, dropdown-free menu / professional footer chrome.
 *
 *   BASE_URL=http://127.0.0.1:3000 node scripts/check-chrome-benchmark.mjs
 *
 * CSS review alone cannot prove that every registry section is a visible, directly clickable
 * link beside the logo, that no disclosure/hamburger is hiding anything, or that a wrapped bar
 * does not overlap or overflow at narrow widths. Every assertion below reads a computed style,
 * an attribute or a bounding box from a real page at desktop, laptop, tablet and phone widths.
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

/** Shared measurement of the flat menu bar at any width. */
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
  const bar = document.querySelector('.hg-nav__bar');
  const primary = document.querySelector('#ch247-primary-nav');
  const brand = document.querySelector('.hg-nav__brand img');
  const links = [...document.querySelectorAll('.hg-menu__link')].filter(visible);
  const groups = [...document.querySelectorAll('.hg-bar__locale, .hg-bar__quick, .hg-bar__actions')].filter(visible);
  let overlap = 0;
  for (const link of links) {
    const lb = box(link);
    for (const group of groups) {
      const gb = box(group);
      if (lb.top < gb.bottom && gb.top < lb.bottom) {
        overlap = Math.max(overlap, Math.min(lb.right, gb.right) - Math.max(lb.x, gb.x));
      }
    }
    if (bar) overlap = Math.max(overlap, Math.max(0, lb.right - box(bar).right));
  }
  const linkInfo = [...document.querySelectorAll('.hg-menu__link')].map((a) => ({
    label: a.textContent?.trim() ?? '',
    href: a.getAttribute('href') ?? '',
    tag: a.tagName,
    hasCaret: !!a.querySelector('.hg-nav__caret, .hg-menu__caret'),
    expanded: a.hasAttribute('aria-expanded'),
  }));
  return {
    bg: header ? getComputedStyle(header).backgroundColor : null,
    sticky: header ? getComputedStyle(header).position : null,
    headerHeight: header ? Math.round(header.getBoundingClientRect().height) : 0,
    brandWhite: (brand?.getAttribute('src') ?? '').includes('white'),
    links: linkInfo,
    visibleLinks: links.length,
    dropdownTriggers: document.querySelectorAll('.hg-nav__trigger, .hg-mega, .hg-drawer__toggle, .hg-nav__toggle').length,
    plusAccordions: document.querySelectorAll('.hg-drawer__toggle').length,
    hiddenPanels: document.querySelectorAll('.hg-mega[hidden], .hg-nav__collapsible:not(.is-open)').length,
    settings: {
      english: [...(primary?.querySelectorAll('button') ?? [])].some((b) => /Language:/.test(b.getAttribute('aria-label') ?? '') && visible(b)),
      usd: [...(primary?.querySelectorAll('button') ?? [])].some((b) => /Display currency:/.test(b.getAttribute('aria-label') ?? '') && visible(b)),
      signIn: [...(primary?.querySelectorAll('a') ?? [])].some((a) => a.textContent?.trim() === 'Sign In' && visible(a)),
      createAccount: [...(primary?.querySelectorAll('a') ?? [])].some((a) => a.textContent?.trim() === 'Create Account' && visible(a)),
    },
    overlap: Math.round(overlap),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    topAnchor: !!document.querySelector('#ch247-top'),
  };
};

async function main() {
  const browser = await launch();

  // ---- Desktop (the width of the original reference screenshot) ----
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  const bar = await page.evaluate(BAR_PROBE);
  check('dark sticky single bar', luminance(bar.bg) < 0.2 && bar.sticky === 'sticky', `background ${bar.bg}, ${bar.headerHeight}px tall`);
  check('white brand mark beside the menu', bar.brandWhite);
  check('every section is a direct link, not a trigger',
    bar.links.length >= 7 && bar.links.every((l) => l.tag === 'A' && l.href.startsWith('/') && !l.hasCaret && !l.expanded),
    `${bar.links.length} links: ${bar.links.map((l) => l.label).join(', ')}`);
  check('no dropdowns, carets, hamburger or + accordions remain',
    bar.dropdownTriggers === 0 && bar.plusAccordions === 0 && bar.hiddenPanels === 0,
    `${bar.dropdownTriggers} disclosure remnants`);
  const settings = bar.settings;
  check('English, USD, Sign In and Create Account are all shown in the bar',
    settings.english && settings.usd && settings.signIn && settings.createAccount,
    JSON.stringify(settings));
  check('back-to-top anchor target exists', bar.topAnchor);
  check('no overlap or overflow at 1440px', bar.overlap === 0 && !bar.overflow, `${bar.overlap}px`);

  const footer = await page.evaluate(() => {
    const el = document.querySelector('footer.hg-footer');
    const top = el?.querySelector('.hg-footer__top');
    const bottom = el?.querySelector('.hg-footer__bottom');
    const columns = [...(el?.querySelectorAll('.hg-footer__column') ?? [])];
    return {
      topText: top?.textContent?.trim(),
      topHref: top?.getAttribute('href'),
      // A flex item's computed display is blockified, so `inline-flex` reports as `flex`.
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

  // ---- Narrower widths: the links must stay visible, never collapse into a drawer ----
  for (const width of [1280, 1024, 834, 390]) {
    const p = await browser.newPage({ viewport: { width, height: 900 } });
    await p.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(250);
    const r = await p.evaluate(BAR_PROBE);
    check(`all ${r.links.length} section links stay visible at ${width}px`,
      r.visibleLinks >= 7 && r.dropdownTriggers === 0 && r.overlap === 0 && !r.overflow,
      `${r.visibleLinks} visible, ${r.overlap}px overlap, overflow=${r.overflow}`);
    await p.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} flat menu/footer checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(2); });
