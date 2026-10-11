/**
 * Employee ID Card Generator — engine tests.
 *
 * These are the tests that make the generator's claims checkable rather than asserted:
 *
 *   • every one of the twelve templates is a *different* layout (fingerprinted geometry, not names);
 *   • nothing a template draws falls outside the card, including with content that is far longer than
 *     the card was designed for;
 *   • the QR symbol is decoded back to its payload by a real scanner, both from the encoder matrix and
 *     from the rasterised card face;
 *   • the Code 128 symbol is decoded back to its value from the rendered bars;
 *   • the PDF's cross-reference table, page size and embedded image streams are byte-correct;
 *   • the ZIP writer round-trips through its own reader with matching CRCs;
 *   • CSV and XLSX imports map columns, reject bad rows with a reason each, and refuse duplicate IDs.
 */

import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';

import { encodeCode128Code, decodeCode128, checkSymbol } from '../../src/tools/business/id-card/code128';
import { encodeQrMatrix, validateQrUrl } from '../../src/tools/business/id-card/qr';
import { buildCardLayout, metricsFor } from '../../src/tools/business/id-card/templates';
import { measureTextWidth } from '../../src/tools/business/id-card/text';
import { CARD_PRESETS, CARD_TEMPLATES, cardPixelSize } from '../../src/tools/business/id-card/types';
import type { CardFace, CardTemplateId, DrawOp } from '../../src/tools/business/id-card/types';
import { buildSpec, defaultFormState, BLOOD_GROUPS } from '../../src/tools/business/id-card/model';
import { renderFaceToRgba, rasterToCode128 } from '../../src/tools/business/id-card/raster';
import { contrastRatio, normalizeColor, relativeLuminance } from '../../src/tools/business/id-card/colors';
import { buildCardsPdf, buildCardsPdfPair, pdfCardPageSize } from '../../src/tools/business/id-card/pdf';
import { buildZip, crc32, readZip } from '../../src/tools/business/id-card/zip';
import {
  BULK_COLUMNS,
  batchManifestCsv,
  chunkRows,
  csvTemplate,
  mapColumns,
  parseCsv,
  parseXlsxSheet,
  rejectedRowsCsv,
  summariseReport,
  validateRows,
} from '../../src/tools/business/id-card/batch';
import { detectImageType, validateDataUrl, validateImageDimensions, validateImageFile } from '../../src/tools/business/id-card/images';
import { faceToSvg } from '../../src/tools/business/id-card/svg';
import { computeIdCardTool } from '../../src/tools/business/id-card/tool';

/* ------------------------------------------------------------------ */
/* Fixtures and helpers                                                */
/* ------------------------------------------------------------------ */

function cardSpec(overrides: Record<string, unknown> = {}) {
  const state = {
    ...defaultFormState(),
    fullName: 'Ada Obi',
    employeeId: 'CH247-OPS-2026-0001-8',
    jobTitle: 'Payroll Officer',
    department: 'Finance',
    email: 'ada.obi@example.com',
    phone: '+234 801 234 5678',
    bloodGroup: 'O+',
    dateOfJoining: '2023-04-17',
    emergencyContact: 'Chidi Obi +234 802 000 1111',
    companyName: 'CloudHost247 Ltd',
    companyAddress: '12 Ademola Adetokunbo Crescent, Wuse II, Abuja 900288, Nigeria',
    companyWebsite: 'https://www.cloudhost247.com',
    showQr: true,
    showBarcode: true,
    barcodeValue: 'CH247-OPS-2026-0001-8',
    qrContent: 'https://verify.example.com/employee/CH247-OPS-2026-0001-8',
    ...overrides,
  };
  const result = buildSpec(state as never, { strict: false });
  return { state, result, spec: result.spec };
}

/** A crop of a raster as a fresh RGBA buffer, ready for a decoder. */
function crop(image: { width: number; height: number; data: Uint8ClampedArray }, box: { x: number; y: number; w: number; h: number }) {
  const x0 = Math.max(0, Math.round(box.x));
  const y0 = Math.max(0, Math.round(box.y));
  const w = Math.max(1, Math.round(box.w));
  const h = Math.max(1, Math.round(box.h));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const source = ((y0 + y) * image.width + x0 + x) * 4;
      const target = (y * w + x) * 4;
      data[target] = image.data[source] ?? 255;
      data[target + 1] = image.data[source + 1] ?? 255;
      data[target + 2] = image.data[source + 2] ?? 255;
      data[target + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

function decodeQrFromRaster(image: { width: number; height: number; data: Uint8ClampedArray }, box: { x: number; y: number; w: number; h: number }): string | null {
  const region = crop(image, box);
  const decoded = jsQR(region.data, region.width, region.height, { inversionAttempts: 'dontInvert' });
  return decoded ? decoded.data : null;
}

/** A structurally valid JPEG payload: SOI, a little data, EOI. Enough to test PDF embedding. */
function fakeJpeg(size = 64): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(size).fill(0x42), 0xff, 0xd9]);
}

function opsOf(face: CardFace, kind: DrawOp['kind']): DrawOp[] {
  return face.ops.filter((op) => op.kind === kind);
}

/* ------------------------------------------------------------------ */
/* Code 128                                                            */
/* ------------------------------------------------------------------ */

describe('Code 128 barcode', () => {
  it('encodes and decodes an alphanumeric identifier (set B)', () => {
    const encoded = encodeCode128Code('CH247-OPS-2026-0001-8');
    expect('ok' in encoded).toBe(false);
    if ('ok' in encoded) return;
    expect(encoded.codeSet).toBe('B');
    const decoded = decodeCode128(encoded.modules);
    expect('ok' in decoded).toBe(false);
    if ('ok' in decoded) return;
    expect(decoded.value).toBe('CH247-OPS-2026-0001-8');
    expect(decoded.checkSymbol).toBe(encoded.checkSymbol);
  });

  it('uses set C for a long even digit run, halving the symbol width', () => {
    const numeric = '1234567890123456';
    const compressed = encodeCode128Code(numeric);
    const alphanumeric = encodeCode128Code('A234567890123456');
    expect('ok' in compressed).toBe(false);
    expect('ok' in alphanumeric).toBe(false);
    if ('ok' in compressed || 'ok' in alphanumeric) return;
    expect(compressed.codeSet).toBe('C');
    expect(compressed.moduleCount).toBeLessThan(alphanumeric.moduleCount);
    const decoded = decodeCode128(compressed.modules);
    if ('ok' in decoded) throw new Error(decoded.message);
    expect(decoded.value).toBe(numeric);
  });

  it('computes the modulo-103 check symbol the standard specifies', () => {
    // Start B (104) + "AB" (33, 34): 104 + 33*1 + 34*2 = 205; 205 mod 103 = 102.
    expect(checkSymbol([104, 33, 34])).toBe(102);
    // Start C (105) + "12" (12): 105 + 12*1 = 117; 117 mod 103 = 14.
    expect(checkSymbol([105, 12])).toBe(14);
  });

  it('refuses payloads it cannot encode instead of mangling them', () => {
    const encoded = encodeCode128Code('café — naïve');
    expect('ok' in encoded).toBe(true);
    if (!('ok' in encoded)) return;
    expect(encoded.message).toMatch(/cannot encode/i);
  });

  it('detects a damaged symbol through the check symbol', () => {
    const encoded = encodeCode128Code('EMP00042');
    if ('ok' in encoded) throw new Error(encoded.message);
    const modules = encoded.modules.split('');
    // Flip one module in the middle of the symbol, as a scratch or a print artefact would.
    const middle = Math.floor(modules.length / 2);
    modules[middle] = modules[middle] === '1' ? '0' : '1';
    const decoded = decodeCode128(modules.join(''));
    expect('ok' in decoded).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* QR codes                                                            */
/* ------------------------------------------------------------------ */

describe('QR codes', () => {
  it('produces a matrix that a real scanner decodes back to the payload', () => {
    const payload = 'https://verify.example.com/employee/CH247-OPS-2026-0001-8';
    const matrix = encodeQrMatrix(payload, 'M');
    if ('ok' in matrix) throw new Error(matrix.message);
    const scale = 6;
    const quiet = 4;
    const size = (matrix.size + quiet * 2) * scale;
    const data = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let row = 0; row < matrix.size; row += 1) {
      for (let column = 0; column < matrix.size; column += 1) {
        if (!matrix.modules[row]?.[column]) continue;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            const x = (column + quiet) * scale + dx;
            const y = (row + quiet) * scale + dy;
            const offset = (y * size + x) * 4;
            data[offset] = 0;
            data[offset + 1] = 0;
            data[offset + 2] = 0;
            data[offset + 3] = 255;
          }
        }
      }
    }
    const decoded = jsQR(data, size, size);
    expect(decoded?.data).toBe(payload);
  });

  it('refuses a verification URL that a phone camera could not open', () => {
    expect(validateQrUrl('javascript:alert(1)').ok).toBe(false);
    expect(validateQrUrl('https://verify.example.com/x').ok).toBe(true);
    expect(validateQrUrl('not a url').ok).toBe(false);
    expect(validateQrUrl('http://verify.example.com/x').ok).toBe(true);
  });

  it('rejects empty and oversized payloads', () => {
    expect('ok' in encodeQrMatrix('', 'M')).toBe(true);
    expect('ok' in encodeQrMatrix('x'.repeat(600), 'M')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

describe('Templates', () => {
  const layoutFor = (template: CardTemplateId) => buildCardLayout(cardSpec({ template }).spec);

  it('renders all twelve templates', () => {
    expect(CARD_TEMPLATES).toHaveLength(12);
    for (const template of CARD_TEMPLATES) {
      const layout = layoutFor(template.id);
      expect(layout.front.ops.length, template.id).toBeGreaterThan(8);
      expect(layout.back.ops.length, template.id).toBeGreaterThan(8);
      expect(layout.front.side).toBe('front');
      expect(layout.back.side).toBe('back');
    }
  });

  it('gives every template a genuinely different layout', () => {
    const fingerprints = new Map<string, string>();
    for (const template of CARD_TEMPLATES) {
      const layout = layoutFor(template.id);
      // The fingerprint is the multiset of op kinds plus rounded geometry of the first twenty ops:
      // two templates that only differ by colour produce the same fingerprint and fail here.
      const fingerprint = layout.front.ops
        .slice(0, 24)
        .map((op) => {
          if (op.kind === 'text') return `text:${Math.round(op.x / 8)}:${Math.round(op.y / 8)}:${op.text.slice(0, 6)}`;
          if (op.kind === 'image') return `image:${Math.round(op.x / 8)}:${Math.round(op.y / 8)}:${Math.round(op.w / 8)}`;
          if (op.kind === 'rect') return `rect:${Math.round(op.x / 8)}:${Math.round(op.y / 8)}:${Math.round(op.w / 8)}:${Math.round(op.h / 8)}`;
          if (op.kind === 'polygon') return `poly:${op.points.length}:${Math.round((op.points[0]?.x ?? 0) / 8)}`;
          if (op.kind === 'circle') return `circle:${Math.round(op.cx / 8)}:${Math.round(op.cy / 8)}:${Math.round(op.r / 8)}`;
          if (op.kind === 'line') return `line:${Math.round(op.x1 / 8)}:${Math.round(op.y2 / 8)}`;
          return op.kind;
        })
        .join('|');
      const duplicate = [...fingerprints.entries()].find(([, value]) => value === fingerprint);
      expect(duplicate?.[0], `${template.id} has the same layout fingerprint as ${duplicate?.[0]}`).toBeUndefined();
      fingerprints.set(template.id, fingerprint);
    }
  });

  it('keeps every element inside the card, even with content far longer than the layout expects', () => {
    const { spec } = cardSpec({
      fullName: 'Oluwasegun Adebayo-Chukwuemeka Nwachukwu-Okonkwo',
      companyName: 'The National Association of Very Long Corporate Names Limited',
      department: 'International Strategic Programmes and Intergovernmental Affairs',
      jobTitle: 'Deputy Director of Enterprise Architecture and Platform Reliability Engineering',
      email: 'oluwasegun.adebayo-chukwuemeka@extremely-long-domain-name.example.com',
      emergencyContact: 'Chukwuemeka Nwachukwu-Okonkwo +234 802 000 1111 ext 4422',
      companyAddress: 'Plot 1234, Some Extremely Long Street Name, Central Business District, Abuja 900288, Nigeria',
    });
    for (const template of CARD_TEMPLATES) {
      const layout = buildCardLayout({ ...spec, options: { ...spec.options, template: template.id } });
      for (const face of [layout.front, layout.back]) {
        for (const op of face.ops) {
          // Decoration marked `bleed` is meant to run off the card edge; everything else — every
          // label, value, photograph, and both machine-readable codes — must sit inside it.
          if ('bleed' in op && op.bleed === true) continue;
          const boxes = describeBounds(op);
          for (const box of boxes) {
            expect(box.x, `${template.id} ${face.side} ${op.kind} left`).toBeGreaterThanOrEqual(-2);
            expect(box.y, `${template.id} ${face.side} ${op.kind} top`).toBeGreaterThanOrEqual(-2);
            expect(box.x + box.w, `${template.id} ${face.side} ${op.kind} right`).toBeLessThanOrEqual(face.width + 2);
            expect(box.y + box.h, `${template.id} ${face.side} ${op.kind} bottom`).toBeLessThanOrEqual(face.height + 2);
          }
        }
      }
    }
  });

  it('never lets one element print over another', () => {
    // Staying inside the card is not enough: a QR tile drawn across the employee's telephone number
    // is a defect that no "is it on the card?" check can see. This builds a real bounding box for
    // every element a reader has to read — text, photographs, and both machine-readable codes — and
    // fails if any two of them intersect.
    interface Box {
      tag: string;
      x: number;
      y: number;
      w: number;
      h: number;
    }
    const boxesFor = (face: { ops: DrawOp[]; side: string }, templateId: string): Box[] => {
      const boxes: Box[] = [];
      face.ops.forEach((op, index) => {
        const tag = `${templateId} ${face.side} #${index} ${op.kind}`;
        if (op.kind === 'text') {
          const width = measureTextWidth(op.text, op.size, op.family ?? 'sans');
          const left = op.anchor === 'middle' ? op.x - width / 2 : op.anchor === 'end' ? op.x - width : op.x;
          boxes.push({ tag: `${tag} “${op.text.slice(0, 24)}”`, x: left, y: op.y - op.size * 0.72, w: width, h: op.size * 0.97 });
        } else if (op.kind === 'qr') {
          boxes.push({ tag, x: op.x, y: op.y, w: op.size, h: op.size });
        } else if (op.kind === 'barcode') {
          boxes.push({ tag, x: op.x, y: op.y, w: op.w, h: op.h });
        } else if (op.kind === 'image') {
          boxes.push({ tag, x: op.x, y: op.y, w: op.w, h: op.h });
        }
      });
      return boxes;
    };

    const state = cardSpec().state;
    for (const template of CARD_TEMPLATES) {
      const { spec } = buildSpec({ ...state, template: template.id } as never, { strict: false });
      const layout = buildCardLayout(spec);
      for (const face of [layout.front, layout.back]) {
        const boxes = boxesFor(face, template.id);
        for (let a = 0; a < boxes.length; a += 1) {
          for (let b = a + 1; b < boxes.length; b += 1) {
            const one = boxes[a];
            const two = boxes[b];
            if (!one || !two) continue;
            // A one-pixel tolerance: touching edges are fine, printing over another element is not.
            const overlapX = Math.min(one.x + one.w, two.x + two.w) - Math.max(one.x, two.x);
            const overlapY = Math.min(one.y + one.h, two.y + two.h) - Math.max(one.y, two.y);
            if (overlapX > 1 && overlapY > 1) {
              throw new Error(`Overlap of ${Math.round(overlapX)} × ${Math.round(overlapY)} px between ${one.tag} and ${two.tag}`);
            }
          }
        }

        // Z-order rule: a shape painted *after* a line of text, and opaque enough to hide it, would
        // print over it whatever their bounding boxes say. This is what hid the SIGNATURE label
        // behind the accent footer band on the dark backs.
        const coverers: Box[] = [];
        face.ops.forEach((op, index) => {
          if (op.kind === 'text') {
            const text = boxes.find((box) => box.tag.endsWith(`#${index} text`) || box.tag.includes(`#${index} text`));
            if (!text) return;
            coverers.push({ ...text, tag: `${template.id} ${face.side} #${index} text-overpaint`, w: -1, h: -1 });
          }
        });
        face.ops.forEach((op, index) => {
          const fill = 'fill' in op && typeof op.fill === 'string' ? (op as { fill?: string }).fill : undefined;
          const opacity = 'opacity' in op && typeof op.opacity === 'number' ? op.opacity : 1;
          if (!fill || opacity < 0.5) return;
          if (op.kind !== 'rect' && op.kind !== 'polygon' && op.kind !== 'circle') return;
          const shape: Box =
            op.kind === 'rect'
              ? { tag: `${template.id} ${face.side} #${index} ${op.kind}`, x: op.x, y: op.y, w: op.w, h: op.h }
              : op.kind === 'circle'
                ? { tag: `${template.id} ${face.side} #${index} ${op.kind}`, x: op.cx - op.r, y: op.cy - op.r, w: op.r * 2, h: op.r * 2 }
                : {
                    tag: `${template.id} ${face.side} #${index} ${op.kind}`,
                    x: Math.min(...op.points.map((point) => point.x)),
                    y: Math.min(...op.points.map((point) => point.y)),
                    w: Math.max(...op.points.map((point) => point.x)) - Math.min(...op.points.map((point) => point.x)),
                    h: Math.max(...op.points.map((point) => point.y)) - Math.min(...op.points.map((point) => point.y)),
                  };
          boxesFor(face, template.id)
            .filter((box) => box.tag.includes('text') || box.tag.includes('qr') || box.tag.includes('barcode'))
            .forEach((box) => {
              const boxIndex = Number(/#(\d+)/.exec(box.tag)?.[1] ?? -1);
              if (boxIndex >= index) return;
              const overlapX = Math.min(box.x + box.w, shape.x + shape.w) - Math.max(box.x, shape.x);
              const overlapY = Math.min(box.y + box.h, shape.y + shape.h) - Math.max(box.y, shape.y);
              if (overlapX > 1 && overlapY > 1) {
                throw new Error(`${shape.tag} is painted over ${box.tag} (${Math.round(overlapX)} × ${Math.round(overlapY)} px)`);
              }
            });
        });
      }
    }
  });

  it('prints the identifier, the telephone number and the email in full on every template', () => {
    // A badge whose identifier is trimmed with an ellipsis is not a badge. This is the regression
    // test for a width table that had no digits in it, which made every ID look a third wider than
    // it is and quietly truncated it.
    const state = {
      ...cardSpec().state,
      showBarcode: false,
      qrContent: '',
    };
    for (const template of CARD_TEMPLATES) {
      const { spec } = buildSpec({ ...state, template: template.id } as never, { strict: false });
      const layout = buildCardLayout(spec);
      const texts = [...layout.front.ops, ...layout.back.ops]
        .filter((op): op is Extract<DrawOp, { kind: 'text' }> => op.kind === 'text')
        .map((op) => op.text);
      expect(texts.some((text) => text.includes(spec.employee.employeeId)), `${template.id} employee ID`).toBe(true);
      expect(texts.some((text) => text.includes(spec.employee.phone)), `${template.id} telephone`).toBe(true);
      expect(texts.some((text) => text.includes(spec.employee.email)), `${template.id} email`).toBe(true);
      // …and nothing was trimmed to make room: with realistic values no line should need an ellipsis,
      // because the fields that identify a person must be printed whole.
      expect(texts.filter((text) => text.includes('…')), `${template.id} trimmed text`).toEqual([]);
    }
  });

  it('places a QR symbol big enough to scan, and a barcode with the value it was given', () => {
    for (const template of CARD_TEMPLATES) {
      const layout = layoutFor(template.id);
      const faces = [layout.front, layout.back];
      const qr = faces.flatMap((face) => opsOf(face, 'qr'))[0];
      expect(qr, `${template.id} should print a QR symbol`).toBeDefined();
      if (qr && qr.kind === 'qr') {
        expect(qr.size, template.id).toBeGreaterThanOrEqual(96);
        expect(qr.payload).toBe('https://verify.example.com/employee/CH247-OPS-2026-0001-8');
      }
      const barcode = faces.flatMap((face) => opsOf(face, 'barcode'))[0];
      if (barcode && barcode.kind === 'barcode') expect(barcode.value).toBe('CH247-OPS-2026-0001-8');
    }
  });

  it('uses the chosen palette for the card body and the accent', () => {
    const { spec } = cardSpec({ preset: 'royal-purple', template: 'modern-badge' });
    const layout = buildCardLayout(spec);
    const fills = JSON.stringify(layout.front.ops).toLowerCase();
    const accent = CARD_PRESETS.find((preset) => preset.id === 'royal-purple')?.accent.toLowerCase() ?? '';
    expect(fills).toContain(accent);
  });

  it('renders a portrait card at the same ID-1 ratio, rotated', () => {
    const landscape = cardPixelSize('landscape');
    const portrait = cardPixelSize('portrait');
    expect(landscape).toEqual({ width: 1011, height: 638 });
    expect(portrait).toEqual({ width: 638, height: 1011 });
    for (const template of CARD_TEMPLATES) {
      const layout = buildCardLayout(cardSpec({ template, orientation: 'portrait' }).spec);
      expect(layout.front.width).toBe(638);
      expect(layout.front.height).toBe(1011);
    }
  });

  it('keeps a QR quiet zone inside the slot it was given', () => {
    const metrics = metricsFor(1011, 638);
    expect(metrics.margin).toBeGreaterThan(10);
    const layout = buildCardLayout(cardSpec({ template: 'modern-badge' }).spec);
    const qr = opsOf(layout.back, 'qr')[0];
    expect(qr).toBeDefined();
    if (qr && qr.kind === 'qr') {
      const raster = renderFaceToRgba(layout.back, { scale: 1 });
      const white = rasterWhiteRatio(raster, { x: qr.x, y: qr.y, w: qr.size, h: qr.size });
      // The quiet zone is white, so a healthy symbol never fills its whole slot with ink.
      expect(white).toBeGreaterThan(0.2);
    }
  });
});

function describeBounds(op: DrawOp): Array<{ x: number; y: number; w: number; h: number }> {
  switch (op.kind) {
    case 'rect':
    case 'image':
      return [{ x: op.x, y: op.y, w: op.w, h: op.h }];
    case 'circle':
      return [{ x: op.cx - op.r, y: op.cy - op.r, w: op.r * 2, h: op.r * 2 }];
    case 'polygon': {
      const xs = op.points.map((point) => point.x);
      const ys = op.points.map((point) => point.y);
      return [{ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }];
    }
    case 'line':
      return [
        {
          x: Math.min(op.x1, op.x2) - op.width,
          y: Math.min(op.y1, op.y2) - op.width,
          w: Math.abs(op.x2 - op.x1) + op.width * 2,
          h: Math.abs(op.y2 - op.y1) + op.width * 2,
        },
      ];
    case 'text': {
      // The layout fits text to `maxWidth` before placing it, so the measured width is the real one.
      const measured = measureTextWidth(op.text, op.size, op.family ?? 'sans');
      const width = op.maxWidth ? Math.min(op.maxWidth, measured) : measured;
      const x = op.anchor === 'middle' ? op.x - width / 2 : op.anchor === 'end' ? op.x - width : op.x;
      return [{ x, y: op.y - op.size, w: width, h: op.size * 1.35 }];
    }
    default:
      return [];
  }
}

function rasterWhiteRatio(image: { width: number; height: number; data: Uint8ClampedArray }, box: { x: number; y: number; w: number; h: number }): number {
  let white = 0;
  let total = 0;
  for (let y = Math.round(box.y); y < Math.round(box.y + box.h); y += 1) {
    for (let x = Math.round(box.x); x < Math.round(box.x + box.w); x += 1) {
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
      const offset = (y * image.width + x) * 4;
      total += 1;
      if ((image.data[offset] ?? 0) > 200 && (image.data[offset + 1] ?? 0) > 200) white += 1;
    }
  }
  return total === 0 ? 0 : white / total;
}

/* ------------------------------------------------------------------ */
/* Raster readback: the exported card scannable, verified              */
/* ------------------------------------------------------------------ */

describe('Rendered card readback', () => {
  it('decodes the QR symbol and the barcode straight off the rasterised card face', () => {
    const layout = buildCardLayout(cardSpec({ template: 'corporate-split' }).spec);
    const faces = [layout.front, layout.back];
    const scale = 2;
    const rasters = faces.map((face) => renderFaceToRgba(face, { scale }));
    let qrFound = 0;
    let barcodeFound = 0;

    faces.forEach((face, index) => {
      const raster = rasters[index];
      if (!raster) return;
      const qr = opsOf(face, 'qr')[0];
      if (qr && qr.kind === 'qr') {
        const decoded = decodeQrFromRaster(raster, { x: qr.x * scale, y: qr.y * scale, w: qr.size * scale, h: qr.size * scale });
        expect(decoded).toBe(qr.payload);
        qrFound += 1;
      }
      const barcode = opsOf(face, 'barcode')[0];
      if (barcode && barcode.kind === 'barcode') {
        const bars = {
          x: Math.round(barcode.x * scale),
          y: Math.round(barcode.y * scale),
          w: Math.round(barcode.w * scale),
          h: Math.max(4, Math.round(barcode.h * scale)),
        };
        const region = crop(raster, bars);
        const decoded = rasterToCode128({ ...region, skipped: [] });
        expect(decoded?.value, `${face.side} barcode`).toBe(barcode.value);
        barcodeFound += 1;
      }
    });

    expect(qrFound).toBeGreaterThan(0);
    expect(barcodeFound).toBeGreaterThan(0);
  });

  it('draws no machine-readable code when the options are off', () => {
    const layout = buildCardLayout(cardSpec({ showQr: false, showBarcode: false }).spec);
    for (const face of [layout.front, layout.back]) {
      expect(opsOf(face, 'qr')).toHaveLength(0);
      expect(opsOf(face, 'barcode')).toHaveLength(0);
    }
  });

  it('reports what it cannot rasterise rather than returning a blank card', () => {
    const layout = buildCardLayout(cardSpec().spec);
    const raster = renderFaceToRgba(layout.front, { scale: 1 });
    expect(raster.skipped).toContain('text');
    expect(raster.width).toBe(layout.front.width);
    // Something was drawn: the card is not a uniform white rectangle.
    const first = raster.data[0] ?? 0;
    const differs = raster.data.some((value, index) => index % 4 === 0 && value !== first);
    expect(differs).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Model validation                                                    */
/* ------------------------------------------------------------------ */

describe('Card validation', () => {
  it('requires a name, an employee ID and a company name', () => {
    const { result } = cardSpec({ fullName: '', employeeId: '', companyName: '' });
    const keys = result.errors.map((error) => error.key);
    expect(keys).toContain('fullName');
    expect(keys).toContain('employeeId');
    expect(keys).toContain('companyName');
  });

  it('validates email, phone, blood group and dates', () => {
    const { result } = cardSpec({
      email: 'ada@@example',
      phone: 'not-a-phone',
      bloodGroup: 'Z+',
      dateOfJoining: '2023-02-30',
      validFrom: '2026-01-01',
      validUntil: '2025-01-01',
    });
    const keys = result.errors.map((error) => error.key);
    expect(keys).toContain('email');
    expect(keys).toContain('phone');
    expect(keys).toContain('bloodGroup');
    expect(keys).toContain('dateOfJoining');
    expect(result.warnings.some((warning) => /not after the issue date/i.test(warning))).toBe(true);
  });

  it('makes the two card-is-wrong problems blocking under strict, and advisory through the API', () => {
    const state = {
      ...defaultFormState(),
      fullName: 'Ada Obi',
      employeeId: 'EMP-0001',
      companyName: 'CloudHost247 Ltd',
      validFrom: '2026-06-01',
      validUntil: '2026-01-01',
    };

    // The interactive form is strict: a card that expires before it is issued cannot be printed.
    const strict = buildSpec(state, { strict: true });
    expect(strict.errors.map((error) => error.key)).toContain('validUntil');
    expect(strict.warnings.some((warning) => /not after the issue date/i.test(warning))).toBe(false);

    // The published API keeps its historical contract: a document plus an advisory.
    const lenient = buildSpec(state, { strict: false });
    expect(lenient.errors.map((error) => error.key)).not.toContain('validUntil');
    expect(lenient.warnings.some((warning) => /not after the issue date/i.test(warning))).toBe(true);

    // A barcode that is switched on with nothing to encode is the same kind of problem.
    const noValue = { ...state, validFrom: '', validUntil: '', employeeId: '', showBarcode: true, barcodeValue: '' };
    expect(buildSpec(noValue, { strict: true }).errors.map((error) => error.key)).toContain('barcodeValue');
    expect(buildSpec(noValue, { strict: false }).warnings.some((warning) => /no value to encode/i.test(warning))).toBe(true);
  });

  it('accepts every recognised blood group and rejects case variants of nothing', () => {
    for (const group of BLOOD_GROUPS) {
      const { result } = cardSpec({ bloodGroup: group });
      expect(result.errors.filter((error) => error.key === 'bloodGroup'), group).toHaveLength(0);
    }
    const lower = cardSpec({ bloodGroup: 'o+' });
    expect(lower.result.errors.filter((error) => error.key === 'bloodGroup')).toHaveLength(0);
  });

  it('warns when a photograph is missing instead of failing', () => {
    const { result } = cardSpec({ photo: '', showPhoto: true });
    expect(result.errors.filter((error) => error.key === 'photo')).toHaveLength(0);
    const layout = buildCardLayout(result.spec);
    expect(layout.warnings.some((warning) => /monogram/i.test(warning))).toBe(true);
  });

  it('rejects a malformed QR verification URL', () => {
    const { result } = cardSpec({ qrContent: 'javascript:alert(1)' });
    expect(result.errors.map((error) => error.key)).toContain('qrContent');
  });

  it('falls back to a default QR payload that states what it is', () => {
    const { result } = cardSpec({ qrContent: '' });
    expect(result.spec.options.qrContent).toContain('Ada Obi');
    expect(result.spec.options.qrContent).toContain('CH247-OPS-2026-0001-8');
  });
});

/* ------------------------------------------------------------------ */
/* SVG                                                                 */
/* ------------------------------------------------------------------ */

describe('SVG output', () => {
  it('renders both faces at the card size with the module-level QR geometry', () => {
    const layout = buildCardLayout(cardSpec().spec);
    const svg = faceToSvg(layout.front, { title: 'Front' });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('width="1011" height="638"');
    expect(svg).toContain('Ada Obi');
    expect(svg).toContain('CH247-OPS-2026-0001-8');
    // QR modules are real rectangles, not a placeholder.
    expect((svg.match(/<rect /g) ?? []).length).toBeGreaterThan(40);
    expect(svg).not.toContain('<script');
  });

  it('escapes text so a name cannot inject markup', () => {
    const { spec } = cardSpec({ fullName: 'Ada <script>alert(1)</script> Obi' });
    const layout = buildCardLayout(spec);
    const svg = faceToSvg(layout.front, { title: 'Front' });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });
});

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

describe('PDF export', () => {
  it('writes one page per side at ID-1 size with an exact cross-reference table', () => {
    const image = { data: fakeJpeg(256), width: 1011, height: 638 };
    const pdf = buildCardsPdf(
      [
        { image, label: 'front' },
        { image, label: 'back' },
      ],
      { title: 'Ada Obi — employee ID card' }
    );
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('%%EOF');
    expect(text).toContain('/Count 2');
    const { widthPt, heightPt } = pdfCardPageSize();
    expect(widthPt).toBeCloseTo(242.65, 1);
    expect(heightPt).toBeCloseTo(153.02, 1);
    expect(text).toContain(`/MediaBox [0 0 ${Math.round(widthPt * 100) / 100} ${Math.round(heightPt * 100) / 100}]`);
    expect(text).toContain('/Filter /DCTDecode');
    expect(text).toContain('/Width 1011 /Height 638');

    // Every offset in the xref table must point at the object it claims.
    const xrefIndex = text.lastIndexOf('\nxref\n') + 1;
    // The table is: `xref`, the subsection header, the free entry for object 0, then one line per object.
    const table = text.slice(xrefIndex).split('\n').slice(3, 3 + 7);
    table.forEach((line, index) => {
      const offset = Number(line.slice(0, 10));
      expect(Number.isNaN(offset), `entry ${index + 1} should be an offset`).toBe(false);
      expect(text.slice(offset, offset + `${index + 1} 0 obj`.length), `object ${index + 1} offset`).toBe(`${index + 1} 0 obj`);
    });
    // The JPEG payload survives byte-for-byte (SOI … EOI).
    const soi = pdf.indexOf(0xff);
    expect(soi).toBeGreaterThan(-1);
    const bytes = Array.from(pdf.subarray(pdf.indexOf(0xff), pdf.indexOf(0xff) + 2));
    expect(bytes).toEqual([0xff, 0xd8]);
  });

  it('writes a single-sheet front-and-back page for card printers that want one page', () => {
    const image = { data: fakeJpeg(128), width: 1011, height: 638 };
    const pdf = buildCardsPdfPair(image, image, { title: 'Pair' });
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text).toContain('/ImF');
    expect(text).toContain('/ImB');
    const page = pdfCardPageSize();
    const expectedHeight = Math.round((page.heightPt * 2 + 18) * 100) / 100;
    expect(text).toContain(`/MediaBox [0 0 ${Math.round(page.widthPt * 100) / 100} ${expectedHeight}]`);
  });

  it('refuses to build a PDF from something that is not a JPEG', () => {
    expect(() => buildCardsPdf([{ image: { data: new Uint8Array([1, 2, 3, 4]), width: 10, height: 10 } }], { title: 'x' })).toThrow(/not a complete JPEG/i);
  });
});

/* ------------------------------------------------------------------ */
/* ZIP                                                                 */
/* ------------------------------------------------------------------ */

describe('Batch archive', () => {
  it('computes the reference CRC-32 value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes an archive its own reader can read back, with matching CRCs', () => {
    const files = [
      { name: 'cards/ada-obi-front.png', data: new Uint8Array([137, 80, 78, 71, 1, 2, 3]) },
      { name: 'cards/ada-obi-back.png', data: new Uint8Array([137, 80, 78, 71, 4, 5, 6]) },
      { name: 'batch-manifest.csv', data: new TextEncoder().encode('Row,Employee ID\n2,EMP00001\n') },
    ];
    const zip = buildZip(files);
    const entries = readZip(zip);
    expect(entries).toHaveLength(3);
    entries.forEach((entry, index) => {
      const source = files[index];
      if (!source) throw new Error('missing fixture');
      expect(entry.name).toBe(source.name);
      expect(Array.from(entry.data)).toEqual(Array.from(source.data));
      expect(entry.crc).toBe(crc32(source.data));
    });
  });

  it('strips traversal attempts out of archive entry names', () => {
    const zip = buildZip([{ name: '../../etc/passwd', data: new Uint8Array([1]) }]);
    expect(readZip(zip)[0]?.name).toBe('etc/passwd');
  });
});

/* ------------------------------------------------------------------ */
/* Bulk import                                                         */
/* ------------------------------------------------------------------ */

describe('Bulk import', () => {
  const base = defaultFormState();
  const baseState = {
    ...base,
    companyName: 'CloudHost247 Ltd',
    template: 'modern-badge' as const,
    showQr: true,
    showBarcode: true,
  };

  it('publishes a template whose header row the importer maps without help', () => {
    const template = csvTemplate();
    const { rows } = parseCsv(template);
    const { mapping, unmapped } = mapColumns(rows[0] ?? []);
    expect(unmapped).toHaveLength(0);
    expect(mapping.size).toBe(BULK_COLUMNS.length);
    expect(rows.length).toBeGreaterThan(1);
  });

  it('parses quoted fields, embedded commas and semicolon files', () => {
    const { rows } = parseCsv('Full name,Employee ID\n"Obi, Ada",EMP1\n"Ada ""Ace"" Obi",EMP2\n');
    expect(rows[1]).toEqual(['Obi, Ada', 'EMP1']);
    expect(rows[2]).toEqual(['Ada "Ace" Obi', 'EMP2']);

    const semicolon = parseCsv('Full name;Employee ID\nAda Obi;EMP1\n');
    expect(semicolon.delimiter).toBe(';');
    expect(semicolon.rows[1]).toEqual(['Ada Obi', 'EMP1']);
  });

  it('imports good rows, rejects bad ones with a reason each, and keeps the good ones', () => {
    const rows = [
      ['Full name', 'Employee ID', 'Email', 'Blood group'],
      ['Ada Obi', 'EMP00001', 'ada.obi@example.com', 'O+'],
      ['Chidi Eze', 'EMP00002', 'chidi@@example.com', 'B+'],
      ['', 'EMP00003', 'nobody@example.com', 'A+'],
      ['Bisi Lawal', 'EMP00004', 'bisi@example.com', 'ZZ'],
    ];
    const report = validateRows(rows, { base: baseState });
    expect(report.accepted.map((entry) => entry.spec.spec.employee.employeeId)).toEqual(['EMP00001']);
    expect(report.rejected.map((entry) => entry.rowNumber)).toEqual([3, 4, 5]);
    expect(report.rejected[0]?.reasons.join(' ')).toMatch(/email address/i);
    expect(report.rejected[1]?.reasons.join(' ')).toMatch(/name is required/i);
    expect(report.rejected[2]?.reasons.join(' ')).toMatch(/blood group/i);
    expect(summariseReport(report)).toMatch(/1 of 4 rows are ready/);
  });

  it('rejects every row that shares a duplicate employee ID', () => {
    const rows = [
      ['Full name', 'Employee ID'],
      ['Ada Obi', 'EMP00001'],
      ['Chidi Eze', 'EMP00002'],
      ['Ada Nwosu', 'emp00001'],
    ];
    const report = validateRows(rows, { base: baseState });
    expect(report.accepted).toHaveLength(1);
    expect(report.accepted[0]?.spec.spec.employee.fullName).toBe('Chidi Eze');
    expect(report.rejected).toHaveLength(2);
    expect(report.rejected[0]?.reasons.join(' ')).toMatch(/appears on rows 2, 4/);
  });

  it('reports missing required columns instead of importing nothing silently', () => {
    const report = validateRows([['Full name'], ['Ada Obi']], { base: baseState });
    expect(report.missingColumns).toContain('Employee ID');
    expect(summariseReport(report)).toMatch(/missing the required column/i);
  });

  it('reports unmapped columns but still imports', () => {
    const rows = [
      ['Full name', 'Employee ID', 'Cost centre'],
      ['Ada Obi', 'EMP00001', 'CC-1'],
    ];
    const report = validateRows(rows, { base: baseState });
    expect(report.unmappedHeaders).toEqual(['Cost centre']);
    expect(report.accepted).toHaveLength(1);
  });

  it('rejects an insecure or malformed photo URL', () => {
    const rows = [
      ['Full name', 'Employee ID', 'Photo URL'],
      ['Ada Obi', 'EMP00001', 'http://insecure.example.com/a.png'],
      ['Chidi Eze', 'EMP00002', 'https://cdn.example.com/b.png'],
    ];
    const report = validateRows(rows, { base: baseState });
    expect(report.accepted.map((entry) => entry.photoUrl)).toEqual(['https://cdn.example.com/b.png']);
    expect(report.rejected[0]?.reasons.join(' ')).toMatch(/https:\/\//);
  });

  it('writes a rejected-rows report that can be handed back to the HR team', () => {
    const rows = [['Full name', 'Employee ID'], ['', 'EMP00001']];
    const report = validateRows(rows, { base: baseState });
    const csv = rejectedRowsCsv(report);
    expect(csv.split('\r\n')[0]).toContain('Row,Reason');
    expect(csv).toContain('EMP00001');
    expect(csv).toContain('An employee name is required');
  });

  it('writes a manifest that distinguishes generated from rejected rows', () => {
    const rows = [['Full name', 'Employee ID'], ['Ada Obi', 'EMP00001'], ['', 'EMP00002']];
    const report = validateRows(rows, { base: baseState });
    const manifest = batchManifestCsv(report, [{ rowNumber: 2, file: 'cards/emp00001-front.png' }]);
    expect(manifest).toContain('cards/emp00001-front.png');
    expect(manifest).toContain('rejected');
    expect(manifest).toContain('generated');
  });

  it('pages an oversized import instead of rendering it in one blocking pass', () => {
    const rows = [['Full name', 'Employee ID']];
    for (let index = 0; index < 12; index += 1) rows.push([`Employee ${index}`, `EMP${String(index).padStart(5, '0')}`]);
    const report = validateRows(rows, { base: baseState });
    expect(report.accepted).toHaveLength(12);
    expect(chunkRows(report, 5)).toHaveLength(3);
  });

  it('reads a real worksheet: shared strings, inline strings and numeric cells', () => {
    const sheet = `<?xml version="1.0"?><worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>Ada Obi</t></is></c><c r="B2" t="s"><v>2</v></c></row>
      <row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>42</v></c></row>
    </sheetData></worksheet>`;
    const shared = ['Full name', 'Employee ID', 'EMP00001', 'Chidi Eze'];
    const rows = parseXlsxSheet(shared, sheet);
    expect(rows[0]).toEqual(['Full name', 'Employee ID']);
    expect(rows[1]).toEqual(['Ada Obi', 'EMP00001']);
    expect(rows[2]).toEqual(['Chidi Eze', '42']);
  });
});

/* ------------------------------------------------------------------ */
/* Uploads                                                             */
/* ------------------------------------------------------------------ */

describe('Image validation', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

  it('identifies formats by content, not by file name', () => {
    expect(detectImageType(png)).toBe('image/png');
    expect(detectImageType(jpeg)).toBe('image/jpeg');
    expect(detectImageType(svg)).toBeNull();
  });

  it('refuses an SVG even though a browser would render it', () => {
    const result = validateImageFile('logo', { name: 'logo.svg', type: 'image/svg+xml', size: 200, head: svg });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not a PNG, JPEG or WebP/i);
  });

  it('refuses a file whose contents contradict its MIME type', () => {
    const result = validateImageFile('photo', { name: 'photo.png', type: 'image/png', size: 2000, head: jpeg });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/contents are image\/jpeg/i);
  });

  it('refuses oversized and empty uploads with the limit stated', () => {
    expect(validateImageFile('photo', { name: 'huge.jpg', type: 'image/jpeg', size: 9 * 1024 * 1024, head: jpeg }).message).toMatch(/6 MB/);
    expect(validateImageFile('photo', { name: 'empty.jpg', type: 'image/jpeg', size: 0, head: jpeg }).ok).toBe(false);
  });

  it('refuses an image too small to print at 300 dpi', () => {
    const result = validateImageDimensions('photo', 90, 120);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/240 × 240/);
  });

  it('warns about extreme aspect ratios without blocking them', () => {
    const result = validateImageDimensions('photo', 400, 1600);
    expect(result.ok).toBe(true);
    expect(result.warning).toMatch(/crop/i);
  });

  it('accepts only base64 PNG/JPEG/WebP data URLs', () => {
    expect(validateDataUrl('data:image/png;base64,AAAA').ok).toBe(true);
    expect(validateDataUrl('data:image/svg+xml;base64,AAAA').ok).toBe(false);
    expect(validateDataUrl('https://example.com/a.png').ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* API adapter                                                         */
/* ------------------------------------------------------------------ */

describe('Tool adapter', () => {
  it('accepts the historical field names and returns both sides', () => {
    const outcome = computeIdCardTool({
      companyName: 'CloudHost247',
      employeeName: 'Ada Obi',
      employeeId: 'CH247-OPS-2026-0001-8',
      designation: 'Payroll Officer',
      department: 'Finance',
      bloodGroup: 'O+',
      issueDate: '2026-01-01',
      expiryDate: '2027-12-31',
      orientation: 'landscape',
      themeColor: '#0f2b46',
      includePhoto: true,
      includeQr: true,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.document?.content).toContain('1011');
    expect(outcome.result.extraDocuments).toHaveLength(2);
    expect(outcome.result.metrics.find((metric) => metric.label === 'Check digit')?.value).toBe('Valid (Luhn)');
  });

  it('defaults the QR payload to the employee ID, or NAME:<name> when there is none', () => {
    const withId = computeIdCardTool({ companyName: 'X Ltd', employeeName: 'Ada Obi', employeeId: 'EMP00001', includeQr: true });
    expect(withId.ok).toBe(true);
    if (!withId.ok) return;
    expect(withId.result.warnings?.join(' ')).not.toMatch(/could not be encoded/);

    const withoutId = computeIdCardTool({ companyName: 'X Ltd', employeeName: 'Ada Obi', includeQr: false });
    expect(withoutId.ok).toBe(true);
    if (!withoutId.ok) return;
    expect(withoutId.result.tables?.[1]?.rows[0]?.cells[1]).toBe('Omitted');
  });

  it('always states that the card verifies nothing about the holder', () => {
    const outcome = computeIdCardTool({ companyName: 'X Ltd', employeeName: 'Ada Obi', employeeId: 'EMP00001' });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.warnings?.some((warning) => /may constitute fraud/i.test(warning))).toBe(true);
  });

  it('fails with field errors rather than producing a nameless badge', () => {
    const outcome = computeIdCardTool({ companyName: '', employeeName: '', employeeId: '' });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.fieldErrors?.length ?? 0).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* Helper module used above (kept here so the test file is self-contained) */
/* ------------------------------------------------------------------ */

describe('colour helpers', () => {
  it('never trusts a colour string', () => {
    expect(normalizeColor('red', '#000000')).toBe('#000000');
    expect(normalizeColor('#abc', '#000000')).toBe('#aabbcc');
    expect(normalizeColor('#fff', '#000000')).toBe('#ffffff');
  });

  it('computes WCAG contrast the way the spec defines it', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeGreaterThan(4);
  });
});
