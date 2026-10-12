import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

/**
 * Employee ID Card Generator, end to end: templates and colours, live front-and-back preview,
 * photo validation, real PNG/JPG/PDF downloads, bulk import with a rejected-row report, and the
 * ZIP batch. Each download is checked against its file signature, so an empty or placeholder file
 * fails the test.
 */
const URL = '/tools/business-tools/employee-id-card-generator';
const PNG = [0x89, 0x50, 0x4e, 0x47];
const JPG = [0xff, 0xd8, 0xff];

async function fillRequiredDetails(page: Page): Promise<void> {
  await page.locator('#idc-field-companyName').fill('Acme Ltd');
  await page.locator('#idc-field-fullName').fill('Ada Okafor');
  await page.locator('#idc-field-employeeId').fill('CH-0001');
}

async function bytesOf(download: import('@playwright/test').Download): Promise<Buffer> {
  const path = await download.path();
  if (!path) throw new Error('download has no file on disk');
  return readFile(path);
}

function startsWith(buffer: Buffer, signature: number[]): boolean {
  return signature.every((byte, index) => buffer[index] === byte);
}

test.describe('Employee ID Card Generator', () => {
  test('offers twelve templates, eight colour presets and the reset control', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByRole('heading', { level: 1, name: 'Employee ID Card Generator' })).toBeVisible();

    await expect(page.getByRole('radiogroup', { name: 'Card template' }).locator('button')).toHaveCount(12);
    await expect(page.getByRole('radiogroup', { name: 'Colour preset' }).locator('button')).toHaveCount(8);
    await expect(page.getByRole('tab', { name: 'Templates & colour' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Download & print' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Bulk generation' })).toBeVisible();
  });

  test('selecting a template and a colour preset updates the selected state', async ({ page }) => {
    await page.goto(URL);
    const templates = page.getByRole('radiogroup', { name: 'Card template' }).locator('button');
    await templates.nth(4).click();
    await expect(templates.nth(4)).toHaveAttribute('aria-checked', 'true');
    await expect(templates.nth(0)).toHaveAttribute('aria-checked', 'false');

    const presets = page.getByRole('radiogroup', { name: 'Colour preset' }).locator('button');
    await presets.nth(3).click();
    await expect(presets.nth(3)).toHaveAttribute('aria-checked', 'true');
  });

  test('a custom colour is validated as six-digit hex', async ({ page }) => {
    await page.goto(URL);
    const hex = page.getByLabel('Primary accent hex value');
    await hex.fill('#zzz');
    await expect(page.getByText('The primary colour must be a six-digit hex value such as #18BF63.').first()).toBeVisible();
    await hex.fill('#1F7AE0');
    await expect(page.getByText('The primary colour must be a six-digit hex value such as #18BF63.')).toHaveCount(0);
  });

  test('entered details change the live card preview', async ({ page }) => {
    await page.goto(URL);
    // The card is drawn on a canvas, so the check compares rendered pixels before and after input.
    const preview = page.locator('canvas').first();
    await expect(preview).toBeVisible();
    const blank = await preview.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
    await fillRequiredDetails(page);
    await expect.poll(async () => preview.evaluate((node) => (node as HTMLCanvasElement).toDataURL())).not.toBe(blank);
  });

  test('reset clears the form back to empty fields', async ({ page }) => {
    await page.goto(URL);
    await fillRequiredDetails(page);
    await page.getByRole('button', { name: 'Reset form' }).click();
    await expect(page.locator('#idc-field-fullName')).toHaveValue('');
    await expect(page.locator('#idc-field-employeeId')).toHaveValue('');
  });

  test('rejects a non-image photo with a visible error', async ({ page }) => {
    await page.goto(URL);
    await page.locator('#idc-image-photo').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('this is not a picture'),
    });
    await expect(page.getByText('That file is not a PNG, JPEG or WebP image.').first()).toBeVisible();
  });

  test('accepts a real PNG photo without an error', async ({ page }, testInfo) => {
    await page.goto(URL);
    // Generate a 300×300 PNG locally, so the upload is a real image of the minimum size.
    await page.setContent('<div style="width:300px;height:300px;background:#2b6cb0"></div>');
    const photoPath = testInfo.outputPath('portrait.png');
    await page.locator('div').first().screenshot({ path: photoPath });
    await page.goto(URL);
    await page.locator('#idc-image-photo').setInputFiles(photoPath);
    await expect(page.getByText('That file is not a PNG, JPEG or WebP image.')).toHaveCount(0);
  });

  test('downloads a single PNG, both-side PNG and JPG ZIP, and PDF with the matching file signatures', async ({ page }) => {
    await page.goto(URL);
    await fillRequiredDetails(page);
    await page.getByRole('tab', { name: 'Download & print' }).click();

    // A single side is one image file.
    const frontPng = page.waitForEvent('download');
    await page.getByRole('button', { name: 'PNG — front' }).click();
    expect(startsWith(await bytesOf(await frontPng), PNG)).toBe(true);

    // Both sides are packed in a ZIP that holds one image per side.
    const bothPng = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download PNG (both sides)' }).click();
    const pngZip = await bytesOf(await bothPng);
    expect(startsWith(pngZip, [0x50, 0x4b])).toBe(true);
    expect(pngZip.includes(Buffer.from(PNG))).toBe(true);

    const bothJpg = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download JPG (both sides)' }).click();
    const jpgZip = await bytesOf(await bothJpg);
    expect(startsWith(jpgZip, [0x50, 0x4b])).toBe(true);
    expect(jpgZip.includes(Buffer.from(JPG))).toBe(true);

    const pdfDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download PDF (both sides)' }).click();
    const pdf = await bytesOf(await pdfDownload);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  test('bulk import rejects duplicate IDs with a reason and generates a ZIP for the valid rows', async ({ page }, testInfo) => {
    await page.goto(URL);
    await page.locator('#idc-field-companyName').fill('Acme Ltd');
    await page.getByRole('tab', { name: 'Bulk generation' }).click();

    const csvPath = testInfo.outputPath('roster.csv');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      csvPath,
      ['Full name,Employee ID', 'Ada Okafor,CH-1001', 'Chidi Eze,CH-1002', 'Duplicate Person,CH-1001'].join('\n'),
      'utf8'
    );
    await page.locator('#idc-bulk-file').setInputFiles(csvPath);

    // Both rows that share CH-1001 are rejected, not just the second one, because the tool cannot
    // tell which record is correct. Nothing is dropped silently.
    await expect(page.getByText('appears on rows 2, 4').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download rejected rows (CSV)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate 1 card', exact: true })).toBeEnabled();

    const zipDownload = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByRole('button', { name: 'Generate 1 card', exact: true }).click();
    const zip = await bytesOf(await zipDownload);
    expect(startsWith(zip, [0x50, 0x4b])).toBe(true);
    expect(zip.includes(Buffer.from('manifest.csv'))).toBe(true);
  });

  test('clear stored data confirms what was removed', async ({ page }) => {
    await page.goto(URL);
    await page.getByRole('tab', { name: 'Download & print' }).click();
    await page.getByRole('button', { name: /Clear stored data/ }).click();
    await expect(page.getByText('Stored card details were cleared.').first()).toBeVisible();
  });
});
