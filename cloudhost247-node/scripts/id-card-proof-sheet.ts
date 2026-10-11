/**
 * Employee ID Card Generator — proof sheets.
 *
 * Renders every one of the twelve templates straight from the engine and writes two evidence files:
 *
 *   docs/tools/verification/id-card-templates.svg        the twelve fronts, labelled
 *   docs/tools/verification/id-card-templates-front-back.svg  each template with its front and back
 *
 * Both are the engine's own SVG output (the SVG writer emits real `<text>` elements, so a viewer
 * renders the same strings the canvas and PDF exporters do). The QR module group is left out of the
 * twelve-panel overview — it is ~500 rectangles per card — and one card is shown at full detail in
 * panel 13 instead; the front/back sheet keeps every code, so a reviewer can scan them.
 *
 *   npx tsx scripts/id-card-proof-sheet.ts
 *
 * The delivered PNG (docs/tools/verification/id-card-templates-front-back.png) is this SVG rendered
 * at 2× with resvg using Arimo — the metric-compatible Arial clone the engine's width estimator
 * assumes — so the layout in the picture is the layout a browser produces. Re-render with:
 *
 *   npx @resvg/resvg-js-cli --width 2000 docs/tools/verification/id-card-templates-front-back.svg \
 *     docs/tools/verification/id-card-templates-front-back.png
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSpec, buildCardLayout, defaultFormState, CARD_TEMPLATES, faceToSvg } from '../src/tools/business/id-card';

const CARD_WIDTH = 1011;
const CARD_HEIGHT = 638;
const OUT_DIR = resolve(__dirname, '..', '..', 'docs', 'tools', 'verification');

const sample = {
  ...defaultFormState(),
  fullName: 'Ada Obi',
  employeeId: 'CH247-OPS-2026-0001-8',
  jobTitle: 'Payroll Officer',
  department: 'Finance',
  email: 'ada.obi@cloudhost247.example',
  phone: '+234 801 234 5678',
  bloodGroup: 'O+',
  dateOfJoining: '2024-03-01',
  emergencyContact: 'Chidi Obi +234 802 000 1111',
  validFrom: '2026-01-01',
  validUntil: '2027-12-31',
  companyName: 'CloudHost247 Ltd',
  companyAddress: 'Plot 1234, Central Business District, Abuja 900288, Nigeria',
  companyWebsite: 'https://cloudhost247.example',
  showPhoto: true,
  showLogo: true,
  showSignature: true,
  showQr: true,
  showBarcode: true,
  barcodeValue: 'CH247-OPS-2026-0001-8',
};

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The inner markup of a generated face, ready to be placed inside the sheet's own `<svg>`. */
function faceInner(templateId: string, side: 'front' | 'back', options: { keepCodes: boolean }): string {
  const { spec, errors } = buildSpec({ ...sample, template: templateId } as never, { strict: false });
  if (errors.length > 0) throw new Error(`${templateId}: ${errors.map((error) => error.message).join('; ')}`);
  const layout = buildCardLayout(spec);
  const face = side === 'front' ? layout.front : layout.back;
  let svg = faceToSvg(face, { title: `${templateId} ${side}` });
  if (!options.keepCodes) {
    svg = svg.replace(/<g class="bt247-qr"[^>]*>[\s\S]*?<\/g>/g, '');
  }
  return svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>'));
}

/** Substitute the module group of a QR symbol with nothing, so a layout sheet stays small. */
function stripQr(svg: string): string {
  return svg.replace(/<g class="bt247-qr"[^>]*>[\s\S]*?<\/g>/g, '');
}

/* ------------------------------------------------------------------ */
/* Sheet 1: the twelve fronts                                          */
/* ------------------------------------------------------------------ */

function overviewSheet(): string {
  const scale = 0.42;
  const width = Math.round(CARD_WIDTH * scale);
  const height = Math.round(CARD_HEIGHT * scale);
  const gap = 28;
  const labelHeight = 34;
  const columns = 3;
  const rows = Math.ceil(CARD_TEMPLATES.length / columns);
  const cellHeight = height + labelHeight + gap;
  const codeScale = 0.62;
  const codeHeight = Math.round(CARD_HEIGHT * codeScale);
  const sheetWidth = gap + columns * (width + gap);
  const sheetHeight = gap * 3 + rows * cellHeight + codeHeight + 60;

  const cells: string[] = [];
  CARD_TEMPLATES.forEach((template, index) => {
    const inner = stripQr(faceInner(template.id, 'front', { keepCodes: true }));
    const x = gap + (index % columns) * (width + gap);
    const y = gap + Math.floor(index / columns) * cellHeight + labelHeight;
    cells.push(
      `<g><text x="${x}" y="${y - 12}" font-family="Helvetica, Arial, sans-serif" font-size="19" font-weight="700" fill="#0f172a">${escapeXml(
        `${index + 1}. ${template.name}`
      )}</text>` +
        `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" role="img" aria-label="${escapeXml(
          `${template.name} employee ID card`
        )}">${inner}</svg>` +
        `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" stroke="#cbd5e1"/></g>`
    );
  });

  const codeY = gap * 2 + rows * cellHeight + 6;
  cells.push(
    `<g><text x="${gap}" y="${codeY}" font-family="Helvetica, Arial, sans-serif" font-size="19" font-weight="700" fill="#0f172a">13. Modern Badge with the real QR symbol and Code 128 barcode</text>` +
      `<text x="${gap}" y="${codeY + 20}" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="#64748b">The QR is a module group that publishes its own payload; the barcode is drawn only when its narrowest bar stays at least 0.19 mm wide at 300 dpi.</text>` +
      `<svg x="${gap}" y="${codeY + 30}" width="${Math.round(CARD_WIDTH * codeScale)}" height="${codeHeight}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" role="img" aria-label="Modern Badge front with QR and barcode">${faceInner(
        'modern-badge',
        'front',
        { keepCodes: true }
      )}</svg>` +
      `<rect x="${gap}" y="${codeY + 30}" width="${Math.round(CARD_WIDTH * codeScale)}" height="${codeHeight}" fill="none" stroke="#cbd5e1"/></g>`
  );

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetWidth}" height="${sheetHeight}" viewBox="0 0 ${sheetWidth} ${sheetHeight}" font-family="Helvetica, Arial, sans-serif">` +
    `<rect width="${sheetWidth}" height="${sheetHeight}" fill="#f8fafc"/>` +
    `<text x="${gap}" y="${gap + 4}" font-size="24" font-weight="700" fill="#0f172a">Employee ID Card Generator — the twelve templates</text>` +
    `<text x="${gap}" y="${gap + 26}" font-size="14" fill="#64748b">Every face below is the engine's own SVG output at 1011 × 638 px (ISO/IEC 7810 ID-1 at 300 dpi) with one sample employee and one palette. The QR tiles are left empty here; panel 13 shows one card at full detail.</text>` +
    cells.join('') +
    `</svg>`
  );
}

/* ------------------------------------------------------------------ */
/* Sheet 2: front and back of all twelve, with every code intact       */
/* ------------------------------------------------------------------ */

function frontBackSheet(): string {
  const scale = 0.5;
  const width = Math.round(CARD_WIDTH * scale);
  const height = Math.round(CARD_HEIGHT * scale);
  const gap = 26;
  const labelHeight = 40;
  const cellHeight = labelHeight + height * 2 + 14;
  const columns = 2;
  const rows = Math.ceil(CARD_TEMPLATES.length / columns);
  const cellWidth = width + gap;
  const sheetWidth = gap + columns * cellWidth;
  const sheetHeight = gap * 2 + 44 + rows * cellHeight;

  const cells: string[] = [];
  CARD_TEMPLATES.forEach((template, index) => {
    const x = gap + (index % columns) * cellWidth;
    const y = gap + 44 + Math.floor(index / columns) * cellHeight;
    cells.push(
      `<g><text x="${x}" y="${y - 14}" font-family="Helvetica, Arial, sans-serif" font-size="18" font-weight="700" fill="#0f172a">${escapeXml(
        `${index + 1}. ${template.name}`
      )}</text>` +
        `<text x="${x}" y="${y - 1}" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="#64748b">${escapeXml(
          'front'
        )}</text>` +
        `<svg x="${x}" y="${y + 6}" width="${width}" height="${height}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" role="img" aria-label="${escapeXml(
          `${template.name} front`
        )}">${faceInner(template.id, 'front', { keepCodes: true })}</svg>` +
        `<rect x="${x}" y="${y + 6}" width="${width}" height="${height}" fill="none" stroke="#cbd5e1"/>` +
        `<text x="${x}" y="${y + height + 20}" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="#64748b">back</text>` +
        `<svg x="${x}" y="${y + height + 27}" width="${width}" height="${height}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" role="img" aria-label="${escapeXml(
          `${template.name} back`
        )}">${faceInner(template.id, 'back', { keepCodes: true })}</svg>` +
        `<rect x="${x}" y="${y + height + 27}" width="${width}" height="${height}" fill="none" stroke="#cbd5e1"/></g>`
    );
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetWidth}" height="${sheetHeight}" viewBox="0 0 ${sheetWidth} ${sheetHeight}" font-family="Helvetica, Arial, sans-serif">` +
    `<rect width="${sheetWidth}" height="${sheetHeight}" fill="#f8fafc"/>` +
    `<text x="${gap}" y="${gap + 10}" font-size="23" font-weight="700" fill="#0f172a">Employee ID Card Generator — front and back of all twelve templates</text>` +
    `<text x="${gap}" y="${gap + 32}" font-size="13" fill="#64748b">Engine SVG output, one sample employee. Every QR symbol and Code 128 barcode below is the real thing: the QR encodes the identifier (or the supplied verification URL) and the barcode carries the employee ID.</text>` +
    cells.join('') +
    `</svg>`
  );
}

const overview = overviewSheet();
const frontBack = frontBackSheet();
writeFileSync(resolve(OUT_DIR, 'id-card-templates.svg'), overview, 'utf8');
writeFileSync(resolve(OUT_DIR, 'id-card-templates-front-back.svg'), frontBack, 'utf8');
console.log(`wrote id-card-templates.svg (${Math.round(overview.length / 1024)} KB)`);
console.log(`wrote id-card-templates-front-back.svg (${Math.round(frontBack.length / 1024)} KB)`);
