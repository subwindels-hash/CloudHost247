import { test, expect } from '@playwright/test';

// Mocked snapshots exercise browser wiring only; they are NOT evidence of a live FX provider.
for (const [locale, expected] of [['en-GB', 'GBP'], ['en-US', 'USD'], ['en-NG', 'NGN']] as const) {
  test(`browser region ${locale} suggests ${expected} when a current fixture rate is available`, async ({ browser }) => {
    const context = await browser.newContext({ locale });
    const page = await context.newPage();
    await page.route('**/api/v1/currency/geo-country', route => route.fulfill({ json: { country: null } }));
    await page.route('**/api/v1/currency/rates', route => route.fulfill({ json: {
      base: 'USD', available: true, reason: null, asOf: '2026-11-07T00:00:00Z', fetchedAt: '2026-11-07T00:00:00Z',
      currencies: [{ code: 'GBP', rate: 0.8, observedAt: '2026-11-07T00:00:00Z' }, { code: 'NGN', rate: 1500, observedAt: '2026-11-07T00:00:00Z' }],
    } }));
    await page.goto('/');
    await expect(page.getByRole('button', { name: new RegExp(`Display currency: ${expected}`) })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: new RegExp(`Display currency: ${expected}`) })).toBeVisible();
    await context.close();
  });
}

test('an explicit language updates existing translated controls and persists after reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Language: English/ }).click();
  await page.getByRole('button', { name: /Français/ }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.getByRole('link', { name: 'Rechercher sur CloudHost247' })).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
});
