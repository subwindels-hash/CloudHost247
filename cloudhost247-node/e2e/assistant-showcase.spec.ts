import { test, expect } from '@playwright/test';

const features = ['Speed it up', 'Migrate', 'Fix', 'Manage', 'Edit'];
const descriptions = [
  'Find a clearer path to a faster website', 'Plan the move to a new home',
  'Work through website issues', 'Keep the details of your online presence',
  'Shape your website and make it feel more like your idea',
];

for (const width of [1440, 850]) {
  test(`each feature expands on hover at ${width}px and resets on leave`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const cards = page.locator('.assistant-features');
    await cards.scrollIntoViewIfNeeded();
    const buttons = cards.getByRole('button');
    await expect(buttons).toHaveCount(5);
    for (let i = 0; i < features.length; i++) {
      const button = cards.getByRole('button', { name: features[i] });
      await button.hover();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect(button.locator('.assistant-feature__description')).toContainText(descriptions[i]);
      await expect(button.locator('.assistant-demo')).toBeVisible();
      await expect(cards.locator('[aria-pressed="true"]')).toHaveCount(1);
      await expect.poll(async () => {
        const widths = await buttons.evaluateAll(elements => elements.map(el => el.getBoundingClientRect().width));
        return widths[i] > Math.max(...widths.filter((_, j) => j !== i)) * 1.5;
      }).toBe(true);
    }
    await page.mouse.move(0, 0);
    await expect(buttons.first()).toHaveAttribute('aria-pressed', 'true');
    expect(new URL(page.url()).pathname).toBe('/');
    const manage = cards.getByRole('button', { name: 'Manage' });
    await manage.focus();
    await page.keyboard.press('Space');
    await expect(manage).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.assistant-promo__link')).toHaveAttribute('href', '/account/assistant');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

test('all five mobile cards expand by touch without page overflow', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto('/');
  const cards = page.locator('.assistant-features');
  for (let i = 0; i < features.length; i++) {
    const button = cards.getByRole('button', { name: features[i] });
    await button.tap();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(button.locator('.assistant-feature__description')).toContainText(descriptions[i]);
    await expect(button.locator('.assistant-demo')).toBeVisible();
    await expect(cards.locator('[aria-pressed="true"]')).toHaveCount(1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expect(page.locator('.assistant-promo__visual')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
  await context.close();
});

test('reduced motion disables feature and task animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const card = page.getByRole('button', { name: 'Fix', exact: true });
  await card.click();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  expect(await card.evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  expect(await page.locator('.assistant-promo__task--one').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
});
