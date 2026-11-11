import { expect, test } from '@playwright/test';

for (const width of [375, 1440]) {
  test(`legal policy links wrap without a nested scrollbar at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/legal/privacy-policy');
    const nav = page.getByRole('navigation', { name: 'Policies' });
    await expect(nav.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('aria-current', 'page');
    expect(await nav.evaluate((el) => el.scrollHeight === el.clientHeight && el.scrollWidth === el.clientWidth)).toBe(true);
    await nav.getByRole('link', { name: 'Cookie Policy', exact: true }).click();
    await expect(page).toHaveURL(/\/legal\/cookies#policy-content$/);
    await expect(page.getByRole('navigation', { name: 'Policies' }).getByRole('link', { name: 'Cookie Policy', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('main h1')).toHaveText('Cookie Policy');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test('policy contact addresses link to the contact page', async ({ page }) => {
  await page.goto('/legal/privacy-policy');
  const article = page.locator('#policy-content');
  await expect(article.getByRole('link', { name: 'Contact us' }).first()).toHaveAttribute('href', '/contact');
  await expect(article).not.toContainText(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i);
  await article.getByRole('link', { name: 'Contact us' }).first().click();
  await expect(page).toHaveURL(/\/contact$/);
});

test('FAQ contact options use the contact page without exposing mailbox addresses', async ({ page }) => {
  await page.goto('/faq');
  const main = page.locator('main');
  await expect(main).not.toContainText(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i);
  await expect(main.locator('a[href^="mailto:"]')).toHaveCount(0);
  await expect(main.getByRole('link', { name: 'Contact us' })).toHaveCount(3);
  await expect(main.getByRole('link', { name: 'contact our support team' })).toHaveAttribute('href', '/contact');
});
