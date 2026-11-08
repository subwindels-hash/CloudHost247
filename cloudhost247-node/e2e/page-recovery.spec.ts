import { test, expect } from '@playwright/test';

test('a failed page chunk shows a refresh option instead of a blank page', async ({ page }) => {
  await page.route('**/assets/HomePage-*.js', route => route.abort());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'We couldn’t load this page.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Refresh page' })).toBeVisible();
  await page.unroute('**/assets/HomePage-*.js');
  await page.getByRole('link', { name: 'Refresh page' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Your idea, online/ })).toBeVisible();
});

test('the document provides a recovery hint if the main bundle cannot load', async ({ page }) => {
  await page.route('**/assets/index-*.js', route => route.abort());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Loading CloudHost247…' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'refresh the page' })).toBeVisible();
});
