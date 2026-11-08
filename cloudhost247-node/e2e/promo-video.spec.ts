import { test, expect } from '@playwright/test';

for (const width of [1440, 768, 390, 320]) {
  test(`promotional videos and search remain responsive at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const hero = page.locator('.promo-video');
    await hero.scrollIntoViewIfNeeded();
    await expect(hero.getByRole('heading', { name: 'Find a name for your next big idea.' })).toBeVisible();
    await expect(hero.getByRole('link', { name: /Search domains/ })).toHaveAttribute('href', '/domains/search');
    await expect(hero.getByRole('button', { name: 'Play promotional videos' })).toBeVisible();
    expect(await page.evaluate(() => {
      const search = document.querySelector('.hg-domain')!;
      const hero = document.querySelector('.promo-video')!;
      const proof = document.querySelector('.hg-proof')!;
      return !!(search.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING)
        && !!(hero.compareDocumentPosition(proof) & Node.DOCUMENT_POSITION_FOLLOWING);
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    const dimensions = await hero.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const canvas = node.querySelector('.promo-video__canvas')!.getBoundingClientRect();
      const copy = node.querySelector('.promo-video__copy')!.getBoundingClientRect();
      const footer = node.querySelector('.promo-video__footer')!.getBoundingClientRect();
      return { x: rect.x, width: rect.width, height: rect.height, canvasX: canvas.x, canvasWidth: canvas.width, copyBottom: copy.bottom, footerTop: footer.top };
    });
    expect(dimensions.x).toBe(0);
    expect(dimensions.width).toBe(width);
    expect(dimensions.height).toBeGreaterThanOrEqual(900);
    expect(dimensions.canvasX).toBe(4);
    expect(dimensions.canvasWidth).toBe(width - 8);
    await expect(hero.locator('.promo-video__base')).toContainText('CloudHost247');
    await expect(hero.locator('.promo-video__base').getByRole('link', { name: 'Support' })).toHaveAttribute('href', '/support');
    expect(dimensions.footerTop).toBeGreaterThan(dimensions.copyBottom);
    let video = hero.locator('video.promo-video__background--current');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    await expect(video).toHaveAttribute('loop', '');
    await expect(video).toHaveAttribute('playsinline', '');
    expect(await video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(true);
    expect(await video.locator('source').count()).toBe(2);
    await hero.getByRole('button', { name: 'Next slide' }).click();
    await expect(hero.getByRole('heading', { name: 'A little idea can go a long way.' })).toBeVisible();
    await expect(hero.getByRole('link', { name: /Explore websites/ })).toHaveAttribute('href', '/websites');
    await expect(hero.getByRole('button', { name: 'Website Builder', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(hero.getByRole('button', { name: 'Show Website Builder slide' })).toHaveAttribute('aria-current', 'true');
    video = hero.locator('video.promo-video__background--current');
    expect(await video.locator('source').first().getAttribute('src')).toContain(width <= 600 ? 'people-mobile.webm' : 'people-desktop.webm');
    await hero.getByRole('button', { name: 'Previous slide' }).click();
    await expect(hero.getByRole('heading', { name: 'Find a name for your next big idea.' })).toBeVisible();
    await hero.getByRole('button', { name: 'Show Website Builder slide' }).click();
    await expect(hero.getByRole('heading', { name: 'A little idea can go a long way.' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

test('videos play, loop, pause and resume; slide navigation swaps the asset', async ({ page }) => {
  await page.goto('/');
  const hero = page.locator('.promo-video');
  await hero.scrollIntoViewIfNeeded();
  let video = hero.locator('video.promo-video__background--current');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 10000 }).toBeGreaterThan(0.2);
  expect(await video.evaluate((v: HTMLVideoElement) => v.currentSrc)).toMatch(/domains-desktop\.(webm|mp4)$/);
  await hero.getByRole('button', { name: 'Pause promotional videos' }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  const pausedAt = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  await page.waitForTimeout(400);
  expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(pausedAt, 1);
  await hero.getByRole('button', { name: 'Play promotional videos' }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  await video.evaluate((v: HTMLVideoElement) => { v.currentTime = v.duration - 0.2; });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 5000 }).toBeLessThan(2);
  await hero.getByRole('button', { name: 'Next slide' }).click();
  video = hero.locator('video.promo-video__background--current');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 10000 }).toBeGreaterThan(0.2);
  expect(await video.evaluate((v: HTMLVideoElement) => v.currentSrc)).toMatch(/people-desktop\.(webm|mp4)$/);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
});

test('automatically rotates when visible and not paused or focused', async ({ page }) => {
  await page.goto('/');
  const hero = page.locator('.promo-video');
  await hero.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await expect(hero.getByRole('heading', { name: 'A little idea can go a long way.' })).toBeVisible({ timeout: 15000 });
  await expect(hero.getByRole('button', { name: 'Website Builder', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('reduced motion prevents autoplay but allows intentional playback', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const hero = page.locator('.promo-video');
  await hero.scrollIntoViewIfNeeded();
  const video = hero.locator('video.promo-video__background--current');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await hero.getByRole('button', { name: 'Play promotional videos' }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 10000 }).toBeGreaterThan(0.2);
});

test('domain search remains functional', async ({ page }) => {
  await page.goto('/');
  const search = page.locator('.hg-domain');
  await search.locator('input').fill('example.com');
  await search.locator('button').click();
  await expect(page).toHaveURL(/\/domains\?q=example\.com/);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test(`fullscreen controls stay usable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const hero = page.locator('.promo-video');
    await hero.getByRole('button', { name: 'Next slide' }).click();
    await expect(hero.getByRole('heading', { name: 'A little idea can go a long way.' })).toBeVisible();
    await hero.getByRole('button', { name: 'Previous slide' }).click();
    await expect(hero.getByRole('heading', { name: 'Find a name for your next big idea.' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    await hero.locator('.promo-video__base').getByRole('link', { name: 'Support' }).click();
    await expect(page).toHaveURL(/\/support$/);
  });
}

test('black and silver frame moves unless reduced motion is preferred', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const hero = page.locator('.promo-video');
  const positions = await hero.evaluate((node) => {
    const animation = node.getAnimations().find((item) => (item as CSSAnimation).animationName === 'promo-frame-shimmer');
    if (!animation) return null;
    animation.pause();
    animation.currentTime = 0;
    const start = getComputedStyle(node).backgroundPosition;
    animation.currentTime = 4500;
    const midpoint = getComputedStyle(node).backgroundPosition;
    return { start, midpoint };
  });
  expect(positions).not.toBeNull();
  expect(positions!.start).not.toBe(positions!.midpoint);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => hero.evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
});
