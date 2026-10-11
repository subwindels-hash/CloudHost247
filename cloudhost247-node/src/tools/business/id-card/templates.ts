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

import { formatCardDate, fitText, initials, label, measureTextWidth, titleCase } from './text';
import { mix, shade, surfacesFor, type CardSurfaces } from './colors';
import { encodeQrMatrix, type QrMatrix } from './qr';
import { encodeCode128Code } from './code128';
import {
  CARD_TEMPLATES,
  cardPixelSize,
  type CardFace,
  type CardLayout,
  type CardSpec,
  type CardTemplateId,
  type DrawOp,
} from './types';

/**
 * The narrowest bar, in card pixels at 300 dpi, this tool will print for a Code 128 symbol.
 *
 * ISO/IEC 15417 sets no minimum X dimension for a card, but a scanner needs enough pixels per
 * module to resolve run lengths: below roughly 0.21 mm (2.5 px at 300 dpi) a badge printer's dot
 * gain merges narrow bars and the symbol stops reading. The value is a print constraint, not a
 * style choice, and `buildCardLayout` refuses to draw a barcode that cannot meet it.
 */
export const MIN_CODE128_MODULE_PX = 2.5;

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

interface TemplateContext {
  width: number;
  height: number;
  m: FaceMetrics;
  s: CardSurfaces;
  spec: CardSpec;
}

/* ------------------------------------------------------------------ */
/* Shared building blocks                                              */
/* ------------------------------------------------------------------ */

/** Company logo (or a monogram tile) plus the company name. */
function header(ctx: TemplateContext, box: { x: number; y: number; w: number }, tone: 'light' | 'dark'): DrawOp[] {
  const { s, spec, m } = ctx;
  const color = tone === 'dark' ? s.onPrimary : s.palette.text;
  const muted = tone === 'dark' ? mix(s.onPrimary, s.palette.primary, 0.25) : s.muted;
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
      { kind: 'rect', x: box.x, y: box.y, w: logoSize, h: logoSize, radius: Math.round(logoSize * 0.22), fill: tone === 'dark' ? shade(s.palette.primary, 0.25) : s.palette.primary },
      {
        kind: 'text',
        x: box.x + logoSize / 2,
        y: box.y + logoSize * 0.68,
        text: initials(spec.company.name || 'Company'),
        size: Math.round(logoSize * 0.42),
        color: tone === 'dark' ? s.onPrimary : s.onPrimary,
        anchor: 'middle',
        weight: '800',
      }
    );
  }

  const textX = box.x + logoSize + Math.round(m.gap * 0.6);
  const available = box.w - (textX - box.x);
  /* A company name is the badge's issuer; it shrinks a long way before it is shortened, because
     "Northstar…" on the front of a card identifies nobody. */
  const name = fitText(spec.company.name || 'Company name', available, Math.round(m.valueSize * 1.05), { minSize: Math.round(m.valueSize * 0.5) });
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
      ...fitOp(stripScheme(subtitle), available, m.smallSize),
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
      color: options.monogramColor ?? s.palette.primary,
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
  options: { nameColor?: string; roleColor?: string; labelColor?: string; uppercaseName?: boolean; nameWeight?: '400' | '600' | '700' | '800' } = {}
): DrawOp[] {
  const { spec, s, m } = ctx;
  const align = box.align ?? 'start';
  const anchor = align === 'middle' ? 'middle' : 'start';
  const x = align === 'middle' ? box.x + box.w / 2 : box.x;
  const ops: DrawOp[] = [];
  const nameValue = spec.employee.fullName.trim() || 'Employee name';
  const nameCase = options.uppercaseName ? nameValue.toUpperCase() : nameValue;
  let y = box.y;

  /* The name is the field a badge is actually read for, so its floor is deliberately low: an
     extreme name shrinks rather than losing its surname. */
  const name = fitText(nameCase, box.w, m.nameSize, { minSize: Math.round(m.nameSize * 0.45) });
  ops.push({ kind: 'text', x, y, text: name.text, size: name.size, color: options.nameColor ?? s.palette.text, anchor, weight: options.nameWeight ?? '800', maxWidth: box.w });
  y += Math.round(m.nameSize * 0.95);

  const role = spec.employee.jobTitle.trim();
  if (role !== '') {
    ops.push({
      kind: 'text',
      x,
      y,
      ...fitOp(role, box.w, m.roleSize, { minSize: Math.max(7, Math.round(m.roleSize * 0.6)) }),
      color: options.roleColor ?? s.palette.primary,
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
      ...fitOp(titleCase(department), box.w, m.valueSize),
      color: options.labelColor ?? s.muted,
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
  options: { labelColor?: string; valueColor?: string; columns?: 1 | 2; rowGap?: number; rule?: string; ruleGap?: number } = {}
): DrawOp[] {
  const { s, m } = ctx;
  const columns = options.columns ?? 1;
  const labelColor = options.labelColor ?? s.muted;
  const valueColor = options.valueColor ?? s.palette.text;
  const rowGap = options.rowGap ?? Math.round(m.valueSize * 2.35);
  const columnWidth = box.w / columns;
  const ops: DrawOp[] = [];

  rows.forEach((row, index) => {
    const column = index % columns;
    const line = Math.floor(index / columns);
    const x = box.x + column * columnWidth;
    const y = box.y + line * rowGap;
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
    ops.push({
      kind: 'text',
      x,
      y: y + Math.round(m.valueSize * 1.05),
      /* Row values are data — an email, a telephone number, an emergency contact, a date. They
         shrink to 45 % before they are shortened, so the back of the card carries complete facts
         rather than a plausible-looking fragment. */
      ...fitOp(row.value, columnWidth - Math.round(m.gap * 0.5), m.valueSize, { minSize: Math.round(m.valueSize * 0.45) }),
      weight: '700',
      color: valueColor,
      maxWidth: columnWidth - Math.round(m.gap * 0.5),
    });
    if (options.rule && column === columns - 1) {
      ops.push({
        kind: 'line',
        x1: box.x,
        y1: y + rowGap - (options.ruleGap ?? Math.round(m.gap * 0.8)),
        x2: box.x + box.w,
        y2: y + rowGap - (options.ruleGap ?? Math.round(m.gap * 0.8)),
        color: options.rule,
        width: 1,
      });
    }
  });
  return ops;
}

/** The employee's signature image (or a ruled line labelled "signature"). */
function signature(ctx: TemplateContext, box: { x: number; y: number; w: number; h?: number }, tone: 'light' | 'dark' = 'light'): DrawOp[] {
  const { s, m, spec } = ctx;
  const color = tone === 'dark' ? mix(s.onPrimary, s.palette.primary, 0.35) : s.muted;
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
      ops.push({
        kind: 'rect',
        x: boxes.qr.x - 4,
        y: boxes.qr.y - 4,
        w: boxes.qr.size + 8,
        h: boxes.qr.size + (style.caption ? Math.round(m.smallSize * 2.2) : 8),
        fill: style.light,
        radius: 4,
      });
      if (style.rule && style.ruleColor) {
        ops.push({ kind: 'rect', x: boxes.qr.x - 4, y: boxes.qr.y - 4, w: boxes.qr.size + 8, h: boxes.qr.size + 8, radius: 4, stroke: style.ruleColor, strokeWidth: 1 });
      }
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
      } else if (Number.isFinite(encoded.moduleCount) && boxes.barcode.w / (encoded.moduleCount + 20) < MIN_CODE128_MODULE_PX) {
        // A Code 128 symbol needs at least a ten-module quiet zone on each side, and a bar narrower
        // than this prints as grey mush or disappears into a neighbouring bar. Refusing to draw it
        // and saying why is the only honest option: a barcode on an ID badge that does not scan is
        // discovered at the turnstile, in front of a queue.
        warnings.push(
          `The barcode value “${value}” needs ${encoded.moduleCount + 20} modules; at ${Math.round(boxes.barcode.w)} px the bars would be ${(boxes.barcode.w / (encoded.moduleCount + 20)).toFixed(1)} px wide, below the ${MIN_CODE128_MODULE_PX} px this tool will print. Use a shorter barcode value, or turn the barcode off.`
        );
      } else if (boxes.barcode.w < 180) {
        warnings.push('The barcode slot on this template is narrower than 180 px at 300 dpi, so no barcode was drawn. Choose a template with a wider barcode slot.');
      } else {
        // A light plate behind the symbol: a template's texture or band crossing the bars would
        // change the run lengths and make a valid symbol unreadable.
        ops.push({
          kind: 'rect',
          x: boxes.barcode.x - 6,
          y: boxes.barcode.y - 6,
          w: boxes.barcode.w + 12,
          h: boxes.barcode.h + (style.caption ? Math.round(boxes.barcode.h * 0.9) : 12),
          fill: style.light,
          radius: 3,
        });
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

  return { ops, warnings };
}

/**
 * Fit `text` and return the draw fields for it: the fitted string *and* the size it was fitted at.
 *
 * The size is the half that matters. A call site that keeps the requested size while drawing the
 * shortened string prints text wider than the box it was measured against — which is how a value on
 * the back of the card ends up running under the neighbouring column.
 */
function fitOp(
  text: string,
  maxWidth: number,
  size: number,
  options?: { minSize?: number; family?: 'sans' | 'mono'; tracking?: number }
): { text: string; size: number; maxWidth: number } {
  const fitted = fitText(text, maxWidth, size, options ?? {});
  return { text: fitted.text, size: fitted.size, maxWidth };
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
      ...fitOp(text, width - m.margin, Math.round(m.smallSize * 0.92), { minSize: Math.round(m.smallSize * 0.7) }),
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
  const bodyText = tone === 'dark' ? s.onPrimary : s.palette.text;
  const muted = tone === 'dark' ? mix(s.onPrimary, s.palette.background, 0.35) : s.muted;
  const background = tone === 'dark' ? s.palette.detail : s.palette.background;
  const ops: DrawOp[] = [{ kind: 'rect', x: 0, y: 0, w: width, h: height, fill: background }];

  if (options.accentBand) {
    ops.push({ kind: 'rect', x: 0, y: 0, w: width, h: Math.round(height * 0.09), fill: tone === 'dark' ? s.palette.primary : shade(s.palette.primary, 0.12) });
    ops.push({
      kind: 'text',
      x: m.margin,
      y: Math.round(height * 0.062),
      text: label('Employee identification — reverse'),
      size: Math.round(m.smallSize * 0.9),
      color: s.onPrimary,
      letterSpacing: 1.3,
      tracking: true,
    });
  }

  const top = options.accentBand ? Math.round(height * 0.17) : Math.round(height * 0.16);
  const qrSize = Math.round(Math.min(width, height) * 0.34);
  // The barcode is given the full card width above the footer: a Code 128 symbol of a normal staff
  // identifier needs roughly 300 modules, and at 36 % of the card width it would print at less than
  // two pixels per module — dense enough that it would not scan.
  const barcodeTop = height - m.footerHeight - Math.round(m.gap * 4.6);
  const codeBoxes: CodeBoxes = {
    qr: { x: width - m.margin - qrSize, y: top, size: qrSize },
    barcode: { x: m.margin, y: barcodeTop, w: width - m.margin * 2, h: Math.round(m.gap * 1.7) },
  };

  // Left column: contact and employment facts.
  /* Order matters as much as content: only six of these rows fit a stacked back face, so the
     security and safety facts come first and the issuer's address comes last. Printing the company
     website while dropping the expiry date was the wrong trade. */
  const rows: FieldRow[] = [];
  if ((spec.employee.validUntil ?? '').trim() !== '') rows.push({ label: 'Valid until', value: formatCardDate(spec.employee.validUntil ?? '') });
  if (spec.employee.bloodGroup.trim() !== '') rows.push({ label: 'Blood group', value: spec.employee.bloodGroup });
  if (spec.employee.emergencyContact.trim() !== '') rows.push({ label: 'Emergency contact', value: spec.employee.emergencyContact });
  if (spec.employee.phone.trim() !== '') rows.push({ label: 'Telephone', value: spec.employee.phone });
  if (spec.employee.email.trim() !== '') rows.push({ label: 'Work email', value: spec.employee.email });
  if ((spec.employee.validFrom ?? '').trim() !== '') rows.push({ label: 'Valid from', value: formatCardDate(spec.employee.validFrom ?? '') });
  if (spec.employee.dateOfJoining.trim() !== '') rows.push({ label: 'Date of joining', value: formatCardDate(spec.employee.dateOfJoining) });
  if (spec.company.address.trim() !== '') rows.push({ label: 'Registered address', value: spec.company.address.replace(/\s*\n\s*/g, ', ') });
  if (spec.company.website.trim() !== '') rows.push({ label: 'Website', value: stripScheme(spec.company.website) });

  const columnWidth = Math.round(width * 0.52);
  const shown = rows.slice(0, options.layout === 'grid' ? 8 : 6);
  const halfWidth = Math.round(columnWidth / 2) - Math.round(m.gap * 0.5);
  const floor = Math.round(m.valueSize * 0.6);
  const columnsWanted =
    options.layout === 'columns' &&
    width > height &&
    shown.every((row) => measureTextWidth(row.value, floor) <= halfWidth);
  const grid = fields(ctx, { x: m.margin, y: top + Math.round(m.valueSize * 1.1), w: columnWidth }, shown, {
    labelColor: muted,
    valueColor: bodyText,
    /* Two columns only when both the card is landscape and every value still fits a half-width
       column at the readable floor. A portrait card split in two leaves roughly 157 px per value,
       and a long address or an emergency-contact line then has to be clipped — at which point the
       second column is decoration that costs real information. */
    columns: columnsWanted ? 2 : 1,
    rowGap: Math.round(m.valueSize * (columnsWanted ? 2.6 : 2.15)),
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

  // The signature sits under the QR rather than beside the barcode, so neither has to be squeezed.
  ops.push(
    ...signature(
      ctx,
      {
        x: Math.round(width * 0.62),
        y: barcodeTop - Math.round(m.gap * 1.1),
        w: Math.round(width * 0.3),
      },
      tone
    )
  );

  if (tone === 'dark') {
    ops.push({ kind: 'rect', x: 0, y: height - m.footerHeight, w: width, h: m.footerHeight, fill: s.palette.primary });
    ops.push({
      kind: 'text',
      x: width / 2,
      y: height - m.footerHeight * 0.38,
      ...fitOp(returnLine(spec), width - m.margin, Math.round(m.smallSize * 0.92)),
      color: s.onPrimary,
      anchor: 'middle',
      maxWidth: width - m.margin,
    });
  } else {
    ops.push({ kind: 'line', x1: 0, y1: height - m.footerHeight, x2: width, y2: height - m.footerHeight, color: s.hairline, width: 1 });
    ops.push({
      kind: 'text',
      x: width / 2,
      y: height - m.footerHeight * 0.42,
      ...fitOp(returnLine(spec), width - m.margin, Math.round(m.smallSize * 0.92)),
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
      ...fitOp(line, box.w, Math.round(m.smallSize * 1.05), { minSize: Math.round(m.smallSize * 0.62) }),
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
  /* The ID block sits above the footer band. At 0.95 of the height the caption was printed inside
     the band and the footer's fill covered the bottom half of the words. */
  front.push({
    kind: 'text',
    x: panelWidth / 2,
    y: Math.round(height * 0.86),
    ...fitOp(spec.employee.employeeId || 'EMPLOYEE ID', panelWidth - m.gap * 2, Math.round(m.valueSize * 1.15)),
    color: s.onPrimary,
    anchor: 'middle',
    weight: '800',
    maxWidth: panelWidth - m.gap * 2,
  });
  front.push({ kind: 'text', x: panelWidth / 2, y: Math.round(height * 0.912), text: 'EMPLOYEE ID', size: Math.round(m.smallSize * 0.85), color: mix(s.onPrimary, s.palette.primary, 0.3), anchor: 'middle', letterSpacing: 1.2, tracking: true });
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
  const front: DrawOp[] = [
    { kind: 'rect', x: 0, y: 0, w: width, h: height, fill: s.dark ? s.palette.background : '#111D19' },
    { kind: 'rect', x: 0, y: 0, w: width, h: Math.round(height * 0.028), fill: s.palette.primary },
    { kind: 'circle', cx: width * 0.9, cy: height * 0.1, r: Math.round(height * 0.3), fill: mix(s.palette.background, '#FFFFFF', 0.12), opacity: 0.55 },
  ];
  const photoW = Math.round(width * 0.26);
  const photoH = Math.round(photoW * 1.22);
  front.push(...photo(ctx, { x: m.margin, y: Math.round(height * 0.24), w: photoW, h: photoH }, { radius: Math.round(photoW * 0.16), ring: s.palette.primary, monogramFill: mix(s.palette.background, '#FFFFFF', 0.14), monogramColor: s.palette.primary }));
  front.push({ kind: 'rect', x: m.margin + Math.round(photoW * 0.06), y: Math.round(height * 0.24) + photoH + Math.round(m.gap * 0.5), w: Math.round(photoW * 0.88), h: Math.round(m.gap * 0.95), radius: Math.round(m.gap * 0.4), fill: s.palette.primary });
  front.push({ kind: 'text', x: m.margin + photoW / 2, y: Math.round(height * 0.24) + photoH + Math.round(m.gap * 1.35), ...fitOp(spec.employee.employeeId || 'NO ID', photoW, Math.round(m.valueSize * 1.1)),color: s.onPrimary, anchor: 'middle', weight: '800', maxWidth: photoW });
  front.push(...header(ctx, { x: m.margin, y: Math.round(height * 0.07), w: width - m.margin * 2 }, 'dark'));
  const textX = m.margin + photoW + Math.round(m.gap * 1.2);
  const textW = width - textX - m.margin;
  front.push({
    kind: 'text', x: textX, y: Math.round(height * 0.34), text: label('Team member'),
    size: Math.round(m.labelSize * 0.95), color: s.palette.primary, letterSpacing: 1.4, tracking: true,
  });
  front.push(...identity(ctx, { x: textX, y: Math.round(height * 0.43), w: textW }, { nameColor: '#FFFFFF', roleColor: s.palette.primary, labelColor: mix('#FFFFFF', s.palette.primary, 0.35) }));
  front.push({ kind: 'line', x1: textX, y1: Math.round(height * 0.62), x2: width - m.margin, y2: Math.round(height * 0.62), color: mix(s.palette.background, '#FFFFFF', 0.18), width: 2 });
  const rows = employeeRows(spec).filter((row) => row.label !== 'Employee ID').slice(0, 3);
  front.push(...fields(ctx, { x: textX, y: Math.round(height * 0.7), w: textW }, rows, { labelColor: mix('#FFFFFF', s.palette.primary, 0.3), valueColor: '#FFFFFF', rowGap: Math.round(m.valueSize * 1.9) }));
  const qrSize = Math.round(Math.min(width * 0.14, height * 0.26));
  const codes = codeOps(ctx, { qr: { x: width - m.margin - qrSize, y: height - Math.round(m.gap * 1.4) - qrSize, size: qrSize } }, { dark: '#101828', light: '#FFFFFF' });
  front.push(...codes.ops);
  const back = backFace(ctx, { tone: 'dark', layout: 'grid', accentBand: true });
  return { front, back: back.ops, warnings: codes.warnings.concat(back.warnings) };
};

const minimalCentre: TemplateFn = (ctx) => {
  const { width, height, m, s, spec } = ctx;
  const front: DrawOp[] = [{ kind: 'rect', x: 0, y: 0, w: width, h: height, fill: s.palette.background }];
  front.push(...header(ctx, { x: width / 2 - Math.round(width * 0.3), y: Math.round(height * 0.09), w: Math.round(width * 0.6) }, 'light'));
  const photoSize = Math.round(Math.min(height * 0.3, width * 0.2));
  front.push(...photo(ctx, { x: width / 2 - photoSize / 2, y: Math.round(height * 0.3), w: photoSize, h: photoSize }, { radius: Math.round(photoSize / 2), ring: s.palette.primary, ringWidth: 2, monogramFill: s.surface }));
  front.push(...identity(ctx, { x: m.margin, y: Math.round(height * 0.68), w: width - m.margin * 2, align: 'middle' }, { nameWeight: '700' }));
  front.push({ kind: 'line', x1: width * 0.35, y1: Math.round(height * 0.855), x2: width * 0.65, y2: Math.round(height * 0.855), color: s.palette.primary, width: 2 });
  front.push({
    kind: 'text', x: width / 2, y: Math.round(height * 0.92),
    ...fitOp([spec.employee.employeeId ? `ID ${spec.employee.employeeId}` : '', spec.employee.bloodGroup ? `BLOOD ${spec.employee.bloodGroup}` : ''].filter(Boolean).join('   ·   ') || 'EMPLOYEE IDENTIFICATION CARD', width - m.margin * 2, Math.round(m.smallSize * 1.05)),
    color: s.muted,
    anchor: 'middle',
    letterSpacing: 1.2,
    tracking: true,
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
  front.push(...photo(ctx, { x: width - m.margin - photoW, y: Math.round(height * 0.1), w: photoW, h: photoH }, { radius: Math.round(photoW * 0.12), ring: s.palette.primary, monogramColor: s.palette.primary }));
  front.push(...identity(ctx, { x: m.margin, y: Math.round(height * 0.42), w: width - photoW - m.margin * 3 }, { roleColor: s.palette.primary }));
  front.push(...fields(ctx, { x: m.margin, y: Math.round(height * 0.6), w: width - photoW - m.margin * 3 }, employeeRows(spec).slice(0, 2), { valueColor: s.palette.text, rowGap: Math.round(m.valueSize * 1.95) }));
  front.push({ kind: 'text', x: m.margin, y: Math.round(height * 0.8), ...fitOp(spec.employee.fullName || 'Employee', width * 0.5, Math.round(m.roleSize * 0.95)),color: s.onPrimary, weight: '700', opacity: 0.9, maxWidth: width * 0.5 });
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
    { kind: 'circle', cx: Math.round(width * 0.14), cy: Math.round(height * 0.14), r: Math.round(height * 0.22), fill: mix(s.palette.background, s.palette.primary, 0.12), opacity: 0.8 },
  ];
  front.push({ kind: 'rect', x: m.margin, y: m.margin, w: Math.round(m.gap * 2.2), h: Math.round(m.gap * 2.2), radius: 6, fill: s.palette.text });
  front.push({ kind: 'text', x: m.margin + Math.round(m.gap * 1.1), y: m.margin + Math.round(m.gap * 1.5), text: initials(spec.employee.fullName || 'ID'), size: Math.round(m.gap * 0.85), color: s.palette.background, anchor: 'middle', weight: '800' });
  front.push(...header(ctx, { x: m.margin + Math.round(m.gap * 2.8), y: m.margin, w: panelRight - m.margin * 2 - Math.round(m.gap * 2.8) }, 'light'));
  front.push(...identity(ctx, { x: m.margin, y: Math.round(height * 0.4), w: panelRight - m.margin * 2 }, { roleColor: s.palette.detail }));
  front.push(...fields(ctx, { x: m.margin, y: Math.round(height * 0.62), w: panelRight - m.margin * 2 }, employeeRows(spec).slice(0, 2), { rowGap: Math.round(m.valueSize * 1.9) }));
  const photoW = Math.round(width * 0.22);
  const photoH = Math.round(photoW * 1.25);
  front.push(...photo(ctx, { x: width - photoW - Math.round(width * 0.06), y: Math.round(height * 0.12), w: photoW, h: photoH }, { radius: Math.round(photoW * 0.14), ring: s.onPrimary, ringWidth: 3, monogramFill: mix(s.palette.primary, '#FFFFFF', 0.25), monogramColor: s.onPrimary, placeholderLabel: 'PHOTO' }));
  front.push({ kind: 'text', x: width - Math.round(width * 0.06) - photoW / 2, y: Math.round(height * 0.12) + photoH + Math.round(m.gap * 1.3), ...fitOp(spec.employee.employeeId || '—', photoW, Math.round(m.valueSize * 1.05)),color: s.onPrimary, anchor: 'middle', weight: '800', maxWidth: photoW });
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
  const photoX = width - inset - m.gap - photoW;
  const photoY = height - inset - m.gap * 0.8 - photoH - m.footerHeight * 0.4;
  front.push(...photo(ctx, { x: photoX, y: photoY, w: photoW, h: photoH }, { radius: 4, ring: s.palette.primary, ringWidth: 2 }));
  front.push(...identity(ctx, { x: inset + m.gap, y: Math.round(height * 0.46), w: width - inset * 2 - photoW - m.gap * 2.4 }, { roleColor: s.palette.primary, uppercaseName: true, nameWeight: '800' }));
  const rows = employeeRows(spec).slice(0, 3);
  front.push(...fields(ctx, { x: inset + m.gap, y: Math.round(height * 0.68), w: Math.round(width * 0.44) }, rows, { columns: 1, rowGap: Math.round(m.valueSize * 1.85) }));
  /* The QR sits immediately to the left of the photograph, level with its lower edge.
     Its first position was pinned to the bottom left — exactly where the three field rows are
     printed, so the plate covered the employee ID, the email address and the telephone number. Its
     second was under the photograph, which put the plate over the monogram inside the frame. */
  const qrSize = Math.round(Math.min(width * 0.13, height * 0.22));
  const codes = codeOps(
    ctx,
    { qr: { x: photoX - m.gap - qrSize, y: height - m.footerHeight - qrSize - Math.round(m.gap * 0.5), size: qrSize } },
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
  bands.push(...identity(ctx, { x: Math.round(width * 0.08) + photoSize + m.gap, y: Math.round(height * 0.34), w: width - photoSize - m.gap * 2.4 }, { roleColor: s.palette.detail }));
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
  /* The photograph is deliberately shorter than it was: at 62 % of the card height it left no room
     for the QR symbol except over the left-hand field rows, which is where the plate used to land.
     The ID line and the code now stack in the right-hand column, under the photograph. */
  front.push(...photo(ctx, { x: width - photoW + Math.round(photoW * 0.1), y: Math.round(height * 0.16), w: Math.round(photoW * 0.8), h: Math.round(height * 0.44) }, { radius: Math.round(photoW * 0.06), ring: s.palette.primary, ringWidth: 2 }));
  front.push({ kind: 'text', x: width - photoW / 2, y: Math.round(height * 0.65), ...fitOp(spec.employee.employeeId || '—', photoW - m.gap, Math.round(m.valueSize * 1.2)),color: s.palette.text, anchor: 'middle', weight: '800', family: 'mono', maxWidth: photoW - m.gap });
  front.push(...header(ctx, { x: m.margin, y: m.margin, w: width - photoW - m.margin * 2 }, 'light'));
  front.push(...identity(ctx, { x: m.margin, y: Math.round(height * 0.36), w: width - photoW - m.margin * 2.4 }, { roleColor: s.palette.primary }));
  front.push(...fields(ctx, { x: m.margin, y: Math.round(height * 0.6), w: width - photoW - m.margin * 2.4 }, employeeRows(spec).slice(1, 5), { columns: 1, rowGap: Math.round(m.valueSize * 1.8), rule: s.hairline, ruleGap: Math.round(m.gap * 0.5) }));
  const qrSize = Math.round(Math.min(width * 0.13, height * 0.2));
  const codes = codeOps(ctx, { qr: { x: width - m.margin - qrSize, y: height - m.footerHeight - qrSize - Math.round(m.gap * 0.5), size: qrSize } }, { dark: '#101828', light: '#FFFFFF' });
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
  front.push({ kind: 'text', x: m.margin, y: Math.round(height * 0.34), text: 'EMPLOYEE', size: Math.round(m.labelSize * 0.95), color: s.palette.primary, letterSpacing: 2, tracking: true });
  front.push(...identity(ctx, { x: m.margin, y: Math.round(height * 0.42), w: Math.round(width * 0.5) }, { roleColor: s.palette.detail, nameWeight: '700' }));
  const photoW = Math.round(width * 0.2);
  const photoH = Math.round(photoW * 1.2);
  front.push(...photo(ctx, { x: width - m.margin - photoW, y: Math.round(height * 0.42), w: photoW, h: photoH }, { radius: 2, ring: s.onPrimary, ringWidth: 2, monogramFill: mix(s.palette.primary, '#FFFFFF', 0.25), monogramColor: s.onPrimary }));
  front.push({ kind: 'text', x: m.margin, y: Math.round(height * 0.72), ...fitOp(spec.employee.employeeId || 'NO ID', Math.round(width * 0.4), Math.round(m.valueSize * 1.25), { family: 'mono' }),color: s.palette.text, weight: '700', family: 'mono', maxWidth: Math.round(width * 0.4) });
  /* The QR sits above the photograph, on the diagonal band. Its former position — bottom right —
     put the white plate across the bottom of the photo frame and over the monogram inside it. */
  const qrSize = Math.round(Math.min(width * 0.13, height * 0.22));
  const codes = codeOps(ctx, { qr: { x: width - m.margin - qrSize, y: m.margin, size: qrSize } }, { dark: '#101828', light: '#FFFFFF' });
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
  front.push({ kind: 'text', x: stripeW + m.margin + Math.round(m.gap * 0.8), y: Math.round(height * 0.62) + Math.round(m.gap * 1.02), ...fitOp(spec.employee.employeeId || 'NO ID', Math.round(width * 0.35), Math.round(m.valueSize * 1.05), { family: 'mono' }),color: s.palette.background, weight: '700', family: 'mono', maxWidth: Math.round(width * 0.35) });
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
  front.push(...identity(ctx, { x: m.margin, y: Math.round(height * 0.4), w: Math.round(width * 0.56) }, { roleColor: s.palette.detail, nameWeight: '600' }));
  front.push({ kind: 'line', x1: m.margin, y1: Math.round(height * 0.585), x2: Math.round(width * 0.56), y2: Math.round(height * 0.585), color: s.hairline, width: 1 });
  const rows = employeeRows(spec).slice(0, 3);
  front.push(...fields(ctx, { x: m.margin, y: Math.round(height * 0.68), w: Math.round(width * 0.52) }, rows, { columns: 1, rowGap: Math.round(m.valueSize * 1.75) }));
  const photoW = Math.round(width * 0.18);
  const photoH = Math.round(photoW * 1.2);
  front.push(...photo(ctx, { x: width - m.margin - photoW, y: Math.round(height * 0.42), w: photoW, h: photoH }, { radius: 3, ring: s.palette.detail, ringWidth: 2 }));
  front.push({ kind: 'text', x: width - m.margin - photoW / 2, y: Math.round(height * 0.42) + photoH + Math.round(m.gap * 1.2), text: label(spec.employee.department || 'Employee'), size: Math.round(m.smallSize * 0.85), color: s.muted, anchor: 'middle', letterSpacing: 1.1, tracking: true });
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
    { kind: 'circle', cx: Math.round(width * 0.9), cy: Math.round(height * 0.12), r: Math.round(height * 0.34), fill: mix(s.palette.background, s.palette.primary, 0.18) },
    { kind: 'circle', cx: Math.round(width * 0.08), cy: Math.round(height * 0.94), r: Math.round(height * 0.3), fill: mix(s.palette.background, s.palette.detail, 0.14) },
    { kind: 'circle', cx: Math.round(width * 0.72), cy: Math.round(height * 1.02), r: Math.round(height * 0.18), fill: s.surface },
  ];
  const panel = { x: m.margin, y: Math.round(height * 0.12), w: Math.round(width * 0.56), h: Math.round(height * 0.72) };
  front.push({ kind: 'rect', x: panel.x, y: panel.y, w: panel.w, h: panel.h, radius: Math.round(m.gap * 1.2), fill: s.surface, opacity: 0.85 });
  front.push(...header(ctx, { x: panel.x + m.gap, y: panel.y + Math.round(m.gap * 0.8), w: panel.w - m.gap * 2 }, 'light'));
  const photoSize = Math.round(Math.min(height * 0.34, width * 0.18));
  front.push(...photo(ctx, { x: width - m.margin - photoSize, y: Math.round(height * 0.2), w: photoSize, h: photoSize }, { radius: Math.round(photoSize / 2), ring: s.palette.primary, ringWidth: 3 }));
  front.push(...identity(ctx, { x: panel.x + m.gap, y: Math.round(height * 0.42), w: panel.w - m.gap * 2 }, { roleColor: s.palette.primary }));
  /* Portrait is tall and narrow: a two-column label/value block puts an email address in a
     ~150 px slot, where it cannot be printed in full. One column in portrait, two in landscape. */
  const sgRows = employeeRows(spec).filter((row) => measureTextWidth(row.value, Math.round(m.valueSize * 0.6)) <= (width > height ? Math.round((panel.w - m.gap * 2) / 2) - Math.round(m.gap * 0.5) : panel.w - m.gap * 2));
  front.push(...fields(ctx, { x: panel.x + m.gap, y: Math.round(height * 0.65), w: panel.w - m.gap * 2 }, sgRows.slice(0, 2), { columns: width > height ? 2 : 1, rowGap: Math.round(m.valueSize * 2.1) }));
  front.push({ kind: 'text', x: width - m.margin - photoSize / 2, y: Math.round(height * 0.2) + photoSize + Math.round(m.gap * 1.6), ...fitOp(spec.employee.employeeId || '—', photoSize + m.gap, Math.round(m.valueSize * 1.1)),color: s.palette.detail, anchor: 'middle', weight: '800', maxWidth: photoSize + m.gap });
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
  const context: TemplateContext = {
    width,
    height,
    m: metricsFor(width, height),
    s: surfacesFor(spec.options.palette),
    spec,
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
  /* Anything the layout had to shorten is reported rather than left for the user to notice on the
     printed card. Identifier fields are never shortened unless they cannot fit even at the smallest
     readable size, so in practice this fires for a very long name, address or job title. */
  const shortened = [...result.front, ...result.back]
    .filter((op): op is Extract<DrawOp, { kind: 'text' }> => op.kind === 'text' && op.text.includes('…'))
    .map((op) => op.text);
  if (shortened.length > 0) {
    const unique = [...new Set(shortened)];
    warnings.push(
      `${unique.length === 1 ? 'One value is' : `${unique.length} values are`} longer than the ${spec.options.orientation} card can print at a readable size, so ${unique.length === 1 ? 'it is' : 'they are'} shortened on the card: ${unique
        .slice(0, 4)
        .map((value) => `“${value}”`)
        .join(', ')}. Shorten the value or switch orientation if the full text matters.`
    );
  }
  return {
    front: { side: 'front', width, height, ops: result.front },
    back: { side: 'back', width, height, ops: result.back },
    warnings,
  };
}
