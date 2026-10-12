import { expect, test } from '@playwright/test';

// Regression: closed desktop mega-menu panels were drawn as empty white bands under the header,
// because the panel's display rule overrode the hidden attribute.
test('closed mega-menu panels are not displayed under the header', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/tools/mrz-generator');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  const displays = await page.locator('.ch247-mega-panel').evaluateAll((els) =>
    els.map((el) => ({ id: el.id, display: getComputedStyle(el).display, hidden: (el as HTMLElement).hidden })),
  );
  expect(displays.length).toBeGreaterThan(0);
  for (const panel of displays) {
    expect(panel.hidden, panel.id).toBe(true);
    expect(panel.display, panel.id).toBe('none');
  }
});
