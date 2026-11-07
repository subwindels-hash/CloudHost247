import { expect, test, type Page } from '@playwright/test';

async function expectInset(page: Page, selector: string, minimum: number) {
  const element = page.locator(selector).first();
  await expect(element).toBeVisible();
  const bounds = await element.boundingBox();
  expect(bounds).not.toBeNull();
  const viewportWidth = page.viewportSize()!.width;
  expect(bounds!.x).toBeGreaterThanOrEqual(minimum);
  expect(viewportWidth - bounds!.x - bounds!.width).toBeGreaterThanOrEqual(minimum);
}

for (const width of [375, 1440]) {
  test.describe(`inner-page spacing at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const route of ['/legal/privacy-policy', '/docs/api-billing']) {
      test(`${route} keeps navigation and article inside centered gutters`, async ({ page }) => {
        await page.goto(route);
        await expect(page.locator('.ch-doc-layout')).toBeVisible();
        await expectInset(page, '.ch-doc-layout', 19);
        await expect(page.locator('.ch-doc-nav a').first()).toBeVisible();
        await expect(page.locator('.ch-prose-doc')).toBeVisible();
        const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        expect(horizontalOverflow).toBe(false);
      });
    }

    test('marketing page content and breadcrumbs have breathing room', async ({ page }) => {
      await page.goto('/hosting/vps');
      await expect(page.locator('main h1')).toBeVisible();
      await expectInset(page, '.ch-breadcrumbs .ch-wrap', 19);
      await expectInset(page, '.ch-hero .ch-wrap', 19);
    });

    test('homepage does not receive inner-page styling, including after navigation', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('main')).not.toHaveClass(/ch247-main--inner/);
      await page.goto('/legal/privacy-policy');
      await expect(page.locator('main')).toHaveClass(/ch247-main--inner/);
      await page.locator('.ch-breadcrumbs a[href="/"]').click();
      await expect(page.locator('main')).not.toHaveClass(/ch247-main--inner/);
    });
  });
}
