import { expect, test } from '@playwright/test';

// Regression: closed desktop mega-menu panels were drawn as empty white bands under the header,
// because the panel's display rule overrode the hidden attribute. The header chrome was since
// redesigned (`.hg-menu__panel` panels in PlatformMegaMenu, hostinger-chrome.css keeps
// `.hg-menu__panel[hidden]{display:none !important}`), so this spec asserts the same contract
// against the current class names — audited 2026-11-07, when the old `.ch247-mega-panel`
// selector was found to match nothing in the app anymore.
test('closed mega-menu panels are not displayed under the header', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/tools/mrz-generator');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  const displays = await page.locator('.hg-menu__panel').evaluateAll((els) =>
    els.map((el) => ({ id: el.id, display: getComputedStyle(el).display, hidden: (el as HTMLElement).hidden })),
  );
  expect(displays.length).toBeGreaterThan(0);
  for (const panel of displays) {
    expect(panel.hidden, panel.id).toBe(true);
    expect(panel.display, panel.id).toBe('none');
  }
});
