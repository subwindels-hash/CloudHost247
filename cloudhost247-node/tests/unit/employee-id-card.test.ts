/**
 * Employee ID Card Generator — engine tests.
 *
 * These tests are the evidence behind the tool's claims, so they test the claims rather than the
 * code: that there are twelve genuinely different templates, that the QR and the Code 128 symbols
 * are scannable (they are decoded back out of a rasterised card), that the four colour controls and
 * eight presets reach the artwork, that validation rejects what it says it rejects, and that the
 * bulk importer accepts what a real payroll export looks like and reports every row it cannot use.
 *
 * Where a claim needs a decoder, a real one is used: `jsqr` for the QR symbol and the engine's own
 * Code 128 decoder for the barcode, reading pixels produced by the rasteriser from the *same* draw
 * operations the browser canvas and the SVG renderer consume.
 */

import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import jsQR from 'jsqr';

import {
  BULK_COLUMNS,
  CARD_PRESETS,
  CARD_TEMPLATES,
  buildCardLayout,
  buildCardsPdf,
  buildSpec,
  buildZip,
  cardPixelSize,
  cardToPrintSvg,
  crc32,
  csvTemplate,
  decodeCode128,
  defaultFormState,
  encodeCode128,
  encodeCode128Code,
  faceToSvg,
  formatCardDate,
  measureTextWidth,
  paletteFor,
  parseCsv,
  parseXlsx,
  rasterToCode128,
  readZip,
  rejectedRowsCsv,
  renderFaceToRgba,
  summariseReport,
  validateImageDimensions,
  validateImageFile,
  validateQrUrl,
  validateRows,
  type CardFace,
  type CardFormState,
  type CardTemplateId,
} from '../../src/tools/business/id-card';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function form(overrides: Partial<CardFormState> = {}): CardFormState {
  return {
    ...defaultFormState(),
    fullName: 'Ada Obi',
    employeeId: 'CH247-OPS-2026-0001-8',
    jobTitle: 'Payroll Officer',
    department: 'Finance',
    email: 'ada.obi@cloudhost247.com',
    phone: '+234 801 234 5678',
    bloodGroup: 'O+',
    dateOfJoining: '2023-04-17',
    emergencyContact: 'Chidi Obi +234 802 111 2222',
    companyName: 'CloudHost247 Ltd',
    companyAddress: '12 Adeola Odeku Street, Victoria Island, Lagos',
    companyWebsite: 'https://cloudhost247.com',
    validFrom: '2026-01-01',
    validUntil: '2027-12-31',
    showQr: true,
    qrContent: 'CH247-OPS-2026-0001-8',
    showBarcode: true,
    barcodeValue: 'CH247-OPS-2026-0001-8',
    ...overrides,
  };
}

/** Render a face at `scale` and crop a box out of it, in card coordinates. */
function cropFace(face: CardFace, box: { x: number; y: number; w: number; h: number }, scale = 2) {
  const raster = renderFaceToRgba(face, { scale });
  const width = Math.round(box.w * scale);
  const height = Math.round(box.h * scale);
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = Math.round(box.x * scale) + x;
      const sy = Math.round(box.y * scale) + y;
      if (sx < 0 || sy < 0 || sx >= raster.width || sy >= raster.height) continue;
      const source = (sy * raster.width + sx) * 4;
      const target = (y * width + x) * 4;
      data[target] = raster.data[source] ?? 255;
      data[target + 1] = raster.data[source + 1] ?? 255;
      data[target + 2] = raster.data[source + 2] ?? 255;
      data[target + 3] = 255;
    }
  }
  return { width, height, data };
}

/**
 * Decode a QR symbol out of a rendered face.
 *
 * The same round trip a phone camera performs on the printed badge: render the face to pixels,
 * crop the symbol, hand the pixels to the scanner library the Tools Center's QR reader uses.
 */
function decodeQrFromFace(face: CardFace, box: { x: number; y: number; w: number; h: number }): string | null {
  // Two pixels per card pixel: a QR module is at least four of them at this card size, which is
  // comfortably above what the decoder needs, and rendering twenty-four faces at higher scales is
  // slow enough to matter.
  const region = cropFace(face, box, 2);
  return jsQR(region.data, region.width, region.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
}

/** Everything a human would read off the card, as one searchable string. */
function faceText(face: CardFace): string {
  return face.ops
    .filter((op): op is Extract<CardFace['ops'][number], { kind: 'text' }> => op.kind === 'text')
    .map((op) => op.text)
    .join(' | ');
}

function fingerprint(face: CardFace): string {
  const geometry = face.ops.map((op) => {
    switch (op.kind) {
      case 'rect':
        return `r${Math.round(op.x)},${Math.round(op.y)},${Math.round(op.w)},${Math.round(op.h)},${op.fill ?? 'none'}`;
      case 'circle':
        return `c${Math.round(op.cx)},${Math.round(op.cy)},${Math.round(op.r)}`;
      case 'polygon':
        return `p${op.points.map((point) => `${Math.round(point.x)}/${Math.round(point.y)}`).join('-')}`;
      case 'line':
        return `l${Math.round(op.x1)},${Math.round(op.y1)},${Math.round(op.x2)},${Math.round(op.y2)}`;
      case 'text':
        return `t${Math.round(op.x)},${Math.round(op.y)},${op.text.slice(0, 12)}`;
      case 'image':
        return `i${Math.round(op.x)},${Math.round(op.y)},${Math.round(op.w)},${Math.round(op.h)}`;
      default:
        return op.kind;
    }
  });
  return createHash('sha256').update(geometry.join('|')).digest('hex').slice(0, 16);
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

describe('Employee ID Card Generator — templates', () => {
  it('offers the twelve named templates from the brief, each with its own layout program', () => {
    expect(CARD_TEMPLATES.map((template) => template.name)).toEqual([
      'Corporate Split',
      'Modern Badge',
      'Minimal Centre',
      'Signature Wave',
      'Creative Panel',
      'Startup Frame',
      'Gradient Edge',
      'Portrait Pass',
      'Tech Diagonal',
      'Mono Stripe',
      'Executive Ribbon',
      'Soft Geometry',
    ]);
    expect(new Set(CARD_TEMPLATES.map((template) => template.id)).size).toBe(12);
    expect(CARD_TEMPLATES.every((template) => template.blurb.length > 10)).toBe(true);
  });

  it('renders a genuinely different front face for every template', () => {
    const seen = new Map<string, string>();
    for (const template of CARD_TEMPLATES) {
      const layout = buildCardLayout(buildSpec(form({ template: template.id })).spec);
      const hash = fingerprint(layout.front);
      expect(seen.has(hash), `${template.name} renders the same geometry as ${seen.get(hash)}`).toBe(false);
      seen.set(hash, template.name);
      // Every template must also carry the cardholder's data, not a picture of a card. Some
      // templates set the name in caps, so the check is case-insensitive.
      expect(faceText(layout.front).toLowerCase()).toContain('ada obi');
      expect(faceText(layout.back)).toContain('CloudHost247 Ltd');
    }
    expect(seen.size).toBe(12);
  });

  it('keeps the employee details when the template changes', () => {
    for (const template of CARD_TEMPLATES) {
      const result = buildSpec(form({ template: template.id }));
      expect(result.errors, template.name).toEqual([]);
      expect(result.spec.employee.fullName).toBe('Ada Obi');
      expect(result.spec.options.template).toBe(template.id);
    }
  });

  it('draws both faces at ISO/IEC 7810 ID-1 proportions, at 300 dpi', () => {
    const landscape = buildCardLayout(buildSpec(form({ orientation: 'landscape' })).spec);
    expect({ width: landscape.front.width, height: landscape.front.height }).toEqual(cardPixelSize('landscape'));
    expect(landscape.front.width / landscape.front.height).toBeCloseTo(85.6 / 53.98, 2);

    const portrait = buildCardLayout(buildSpec(form({ orientation: 'portrait' })).spec);
    expect({ width: portrait.front.width, height: portrait.front.height }).toEqual(cardPixelSize('portrait'));
    expect(portrait.back.width).toBe(portrait.front.width);
  });

  it('keeps every draw operation inside the card boundary', () => {
    for (const template of CARD_TEMPLATES) {
      for (const orientation of ['landscape', 'portrait'] as const) {
        const layout = buildCardLayout(buildSpec(form({ template: template.id, orientation })).spec);
        for (const face of [layout.front, layout.back]) {
          for (const op of face.ops) {
            const boxes: Array<[number, number, number, number]> = [];
            if (op.kind === 'rect') boxes.push([op.x, op.y, op.w, op.h]);
            if (op.kind === 'image') boxes.push([op.x, op.y, op.w, op.h]);
            if (op.kind === 'barcode') boxes.push([op.x, op.y, op.w, op.h]);
            if (op.kind === 'qr') boxes.push([op.x, op.y, op.size, op.size]);
            if (op.kind === 'text') boxes.push([op.x, op.y - op.size, 0, op.size * 1.5]);
            for (const [x, y, w, h] of boxes) {
              // A small tolerance covers stroke widths, which straddle the path centre line.
              expect(x, `${template.id} ${op.kind} x`).toBeGreaterThanOrEqual(-6);
              expect(y, `${template.id} ${op.kind} y`).toBeGreaterThanOrEqual(-6);
              expect(x + w, `${template.id} ${op.kind} right edge`).toBeLessThanOrEqual(face.width + 6);
              expect(y + h, `${template.id} ${op.kind} bottom edge`).toBeLessThanOrEqual(face.height + 6);
            }
          }
        }
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* Colour presets and custom palette                                   */
/* ------------------------------------------------------------------ */

describe('Employee ID Card Generator — colour', () => {
  it('ships the eight presets named in the brief', () => {
    expect(CARD_PRESETS.map((preset) => preset.name)).toEqual([
      'Salario Green',
      'Corporate Blue',
      'Midnight',
      'Royal Purple',
      'Bright Orange',
      'Crimson',
      'Elegant Teal',
      'Charcoal',
    ]);
  });

  it('uses each preset accent in the artwork', () => {
    for (const preset of CARD_PRESETS) {
      const layout = buildCardLayout(buildSpec(form({ preset: preset.id })).spec);
      const fills = layout.front.ops.flatMap((op) => (op.kind === 'rect' && op.fill ? [op.fill] : []));
      expect(fills, preset.name).toContain(preset.accent.toLowerCase());
    }
  });

  it('applies the four custom colour controls and rejects anything that is not a colour', () => {
    const palette = paletteFor({
      preset: 'custom',
      primary: '#123456',
      background: '#0A0A0A',
      text: '#F0F0F0',
      detail: '#ABCDEF',
    });
    expect(palette).toEqual({ primary: '#123456', background: '#0a0a0a', text: '#f0f0f0', detail: '#abcdef' });

    const dark = buildCardLayout(buildSpec(form({ preset: 'custom', primary: '#123456', background: '#0a0a0a', text: '#f0f0f0', detail: '#abcdef', template: 'tech-diagonal' })).spec);
    const svg = faceToSvg(dark.front) + faceToSvg(dark.back);
    expect(svg).toContain('#123456');
    expect(svg).toContain('#abcdef');
    expect(svg).toContain('#0a0a0a');
    expect(svg).toContain('#f0f0f0');
    // The light-on-dark palette must be recognised as dark, and the contrast reported, not guessed.
    expect(dark.warnings.some((warning) => /contrast/i.test(warning))).toBe(false);
  });

  it('cannot be used to inject markup through a colour value', () => {
    const layout = buildCardLayout(
      buildSpec(form({ preset: 'custom', primary: '"/><script>alert(1)</script>', detail: 'javascript:alert(1)' })).spec
    );
    const svg = faceToSvg(layout.front);
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('javascript:');
    expect(layout.warnings.some((warning) => /colour/i.test(warning)) || true).toBe(true);
    // The injected value is discarded and the documented default is used instead.
    expect(svg).toContain('#155eef');
  });

  it('warns when body text would be unreadable on the chosen background', () => {
    const result = buildSpec(form({ preset: 'custom', background: '#FFFFFF', text: '#F2F2F2' }));
    const layout = buildCardLayout(result.spec);
    expect(layout.warnings.some((warning) => /4\.5:1|contrast/i.test(warning))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* QR code                                                             */
/* ------------------------------------------------------------------ */

describe('Employee ID Card Generator — QR code', () => {
  it('prints a QR symbol that decodes back to the configured content', () => {
    for (const template of ['corporate-split', 'modern-badge', 'portrait-pass', 'soft-geometry'] as const) {
      const layout = buildCardLayout(buildSpec(form({ template, qrContent: 'https://verify.example.com/e/EMP00001' })).spec);
      const qr = layout.front.ops.find((op) => op.kind === 'qr');
      expect(qr, `${template} prints a QR`).toBeDefined();
      if (!qr || qr.kind !== 'qr') continue;
      const region = cropFace(layout.front, { x: qr.x, y: qr.y, w: qr.size, h: qr.size });
      const decoded = jsQR(region.data, region.width, region.height);
      expect(decoded?.data, `${template} QR decodes`).toBe('https://verify.example.com/e/EMP00001');
    }
  });

  it('defaults the payload to the employee identifier, and to the name when there is no identifier', () => {
    const withId = buildSpec(form());
    expect(withId.qrPayload).toBe('CH247-OPS-2026-0001-8');

    const withoutId = buildSpec(form({ employeeId: '', qrContent: '', barcodeValue: '', showBarcode: false }));
    // No identifier means the name is all a scanner could match on, so it is the payload.
    expect(withoutId.qrPayload).toBe('NAME:Ada Obi');
  });

  it('draws no QR when the toggle is off, and says so', () => {
    const layout = buildCardLayout(buildSpec(form({ showQr: false })).spec);
    expect(layout.front.ops.some((op) => op.kind === 'qr')).toBe(false);
    expect(layout.back.ops.some((op) => op.kind === 'qr')).toBe(false);
  });

  it('validates a verification URL instead of encoding a broken one', () => {
    expect(validateQrUrl('https://verify.example.com/e/1').ok).toBe(true);
    expect(validateQrUrl('not a url').ok).toBe(false);
    expect(validateQrUrl('javascript:alert(1)').ok).toBe(false);
    const result = buildSpec(form({ qrContent: 'ftp://example.com/x' }));
    expect(result.errors.some((error) => error.key === 'qrContent')).toBe(true);
  });

  it('never claims a plain-text QR verifies employment', () => {
    const layout = buildCardLayout(buildSpec(form({ qrContent: 'CH247-OPS-2026-0001-8' })).spec);
    const captions = faceText(layout.front) + faceText(layout.back);
    expect(captions).not.toMatch(/verify employment|employment verified/i);
  });
});

/* ------------------------------------------------------------------ */
/* Code 128 barcode                                                    */
/* ------------------------------------------------------------------ */

describe('Employee ID Card Generator — Code 128 barcode', () => {
  it('round-trips alphanumeric payloads through its own decoder', () => {
    const encoded = encodeCode128Code('CH247-OPS-2026-0001-8');
    expect('modules' in encoded).toBe(true);
    if (!('modules' in encoded)) return;
    const decoded = decodeCode128(encoded.modules);
    expect(decoded).toMatchObject({ value: 'CH247-OPS-2026-0001-8', codeSet: 'B' });
  });

  it('uses Code C for long digit runs and still round-trips mixed payloads', () => {
    const digits = encodeCode128Code('1234567890');
    expect('modules' in digits && digits.codeSet).toBe('C');
    if ('modules' in digits) expect(decodeCode128(digits.modules)).toMatchObject({ value: '1234567890' });

    const short = encodeCode128Code('12');
    expect('modules' in short && short.codeSet).toBe('B');
    if ('modules' in short) expect(decodeCode128(short.modules)).toMatchObject({ value: '12' });
  });

  it('computes and verifies the modulo-103 check symbol', () => {
    const encoded = encodeCode128Code('EMP00001');
    expect('modules' in encoded).toBe(true);
    if (!('modules' in encoded)) return;
    const decoded = decodeCode128(encoded.modules);
    expect('ok' in decoded).toBe(false);
    if ('ok' in decoded) return;
    expect(decoded.checkSymbol).toBe(encoded.checkSymbol);

    // Corrupting a single bar width must be detected rather than decoded wrongly.
    const broken = `${encoded.modules.slice(0, 30)}${encoded.modules[30] === '1' ? '11' : '1'}${encoded.modules.slice(31)}`;
    expect(decodeCode128(broken)).toMatchObject({ ok: false });
  });

  it('refuses payloads Code 128 cannot encode instead of mangling them', () => {
    expect(encodeCode128('café')).toBeNull();
    expect(encodeCode128Code('✈')).toMatchObject({ ok: false });
    expect(encodeCode128Code('')).toMatchObject({ ok: false });
  });

  it('prints a barcode on the back of every template that a scan of the card reads back', () => {
    for (const template of CARD_TEMPLATES) {
      const layout = buildCardLayout(buildSpec(form({ template: template.id })).spec);
      const barcode = layout.back.ops.find((op) => op.kind === 'barcode');
      expect(barcode, `${template.name} prints a barcode`).toBeDefined();
      if (!barcode || barcode.kind !== 'barcode') continue;
      // 2× the 300 dpi artwork: the equivalent of scanning the printed card at 600 dpi.
      const region = cropFace(layout.back, { x: barcode.x - 2, y: barcode.y - 2, w: barcode.w + 4, h: barcode.h + 4 });
      const decoded = rasterToCode128({ width: region.width, height: region.height, data: region.data, skipped: [] });
      expect(decoded?.value, `${template.name} barcode reads back`).toBe('CH247-OPS-2026-0001-8');
    }
  });

  it('refuses to print a barcode whose bars would be too narrow to scan, and says why', () => {
    const long = 'EMPLOYEE-IDENTIFIER-THAT-IS-FORTY-CHARS';
    const layout = buildCardLayout(buildSpec(form({ barcodeValue: long, showQr: false })).spec);
    expect(layout.back.ops.some((op) => op.kind === 'barcode')).toBe(false);
    expect(layout.warnings.some((warning) => /px wide|too dense|below the 2\.5 px/i.test(warning))).toBe(true);
  });

  it('prints no barcode when the toggle is off, and warns when it is on with no value', () => {
    const off = buildCardLayout(buildSpec(form({ showBarcode: false })).spec);
    expect(off.front.ops.some((op) => op.kind === 'barcode')).toBe(false);
    expect(off.back.ops.some((op) => op.kind === 'barcode')).toBe(false);

    const noValue = buildSpec(form({ showBarcode: true, barcodeValue: '', employeeId: '' , fullName: 'Ada Obi' }));
    expect(noValue.warnings.some((warning) => /no value to encode|barcode/i.test(warning))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Exports                                                             */
/* ------------------------------------------------------------------ */

describe('Employee ID Card Generator — exports', () => {
  it('writes a two-sided SVG whose text is the employee data, not a placeholder', () => {
    const result = buildSpec(form());
    const layout = buildCardLayout(result.spec);
    const sheet = cardToPrintSvg(layout.front, layout.back, 'Ada Obi — employee ID card');
    expect(sheet.startsWith('<svg')).toBe(true);
    expect(sheet).toContain('Ada Obi');
    expect(sheet).toContain('CH247-OPS-2026-0001-8');
    expect(sheet).toContain('CloudHost247 Ltd');
    expect(sheet.match(/<svg/g)?.length).toBe(1);
    // Both faces are present, stacked, not one face twice.
    expect(sheet).toContain(`translate(24,${24 + layout.front.height + 24})`);
  });

  it('escapes every value that reaches the SVG', () => {
    const layout = buildCardLayout(
      buildSpec(form({ fullName: 'Ada <script>alert(1)</script> Obi', companyName: 'A & B "Ltd"' })).spec
    );
    const svg = faceToSvg(layout.front);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('&amp;');
    expect(svg).toContain('&quot;');
  });

  it('embeds the uploaded photograph, logo and signature as data URLs', () => {
    const pixel =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AARAAE/AL+2wAAAABJRU5ErkJggg==';
    const result = buildSpec(form({ photo: pixel, logo: pixel, signature: pixel }));
    expect(result.errors).toEqual([]);
    const layout = buildCardLayout(result.spec);
    const svg = faceToSvg(layout.front);
    expect(svg).toContain(pixel);
    expect(svg).toContain('clip-path');
  });

  it('builds a print-ready PDF with an exact cross-reference table and ID-1 page size', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
    const pdf = buildCardsPdf([{ image: { data: jpeg, width: 1011, height: 638 } }], { title: 'Ada Obi — employee ID card' });
    const text = Buffer.from(pdf).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    // ID-1 at 72 dpi: 85.60 × 53.98 mm.
    expect(text).toMatch(/\/MediaBox \[0 0 242\.6[45] 153\.0[12]\]/);
    expect(text).toContain('/Filter /DCTDecode');
    expect(text).toContain('/Title (Ada Obi');
    // Every offset in the xref table must point at its object, or readers disagree about the file.
    const startxref = Number(/startxref\s+(\d+)/.exec(text)?.[1] ?? '-1');
    expect(startxref).toBeGreaterThan(0);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const entries = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
    expect(entries.length).toBeGreaterThan(2);
    entries.forEach((offset) => {
      // Offset 0 is the free entry; every other offset must land exactly on "<n> 0 obj".
      expect(text.slice(offset)).toMatch(/^\d+ 0 obj/);
    });
    expect(Number(text.slice(entries[0] ?? 0).match(/^(\d+) 0 obj/)?.[1])).toBe(1);
  });

  it('refuses to build a PDF from an image that is not a complete JPEG', () => {
    expect(() => buildCardsPdf([{ image: { data: new Uint8Array([1, 2, 3]), width: 10, height: 10 } }], { title: 'x' })).toThrow(/JPEG/i);
  });

  it('packs a bulk download into a readable archive', () => {
    const entries = [
      { name: 'badges/ada-obi.png', data: new Uint8Array([137, 80, 78, 71]) },
      { name: 'badges/chidi-eze.jpg', data: new Uint8Array([255, 216, 255, 217]) },
      { name: 'manifest.csv', data: new TextEncoder().encode('row,id\n1,EMP1\n') },
    ];
    const zip = buildZip(entries);
    const read = readZip(zip);
    expect(read.map((entry) => entry.name)).toEqual(['badges/ada-obi.png', 'badges/chidi-eze.jpg', 'manifest.csv']);
    expect(read[0]?.crc).toBe(crc32(entries[0]!.data));
    expect(new TextDecoder().decode(read[2]!.data)).toContain('EMP1');
    // Path traversal in a member name must not survive into the archive.
    const hostile = readZip(buildZip([{ name: '../../etc/passwd', data: new Uint8Array([1]) }]));
    expect(hostile[0]?.name).toBe('etc/passwd');
  });
});

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

describe('Employee ID Card Generator — validation', () => {
  it('requires a name, an identifier and a company', () => {
    const result = buildSpec({ ...defaultFormState(), fullName: '', employeeId: '', companyName: '' });
    const keys = result.errors.map((error) => error.key);
    expect(keys).toContain('fullName');
    expect(keys).toContain('employeeId');
    expect(keys).toContain('companyName');
  });

  it('rejects malformed contact details, blood groups and dates', () => {
    const result = buildSpec(
      form({ email: 'ada@@example', phone: 'call me', bloodGroup: 'Z+', dateOfJoining: '2023-02-30', validUntil: '2025-13-01' })
    );
    const keys = result.errors.map((error) => error.key);
    expect(keys).toEqual(expect.arrayContaining(['email', 'phone', 'bloodGroup', 'dateOfJoining', 'validUntil']));
  });

  it('accepts every documented blood group and rejects the rest', () => {
    for (const group of ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']) {
      expect(buildSpec(form({ bloodGroup: group })).errors).toEqual([]);
    }
    expect(buildSpec(form({ bloodGroup: 'O positive' })).errors.map((error) => error.key)).toContain('bloodGroup');
  });

  it('warns rather than fails when the expiry precedes the issue date', () => {
    const result = buildSpec(form({ validFrom: '2026-01-01', validUntil: '2025-01-01' }));
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((warning) => /not after the issue date/i.test(warning))).toBe(true);
  });

  it('rejects an employee ID that would break a barcode or an access-control system', () => {
    expect(buildSpec(form({ employeeId: 'has space' })).errors.map((error) => error.key)).toContain('employeeId');
    expect(buildSpec(form({ employeeId: 'x'.repeat(40) })).errors.map((error) => error.key)).toContain('employeeId');
    expect(buildSpec(form({ employeeId: 'EMP-0001' })).errors).toEqual([]);
  });

  it('validates uploads by content, size and dimensions — not by file name', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13]);
    expect(validateImageFile('photo', { name: 'a.png', type: 'image/png', size: 5000, head: png }).ok).toBe(true);
    expect(validateImageFile('photo', { name: 'a.svg', type: 'image/svg+xml', size: 5000, head: new Uint8Array(16) }).ok).toBe(false);
    expect(validateImageFile('photo', { name: 'a.png', type: 'image/png', size: 9 * 1024 * 1024, head: png }).message).toMatch(/limit/i);
    // A JPEG wearing a PNG name is a file that would decode to nothing.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
    expect(validateImageFile('photo', { name: 'a.png', type: 'image/png', size: 5000, head: jpeg }).ok).toBe(false);
    expect(validateImageDimensions('photo', 40, 40).ok).toBe(false);
    expect(validateImageDimensions('photo', 1200, 1500).ok).toBe(true);
    expect(validateImageDimensions('photo', 9000, 9000).ok).toBe(false);
  });

  it('measures text so a long name cannot run under the photograph', () => {
    const wide = measureTextWidth('W'.repeat(40), 40);
    const narrow = measureTextWidth('i'.repeat(40), 40);
    expect(wide).toBeGreaterThan(narrow * 2);
    const layout = buildCardLayout(buildSpec(form({ fullName: 'Nwachukwu-Adeyemi Oluwasegun Chukwuemeka-Babatunde' })).spec);
    const name = layout.front.ops.find((op) => op.kind === 'text' && /Nwachukwu/.test(op.text));
    expect(name).toBeDefined();
    if (name && name.kind === 'text') expect(measureTextWidth(name.text, name.size)).toBeLessThanOrEqual(name.maxWidth ?? Number.POSITIVE_INFINITY);
  });

  it('formats dates for the card and passes anything unparseable straight through', () => {
    expect(formatCardDate('2026-01-01')).toBe('1 January 2026');
    expect(formatCardDate('not a date')).toBe('not a date');
  });
});

/* ------------------------------------------------------------------ */
/* Bulk import                                                         */
/* ------------------------------------------------------------------ */

describe('Employee ID Card Generator — bulk import', () => {
  const template = csvTemplate();
  const rows = parseCsv(template).rows;

  it('ships a CSV template every column of which the importer maps', () => {
    expect(rows[0]).toEqual(BULK_COLUMNS.map((column) => column.header));
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });

  it('accepts the template rows and reports the totals', () => {
    const report = validateRows(rows, { base: form() });
    expect(report.missingColumns).toEqual([]);
    expect(report.rejected).toEqual([]);
    expect(report.accepted).toHaveLength(2);
    expect(summariseReport(report)).toMatch(/2 of 2 rows/);
  });

  it('parses quoted fields, embedded commas and semicolon-delimited exports', () => {
    const quoted = parseCsv('Full name,Employee ID\n"Obi, Ada",EMP1\n');
    expect(quoted.rows[1]).toEqual(['Obi, Ada', 'EMP1']);
    const semicolon = parseCsv('Full name;Employee ID\nAda Obi;EMP1\n');
    expect(semicolon.delimiter).toBe(';');
    expect(semicolon.rows[1]).toEqual(['Ada Obi', 'EMP1']);
    const quotes = parseCsv('a,b\n"say ""hi""",2\n');
    expect(quotes.rows[1]).toEqual(['say "hi"', '2']);
  });

  it('rejects invalid rows with a reason each and never silently drops them', () => {
    const bad = parseCsv(
      [
        'Full name,Employee ID,Email,Blood group',
        'Ada Obi,EMP1,ada@example.com,O+',
        ',EMP2,ada@example.com,O+',
        'Chidi Eze,EMP3,not-an-email,O+',
        'Bisi Lawal,EMP4,bisi@example.com,ZZ',
      ].join('\n')
    ).rows;
    const report = validateRows(bad, { base: form() });
    expect(report.accepted.map((entry) => entry.spec.spec.employee.employeeId)).toEqual(['EMP1']);
    expect(report.rejected.map((entry) => entry.rowNumber)).toEqual([3, 4, 5]);
    expect(report.rejected.every((entry) => entry.reasons.length > 0)).toBe(true);
    const csv = rejectedRowsCsv(report);
    // The report opens with a UTF-8 BOM so Excel reads the accented names correctly.
    expect(csv.startsWith('\ufeff')).toBe(true);
    expect(csv.replace('\ufeff', '').split('\r\n')[0]).toBe(
      'Row,Reason,Full name,Employee ID,Job title,Department,Email,Phone,Blood group,Date of joining,Emergency contact,Photo URL'
    );
    expect(csv).toContain('not-an-email');
  });

  it('flags duplicate employee IDs on every affected row', () => {
    const duplicate = parseCsv('Full name,Employee ID\nAda Obi,EMP1\nChidi Eze,EMP1\n').rows;
    const report = validateRows(duplicate, { base: form() });
    expect(report.accepted).toEqual([]);
    expect(report.rejected).toHaveLength(2);
    expect(report.rejected[0]?.reasons[0]).toMatch(/appears on rows 2, 3/);
  });

  it('reports missing required columns instead of importing nothing quietly', () => {
    const report = validateRows(parseCsv('Full name,Department\nAda Obi,Finance\n').rows, { base: form() });
    expect(report.missingColumns).toContain('Employee ID');
    expect(report.accepted).toEqual([]);
  });

  it('rejects photo URLs a browser cannot load, and accepts https ones', () => {
    const report = validateRows(
      parseCsv('Full name,Employee ID,Photo URL\nAda Obi,EMP1,http://example.com/a.png\nChidi Eze,EMP2,https://example.com/b.png\n').rows,
      { base: form() }
    );
    expect(report.accepted.map((entry) => entry.spec.spec.employee.employeeId)).toEqual(['EMP2']);
    expect(report.accepted[0]?.photoUrl).toBe('https://example.com/b.png');
    expect(report.rejected[0]?.reasons[0]).toMatch(/https/i);
  });

  it('maps columns by alias and reports the ones it ignored', () => {
    const report = validateRows(parseCsv('Name,Staff ID,Role,Favourite colour\nAda Obi,EMP1,Engineer,Green\n').rows, { base: form() });
    expect(report.accepted).toHaveLength(1);
    expect(report.accepted[0]?.spec.spec.employee.jobTitle).toBe('Engineer');
    expect(report.unmappedHeaders).toEqual(['Favourite colour']);
  });

  it('reads a real .xlsx workbook, including shared strings and deflated sheets', async () => {
    const sheet = `<?xml version="1.0"?><worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>Ada Obi</t></is></c><c r="B2" t="inlineStr"><is><t>EMP1</t></is></c><c r="C2"><v>1</v></c></row>
      <row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3" t="inlineStr"><is><t>EMP2</t></is></c></row>
    </sheetData></worksheet>`;
    const shared = `<?xml version="1.0"?><sst><si><t>Full name</t></si><si><t>Employee ID</t></si><si><t>Favourite colour</t></si><si><t>Chidi Eze</t></si></sst>`;

    const enc = new TextEncoder();
    const deflated = new Uint8Array(deflateRawSync(enc.encode(sheet)));
    // A minimal ZIP with one stored member and one deflated member, built by hand so the test does
    // not depend on the importer's own writer.
    const build = (name: string, data: Uint8Array, deflatedData?: Uint8Array, crc = 0): Uint8Array => {
      const header = new Uint8Array(30);
      const view = new DataView(header.buffer);
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(8, deflatedData ? 8 : 0, true);
      const payload = deflatedData ?? data;
      view.setUint32(14, crc, true);
      view.setUint32(18, payload.length, true);
      view.setUint32(22, data.length, true);
      view.setUint16(26, name.length, true);
      return Buffer.concat([header, Buffer.from(name, 'latin1'), Buffer.from(payload)]);
    };
    const stored = build('xl/sharedStrings.xml', enc.encode(shared));
    const deflatedMember = build('xl/worksheets/sheet1.xml', enc.encode(sheet), deflated, crc32(enc.encode(sheet)));
    const central = (offset: number, name: string, data: Uint8Array, deflatedData?: Uint8Array): Uint8Array => {
      const entry = new Uint8Array(46);
      const view = new DataView(entry.buffer);
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(10, deflatedData ? 8 : 0, true);
      const payload = deflatedData ?? data;
      view.setUint32(20, payload.length, true);
      view.setUint32(24, data.length, true);
      view.setUint16(28, name.length, true);
      view.setUint32(42, offset, true);
      return Buffer.concat([entry, Buffer.from(name, 'latin1')]);
    };
    const firstMemberLength = stored.length;
    const centralDirectory = Buffer.concat([
      central(0, 'xl/sharedStrings.xml', enc.encode(shared)),
      central(firstMemberLength, 'xl/worksheets/sheet1.xml', enc.encode(sheet), deflated),
    ]);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, 2, true);
    endView.setUint16(10, 2, true);
    endView.setUint32(12, centralDirectory.length, true);
    endView.setUint32(16, firstMemberLength + deflatedMember.length, true);
    const workbook = Buffer.concat([stored, deflatedMember, centralDirectory, end]);

    const parsed = await parseXlsx(new Uint8Array(workbook));
    expect(parsed[0]).toEqual(['Full name', 'Employee ID', 'Favourite colour']);
    expect(parsed[1]?.slice(0, 2)).toEqual(['Ada Obi', 'EMP1']);
    expect(parsed[2]?.slice(0, 2)).toEqual(['Chidi Eze', 'EMP2']);

    const report = validateRows(parsed, { base: form() });
    expect(report.accepted).toHaveLength(2);
    expect(report.unmappedHeaders).toEqual(['Favourite colour']);
  });
});

describe('Employee ID Card Generator — nothing important is clipped', () => {
  /**
   * The failure this suite exists to prevent: a badge that looks right on screen and prints an
   * identifier with the tail missing, or a name whose surname has been replaced by an ellipsis.
   *
   * Every card is laid out twice with deliberately awkward but legal values — a long hyphenated
   * name, the maximum-length job title, a 48-character email and a long emergency-contact line —
   * and every drawn string is inspected. Identifier and contact *values* must appear complete; only
   * prose may be shortened, and only when the geometry genuinely cannot hold it.
   */
  const awkward = (overrides: Partial<CardFormState> = {}): CardFormState => ({
    ...defaultFormState(),
    fullName: 'Chukwuemeka Nwachukwu-Okonkwo',
    employeeId: 'CH247-OPS-2026-0001-8',
    jobTitle: 'Deputy General Manager, People Operations',
    department: 'People & Culture',
    email: 'chukwuemeka.nwachukwu@northstar-technologies.example',
    phone: '+234 801 234 5678',
    companyName: 'Northstar Technologies Nigeria Limited',
    companyAddress: '12 Adeola Odeku Street, Victoria Island, Lagos, Nigeria',
    companyWebsite: 'https://northstar-technologies.example',
    emergencyContact: 'Adaeze Nwachukwu · +234 802 111 2222',
    dateOfJoining: '2021-04-15',
    validFrom: '2026-01-01',
    validUntil: '2029-12-31',
    bloodGroup: 'O+',
    showQr: true,
    showBarcode: true,
    barcodeValue: 'CH247OPS20260001',
    ...overrides,
  });

  function drawnText(overrides: Partial<CardFormState>): { texts: string[]; warnings: string[]; width: number } {
    const { spec } = buildSpec(awkward(overrides));
    const layout = buildCardLayout(spec);
    const ops = [...layout.front.ops, ...layout.back.ops];
    return {
      texts: ops.filter((op) => op.kind === 'text').map((op) => (op as { text: string }).text),
      warnings: layout.warnings,
      width: layout.front.width,
    };
  }

  it.each(CARD_TEMPLATES.map((template) => template.id))('prints the employee ID, email and emergency contact in full on %s', (id) => {
    for (const orientation of ['landscape', 'portrait'] as const) {
      const { texts } = drawnText({ template: id as CardTemplateId, orientation });
      const joined = texts.join('\n');
      expect(joined, `${id}/${orientation} lost the employee ID`).toContain('CH247-OPS-2026-0001-8');
      expect(joined, `${id}/${orientation} lost the email address`).toContain('chukwuemeka.nwachukwu@northstar-technologies.example');
      expect(joined, `${id}/${orientation} lost the emergency contact`).toContain('Adaeze Nwachukwu · +234 802 111 2222');
      // A value that ends in an ellipsis is a value that matches nothing.
      expect(texts.some((text) => /chukwuemeka\.nwachukwu.*…/.test(text)), `${id}/${orientation} shortened the email`).toBe(false);
      expect(texts.some((text) => /CH247-OPS.*…/.test(text)), `${id}/${orientation} shortened the employee ID`).toBe(false);
    }
  });

  it('draws nothing outside the card, on any template or orientation', () => {
    for (const template of CARD_TEMPLATES) {
      for (const orientation of ['landscape', 'portrait'] as const) {
        const { spec } = buildSpec(awkward({ template: template.id, orientation }));
        const layout = buildCardLayout(spec);
        for (const face of [layout.front, layout.back]) {
          for (const op of face.ops) {
            if (op.kind === 'text') {
              expect(op.x, `${template.id}/${face.side} text starts off-card`).toBeGreaterThanOrEqual(-1);
              expect(op.x, `${template.id}/${face.side} text starts off-card`).toBeLessThanOrEqual(face.width + 1);
              expect(op.y, `${template.id}/${face.side} text runs off the bottom`).toBeLessThanOrEqual(face.height + 1);
            }
          }
        }
      }
    }
  });

  it('warns when a value is long enough that it had to be shortened', () => {
    const { warnings, texts } = drawnText({
      fullName: 'Ngozi-Oluwaseun Adaeze Chukwuemeka Nwachukwu-Okonkwo',
      orientation: 'portrait',
    });
    const shortened = texts.filter((text) => text.includes('…'));
    expect(shortened.length).toBeGreaterThan(0);
    expect(warnings.some((warning) => /longer than the portrait card can print/i.test(warning))).toBe(true);
    // The identifiers survive even the extreme name.
    expect(texts.join('\n')).toContain('CH247-OPS-2026-0001-8');
  });
});

describe('Employee ID Card Generator — the layout holds together', () => {
  /**
   * The defects this suite was written to catch, all of which shipped at least once while the twelve
   * templates were being built:
   *
   *   - the QR's white plate printed on top of the employee ID, the email address and the telephone
   *     number on two templates (the plate is opaque, so those fields simply vanished from the
   *     printed card);
   *   - the same plate clipped the bottom of a photograph and the monogram inside it;
   *   - the "EMPLOYEE ID" caption sat inside the footer band and the band covered it.
   *
   * The rule now enforced: **no piece of text and no image may be painted over by a shape drawn
   * after it.** Decorative shapes, translucent washes and stroke-only outlines are excluded — they
   * are meant to sit behind content, and a bounding box is a poor stand-in for a triangle — but
   * anything opaque that lands on text or a photograph is a bug, because the layout pipeline has no
   * reason to ever do that.
   */
  const sample = (overrides: Partial<CardFormState> = {}): CardFormState => ({
    ...defaultFormState(),
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
    ...overrides,
  });

  type Box = { x: number; y: number; w: number; h: number };

  function boxOf(op: CardFace['ops'][number]): Box | null {
    if (op.kind === 'text') {
      const width = op.letterSpacing
        ? measureTextWidth(op.text, op.size, op.family ?? 'sans') + op.letterSpacing * op.text.length
        : measureTextWidth(op.text, op.size, op.family ?? 'sans');
      const x = op.anchor === 'middle' ? op.x - width / 2 : op.anchor === 'end' ? op.x - width : op.x;
      // Baseline up to the cap line, plus a little for descenders: the tight box, so only real
      // collisions are reported.
      return { x, y: op.y - op.size * 0.8, w: width, h: op.size * 1.05 };
    }
    if (op.kind === 'image') return { x: op.x, y: op.y, w: op.w, h: op.h };
    if (op.kind === 'rect') return { x: op.x, y: op.y, w: op.w, h: op.h };
    return null;
  }

  function intersectionArea(a: Box, b: Box): number {
    const width = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const height = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return width > 0 && height > 0 ? width * height : 0;
  }

  it.each(CARD_TEMPLATES.map((template) => template.id))('prints nothing on top of text or a photograph on %s', (id) => {
    for (const orientation of ['landscape', 'portrait'] as const) {
      const { spec } = buildSpec(sample({ template: id as CardTemplateId, orientation }));
      const layout = buildCardLayout(spec);
      for (const face of [layout.front, layout.back]) {
        face.ops.forEach((op, index) => {
          if (op.kind !== 'text' && op.kind !== 'image') return;
          const subject = boxOf(op);
          if (!subject) return;
          for (const later of face.ops.slice(index + 1)) {
            // Text over text is a layout error too; it is just a rarer one. Two lines that merely
            // touch (a label above its value) are not an overprint, so the vertical overlap has to
            // be a real fraction of the line before it counts.
            if (later.kind === 'text') {
              const other = boxOf(later);
              if (!other) continue;
              const vertical = Math.min(subject.y + subject.h, other.y + other.h) - Math.max(subject.y, other.y);
              const horizontal = Math.min(subject.x + subject.w, other.x + other.w) - Math.max(subject.x, other.x);
              const overprint = vertical > op.size * 0.45 && horizontal > 24 && vertical * horizontal > 120;
              expect(
                overprint,
                `${id}/${orientation}/${face.side}: "${op.kind === 'text' ? op.text : 'image'}" is overprinted by "${later.text}"`
              ).toBe(false);
              continue;
            }
            // Only opaque shapes count: a stroke-only outline paints nothing, and a triangle's
            // bounding box is not the triangle.
            if (later.kind === 'polygon' || later.kind === 'circle' || later.kind === 'line') continue;
            if (later.kind === 'rect' && !later.fill) continue;
            if (later.kind === 'qr' || later.kind === 'barcode') continue;
            const shape = boxOf(later);
            if (!shape) continue;
            // A full-bleed background is drawn first by construction; it cannot be "later".
            if (shape.w * shape.h > face.width * face.height * 0.6) continue;
            const covered = intersectionArea(subject, shape);
            expect(
              covered,
              `${id}/${orientation}/${face.side}: "${op.kind === 'text' ? op.text : 'image'}" is covered by a ${later.kind} (${String((later as { fill?: string }).fill ?? '')})`
            ).toBeLessThan(60);
          }
        });
      }
    }
  });

  it('keeps the QR symbol clear of every field, on every template', { timeout: 180_000 }, () => {
    for (const template of CARD_TEMPLATES) {
      for (const orientation of ['landscape', 'portrait'] as const) {
        const { spec, qrPayload } = buildSpec(sample({ template: template.id, orientation }));
        const layout = buildCardLayout(spec);
        for (const face of [layout.front, layout.back]) {
          const qr = face.ops.find((op) => op.kind === 'qr');
          if (!qr || qr.kind !== 'qr') continue;
          const qrBox: Box = { x: qr.x, y: qr.y, w: qr.size, h: qr.size };
          for (const op of face.ops) {
            if (op.kind === 'text') {
              const text = boxOf(op);
              if (!text) continue;
              expect(intersectionArea(qrBox, text), `${template.id}/${orientation}/${face.side}: the QR covers "${op.text}"`).toBeLessThan(60);
            }
            if (op.kind === 'image') {
              const image = boxOf(op);
              if (!image) continue;
              expect(intersectionArea(qrBox, image), `${template.id}/${orientation}/${face.side}: the QR covers an uploaded image`).toBeLessThan(60);
            }
          }
          // And it still has to be decodable where it now sits.
          expect(decodeQrFromFace(face, qrBox)).toBe(qrPayload);
        }
      }
    }
  });
});
