import { test, expect } from '@playwright/test';

test('every gallery image and scene image moves on hover', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const cards = page.locator('.creation-card').filter({ has: page.locator('img') });
  await expect(cards).toHaveCount(6);
  for (const card of await cards.all()) {
    await card.hover();
    const image = card.locator(':scope > img');
    expect(await image.evaluate(el => getComputedStyle(el).animationName)).toBe('creation-image-shake');
  }
  for (const selector of ['.creation-mini__estate-image', '.creation-mini__wellness-image']) {
    const image = page.locator(selector);
    await image.locator('xpath=ancestor::article').hover();
    expect(await image.evaluate(el => getComputedStyle(el).animationName)).toBe('creation-image-shake');
  }
  for (const selector of ['.creation-mini--cafe', '.creation-mini--shop']) {
    const image = page.locator(selector);
    await image.locator('xpath=ancestor::article').hover();
    expect(await image.evaluate(el => getComputedStyle(el, '::after').animationName)).toBe('creation-image-shake');
  }
  const scene = page.locator('.creation-scene');
  await scene.hover({ position: { x: 20, y: 20 } });
  for (const selector of ['.creation-scene__site-image', '.creation-scene__phone-image']) {
    expect(await scene.locator(selector).evaluate(el => getComputedStyle(el).animationName)).toBe('creation-image-shake');
  }
  await page.mouse.move(0, 0);
  expect(await scene.locator('.creation-scene__site-image').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await expect(page.locator('.creation-showcase__cta')).toHaveAttribute('href', '/websites/templates');
});

test('image hover motion respects reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const card = page.locator('.creation-card--architecture');
  await card.hover();
  expect(await card.locator('img').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  expect(await card.locator('.creation-mini__estate-image').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  const scene = page.locator('.creation-scene');
  await scene.hover({ position: { x: 20, y: 20 } });
  expect(await scene.locator('.creation-scene__site-image').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
});
