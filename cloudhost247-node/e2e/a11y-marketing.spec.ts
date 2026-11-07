import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Accessibility scan of the premium public pages with WCAG 2.1 AA rules.
 * Serious and critical violations fail the test; every violation is attached
 * to the report so moderate issues stay visible for triage.
 *
 * These pages are rendered client-side by the SPA, so the scan runs after the
 * route mounts (heading present) rather than on the static shell.
 */

const PAGES = [
  '/',
  '/hosting/web-hosting',
  '/hosting/vps',
  '/hosting/dedicated',
  '/hosting/cpanel',
  '/cloud',
  '/domains',
  '/pricing',
  '/about',
  '/contact',
];

async function scan(page: import('@playwright/test').Page, label: string, testInfo: import('@playwright/test').TestInfo) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  await testInfo.attach(`axe-${label}.json`, {
    body: JSON.stringify(
      results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.length,
        targets: v.nodes.slice(0, 5).map((n) => n.target),
      })),
      null,
      2,
    ),
    contentType: 'application/json',
  });
  return results.violations;
}

for (const url of PAGES) {
  const label = url.replace(/\//g, '-') || 'home';
  test(`homepage/marketing page ${url} has no serious or critical WCAG 2.1 AA violations`, async ({ page }, testInfo) => {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const violations = await scan(page, label, testInfo);
    const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(
      blocking.map(
        (v) =>
          `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')} :: ${
            v.nodes.map((n) => n.failureSummary ?? '').join(' | ').slice(0, 400)
          }`,
      ),
    ).toEqual([]);
  });
}
