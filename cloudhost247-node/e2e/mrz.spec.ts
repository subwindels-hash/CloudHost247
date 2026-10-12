import { expect, test, type Page } from '@playwright/test';

/**
 * MRZ page, TD1 and TD2 paths, through the visible controls.
 *
 * The page reads its availability settings from /api/tools/mrz/config. The preview server has no
 * API behind it, so this spec answers that one request with the settings the page needs. Every
 * other request, and all MRZ logic, runs for real in the browser.
 */
const CALCULATOR = '/tools/document/mrz';

const TD1 = [
  'I<UTOD231458907<<<<<<<<<<<<<<<',
  '7408122F1204159UTO<<<<<<<<<<<6',
  'ERIKSSON<<ANNA<MARIA<<<<<<<<<<',
];
const TD2 = ['I<UTOERIKSSON<<ANNA<MARIA'.padEnd(36, '<'), 'D231458907UTO7408122F1204159'.padEnd(35, '<') + '6'];

async function stubConfig(page: Page): Promise<void> {
  await page.route('**/api/tools/mrz/config', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ calculatorEnabled: true, parserEnabled: true, testDataEnabled: false, availability: 'public' }),
    })
  );
}

test.beforeEach(async ({ page }) => {
  await stubConfig(page);
});

test('generates an ICAO TD1 MRZ from the form and shows the notice', async ({ page }) => {
  await page.goto(CALCULATOR);
  await page.getByLabel('MRZ format').selectOption('TD1');
  await page.getByLabel('Document Type').selectOption('I<');
  await page.getByLabel('Issuing State').fill('UTO');
  await page.getByLabel('Surname').fill('Eriksson');
  await page.getByLabel('Given Names').fill('Anna Maria');
  await page.getByLabel('Nationality').fill('UTO');
  await page.getByLabel('Date of Birth (YYMMDD)').fill('740812');
  await page.getByLabel('Sex').selectOption('F');
  await page.getByLabel('Document Number').fill('D23145890');
  await page.getByLabel('Expiry Date (YYMMDD)').fill('120415');
  await page.getByRole('button', { name: 'Generate MRZ' }).click();

  await expect(page.getByTestId('mrz-td-line-1')).toHaveText(TD1[0]!);
  await expect(page.getByTestId('mrz-td-line-2')).toHaveText(TD1[1]!);
  await expect(page.getByTestId('mrz-td-line-3')).toHaveText(TD1[2]!);
  await expect(page.getByText(/does NOT verify/).first()).toBeVisible();
});

test('TD2 refuses an invalid issuing state and shows the reason instead of an MRZ', async ({ page }) => {
  await page.goto(CALCULATOR);
  await page.getByLabel('MRZ format').selectOption('TD2');
  await page.getByLabel('Issuing State').fill('N1');
  await page.getByRole('button', { name: 'Generate MRZ' }).click();

  await expect(page.getByText('Issuing state must be a three-letter code').first()).toBeVisible();
  await expect(page.getByTestId('mrz-td-line-1')).toHaveCount(0);
});

test('the validator accepts a three-line TD1 and lists each rule', async ({ page }) => {
  await page.goto(CALCULATOR);
  await page.getByRole('tab', { name: 'MRZ Validator' }).click();
  await page.locator('textarea').first().fill(TD1.join('\n'));
  await page.getByRole('button', { name: 'Validate MRZ' }).click();

  await expect(page.getByTestId('td-result').getByText(/TD1 passes every structural check/)).toBeVisible();
  await expect(page.getByTestId('td-result').getByText('Document number check digit')).toBeVisible();
  await expect(page.getByTestId('td-result').getByText('Composite check digit')).toBeVisible();
});

test('the validator reports a corrupted check digit by rule name', async ({ page }) => {
  await page.goto(CALCULATOR);
  await page.getByRole('tab', { name: 'MRZ Validator' }).click();
  const corrupted = [TD1[0]!.slice(0, 14) + '1' + TD1[0]!.slice(15), TD1[1]!, TD1[2]!];
  await page.locator('textarea').first().fill(corrupted.join('\n'));
  await page.getByRole('button', { name: 'Validate MRZ' }).click();

  await expect(page.getByTestId('td-result').getByText(/has failing checks/)).toBeVisible();
  await expect(page.getByTestId('td-result').getByText(/document number check digit does not match/)).toBeVisible();
});

test('the parser decodes a TD2 into its named fields', async ({ page }) => {
  // /tools/mrz-parser is a legacy URL that redirects to the generator page; the parser is a tab there.
  await page.goto('/tools/mrz-generator');
  await page.getByRole('tab', { name: 'MRZ Parser' }).click();
  await page.locator('textarea').first().fill(TD2.join('\n'));
  await page.getByRole('button', { name: 'Parse MRZ' }).click();

  const result = page.getByTestId('td-result');
  await expect(result.getByText(/TD2 passes every structural check/)).toBeVisible();
  await expect(result.getByText('ERIKSSON')).toBeVisible();
  await expect(result.getByText('ANNA MARIA')).toBeVisible();
});
