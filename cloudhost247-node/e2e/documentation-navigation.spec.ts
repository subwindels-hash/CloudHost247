import { expect, test } from '@playwright/test';

for (const width of [375, 1440]) {
  test(`documentation navigation wraps without a nested scrollbar at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/docs/api-billing');
    const nav = page.getByRole('navigation', { name: 'Documentation' });
    await expect(nav.getByRole('link', { name: 'Billing API', exact: true })).toHaveAttribute('aria-current', 'page');
    expect(await nav.evaluate((el) => el.scrollHeight === el.clientHeight && el.scrollWidth === el.clientWidth)).toBe(true);
    await nav.getByRole('link', { name: 'Catalog API', exact: true }).click();
    await expect(page).toHaveURL(/\/docs\/api-catalog#document-content$/);
    await expect(nav.getByRole('link', { name: 'Catalog API', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#document-content')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
