import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Accessibility scan of the Employee ID Card page with WCAG 2.1 AA rules. The scan runs once on the
 * empty form and once with a card filled in, so the live preview (which is where most visual
 * content lives) is included. Serious and critical violations fail the test; every violation is
 * attached to the report so moderate issues stay visible.
 */

const URL = '/tools/business-tools/employee-id-card-generator';

async function scan(page: import('@playwright/test').Page, label: string, testInfo: import('@playwright/test').TestInfo) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  await testInfo.attach(`axe-${label}.json`, {
    body: JSON.stringify(results.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 5).map((n) => n.target) })), null, 2),
    contentType: 'application/json',
  });
  return results.violations;
}

test('ID card page has no serious or critical WCAG 2.1 AA violations (empty form)', async ({ page }, testInfo) => {
  await page.goto(URL);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const violations = await scan(page, 'empty', testInfo);
  const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')} :: ${v.nodes.map((n) => n.failureSummary ?? '').join(' | ').slice(0, 400)}`)).toEqual([]);
});

test('ID card page with a filled preview has no serious or critical WCAG 2.1 AA violations', async ({ page }, testInfo) => {
  await page.goto(URL);
  await page.locator('#idc-field-companyName').fill('Acme Ltd');
  await page.locator('#idc-field-fullName').fill('Ada Okafor');
  await expect(page.locator('.idc-preview')).toBeVisible();
  await expect(page.locator('.idc-preview[aria-busy="false"]')).toBeVisible();
  const violations = await scan(page, 'filled', testInfo);
  const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')} :: ${v.nodes.map((n) => n.failureSummary ?? '').join(' | ').slice(0, 400)}`)).toEqual([]);
});
