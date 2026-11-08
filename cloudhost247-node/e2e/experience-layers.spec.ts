import { test, expect } from '@playwright/test';

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`one set of selectable platform layers at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const section = page.locator('#experience-3d');
    const group = section.getByRole('group', { name: 'Choose a platform layer' });
    await expect(group.getByRole('button')).toHaveCount(4);
    const layers = [
      ['Edge & DNS', '/domains'], ['Compute & Hosting', '/hosting'],
      ['Cloud & Storage', '/cloud'], ['Operations', '/status'],
    ];
    for (const [name, href] of layers) {
      await expect(section.getByText(name, { exact: true })).toHaveCount(1);
      const button = group.getByRole('button', { name });
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect(section.locator('#hg-exp3d-detail').getByRole('link')).toHaveAttribute('href', href);
    }
    const cloud = group.getByRole('button', { name: 'Cloud & Storage' });
    await cloud.focus();
    await page.keyboard.press('Enter');
    await expect(cloud).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
  });
}
