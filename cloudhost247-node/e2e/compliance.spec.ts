import { expect, test } from '@playwright/test';

// Compliance & Document Tools hub. Every link on the hub must open a real tool page; a dead link
// is the failure this hub exists to prevent.
const HUB = '/tools/compliance-documents';

test('the hub renders its heading and at least one tool group', async ({ page }) => {
  await page.goto(HUB);
  await expect(page.getByRole('heading', { level: 1, name: 'Compliance & Document Tools' })).toBeVisible();
  await expect(page.locator('h2').first()).toBeVisible();
});

test('every tool link on the hub opens a rendered tool page', async ({ page }) => {
  await page.goto(HUB);
  const links = page.locator('main a[href^="/tools/"]');
  await expect(links.first()).toBeVisible({ timeout: 15_000 });
  const hrefs = await links.evaluateAll((els) =>
    [...new Set(els.map((el) => el.getAttribute('href') ?? ''))].filter((h) => h && h !== '/tools' && !h.startsWith('/tools/category')),
  );
  expect(hrefs.length).toBeGreaterThan(0);

  for (const href of hrefs) {
    await page.goto(href);
    await expect(page.locator('h1').first(), `page for ${href}`).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Tool not found'), `${href} must not dead-end`).toHaveCount(0);
  }
});

test('the inventory link on the hub leads to the tools index', async ({ page }) => {
  await page.goto(HUB);
  // The normal state links to the full inventory. The error state links to the Tools Center instead.
  await page.getByRole('link', { name: /See the full inventory/ }).click();
  await expect(page).toHaveURL(/\/tools$/);
});
