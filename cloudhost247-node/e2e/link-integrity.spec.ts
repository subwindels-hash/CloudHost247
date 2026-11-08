import { expect, test } from '@playwright/test';

/**
 * Website functionality audit — browser link integrity (2026-11-07).
 *
 * The static half of this audit (frontend/tests/unit/link-integrity.test.ts) proves every
 * internal target written in the source resolves to a declared route. This spec proves the
 * rendered behaviour: no placeholder hrefs are ever emitted, internal links clicked from real
 * pages never land on the router's "Page not found", and the per-account Tools pages
 * (history/favorites/reports/monitors) send signed-out visitors to /login with a return path
 * instead of leaking the API's raw "Missing bearer token" error (the audit's one dead-end UX
 * bug — fixed by nesting those routes under RequireAuth in App.tsx).
 */

const KEY_PAGES = ['/', '/tools', '/domains', '/apps', '/hosting', '/contact', '/faq', '/legal', '/docs', '/sitemap'];

test('no page emits placeholder or empty links', async ({ page }) => {
  for (const path of KEY_PAGES) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    const dead = await page.locator('a').evaluateAll((els) =>
      els
        .map((a) => a.getAttribute('href'))
        .filter((href) => href === null || href === '' || href === '#' || href.startsWith('javascript:')),
    );
    expect(dead, `${path} emits dead links`).toEqual([]);
  }
});

test('every internal link on key pages lands on a real page, not the 404 page', async ({ page }) => {
  test.setTimeout(240_000);
  const targets = new Set<string>();
  for (const path of KEY_PAGES) {
    await page.goto(path);
    const hrefs = await page.locator('a').evaluateAll((els) =>
      els.map((a) => a.getAttribute('href')).filter((h): h is string => Boolean(h)),
    );
    for (const href of hrefs) {
      if (!href.startsWith('/') || href.startsWith('/api/') || /\.(xml|txt)$/.test(href)) continue;
      targets.add(href.split('#')[0].split('?')[0]);
    }
  }
  expect(targets.size).toBeGreaterThan(40);
  const broken: string[] = [];
  for (const target of targets) {
    await page.goto(target);
    const h1 = await page.getByRole('heading', { level: 1 }).first().textContent().catch(() => '');
    if ((h1 ?? '').trim() === 'Page not found') broken.push(target);
  }
  expect(broken).toEqual([]);
});

for (const accountPage of ['/tools/history', '/tools/favorites', '/tools/reports', '/tools/monitors']) {
  test(`signed-out visitor to ${accountPage} is sent to login, never shown a raw API error`, async ({ page }) => {
    await page.goto(accountPage);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText('Missing bearer token')).toHaveCount(0);
    // The login page preserves the return destination so the user lands back on the page
    // they originally asked for after signing in.
    const registerLink = page.getByRole('link', { name: 'Create an account' });
    await expect(registerLink).toHaveAttribute('href', `/register?next=${encodeURIComponent(accountPage)}`);
  });
}

test('tools account shortcuts route a guest through login', async ({ page }) => {
  await page.goto('/tools');
  await page.getByRole('link', { name: 'Favorites' }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText('Missing bearer token')).toHaveCount(0);
});

test('footer back-to-top strip is a full-width bar that returns to the top', async ({ page }) => {
  await page.goto('/');
  const strip = page.getByRole('link', { name: 'Back to top' });
  await expect(strip).toHaveAttribute('href', '#ch247-top');
  // Amazon-style strip, placed as the footer's final band below the legal row.
  const geometry = await strip.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return {
      isLastChild: el.parentElement?.lastElementChild === el,
      widthRatio: rect.width / window.innerWidth,
      height: rect.height,
      background: getComputedStyle(el).backgroundColor,
    };
  });
  expect(geometry.isLastChild).toBe(true);
  expect(geometry.widthRatio).toBeGreaterThan(0.99);
  await strip.scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(400);
  await strip.click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test('mobile navigation opens and its Pricing link lands on Pricing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const quickLinks = page.getByRole('navigation', { name: 'Quick links' });
  await quickLinks.getByRole('link', { name: 'Pricing' }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Pricing');
});
