import { test, expect } from '@playwright/test';

test('scene objects and gallery cards respond to hover and settle back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const scene = page.locator('.creation-scene');
  const browser = scene.locator('.creation-scene__browser');
  const phone = scene.locator('.creation-scene__phone');
  const palette = scene.locator('.creation-scene__palette');
  await scene.scrollIntoViewIfNeeded();
  const transform = (element: typeof browser) => element.evaluate(el => getComputedStyle(el).transform);
  const initial = await Promise.all([browser, phone, palette].map(transform));
  await scene.hover({ position: { x: 30, y: 30 } });
  await expect.poll(async () => (await Promise.all([browser, phone, palette].map(transform))).every((value, i) => value !== initial[i])).toBe(true);
  await page.mouse.move(0, 0);
  await expect.poll(async () => Promise.all([browser, phone, palette].map(transform))).toEqual(initial);

  const card = page.locator('.creation-card').first();
  await card.scrollIntoViewIfNeeded();
  const restingCard = await transform(card);
  await card.hover();
  await expect.poll(() => transform(card)).not.toBe(restingCard);
  await expect(page.locator('.creation-showcase__cta')).toHaveAttribute('href', '/websites/templates');
});

test('hover motion is disabled when reduced motion is requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const scene = page.locator('.creation-scene');
  await scene.scrollIntoViewIfNeeded();
  const browser = scene.locator('.creation-scene__browser');
  const before = await browser.evaluate(el => getComputedStyle(el).transform);
  await scene.hover({ position: { x: 30, y: 30 } });
  expect(await browser.evaluate(el => getComputedStyle(el).transform)).toBe(before);
  expect(await scene.locator('.creation-scene__browser-float').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  const card = page.locator('.creation-card').first();
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  expect(await card.evaluate(el => getComputedStyle(el).transform)).toBe('none');
});
