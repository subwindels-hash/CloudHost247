/**
 * The twelve badge templates.
 *
 * Each template is a *layout program*: it receives the card geometry, the resolved palette and the
 * employee's details, and returns the draw operations for the front and the back. Templates differ
 * in structure — where the photograph sits, whether the card is dark or light, how the identifier
 * is emphasised, where the machine-readable codes go — not in a name and a highlight colour. The
 * test suite asserts that by fingerprinting each template's operation geometry and failing if any
 * two are the same.
 *
 * Shared building blocks (`header`, `photo`, `identity`, `fields`, `codes`, `backFace`) keep the
 * templates consistent in the things that must not vary: the return line, the honest handling of a
 * missing photograph, and the quiet zone around a QR symbol.
 */

import { formatCardDate, fitText, initials, label, measureTextWidth, titleCase, wrapText } from './text';
import { autoTextOn, mix, readableInk, shade, surfacesFor, type CardSurfaces } from './colors';
import { encodeQrMatrix, type QrMatrix } from './qr';
import { encodeCode128Code } from './code128';
import { CODE128_QUIET_MODULES, MIN_CODE128_MODULE_PX } from './expand';
import {
  CARD_TEMPLATES,
  cardPixelSize,
  type CardFace,
  type CardLayout,
  type CardPalette,
  type CardSpec,
  type CardTemplateId,
  type DrawOp,
} from './types';

export interface FaceMetrics {
  margin: number;
  gap: number;
  nameSize: number;
  roleSize: number;
  labelSize: number;
  valueSize: number;
  smallSize: number;
  headerHeight: number;
  footerHeight: number;
}

export function metricsFor(width: number, height: number): FaceMetrics {
  const unit = Math.min(width, height);
  return {
    margin: Math.round(unit * 0.065),
    gap: Math.round(unit * 0.028),
    nameSize: Math.round(unit * 0.062),
    roleSize: Math.round(unit * 0.03),
    labelSize: Math.round(unit * 0.021),
    valueSize: Math.round(unit * 0.028),
    smallSize: Math.round(unit * 0.018),
    headerHeight: Math.round(height * 0.19),
    footerHeight: Math.round(height * 0.08),
  };
}

/**
 * Inks that read on an arbitrary surface a template paints for itself.
 *
 * A template is free to paint a dark body, a coloured band or a tinted panel regardless of the
 * palette's own background, so text colour cannot be derived from the palette alone: the derived
 * greys are correct on the card body and invisible on a painted panel. Every text op that does not
 * sit on the card body therefore resolves its ink from the surface it actually sits on.
 */
export interface SurfaceInk {
  text: string;
  muted: string;
  accent: string;
  detail: string;
}

export function inkOn(palette: CardPalette, surface: string): SurfaceInk {
  const text = readableInk(palette.text, surface, 4.5);
  return {
    text,
    muted: readableInk(mix(text, surface, 0.35), surface, 4.5),
    accent: readableInk(palette.primary, surface, 4.5),
    detail: readableInk(palette.detail, surface, 4.5),
  };
}

interface TemplateContext {
  width: number;
  height: number;
  m: FaceMetrics;
  s: CardSurfaces;
  spec: CardSpec;
  /** Inks for a surface this template paints; memoised per face. */
  ink: (surface: string) => SurfaceInk;
}

/* ------------------------------------------------------------------ */
/* Shared building blocks                                              */
/* ------------------------------------------------------------------ */

/** Company logo (or a monogram tile) plus the company name. */
function header(
  ctx: TemplateContext,
  box: { x: number; y: number; w: number },
  tone: 'light' | 'dark',
  surface?: string
): DrawOp[] {
  const { s, spec, m } = ctx;
  // `tone` names the kind of surface; `surface` says exactly which one when it is not the card body
  // or the accent band. The ink follows the surface, never the tone alone.
  const surfaceColor = surface ?? (tone === 'dark' ? s.palette.primary : s.palette.background);
  const ink = ctx.ink(surfaceColor);
  const color = ink.text;
  const muted = ink.muted;
  const tile = tone === 'dark' ? shade(s.palette.primary, 0.25) : s.palette.primary;
  const logoSize = Math.round(m.headerHeight * 0.52);
  const ops: DrawOp[] = [];
  const hasLogo = spec.options.showLogo && Boolean(spec.images.logo);

  if (hasLogo) {
    ops.push({
      kind: 'image',
      x: box.x,
      y: box.y,
      w: logoSize,
      h: logoSize,
      href: spec.images.logo,
      fit: 'contain',
    });
  } else {
    ops.push(
      { kind: 'rect', x: box.x, y: box.y, w: logoSize, h: logoSize, radius: Math.round(logoSize * 0.22), fill: tile },
      {
        kind: 'text',
        x: box.x + logoSize / 2,
        y: box.y + logoSize * 0.68,
        text: initials(spec.company.name || 'Company'),
        size: Math.round(logoSize * 0.42),
        color: autoTextOn(tile),
        anchor: 'middle',
        weight: '800',
      }
    );
  }

  const textX = box.x + logoSize + Math.round(m.gap * 0.6);
  const available = box.w - (textX - box.x);
  const name = fitText(spec.company.name || 'Company name', available, Math.round(m.valueSize * 1.05), { minSize: m.smallSize });
  ops.push({
    kind: 'text',
    x: textX,
    y: box.y + logoSize * 0.72,
    text: name.text,
    size: name.size,
    color,
    weight: '700',
    maxWidth: available,
  });
  const subtitle = [spec.company.website, ''].find((value) => (value ?? '').trim() !== '');
  if (subtitle) {
    ops.push({
      kind: 'text',
      x: textX,
      y: box.y + logoSize * 1.12,
      text: fitText(stripScheme(subtitle), available, m.smallSize).text,
      size: m.smallSize,
      color: muted,
      maxWidth: available,
    });
  }
  return ops;
}

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

/** Photograph, or a monogram placeholder that is clearly a placeholder. */
function photo(
  ctx: TemplateContext,
  box: { x: number; y: number; w: number; h: number },
  options: { radius?: number; ring?: string; ringWidth?: number; monogramFill?: string; monogramColor?: string; placeholderLabel?: string } = {}
): DrawOp[] {
  const { spec, s, m } = ctx;
  const radius = options.radius ?? Math.round(Math.min(box.w, box.h) * 0.08);
  const hasPhoto = spec.options.showPhoto && Boolean(spec.images.photo);
  const ops: DrawOp[] = [];
  const frameStroke = options.ring ?? s.palette.primary;
  const frameWidth = options.ringWidth ?? Math.max(2, Math.round(Math.min(box.w, box.h) * 0.03));

  if (hasPhoto) {
    ops.push({ kind: 'image', x: box.x, y: box.y, w: box.w, h: box.h, href: spec.images.photo, fit: 'cover', radius });
    ops.push({ kind: 'rect', x: box.x, y: box.y, w: box.w, h: box.h, radius, stroke: frameStroke, strokeWidth: frameWidth });
    return ops;
  }

  const fill = options.monogramFill ?? mix(s.palette.background, s.palette.primary, s.dark ? 0.65 : 0.12);
  ops.push(
    { kind: 'rect', x: box.x, y: box.y, w: box.w, h: box.h, radius, fill },
    {
      kind: 'text',
      x: box.x + box.w / 2,
      y: box.y + box.h / 2 + Math.round(Math.min(box.w, box.h) * 0.12),
      text: initials(spec.employee.fullName || spec.employee.employeeId || 'ID'),
      size: Math.round(Math.min(box.w, box.h) * 0.36),
      color: options.monogramColor ?? autoTextOn(options.monogramFill ?? s.surface),
      anchor: 'middle',
      weight: '800',
    },
    {
      kind: 'text',
      x: box.x + box.w / 2,
      y: box.y + box.h - Math.round(m.smallSize * 0.9),
      text: options.placeholderLabel ?? 'PHOTO',
      size: Math.round(m.smallSize * 0.8),
      color: s.muted,
      anchor: 'middle',
      letterSpacing: 1.5,
      tracking: true,
    },
    { kind: 'rect', x: box.x, y: box.y, w: box.w, h: box.h, radius, stroke: frameStroke, strokeWidth: frameWidth }
  );
  return ops;
}

/** Name, job title and department in a vertical stack. */
function identity(
  ctx: TemplateContext,
  box: { x: number; y: number; w: number; align?: 'start' | 'middle' },
  options: {
    nameColor?: string;
    roleColor?: string;
    labelColor?: string;
    uppercaseName?: boolean;
    nameWeight?: '400' | '600' | '700' | '800';
    surface?: string;
  } = {}
): DrawOp[] {
  const { spec, s, m } = ctx;
  const ink = ctx.ink(options.surface ?? s.palette.background);
  const align = box.align ?? 'start';
  const anchor = align === 'middle' ? 'middle' : 'start';
  const x = align === 'middle' ? box.x + box.w / 2 : box.x;
  const ops: DrawOp[] = [];
  const nameValue = spec.employee.fullName.trim() || 'Employee name';
  const nameCase = options.uppercaseName ? nameValue.toUpperCase() : nameValue;
  let y = box.y;

  const name = fitText(nameCase, box.w, m.nameSize, { minSize: Math.round(m.nameSize * 0.7) });
  ops.push({ kind: 'text', x, y, text: name.text, size: name.size, color: options.nameColor ?? ink.text, anchor, weight: options.nameWeight ?? '800', maxWidth: box.w });
  y += Math.round(m.nameSize * 0.95);

  const role = spec.employee.jobTitle.trim();
  if (role !== '') {
    ops.push({
      kind: 'text',
      x,
      y,
      text: fitText(role, box.w, m.roleSize, { minSize: m.smallSize }).text,
      size: m.roleSize,
      color: options.roleColor ?? ink.accent,
      anchor,
      weight: '700',
      maxWidth: box.w,
    });
    y += Math.round(m.roleSize * 1.5);
  }

  const department = spec.employee.department.trim();
  if (department !== '') {
    ops.push({
      kind: 'text',
      x,
      y,
      text: fitText(titleCase(department), box.w, m.valueSize).text,
      size: m.valueSize,
      color: options.labelColor ?? ink.muted,
      anchor,
    });
    y += Math.round(m.valueSize * 1.4);
  }
  return ops;
}

interface FieldRow {
  label: string;
  value: string;
}

function employeeRows(spec: CardSpec): FieldRow[] {
  const rows: FieldRow[] = [];
  const push = (name: string, value: string): void => {
    if (value.trim() !== '') rows.push({ label: name, value: value.trim() });
  };
  push('Employee ID', spec.employee.employeeId);
  push('Email', spec.employee.email);
  push('Phone', spec.employee.phone);
  push('Blood group', spec.employee.bloodGroup);
  push('Joined', spec.employee.dateOfJoining ? formatCardDate(spec.employee.dateOfJoining) : '');
  return rows;
}

/** Labelled rows of employee data, stacked in a two-column grid inside `box`. */
function fields(
  ctx: TemplateContext,
  box: { x: number; y: number; w: number },
  rows: FieldRow[],
  options: {
    labelColor?: string;
    valueColor?: string;
    columns?: 1 | 2;
    rowGap?: number;
    rule?: string;
    ruleGap?: number;
    surface?: string;
    /**
     * How many lines a value may occupy. `1` (the default) fits the value onto one line, shrinking
     * and then trimming it; a larger number wraps at a word boundary instead. Contact details use
     * wrapping: a telephone number or an address that has been cut off is worse than one that
     * continues on the next line.
     */
    wrap?: number;
  } = {}
): DrawOp[] {
  const { s, m } = ctx;
  const ink = ctx.ink(options.surface ?? s.palette.background);
  const columns = options.columns ?? 1;
  const labelColor = options.labelColor ?? ink.muted;
  const valueColor = options.valueColor ?? ink.text;
  const rowGap = options.rowGap ?? Math.round(m.valueSize * 2.35);
  const columnWidth = box.w / columns;
  const valueWidth = columnWidth - Math.round(m.gap * 0.5);
  const wrapLines = Math.max(1, options.wrap ?? 1);
  const lineAdvance = Math.round(m.valueSize * 1.12);
  const valueOffset = Math.round(m.valueSize * 1.05);

  // Wrap or fit each value once, so the placement below can reserve the height each row needs.
  const rendered = rows.map((row) => {
    const lines =
      wrapLines > 1
        ? wrapText(row.value, valueWidth, m.valueSize, wrapLines)
        : [fitText(row.value, valueWidth, m.valueSize, { minSize: Math.round(m.valueSize * 0.72) }).text];
    return lines.length > 0 ? lines : [''];
  });
  const rowHeight = rendered.map((lines) => Math.max(1, lines.length));

  const ops: DrawOp[] = [];
  const place = (index: number, x: number, y: number): void => {
    const row = rows[index];
    const lines = rendered[index];
    if (!row || !lines) return;
    ops.push({
      kind: 'text',
      x,
      y,
      text: label(row.label),
      size: Math.round(m.labelSize * 0.92),
      color: labelColor,
      letterSpacing: 1.1,
      tracking: true,
    });
    lines.forEach((text: string, line: number) => {
      ops.push({
        kind: 'text',
        x,
        y: y + valueOffset + line * lineAdvance,
        text,
        size: m.valueSize,
        weight: '700',
        color: valueColor,
        maxWidth: valueWidth,
      });
    });
  };

  let y = box.y;
  for (let line = 0; line * columns < rows.length; line += 1) {
    let tallest = 1;
    for (let column = 0; column < columns; column += 1) {
      tallest = Math.max(tallest, rowHeight[line * columns + column] ?? 1);
    }
    for (let column = 0; column < columns; column += 1) {
      const index = line * columns + column;
      if (index >= rows.length) continue;
      place(index, box.x + column * columnWidth, y);
    }
    y += rowGap + (tallest - 1) * lineAdvance;
    if (options.rule) {
      ops.push({
        kind: 'line',
        x1: box.x,
        y1: y - (options.ruleGap ?? Math.round(m.gap * 0.8)),
        x2: box.x + box.w,
        y2: y - (options.ruleGap ?? Math.round(m.gap * 0.8)),
        color: options.rule,
        width: 1,
      });
    }
  }
  return ops;
}

/** The employee's signature image (or a ruled line labelled "signature"). */
function signature(
  ctx: TemplateContext,
  box: { x: number; y: number; w: number; h?: number },
  tone: 'light' | 'dark' = 'light',
  surface?: string
): DrawOp[] {
  const { s, m, spec } = ctx;
  const color = ctx.ink(surface ?? (tone === 'dark' ? s.palette.primary : s.palette.background)).muted;
  if (spec.options.showSignature && spec.images.signature) {
    return [
      { kind: 'image', x: box.x, y: box.y - (box.h ?? m.valueSize * 2), w: box.w, h: box.h ?? m.valueSize * 2, href: spec.images.signature, fit: 'contain' },
      { kind: 'line', x1: box.x, y1: box.y, x2: box.x + box.w, y2: box.y, color, width: 1 },
      { kind: 'text', x: box.x, y: box.y + m.smallSize, text: 'SIGNATURE', size: Math.round(m.smallSize * 0.85), color, letterSpacing: 1.2, tracking: true },
    ];
  }
  return [
    { kind: 'line', x1: box.x, y1: box.y, x2: box.x + box.w, y2: box.y, color, width: 1 },
    { kind: 'text', x: box.x, y: box.y + m.smallSize, text: 'SIGNATURE', size: Math.round(m.smallSize * 0.85), color, letterSpacing: 1.2, tracking: true },
  ];
}

interface CodeBoxes {
  qr?: { x: number; y: number; size: number };
  barcode?: { x: number; y: number; w: number; h: number };
}

/**
 * The machine-readable blocks.
 *
 * A QR symbol carries a two-module quiet zone because a scanner needs the light margin to find the
 * symbol's edge; a Code 128 symbol carries a ten-module quiet zone on each side for the same reason.
 * Both are dropped — with a warning, never silently — when the slot is too small to print reliably.
 */
function codeOps(ctx: TemplateContext, boxes: CodeBoxes, style: { dark: string; light: string; caption?: boolean; ruleColor?: string; rule?: boolean }): { ops: DrawOp[]; warnings: string[] } {
  const { spec, m, s } = ctx;
  const ops: DrawOp[] = [];
  const warnings: string[] = [];

  if (boxes.qr && spec.options.showQr) {
    const payload = spec.options.qrContent.trim();
    const matrix = payload === '' ? null : ((): QrMatrix | null => {
      const encoded = encodeQrMatrix(payload, 'M');
      return 'modules' in encoded ? encoded : null;
    })();
    if (!matrix) {
      warnings.push('The QR content could not be encoded, so no QR symbol was drawn. Check the QR content field.');
    } else if (boxes.qr.size < 96) {
      warnings.push('The QR slot on this template is smaller than 96 px at 300 dpi, which is too small to scan reliably, so no QR symbol was drawn. Choose a template with a larger QR slot.');
    } else {
      if (style.rule && style.ruleColor) {
        ops.push({ kind: 'rect', x: boxes.qr.x - 4, y: boxes.qr.y - 4, w: boxes.qr.size + 8, h: boxes.qr.size + 8, radius: 4, stroke: style.ruleColor, strokeWidth: 1 });
      }
      ops.push({ kind: 'rect', x: boxes.qr.x, y: boxes.qr.y, w: boxes.qr.size, h: boxes.qr.size, fill: style.light });
      ops.push({ kind: 'qr', x: boxes.qr.x, y: boxes.qr.y, size: boxes.qr.size, payload: matrix.payload, dark: style.dark, light: style.light });
      if (style.caption) {
        ops.push({
          kind: 'text',
          x: boxes.qr.x + boxes.qr.size / 2,
          y: boxes.qr.y + boxes.qr.size + m.smallSize * 1.3,
          text: 'SCAN FOR DETAILS',
          size: Math.round(m.smallSize * 0.78),
          color: s.muted,
          anchor: 'middle',
          letterSpacing: 1.1,
          tracking: true,
        });
      }
    }
  }

  if (boxes.barcode && spec.options.showBarcode) {
    const value = spec.options.barcodeValue.trim();
    if (value === '') {
      warnings.push('The barcode is switched on but has no value, so no barcode was drawn.');
    } else {
      const encoded = encodeCode128Code(value);
      if ('ok' in encoded) {
        warnings.push(encoded.message);
      } else {
        // ISO/IEC 15417 requires a minimum X-dimension (the narrowest bar). Below 0.19 mm — which at
        // 300 dpi is 2.2 px — the symbol prints but scanners stop reading it, so the tool refuses
        // rather than printing a barcode that fails at the turnstile.
        const totalModules = encoded.moduleCount + CODE128_QUIET_MODULES * 2;
        const modulePx = boxes.barcode.w / totalModules;
        if (modulePx < MIN_CODE128_MODULE_PX) {
          const mm = ((modulePx / 300) * 25.4).toFixed(2);
          warnings.push(
            `A Code 128 barcode of “${value}” needs ${totalModules} modules; at the ${Math.round(boxes.barcode.w)} px this template gives it, each bar would be ${mm} mm wide at 300 dpi — below the 0.19 mm minimum a scanner can read reliably, so no barcode was drawn. Use a shorter barcode value, or switch the barcode off and keep the QR code.`
          );
        } else {
          ops.push({
            kind: 'barcode',
            x: boxes.barcode.x,
            y: boxes.barcode.y,
            w: boxes.barcode.w,
            h: boxes.barcode.h,
            value,
            dark: style.dark,
            light: style.light,
            caption: true,
          });
        }
      }
    }
  }

  return { ops, warnings };
}

/** The return line every badge carries, because a lost badge is a security event. */
function footer(ctx: TemplateContext, text: string, options: { background?: string; color?: string } = {}): DrawOp[] {
  const { width, height, m, s } = ctx;
  const h = m.footerHeight;
  const background = options.background ?? s.palette.primary;
  const color = options.color ?? s.onPrimary;
  return [
    { kind: 'rect', x: 0, y: height - h, w: width, h, fill: background },
    {
      kind: 'text',
      x: width / 2,
      y: height - h * 0.38,
      text: fitText(text, width - m.margin, Math.round(m.smallSize * 0.92), { minSize: Math.round(m.smallSize * 0.7) }).text,
      size: Math.round(m.smallSize * 0.92),
      color,
      anchor: 'middle',
      maxWidth: width - m.margin,
    },
  ];
}

function returnLine(spec: CardSpec): string {
  const company = spec.company.name.trim() || 'the issuing organisation';
  return `If found, please return to ${company}`;
}

/** The back of the card: contact block, emergency contact, signature and the codes. */
function backFace(
  ctx: TemplateContext,
  options: {
    tone: 'light' | 'dark';
    layout: 'stacked' | 'columns' | 'grid';
    accentBand?: boolean;
  }
): { ops: DrawOp[]; warnings: string[] } {
  const { width, height, m, s, spec } = ctx;
  const tone = options.tone;
  const background = tone === 'dark' ? s.palette.detail : s.palette.background;
  const ink = ctx.ink(background);
  const bodyText = ink.text;
  const muted = ink.muted;
  const bandInk = ctx.ink(s.palette.primary);
  const ops: DrawOp[] = [{ kind: 'rect', x: 0, y: 0, w: width, h: height, fill: background }];

  if (options.accentBand) {
    ops.push({ kind: 'rect', x: 0, y: 0, w: width, h: Math.round(height * 0.09), fill: tone === 'dark' ? s.palette.primary : shade(s.palette.primary, 0.12) });
    ops.push({
      kind: 'text',
      x: m.margin,
      y: Math.round(height * 0.062),
      text: label('Employee identification — reverse'),
      size: Math.round(m.smallSize * 0.9),
      color: bandInk.text,
      letterSpacing: 1.3,
      tracking: true,
    });
  }

  const top = options.accentBand ? Math.round(height * 0.17) : Math.round(height * 0.16);
  const qrSize = Math.round(Math.min(width, height) * 0.34);
  const codeBoxes: CodeBoxes = {
    qr: { x: width - m.margin - qrSize, y: top, size: qrSize },
    barcode: { x: m.margin, y: height - m.footerHeight - Math.round(m.gap * 3.1), w: Math.round(width - m.margin * 2), h: Math.round(m.gap * 1.5) },
  };

  // Left column: contact and employment facts.
  const rows: FieldRow[] = [];
  if (spec.company.address.trim() !== '') rows.push({ label: 'Registered address', value: spec.company.address.replace(/\s*\n\s*/g, ', ') });
  if (spec.company.website.trim() !== '') rows.push({ label: 'Website', value: stripScheme(spec.company.website) });
  if (spec.employee.email.trim() !== '') rows.push({ label: 'Work email', value: spec.employee.email });
  if (spec.employee.phone.trim() !== '') rows.push({ label: 'Telephone', value: spec.employee.phone });
  if (spec.employee.emergencyContact.trim() !== '') rows.push({ label: 'Emergency contact', value: spec.employee.emergencyContact });
  if (spec.employee.dateOfJoining.trim() !== '') rows.push({ label: 'Date of joining', value: formatCardDate(spec.employee.dateOfJoining) });
  if (spec.employee.bloodGroup.trim() !== '') rows.push({ label: 'Blood group', value: spec.employee.bloodGroup });
  if ((spec.employee.validFrom ?? '').trim() !== '') rows.push({ label: 'Valid from', value: formatCardDate(spec.employee.validFrom ?? '') });
  if ((spec.employee.validUntil ?? '').trim() !== '') rows.push({ label: 'Valid until', value: formatCardDate(spec.employee.validUntil ?? '') });

  const columnWidth = Math.round(width * 0.52);
  // Wrapped, up to three lines: an address or an emergency contact that has been trimmed is not usable.
  const grid = fields(ctx, { x: m.margin, y: top + Math.round(m.valueSize * 1.1), w: columnWidth }, rows.slice(0, options.layout === 'grid' ? 8 : 6), {
    labelColor: muted,
    valueColor: bodyText,
    columns: options.layout === 'columns' ? 2 : 1,
    rowGap: Math.round(m.valueSize * (options.layout === 'columns' ? 2.6 : 2.15)),
    wrap: 3,
  });
  ops.push(...grid);

  const codeResult = codeOps(ctx, codeBoxes, {
    dark: tone === 'dark' ? '#0B1220' : '#101828',
    light: '#FFFFFF',
    caption: true,
    rule: true,
    ruleColor: tone === 'dark' ? mix(background, '#FFFFFF', 0.3) : s.hairline,
  });
  ops.push(...codeResult.ops);

  // The signature rule and its label sit fully above the footer strip; at gap * 0.4 the label was
  // printed under the strip and lost.
  ops.push(...signature(ctx, { x: m.margin, y: height - m.footerHeight - Math.round(m.gap * 1.3), w: Math.round(columnWidth * 0.8) }, tone, background));

  if (tone === 'dark') {
    ops.push({ kind: 'rect', x: 0, y: height - m.footerHeight, w: width, h: m.footerHeight, fill: s.palette.primary });
    ops.push({
      kind: 'text',
      x: width / 2,
      y: height - m.footerHeight * 0.38,
      text: fitText(returnLine(spec), width - m.margin, Math.round(m.smallSize * 0.92)).text,
      size: Math.round(m.smallSize * 0.92),
      color: ctx.ink(s.palette.primary).text,
      anchor: 'middle',
      maxWidth: width - m.margin,
    });
  } else {
    ops.push({ kind: 'line', x1: 0, y1: height - m.footerHeight, x2: width, y2: height - m.footerHeight, color: s.hairline, width: 1 });
    ops.push({
      kind: 'text',
      x: width / 2,
      y: height - m.footerHeight * 0.42,
      text: fitText(returnLine(spec), width - m.margin, Math.round(m.smallSize * 0.92)).text,
      size: Math.round(m.smallSize * 0.92),
      color: muted,
      anchor: 'middle',
      maxWidth: width - m.margin,
    });
  }

  // Keep the records straight: if the codes were suppressed the user is told why.
  return { ops, warnings: codeResult.warnings };
}

/** Shared single-column contact strip used by several templates on the front. */
function contactStrip(ctx: TemplateContext, box: { x: number; y: number; w: number }, colors: { text: string; muted: string }): DrawOp[] {
  const { spec, m } = ctx;
  const parts: string[] = [];
  if (spec.employee.email.trim() !== '') parts.push(spec.employee.email.trim());
  if (spec.employee.phone.trim() !== '') parts.push(spec.employee.phone.trim());
  const line = parts.join('  ·  ');
  if (line === '') return [];
  return [
    {
      kind: 'text',
      x: box.x,
      y: box.y,
      text: fitText(line, box.w, Math.round(m.smallSize * 1.05), { minSize: Math.round(m.smallSize * 0.8) }).text,
      size: Math.round(m.smallSize * 1.05),
      color: colors.text,
      maxWidth: box.w,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* The twelve templates                                                */
/* ------------------------------------------------------------------ */

interface TemplateResult {
  front: DrawOp[];
  back: DrawOp[];
  warnings: string[];
}

type TemplateFn = (ctx: TemplateContext) => TemplateResult;

const corporateSplit: TemplateFn = (ctx) => {
  const { width, height, m, s, spec } = ctx;
  const panelWidth = Math.round(width * 0.34);
  const front: DrawOp[] = [
    { kind: 'rect', x: 0, y: 0, w: width, h: height, fill: s.palette.background },
    { kind: 'rect', x: 0, y: 0, w: panelWidth, h: height, fill: s.palette.primary },
    { kind: 'polygon', points: [{ x: 0, y: height * 0.72 }, { x: panelWidth, y: height * 0.6 }, { x: 0, y: height }], fill: mix(s.palette.primary, '#FFFFFF', 0.2), opacity: 0.35 },
  ];
  const photoSize = Math.round(Math.min(panelWidth * 0.62, height * 0.44));
  front.push(...photo(ctx, { x: (panelWidth - photoSize) / 2, y: Math.round(height * 0.28), w: photoSize, h: Math.round(photoSize * 1.2) }, { radius: Math.round(photoSize * 0.1), ring: mix(s.palette.primary, '#FFFFFF', 0.7) }));
  // Both lines sit above the footer band: at the old positions the identifier label was printed
  // underneath it and simply disappeared.
  front.push({
    kind: 'text',
    x: panelWidth / 2,
    y: Math.round(height * 0.82),
    text: fitText(spec.employee.employeeId || 'EMPLOYEE ID', panelWidth - m.gap * 2, Math.round(m.valueSize * 1.15)).text,
    size: Math.round(m.valueSize * 1.15),
    color: s.onPrimary,
    anchor: 'middle',
    weight: '800',
    maxWidth: panelWidth - m.gap * 2,
  });
  front.push({ kind: 'text', x: panelWidth / 2, y: Math.round(height * 0.885), text: 'EMPLOYEE ID', size: Math.round(m.smallSize * 0.85), color: ctx.ink(s.palette.primary).muted, anchor: 'middle', letterSpacing: 1.2, tracking: true });
  front.push({ kind: 'rect', x: panelWidth, y: 0, w: width - panelWidth, h: height, fill: s.palette.background });
  front.push(...header(ctx, { x: panelWidth + m.margin, y: m.margin, w: width - panelWidth - m.margin * 2 }, 'light'));
  front.push(...identity(ctx, { x: panelWidth + m.margin, y: Math.round(height * 0.42), w: width - panelWidth - m.margin * 2 }));
  front.push({ kind: 'rect', x: panelWidth + m.margin, y: Math.round(height * 0.56), w: Math.round(m.gap * 1.6), h: 4, fill: s.palette.primary });
  front.push(...contactStrip(ctx, { x: panelWidth + m.margin, y: Math.round(height * 0.72), w: width - panelWidth - m.margin * 2 }, { text: s.muted, muted: s.muted }));
  const qrSize = Math.round(Math.min(width * 0.16, height * 0.3));
  const codes = codeOps(ctx, { qr: { x: width - m.margin - qrSize, y: height - m.footerHeight - qrSize - Math.round(m.gap * 1.2), size: qrSize } }, { dark: '#101828', light: '#FFFFFF', rule: true, ruleColor: s.hairline });
  front.push(...codes.ops);
  front.push(...footer(ctx, returnLine(spec)));
  const back = backFace(ctx, { tone: 'light', layout: 'stacked', accentBand: true });
  return { front, back: back.ops, warnings: codes.warnings.concat(back.warnings) };
};

const modernBadge: TemplateFn = (ctx) => {
  const { width, height, m, s, spec } = ctx;
  const body = s.dark ? s.palette.background : '#111D19';
  const bodyInk = ctx.ink(body);
  const front: DrawOp[] = [
    { kind: 'rect', x: 0, y: 0, w: width, h: height, fill: body },
    { kind: 'rect', x: 0, y: 0, w: width, h: Math.round(height * 0.028), fill: s.palette.primary },
    { kind: 'circle', bleed: true, cx: width * 0.9, cy: height * 0.1, r: Math.round(height * 0.3), fill: mix(s.palette.background, '#FFFFFF', 0.12), opacity: 0.55 },
  ];
  const photoW = Math.round(width * 0.26);
  const photoH = Math.round(photoW * 1.22);
  front.push(...photo(ctx, { x: m.margin, y: Math.round(height * 0.24), w: photoW, h: photoH }, { radius: Math.round(photoW * 0.16), ring: s.palette.primary, monogramFill: mix(s.palette.background, '#FFFFFF', 0.14), monogramColor: s.accentInk }));
  // The identifier sits in an accent pill wide enough to hold it: the pill is sized from the text it
  // carries, not from the gap metric, so a longer staff number cannot spill over its own background.
  const pillText = fitText(spec.employee.employeeId || 'NO ID', photoW, Math.round(m.valueSize * 1.05)).text;
  const pillSize = Math.round(m.valueSize * 1.05);
  const pillWidth = Math.min(photoW + m.gap, measureTextWidth(pillText, pillSize, 'mono') + Math.round(m.gap * 1.6));
  const pillHeight = Math.round(pillSize * 1.9);
  const pillX = m.margin + photoW / 2 - pillWidth / 2;
  const pillY = Math.round(height * 0.24) + photoH + Math.round(m.gap * 0.5);
  front.push({ kind: 'rect', x: pillX, y: pillY, w: pillWidth, h: pillHeight, radius: Math.round(pillHeight / 2), fill: s.palette.primary });
  front.push({
    kind: 'text',
    x: m.margin + photoW / 2,
    y: pillY + Math.round(pillHeight * 0.68),
    text: pillText,
    size: pillSize,
    color: ctx.ink(s.palette.primary).text,
    anchor: 'middle',
    weight: '800',
    family: 'mono',
    maxWidth: pillWidth - Math.round(m.gap * 0.4),
  });
  front.push(...header(ctx, { x: m.margin, y: Math.round(height * 0.07), w: width - m.margin * 2 }, 'dark', body));
  const textX = m.margin + photoW + Math.round(m.gap * 1.2);
  const textW = width - textX - m.margin;
  front.push({
    kind: 'text', x: textX, y: Math.round(height * 0.34), text: label('Team member'),
    size: Math.round(m.labelSize * 0.95), color: bodyInk.accent, letterSpacing: 1.4, tracking: true,
  });
  front.push(
    ...identity(ctx, { x: textX, y: Math.round(height * 0.43), w: textW }, {
      nameColor: bodyInk.text,
      roleColor: bodyInk.accent,
      labelColor: bodyInk.muted,
      surface: body,
    })
  );
  front.push({ kind: 'line', x1: textX, y1: Math.round(height * 0.62), x2: width - m.margin, y2: Math.round(height * 0.62), color: mix(s.palette.background, '#FFFFFF', 0.18), width: 2 });
  const rows = employeeRows(spec).filter((row) => row.label !== 'Employee ID').slice(0, 3);
  front.push(
    ...fields(ctx, { x: textX, y: Math.round(height * 0.7), w: textW }, rows, {
      labelColor: bodyInk.muted,
      valueColor: bodyInk.text,
      rowGap: Math.round(m.valueSize * 1.9),
      surface: body,
    })
  );
  const qrSize = Math.round(Math.min(width * 0.14, height * 0.26));
  const codes = codeOps(ctx, { qr: { x: width - m.margin - qrSize, y: height - Math.round(m.gap * 1.4) - qrSize, size: qrSize } }, { dark: '#101828', light: '#FFFFFF' });
  front.push(...codes.ops);
  const back = backFace(ctx, { tone: 'dark', layout: 'grid', accentBand: true });
  return { front, back: back.ops, warnings: codes.warnings.concat(back.warnings) };
};

const minimalCentre: TemplateFn = (ctx) => {
  const { width, height, m, s, spec } = ctx;
  const front: DrawOp[] = [{ kind: 'rect', x: 0, y: 0, w: width, h: height, fill: s.palette.background }];
  front.push(...header(ctx, { x: width / 2 - Math.round(width * 0.18), y: Math.round(height * 0.09), w: Math.round(width * 0.36) }, 'light'));
  const photoSize = Math.round(Math.min(height * 0.3, width * 0.2));
  front.push(...photo(ctx, { x: width / 2 - photoSize / 2, y: Math.round(height * 0.3), w: photoSize, h: photoSize }, { radius: Math.round(photoSize / 2), ring: s.palette.primary, ringWidth: 2, monogramFill: s.surface }));
  front.push(...identity(ctx, { x: m.margin, y: Math.round(height * 0.68), w: width - m.margin * 2, align: 'middle' }, { nameWeight: '700' }));
  front.push({ kind: 'line', x1: width * 0.35, y1: Math.round(height * 0.855), x2: width * 0.65, y2: Math.round(height * 0.855), color: s.palette.primary, width: 2 });
  front.push({
    kind: 'text', x: width / 2, y: Math.round(height * 0.92),
    text: fitText([spec.employee.employeeId ? `ID ${spec.employee.employeeId}` : '', spec.employee.bloodGroup ? `BLOOD ${spec.employee.bloodGroup}` : ''].filter(Boolean).join('   ·   ') || 'EMPLOYEE IDENTIFICATION CARD', width - m.margin * 2, Math.round(m.smallSize * 1.05)).text,
    size: Math.round(m.smallSize * 1.05), color: s.muted, anchor: 'middle', letterSpacing: 1.2, tracking: true, maxWidth: width - m.margin * 2,
  });
  const qrSize = Math.round(Math.min(width * 0.14, height * 0.24));
  const codes = codeOps(ctx, { qr: { x: width - m.margin - qrSize, y: m.margin, size: qrSize } }, { dark: '#101828', light: '#FFFFFF' });
  front.push(...codes.ops);
  const back = backFace(ctx, { tone: 'light', layout: 'stacked' });
  return { front, back: back.ops, warnings: codes.warnings.concat(back.warnings) };
};

const signatureWave: TemplateFn = (ctx) => {
  const { width, height, m, s, spec } = ctx;
  const waveTop = Math.round(height * 0.72);
  const front: DrawOp[] = [
    { kind: 'rect', x: 0, y: 0, w: width, h: height, fill: s.palette.background },
    { kind: 'rect', x: 0, y: 0, w: width, h: Math.round(height * 0.26), fill: mix(s.palette.background, s.palette.primary, s.dark ? 0.3 : 0.1) },
    { kind: 'polygon', points: [{ x: 0, y: waveTop + Math.round(height * 0.06) }, { x: width * 0.35, y: waveTop }, { x: width * 0.72, y: waveTop + Math.round(height * 0.08) }, { x: width, y: waveTop + Math.round(height * 0.02) }, { x: width, y: height }, { x: 0, y: height }], fill: s.palette.primary, opacity: 0.95 },
    { kind: 'polygon', points: [{ x: 0, y: waveTop + Math.round(height * 0.16) }, { x: width * 0.4, y: waveTop + Math.round(height * 0.1) }, { x: width * 0.8, y: waveTop + Math.round(height * 0.18) }, { x: width, y: waveTop + Math.round(height * 0.12) }, { x: width, y: height }, { x: 0, y: height }], fill: mix(s.palette.primary, '#FFFFFF', 0.22), opacity: 0.55 },
  ];
  front.push(...header(ctx, { x: m.margin, y: m.margin, w: Math.round(width * 0.6) }, 'light'));
  const photoW = Math.round(width * 0.24);
  const photoH = Math.round(photoW * 1.2);
  front.push(...photo(ctx, { x: width - m.margin - photoW, y: Math.round(height * 0.1), w: photoW, h: photoH }, { radius: Math.round(photoW * 0.12), ring: s.palette.primary, monogramColor: s.accentInk }));
  front.push(...identity(ctx, { x: m.margin, y: Math.round(height * 0.42), w: width - photoW - m.margin * 3 }, { roleColor: s.accentInk }));
  front.push(...fields(ctx, { x: m.margin, y: Math.round(height * 0.6), w: width - photoW - m.margin * 3 }, employeeRows(spec).slice(0, 2), { valueColor: s.palette.text, rowGap: Math.round(m.valueSize * 1.95) }));
  front.push({ kind: 'text', x: m.margin, y: Math.round(height * 0.8), text: fitText(spec.employee.fullName || 'Employee', width * 0.5, Math.round(m.roleSize * 0.95)).text, size: Math.round(m.roleSize * 0.95), color: s.onPrimary, weight: '700', opacity: 0.9, maxWidth: width * 0.5 });
  front.push({ kind: 'text', x: m.margin, y: Math.round(height * 0.845), text: label(spec.employee.jobTitle || 'Team member'), size: Math.round(m.smallSize * 0.9), color: mix(s.onPrimary, s.palette.primary, 0.25), letterSpacing: 1.1, tracking: true });
  const qrSize = Math.round(Math.min(width * 0.13, height * 0.22));
  const codes = codeOps(ctx, { qr: { x: width - m.margin - qrSize, y: height - m.footerHeight - qrSize - Math.round(m.gap * 0.6), size: qrSize } }, { dark: '#101828', light: '#FFFFFF' });
  front.push(...codes.ops);
  const back = backFace(ctx, { tone: 'light', layout: 'columns', accentBand: true });
  return { front, back: back.ops, warnings: codes.warnings.concat(back.warnings) };
};

const creativePanel: TemplateFn = (ctx) => {
  const { width, height, m, s, spec } = ctx;
  const panelRight = width - Math.round(width * 0.34);
  const front: DrawOp[] = [
    { kind: 'rect', x: 0, y: 0, w: width, h: height, fill: s.palette.background },
    { kind: 'polygon', points: [{ x: panelRight, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: panelRight - Math.round(width * 0.06), y: height }], fill: s.palette.primary },
    { kind: 'circle', bleed: true, cx: Math.round(width * 0.14), cy: Math.round(height * 0.14), r: Math.round(height * 0.22), fill: mix(s.palette.background, s.palette.primary, 0.12), opacity: 0.8 },
  ];
  front.push({ kind: 'rect', x: m.margin, y: m.margin, w: Math.round(m.gap * 2.2), h: Math.round(m.gap * 2.2), radius: 6, fill: s.palette.text });
  front.push({ kind: 'text', x: m.margin + Math.round(m.gap * 1.1), y: m.margin + Math.round(m.gap * 1.5), text: initials(spec.employee.fullName || 'ID'), size: Math.round(m.gap * 0.85), color: autoTextOn(s.palette.text), anchor: 'middle', weight: '800' });
  front.push(...header(ctx, { x: m.margin + Math.round(m.gap * 2.8), y: m.margin, w: panelRight - m.margin * 2 - Math.round(m.gap * 2.8) }, 'light'));
  front.push(...identity(ctx, { x: m.margin, y: Math.round(height * 0.4), w: panelRight - m.margin * 2 }, { roleColor: s.detailInk }));
  front.push(...fields(ctx, { x: m.margin, y: Math.round(height * 0.62), w: panelRight - m.margin * 2 }, employeeRows(spec).slice(0, 2), { rowGap: Math.round(m.valueSize * 1.9) }));
  const photoW = Math.round(width * 0.22);
  const photoH = Math.round(photoW * 1.25);
  front.push(...photo(ctx, { x: width - photoW - Math.round(width * 0.06), y: Math.round(height * 0.12), w: photoW, h: photoH }, { radius: Math.round(photoW * 0.14), ring: s.onPrimary, ringWidth: 3, monogramFill: mix(s.palette.primary, '#FFFFFF', 0.25), placeholderLabel: 'PHOTO' }));
  front.push({ kind: 'text', x: width - Math.round(width * 0.06) - photoW / 2, y: Math.round(height * 0.12) + photoH + Math.round(m.gap * 1.3), text: fitText(spec.employee.employeeId || '—', photoW, Math.round(m.valueSize * 1.05)).text, size: Math.round(m.valueSize * 1.05), color: s.onPrimary, anchor: 'middle', weight: '800', maxWidth: photoW });
  const qrSize = Math.round(Math.min(width * 0.13, height * 0.24));
  const codes = codeOps(ctx, { qr: { x: width - Math.round(width * 0.06) - qrSize, y: height - m.footerHeight - qrSize - Math.round(m.gap * 1.1), size: qrSize } }, { dark: '#101828', light: '#FFFFFF' });
  front.push(...codes.ops);
  const back = backFace(ctx, { tone: 'light', layout: 'grid', accentBand: true });
  return { front, back: back.ops, warnings: codes.warnings.concat(back.warnings) };
};

const startupFrame: TemplateFn = (ctx) => {
  const { width, height, m, s, spec } = ctx;
  const inset = Math.round(Math.min(width, height) * 0.035);
  const front: DrawOp[] = [
    { kind: 'rect', x: 0, y: 0, w: width, h: height, fill: s.palette.background },
  ];
  const corner = Math.round(Math.min(width, height) * 0.12);
  front.push(
    { kind: 'rect', x: inset, y: inset, w: width - inset * 2, h: height - inset * 2, radius: Math.round(inset * 0.9), stroke: s.palette.text, strokeWidth: 2 },
    { kind: 'polygon', points: [{ x: inset, y: inset }, { x: inset + corner, y: inset }, { x: inset, y: inset + corner }], fill: s.palette.primary },
    { kind: 'polygon', points: [{ x: width - inset, y: height - inset }, { x: width - inset - corner, y: height - inset }, { x: width - inset, y: height - inset - corner }], fill: s.palette.primary }
  );
  front.push(...header(ctx, { x: inset + m.gap, y: inset + m.gap, w: width - inset * 2 - m.gap * 2 }, 'light'));
  const photoW = Math.round(width * 0.23);
  const photoH = Math.round(photoW * 1.25);
  front.push(...photo(ctx, { x: width - inset - m.gap - photoW, y: height - inset - m.gap * 0.8 - photoH - m.footerHeight * 0.4, w: photoW, h: photoH }, { radius: 4, ring: s.palette.primary, ringWidth: 2 }));
  front.push(...identity(ctx, { x: inset + m.gap, y: Math.round(height * 0.46), w: width - inset * 2 - photoW - m.gap * 2.4 }, { roleColor: s.accentInk, uppercaseName: true, nameWeight: '800' }));
  const rows = employeeRows(spec).slice(0, 3);
  front.push(...fields(ctx, { x: inset + m.gap, y: Math.round(height * 0.68), w: Math.round(width * 0.44) }, rows, { columns: 1, rowGap: Math.round(m.valueSize * 1.85) }));
  // The symbol gets its own column between the header and the photograph. It used to sit in the
  // bottom-left corner, which is where the field rows are — the tile printed straight over the
  // employee ID, the email address and the telephone number. The layout tests now check every
  // template for exactly this class of mistake.
  const qrSize = Math.round(Math.min(width * 0.13, height * 0.22));
  const codes = codeOps(
    ctx,
    { qr: { x: width - inset - m.gap - qrSize, y: inset + m.gap + Math.round(m.headerHeight * 0.6) + Math.round(m.gap * 1.4), size: qrSize } },
    { dark: '#101828', light: '#FFFFFF', rule: true, ruleColor: s.hairline }
  );
  front.push(...codes.ops);
  const back = backFace(ctx, { tone: 'light', layout: 'columns' });
  return { front, back: back.ops, warnings: codes.warnings.concat(back.warnings) };
};

const gradientEdge: TemplateFn = (ctx) => {
  const { width, height, m, s, spec } = ctx;
  const bands: DrawOp[] = [
    { kind: 'rect', x: 0, y: 0, w: width, h: height, fill: s.palette.background },
  ];
  // A gradient rendered as concentric bands: deterministic, and identical in SVG, canvas and PDF.
  const steps = 12;
  for (let step = 0; step < steps; step += 1) {
    bands.push({
      kind: 'rect',
      x: 0,
      y: Math.round((height / steps) * step),
      w: width,
      h: Math.ceil(height / steps) + 1,
      fill: mix(s.palette.primary, s.palette.detail, step / (steps - 1)),
      opacity: 0.1 + (step / steps) * 0.16,
    });
  }
  bands.push({ kind: 'rect', x: 0, y: 0, w: width, h: Math.round(height * 0.045), fill: s.palette.primary });
  bands.push({ kind: 'rect', x: 0, y: height - Math.round(height * 0.045), w: width, h: Math.round(height * 0.045), fill: s.palette.detail });
  const photoSize = Math.round(Math.min(height * 0.42, width * 0.2));
  bands.push(...photo(ctx, { x: Math.round(width * 0.08), y: Math.round(height * 0.24), w: photoSize, h: Math.round(photoSize * 1.15) }, { radius: Math.round(photoSize * 0.5), ring: s.palette.primary, ringWidth: 4 }));
  bands.push(...identity(ctx, { x: Math.round(width * 0.08) + photoSize + m.gap, y: Math.round(height * 0.34), w: width - photoSize - m.gap * 2.4 }, { roleColor: s.detailInk }));
  bands.push({ kind: 'rect', x: Math.round(width * 0.08) + photoSize + m.gap, y: Math.round(height * 0.6), w: Math.round(width * 0.34), h: 1, fill: s.palette.primary });
  bands.push(...fields(ctx, { x: Math.round(width * 0.08) + photoSize + m.gap, y: Math.round(height * 0.68), w: Math.round(width * 0.4) }, employeeRows(spec).slice(0, 3), { columns: 1, rowGap: Math.round(m.valueSize * 1.75) }));
  bands.push(...header(ctx, { x: m.margin, y: Math.round(height * 0.08), w: Math.round(width * 0.7) }, 'light'));
  const qrSize = Math.round(Math.min(width * 0.14, height * 0.22));
  const codes = codeOps(ctx, { qr: { x: width - m.margin - qrSize, y: height - Math.round(height * 0.09) - qrSize, size: qrSize } }, { dark: '#101828', light: '#FFFFFF' });
  bands.push(...codes.ops);
  const back = backFace(ctx, { tone: 'light', layout: 'grid' });
  return { front: bands, back: back.ops, warnings: codes.warnings.concat(back.warnings) };
};

const portraitPass: TemplateFn = (ctx) => {
  const { width, height, m, s, spec } = ctx;
  const photoW = Math.round(width * 0.36);
  const front: DrawOp[] = [
    { kind: 'rect', x: 0, y: 0, w: width, h: height, fill: s.palette.background },
    { kind: 'rect', x: width - photoW, y: 0, w: photoW, h: height, fill: mix(s.palette.background, s.palette.primary, 0.16) },
    // Lanyard slot.
    { kind: 'rect', x: width - photoW / 2 - Math.round(photoW * 0.16), y: Math.round(height * 0.04), w: Math.round(photoW * 0.32), h: Math.round(m.gap * 0.55), radius: Math.round(m.gap * 0.28), fill: s.palette.background, stroke: s.hairline, strokeWidth: 1 },
  ];
  // The right column reads top to bottom: lanyard slot, photograph, QR symbol, identifier. The
  // symbol used to sit in the left column's bottom corner, on top of the field rows.
  front.push(...photo(ctx, { x: width - photoW + Math.round(photoW * 0.1), y: Math.round(height * 0.14), w: Math.round(photoW * 0.8), h: Math.round(height * 0.5) }, { radius: Math.round(photoW * 0.06), ring: s.palette.primary, ringWidth: 2 }));
  front.push({ kind: 'text', x: width - photoW / 2, y: Math.round(height * 0.93), text: fitText(spec.employee.employeeId || '—', photoW - m.gap, Math.round(m.valueSize * 1.2)).text, size: Math.round(m.valueSize * 1.2), color: s.palette.text, anchor: 'middle', weight: '800', family: 'mono', maxWidth: photoW - m.gap });
  front.push(...header(ctx, { x: m.margin, y: m.margin, w: width - photoW - m.margin * 2 }, 'light'));
  front.push(...identity(ctx, { x: m.margin, y: Math.round(height * 0.36), w: width - photoW - m.margin * 2.4 }, { roleColor: s.accentInk }));
  front.push(...fields(ctx, { x: m.margin, y: Math.round(height * 0.6), w: width - photoW - m.margin * 2.4 }, employeeRows(spec).slice(1, 5), { columns: 1, rowGap: Math.round(m.valueSize * 1.8), rule: s.hairline, ruleGap: Math.round(m.gap * 0.5) }));
  const qrSize = Math.round(Math.min(photoW * 0.62, height * 0.19));
  const codes = codeOps(ctx, { qr: { x: width - photoW + Math.round((photoW - qrSize) / 2), y: Math.round(height * 0.68), size: qrSize } }, { dark: '#101828', light: '#FFFFFF' });
  front.push(...codes.ops);
  const back = backFace(ctx, { tone: 'dark', layout: 'stacked', accentBand: false });
  return { front, back: back.ops, warnings: codes.warnings.concat(back.warnings) };
};

const techDiagonal: TemplateFn = (ctx) => {
  const { width, height, m, s, spec } = ctx;
  const front: DrawOp[] = [
    { kind: 'rect', x: 0, y: 0, w: width, h: height, fill: s.palette.background },
    { kind: 'polygon', points: [{ x: width * 0.52, y: 0 }, { x: width, y: 0 }, { x: width, y: height * 0.62 }], fill: s.palette.primary, opacity: 0.94 },
    { kind: 'polygon', points: [{ x: width * 0.62, y: 0 }, { x: width, y: 0 }, { x: width, y: height * 0.42 }], fill: s.palette.detail, opacity: 0.5 },
  ];
  // Deterministic grid texture: a few hairlines, not a bitmap, so the export stays sharp.
  for (let step = 1; step < 6; step += 1) {
    front.push({ kind: 'line', x1: Math.round((width / 6) * step), y1: 0, x2: Math.round((width / 6) * step), y2: height, color: s.hairline, width: 1, dash: [4, 6] });
  }
  front.push(...header(ctx, { x: m.margin, y: m.margin, w: Math.round(width * 0.5) }, 'light'));
  front.push({ kind: 'text', x: m.margin, y: Math.round(height * 0.34), text: 'EMPLOYEE', size: Math.round(m.labelSize * 0.95), color: s.accentInk, letterSpacing: 2, tracking: true });
  front.push(...identity(ctx, { x: m.margin, y: Math.round(height * 0.42), w: Math.round(width * 0.5) }, { roleColor: s.detailInk, nameWeight: '700' }));
  const photoW = Math.round(width * 0.2);
  // Squarish and placed above the corner symbol: the tall frame used to reach down into the QR.
  const photoH = Math.round(photoW * 0.95);
  front.push(...photo(ctx, { x: width - m.margin - photoW, y: Math.round(height * 0.3), w: photoW, h: photoH }, { radius: 2, ring: s.onPrimary, ringWidth: 2, monogramFill: mix(s.palette.primary, '#FFFFFF', 0.25) }));
  front.push({ kind: 'text', x: m.margin, y: Math.round(height * 0.72), text: fitText(spec.employee.employeeId || 'NO ID', Math.round(width * 0.4), Math.round(m.valueSize * 1.25), { family: 'mono' }).text, size: Math.round(m.valueSize * 1.25), color: s.palette.text, weight: '700', family: 'mono', maxWidth: Math.round(width * 0.4) });
  // The barcode keeps to the left 60 % so it cannot run under the corner symbol.
  const barcode = { x: m.margin, y: Math.round(height * 0.82), w: Math.round(width * 0.6), h: Math.round(m.gap * 1.5) };
  const codes = codeOps(ctx, { qr: { x: width - m.margin - Math.round(height * 0.3), y: height - Math.round(height * 0.34), size: Math.round(height * 0.3) }, barcode: spec.options.showBarcode ? barcode : undefined }, { dark: '#101828', light: '#FFFFFF' });
  front.push(...codes.ops);
  const back = backFace(ctx, { tone: 'dark', layout: 'columns', accentBand: true });
  return { front, back: back.ops, warnings: codes.warnings.concat(back.warnings) };
};

const monoStripe: TemplateFn = (ctx) => {
  const { width, height, m, s, spec } = ctx;
  const stripeW = Math.round(width * 0.055);
  const front: DrawOp[] = [
    { kind: 'rect', x: 0, y: 0, w: width, h: height, fill: s.palette.background },
    { kind: 'rect', x: 0, y: 0, w: stripeW, h: height, fill: s.palette.text },
  ];
  const stripes = 6;
  for (let step = 0; step < stripes; step += 1) {
    front.push({
      kind: 'rect',
      x: stripeW,
      y: Math.round((height / stripes) * step + height * 0.02),
      w: Math.round(stripeW * 0.42),
      h: Math.round(height / stripes - height * 0.05),
      fill: step % 2 === 0 ? s.palette.primary : s.hairline,
    });
  }
  const photoSize = Math.round(Math.min(height * 0.34, width * 0.17));
  front.push(...photo(ctx, { x: stripeW + m.margin, y: Math.round(height * 0.16), w: photoSize, h: photoSize }, { radius: 0, ring: s.palette.text, ringWidth: 2, monogramFill: s.surface, placeholderLabel: '' }));
  front.push(...identity(ctx, { x: stripeW + m.margin + photoSize + m.gap, y: Math.round(height * 0.3), w: width - stripeW - m.margin * 3 - photoSize }, { roleColor: s.muted, nameWeight: '600' }));
  front.push(...header(ctx, { x: stripeW + m.margin, y: m.margin, w: Math.round(width * 0.6) }, 'light'));
  front.push({
    kind: 'rect', x: stripeW + m.margin, y: Math.round(height * 0.62), w: Math.round(width * 0.4), h: Math.round(m.gap * 1.5),
    fill: s.palette.text, radius: 3,
  });
  front.push({ kind: 'text', x: stripeW + m.margin + Math.round(m.gap * 0.8), y: Math.round(height * 0.62) + Math.round(m.gap * 1.02), text: fitText(spec.employee.employeeId || 'NO ID', Math.round(width * 0.35), Math.round(m.valueSize * 1.05), { family: 'mono' }).text, size: Math.round(m.valueSize * 1.05), color: s.palette.background, weight: '700', family: 'mono', maxWidth: Math.round(width * 0.35) });
  const rows = employeeRows(spec).filter((row) => row.label === 'Blood group' || row.label === 'Joined');
  if (rows.length > 0) {
    front.push(...fields(ctx, { x: stripeW + m.margin, y: Math.round(height * 0.76), w: Math.round(width * 0.5) }, rows, { columns: 2, rowGap: Math.round(m.valueSize * 2), labelColor: s.muted }));
  }
  const qrSize = Math.round(Math.min(width * 0.12, height * 0.22));
  const codes = codeOps(ctx, { qr: { x: width - m.margin - qrSize, y: height - m.footerHeight - qrSize - Math.round(m.gap * 1.2), size: qrSize } }, { dark: '#101828', light: '#FFFFFF' });
  front.push(...codes.ops);
  const back = backFace(ctx, { tone: 'light', layout: 'stacked', accentBand: false });
  return { front, back: back.ops, warnings: codes.warnings.concat(back.warnings) };
};

const executiveRibbon: TemplateFn = (ctx) => {
  const { width, height, m, s, spec } = ctx;
  const ribbon = Math.round(height * 0.3);
  const front: DrawOp[] = [
    { kind: 'rect', x: 0, y: 0, w: width, h: height, fill: s.palette.background },
    { kind: 'polygon', points: [{ x: width - ribbon * 1.6, y: 0 }, { x: width, y: 0 }, { x: width, y: ribbon }, { x: width - ribbon * 2.1, y: ribbon }], fill: s.palette.detail },
    { kind: 'polygon', points: [{ x: width - ribbon * 1.35, y: 0 }, { x: width, y: 0 }, { x: width, y: ribbon * 0.62 }, { x: width - ribbon * 1.75, y: ribbon * 0.62 }], fill: s.palette.primary, opacity: 0.9 },
    { kind: 'rect', x: 0, y: 0, w: Math.round(width * 0.012), h: height, fill: s.palette.primary },
  ];
  front.push(...header(ctx, { x: m.margin, y: Math.round(height * 0.11), w: Math.round(width * 0.58) }, 'light'));
  front.push(...identity(ctx, { x: m.margin, y: Math.round(height * 0.4), w: Math.round(width * 0.56) }, { roleColor: s.detailInk, nameWeight: '600' }));
  front.push({ kind: 'line', x1: m.margin, y1: Math.round(height * 0.585), x2: Math.round(width * 0.56), y2: Math.round(height * 0.585), color: s.hairline, width: 1 });
  const rows = employeeRows(spec).slice(0, 3);
  front.push(...fields(ctx, { x: m.margin, y: Math.round(height * 0.68), w: Math.round(width * 0.52) }, rows, { columns: 1, rowGap: Math.round(m.valueSize * 1.75) }));
  const photoW = Math.round(width * 0.18);
  const photoH = Math.round(photoW * 1.2);
  front.push(...photo(ctx, { x: width - m.margin - photoW, y: Math.round(height * 0.42), w: photoW, h: photoH }, { radius: 3, ring: s.palette.detail, ringWidth: 2 }));
  const departmentRoom = photoW + m.gap * 2;
  const departmentLabel = fitText(label(spec.employee.department || 'Employee'), departmentRoom, Math.round(m.smallSize * 0.85), {
    minSize: Math.round(m.smallSize * 0.6),
    tracking: 1.1,
  });
  front.push({
    kind: 'text',
    x: width - m.margin - photoW / 2,
    y: Math.round(height * 0.42) + photoH + Math.round(m.gap * 1.2),
    text: departmentLabel.text,
    size: departmentLabel.size,
    color: s.muted,
    anchor: 'middle',
    letterSpacing: 1.1,
    tracking: true,
    maxWidth: departmentRoom,
  });
  const signatureX = Math.round(width * 0.6);
  front.push(...signature(ctx, { x: signatureX, y: Math.round(height * 0.84), w: Math.round(width * 0.3) }));
  const qrSize = Math.round(Math.min(width * 0.12, height * 0.2));
  const codes = codeOps(ctx, { qr: { x: Math.round(width * 0.62), y: Math.round(height * 0.2), size: qrSize } }, { dark: '#101828', light: '#FFFFFF' });
  front.push(...codes.ops);
  const back = backFace(ctx, { tone: 'light', layout: 'columns' });
  return { front, back: back.ops, warnings: codes.warnings.concat(back.warnings) };
};

const softGeometry: TemplateFn = (ctx) => {
  const { width, height, m, s, spec } = ctx;
  const front: DrawOp[] = [
    { kind: 'rect', x: 0, y: 0, w: width, h: height, fill: s.palette.background },
    { kind: 'circle', bleed: true, cx: Math.round(width * 0.9), cy: Math.round(height * 0.12), r: Math.round(height * 0.34), fill: mix(s.palette.background, s.palette.primary, 0.18) },
    { kind: 'circle', bleed: true, cx: Math.round(width * 0.08), cy: Math.round(height * 0.94), r: Math.round(height * 0.3), fill: mix(s.palette.background, s.palette.detail, 0.14) },
    { kind: 'circle', bleed: true, cx: Math.round(width * 0.72), cy: Math.round(height * 1.02), r: Math.round(height * 0.18), fill: s.surface },
  ];
  const panel = { x: m.margin, y: Math.round(height * 0.12), w: Math.round(width * 0.56), h: Math.round(height * 0.72) };
  front.push({ kind: 'rect', x: panel.x, y: panel.y, w: panel.w, h: panel.h, radius: Math.round(m.gap * 1.2), fill: s.surface, opacity: 0.85 });
  front.push(...header(ctx, { x: panel.x + m.gap, y: panel.y + Math.round(m.gap * 0.8), w: panel.w - m.gap * 2 }, 'light'));
  const photoSize = Math.round(Math.min(height * 0.34, width * 0.18));
  front.push(...photo(ctx, { x: width - m.margin - photoSize, y: Math.round(height * 0.2), w: photoSize, h: photoSize }, { radius: Math.round(photoSize / 2), ring: s.palette.primary, ringWidth: 3 }));
  front.push(...identity(ctx, { x: panel.x + m.gap, y: Math.round(height * 0.42), w: panel.w - m.gap * 2 }, { roleColor: s.accentInk }));
  front.push(...fields(ctx, { x: panel.x + m.gap, y: Math.round(height * 0.65), w: panel.w - m.gap * 2 }, employeeRows(spec).slice(0, 2), { columns: 2, rowGap: Math.round(m.valueSize * 2.1) }));
  front.push({ kind: 'text', x: width - m.margin - photoSize / 2, y: Math.round(height * 0.2) + photoSize + Math.round(m.gap * 1.6), text: fitText(spec.employee.employeeId || '—', photoSize + m.gap, Math.round(m.valueSize * 1.1)).text, size: Math.round(m.valueSize * 1.1), color: s.detailInk, anchor: 'middle', weight: '800', maxWidth: photoSize + m.gap });
  const qrSize = Math.round(Math.min(width * 0.12, height * 0.2));
  const codes = codeOps(ctx, { qr: { x: width - m.margin - qrSize, y: height - m.footerHeight - qrSize - Math.round(m.gap * 1.2), size: qrSize } }, { dark: '#101828', light: '#FFFFFF' });
  front.push(...codes.ops);
  const back = backFace(ctx, { tone: 'light', layout: 'grid', accentBand: true });
  return { front, back: back.ops, warnings: codes.warnings.concat(back.warnings) };
};

const TEMPLATE_FUNCTIONS: Record<CardTemplateId, TemplateFn> = {
  'corporate-split': corporateSplit,
  'modern-badge': modernBadge,
  'minimal-centre': minimalCentre,
  'signature-wave': signatureWave,
  'creative-panel': creativePanel,
  'startup-frame': startupFrame,
  'gradient-edge': gradientEdge,
  'portrait-pass': portraitPass,
  'tech-diagonal': techDiagonal,
  'mono-stripe': monoStripe,
  'executive-ribbon': executiveRibbon,
  'soft-geometry': softGeometry,
};

export function isCardTemplate(value: string): value is CardTemplateId {
  return CARD_TEMPLATES.some((template) => template.id === value);
}

/** Build both faces of the card. Pure: same spec in, same operations out. */
export function buildCardLayout(spec: CardSpec): CardLayout {
  const { width, height } = cardPixelSize(spec.options.orientation);
  const template = TEMPLATE_FUNCTIONS[spec.options.template] ?? TEMPLATE_FUNCTIONS['corporate-split'];
  const surfaces = surfacesFor(spec.options.palette);
  const inkCache = new Map<string, SurfaceInk>();
  const context: TemplateContext = {
    width,
    height,
    m: metricsFor(width, height),
    s: surfaces,
    spec,
    ink: (surface: string): SurfaceInk => {
      const existing = inkCache.get(surface);
      if (existing) return existing;
      const computed = inkOn(surfaces.palette, surface);
      inkCache.set(surface, computed);
      return computed;
    },
  };
  const result = template(context);
  const warnings: string[] = [...result.warnings];
  if (context.s.bodyContrast < 4.5) {
    warnings.push(
      `The text colour has only ${context.s.bodyContrast}:1 contrast against the card background — below the 4.5:1 WCAG 2.1 AA minimum for body text. Darken the text or lighten the background before printing.`
    );
  }
  if (!spec.options.showPhoto || !spec.images.photo) {
    warnings.push('No photograph was supplied, so the card shows the initials monogram instead. Add a photograph for an identifiable badge.');
  }
  return {
    front: { side: 'front', width, height, ops: result.front },
    back: { side: 'back', width, height, ops: result.back },
    warnings,
  };
}
