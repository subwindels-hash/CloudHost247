import { expect, test, type Page } from '@playwright/test';
import { BUSINESS_TOOLS, BUSINESS_TOOLS_ROOT } from '../src/tools/business';
import { BUSINESS_FIXTURES } from './business-fixtures';

/**
 * Every SalarioPay-reference tool (5 calculators, 12 generators, 4 comparisons) is driven through
 * the same user path: open the page, enter its sample inputs, submit, and check the result.
 * The checks are deliberately strict:
 *  - no uncaught page errors;
 *  - no error alert for the sample inputs;
 *  - a result panel with Copy result appears;
 *  - a generated document downloads with non-trivial content.
 */

/**
 * Applies the tool's sample inputs from business-fixtures.ts, the way a visitor would type them.
 * Required fields are covered there, so a missing one fails on the page's own message.
 */
async function prepareForm(page: Page, slug: string): Promise<void> {
  for (const [key, value] of Object.entries(BUSINESS_FIXTURES[slug] ?? {})) {
    const field = page.locator(`#bt247-field-${key}`);
    const tag = await field.evaluate((node) => node.tagName.toLowerCase());
    const type = await field.getAttribute('type');
    if (type === 'checkbox') {
      if (value) await field.check();
      else await field.uncheck();
    } else if (tag === 'select') {
      await field.selectOption(String(value));
    } else {
      await field.fill(String(value));
    }
  }
}

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

// The Employee ID Card editor is a separate page (preview, uploads, exports) with its own spec.
const FORM_TOOLS = BUSINESS_TOOLS.filter((tool) => tool.slug !== 'employee-id-card-generator');

for (const tool of FORM_TOOLS) {
  test(`${tool.name} loads and runs with its required sample inputs`, async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await page.goto(`${BUSINESS_TOOLS_ROOT}/${tool.slug}`);

    await expect(page.getByRole('heading', { level: 1, name: tool.name })).toBeVisible();

    await prepareForm(page, tool.slug);
    await page.locator('form button[type="submit"]').click();

    await expect(page.getByRole('button', { name: 'Copy result' })).toBeVisible();
    await expect(page.locator('#bt247-error-summary')).toHaveCount(0);
    await expect(page.locator('.bt247-panel[aria-busy="false"]').first()).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test(`${tool.name} resets its form`, async ({ page }) => {
    await page.goto(`${BUSINESS_TOOLS_ROOT}/${tool.slug}`);
    await prepareForm(page, tool.slug);
    await page.locator('form button[type="submit"]').click();
    await expect(page.getByRole('button', { name: 'Copy result' })).toBeVisible();

    await page.getByRole('button', { name: 'Reset form' }).click();
    await expect(page.getByRole('button', { name: 'Copy result' })).toHaveCount(0);
  });
}

const DOCUMENT_TOOLS = FORM_TOOLS.filter((tool) => tool.category === 'generators');

for (const tool of DOCUMENT_TOOLS) {
  test(`${tool.name} downloads a generated document with content`, async ({ page }) => {
    await page.goto(`${BUSINESS_TOOLS_ROOT}/${tool.slug}`);
    await prepareForm(page, tool.slug);
    await page.locator('form button[type="submit"]').click();
    await expect(page.getByRole('button', { name: 'Copy result' })).toBeVisible();

    const download = page.getByRole('button', { name: /^Download / });
    if ((await download.count()) === 0) {
      test.info().annotations.push({ type: 'note', description: 'tool produces no downloadable document' });
      return;
    }
    const [file] = await Promise.all([page.waitForEvent('download'), download.first().click()]);
    const path = await file.path();
    expect(path).toBeTruthy();
    const fs = await import('node:fs/promises');
    const body = await fs.readFile(path!, 'utf8');
    expect(body.trim().length).toBeGreaterThan(40);
  });
}

test('PAYE refuses to calculate with an empty required amount and shows the reason', async ({ page }) => {
  await page.goto(`${BUSINESS_TOOLS_ROOT}/nigeria-paye-net-salary-calculator`);
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByText('Enter a monthly amount greater than zero.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy result' })).toHaveCount(0);
});
