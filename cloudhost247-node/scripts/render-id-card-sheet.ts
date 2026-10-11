/**
 * Render a contact sheet of all twelve badge templates.
 *
 *   npx tsx scripts/render-id-card-sheet.ts [--pdf]
 *
 * Why this exists: the twelve templates are the part of the Employee ID Card Generator that cannot
 * be asserted as a number. A test can prove that the geometry of two templates differs, that the
 * symbols decode and that nothing is drawn outside the card — it cannot prove that the cards look
 * like something a person would pin to their shirt. This renders every template's front and back
 * through the same rasteriser the browser and the PDF export use, and writes one PNG, so the
 * question "do these look like twelve different cards?" is answered by looking.
 *
 * It is a development tool, not part of the build: `npm run build` does not call it, and the panel
 * it writes is reviewed by eye.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { CARD_TEMPLATES, buildCardLayout, buildSpec, defaultFormState, type CardFormState } from '../src/tools/business/id-card';
import { renderFaceToRgba, type RasterImage } from '../src/tools/business/id-card/raster';

/** A card that exercises every optional field, so a template cannot be judged on an empty form. */
const SAMPLE: Partial<CardFormState> = {
  fullName: 'Amara Okafor',
  employeeId: 'NS-2026-0417',
  jobTitle: 'People Operations Manager',
  department: 'People & Culture',
  email: 'amara.okafor@northstar.example',
  phone: '+234 801 234 5678',
  bloodGroup: 'O+',
  dateOfJoining: '2021-04-15',
  emergencyContact: 'Chidi Okafor · +234 802 111 2222',
  companyName: 'Northstar Technologies',
  companyAddress: '12 Adeola Odeku Street, Victoria Island, Lagos',
  companyWebsite: 'https://northstar.example',
  validFrom: '2026-01-01',
  validUntil: '2029-12-31',
  showQr: true,
  showBarcode: true,
  barcodeValue: 'NS-2026-0417',
};

const SCALE = Number((process.argv.find((a) => a.startsWith("--scale="))?.split("=")[1]) ?? 0.42);

function blit(target: PNG, image: RasterImage, atX: number, atY: number): void {
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const source = (y * image.width + x) * 4;
      const destination = ((atY + y) * target.width + (atX + x)) * 4;
      if (destination < 0 || destination + 3 >= target.data.length) continue;
      target.data[destination] = image.data[source] ?? 255;
      target.data[destination + 1] = image.data[source + 1] ?? 255;
      target.data[destination + 2] = image.data[source + 2] ?? 255;
      target.data[destination + 3] = 255;
    }
  }
}

function fill(target: PNG, x0: number, y0: number, w: number, h: number, colour: [number, number, number]): void {
  for (let y = y0; y < y0 + h; y += 1) {
    if (y < 0 || y >= target.height) continue;
    for (let x = x0; x < x0 + w; x += 1) {
      if (x < 0 || x >= target.width) continue;
      const offset = (y * target.width + x) * 4;
      target.data[offset] = colour[0];
      target.data[offset + 1] = colour[1];
      target.data[offset + 2] = colour[2];
      target.data[offset + 3] = 255;
    }
  }
}

function main(): void {
  /* Optional arguments for inspecting a single card: `--only tech-diagonal,mono-stripe --orientation portrait`. */
  const onlyArg = process.argv.find((argument) => argument.startsWith('--only='));
  const orientationArg = process.argv.find((argument) => argument.startsWith('--orientation='));
  const orientation = (orientationArg?.split('=')[1] === 'portrait' ? 'portrait' : 'landscape') as 'landscape' | 'portrait';
  const selected = onlyArg
    ? CARD_TEMPLATES.filter((template) => (onlyArg.split('=')[1] ?? '').split(',').includes(template.id))
    : CARD_TEMPLATES;
  const templates = selected.length > 0 ? selected : CARD_TEMPLATES;
  const columns = 3;
  const rows = Math.ceil(templates.length / columns);
  const cardWidth = Math.round((orientation === 'portrait' ? 638 : 1011) * SCALE);
  const cardHeight = Math.round((orientation === 'portrait' ? 1011 : 638) * SCALE);
  const pad = 18;
  const gapY = 26;
  const sheetWidth = columns * cardWidth + (columns + 1) * pad;
  const sheetHeight = rows * (cardHeight * 2 + gapY) + (rows + 1) * pad;

  const sheet = new PNG({ width: sheetWidth, height: sheetHeight });
  fill(sheet, 0, 0, sheetWidth, sheetHeight, [241, 245, 249]);

  for (const [index, template] of templates.entries()) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = pad + column * (cardWidth + pad);
    const y = pad + row * (cardHeight * 2 + gapY);
    const state: CardFormState = { ...defaultFormState(), ...SAMPLE, template: template.id, orientation, palette: defaultFormState().palette };
    const { spec } = buildSpec(state, { strict: false });
    const layout = buildCardLayout(spec);
    const front = renderFaceToRgba(layout.front, { scale: SCALE, background: '#FFFFFF' });
    const back = renderFaceToRgba(layout.back, { scale: SCALE, background: '#FFFFFF' });
    blit(sheet, front, x, y);
    blit(sheet, back, x, y + cardHeight + 6);
  }

  const outDir = path.resolve(__dirname, '../../docs/id-card');
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `template-contact-sheet${onlyArg ? `-${orientation}` : ''}.png`);
  writeFileSync(file, PNG.sync.write(sheet, { colorType: 6 }));
  console.log(`Wrote ${file} (${sheetWidth} × ${sheetHeight}px, ${templates.length} templates, ${orientation}, front above back)`);
}

main();
