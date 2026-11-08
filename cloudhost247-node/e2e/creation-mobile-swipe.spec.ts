import { test, expect } from '@playwright/test';

test('mobile idea gallery can be swiped in both directions', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto('/');
  const gallery = page.getByRole('region', { name: /Illustrative website ideas/ });
  await gallery.scrollIntoViewIfNeeded();
  await expect(page.getByText('Swipe to explore')).toBeVisible();
  await expect(gallery.locator('.creation-card')).toHaveCount(10);
  const dimensions = await gallery.evaluate(el => ({ width: el.clientWidth, content: el.scrollWidth }));
  expect(dimensions.content).toBeGreaterThan(dimensions.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

  const box = (await gallery.boundingBox())!;
  const cdp = await context.newCDPSession(page);
  const swipe = async (startX: number, endX: number) => {
    const y = box.y + 80;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y }] });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: startX + (endX - startX) * i / 8, y }] });
      await page.waitForTimeout(20);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await swipe(box.x + box.width - 30, box.x + 40);
  await expect.poll(() => gallery.evaluate(el => el.scrollLeft)).toBeGreaterThan(50);
  const afterLeft = await gallery.evaluate(el => el.scrollLeft);
  await swipe(box.x + 40, box.x + box.width - 30);
  await expect.poll(() => gallery.evaluate(el => el.scrollLeft)).toBeLessThan(afterLeft);
  await expect(page.locator('.creation-showcase__cta')).toHaveAttribute('href', '/websites/templates');
  await context.close();
});
