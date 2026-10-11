/**
 * Deterministic number, money and date formatting for the Business Tools engines.
 *
 * Everything here is deliberately hand-rolled rather than delegated to `Intl.NumberFormat`:
 * `Intl` output depends on the ICU data compiled into the runtime, so a figure formatted in a
 * browser, in Node 20 on cPanel and in a CI container can differ in spacing and grouping. Payroll
 * figures that are asserted in tests and shown to a customer must be byte-identical everywhere.
 *
 * All rounding is half-away-from-zero on a small epsilon guard, which is what a payroll clerk
 * expects from "round to 2 decimal places" and what keeps `round(2.675, 2) === 2.68` true despite
 * 2.675 being stored as 2.67499999… in IEEE-754.
 */

/** Half-away-from-zero rounding to `places` decimals, tolerant of binary representation error. */
export function round(value: number, places = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, places);
  // The epsilon nudge absorbs representation error (2.675 * 100 === 267.49999999999997).
  const scaled = value * factor * (1 + Number.EPSILON);
  const rounded = scaled >= 0 ? Math.floor(scaled + 0.5) : Math.ceil(scaled - 0.5);
  return rounded / factor;
}

/** Insert thin, non-breaking-free digit grouping: 1234567.5 -> "1,234,567.50". */
export function groupDigits(value: number, places = 2): string {
  const fixed = round(value, places).toFixed(places);
  const negative = fixed.startsWith('-');
  const unsigned = negative ? fixed.slice(1) : fixed;
  const dot = unsigned.indexOf('.');
  const intPart = dot === -1 ? unsigned : unsigned.slice(0, dot);
  const decPart = dot === -1 ? '' : unsigned.slice(dot);
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (negative ? '-' : '') + grouped + decPart;
}

/** Money with an explicit currency symbol. Units are never implied on these tools. */
export function formatMoney(value: number, currency = 'NGN', places = 2): string {
  const symbols: Record<string, string> = { NGN: '₦', USD: '$', EUR: '€', GBP: '£' };
  const symbol = symbols[currency] ?? currency + ' ';
  return symbol + groupDigits(value, places);
}

/** A plain money figure with the unit spelled out, for tables that already have a currency column. */
export function formatAmount(value: number, places = 2): string {
  return groupDigits(value, places);
}

export function formatPercent(value: number, places = 2): string {
  return round(value, places).toFixed(places) + '%';
}

/** Multipliers read better than percentages for cost overhead: 1.92 rather than 191.5%. */
export function formatMultiplier(value: number, places = 2): string {
  return round(value, places).toFixed(places) + 'x';
}

export function formatInteger(value: number): string {
  return groupDigits(value, 0);
}

/** Whole-employee counts: a fraction of a person is a modelling artefact, not a headcount. */
export function formatHeadcount(value: number): string {
  return groupDigits(Math.round(value), 0);
}

/* ------------------------------------------------------------------ */
/* Input coercion                                                       */
/* ------------------------------------------------------------------ */

/**
 * Coerce a form value to a finite number.
 *
 * Returns `null` — not `0` — for anything unusable, because a blank payroll field silently read as
 * zero produces a confident, wrong answer. Callers turn `null` into a field error.
 */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value !== 'string') return null;
  // Accept the grouping and currency symbols a clerk pastes from a spreadsheet.
  const cleaned = value.replace(/[,\s₦$€£]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  if (!/^-?\d*\.?\d+(e[-+]?\d+)?$/i.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

export function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'on' || normalized === 'yes';
  }
  return false;
}

/** Split a "one per line" textarea into trimmed, non-empty entries. */
export function toLines(value: unknown): string[] {
  return toText(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Split a comma/semicolon separated list into trimmed, non-empty, de-duplicated entries. */
export function toList(value: unknown): string[] {
  const items = toText(value)
    .split(/[,;]|\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const seen: Record<string, true> = {};
  const unique: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    unique.push(item);
  }
  return unique;
}

/* ------------------------------------------------------------------ */
/* Dates                                                                */
/* ------------------------------------------------------------------ */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse `YYYY-MM-DD` into UTC parts, rejecting impossible calendar dates. */
export function parseIsoDate(value: unknown): { year: number; month: number; day: number } | null {
  const text = toText(value).trim();
  const match = ISO_DATE.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Round-trip through Date so 2026-02-30 is rejected rather than silently rolled into March.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function isoDateToTimestamp(value: unknown): number | null {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  return Date.UTC(parsed.year, parsed.month - 1, parsed.day);
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** `2026-03-05` -> `5 March 2026`. Contract dates read better long-form than ISO. */
export function formatLongDate(value: unknown): string {
  const parsed = parseIsoDate(value);
  if (!parsed) return toText(value).trim() || '—';
  const month = MONTH_NAMES[parsed.month - 1];
  if (!month) return toText(value).trim();
  return `${parsed.day} ${month} ${parsed.year}`;
}

/** `2026-03` -> `March 2026`, for pay periods. */
export function formatMonth(value: unknown): string {
  const text = toText(value).trim();
  const match = /^(\d{4})-(\d{2})$/.exec(text);
  if (!match) return text || '—';
  const month = MONTH_NAMES[Number(match[2]) - 1];
  if (!month) return text;
  return `${month} ${match[1]}`;
}

/** Whole months between two ISO dates, clamped at zero. Used for probation/notice sanity checks. */
export function monthsBetween(from: unknown, to: unknown): number | null {
  const start = isoDateToTimestamp(from);
  const end = isoDateToTimestamp(to);
  if (start === null || end === null) return null;
  const days = (end - start) / 86_400_000;
  return days < 0 ? null : Math.floor(days / 30.4375);
}

/* ------------------------------------------------------------------ */
/* Text                                                                 */
/* ------------------------------------------------------------------ */

export function titleCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/(^|[\s\-/().])([a-z])/g, (_all, boundary: string, letter: string) => boundary + letter.toUpperCase());
}

export function upperCase(value: string): string {
  return toText(value).trim().toUpperCase();
}

/** Collapse runs of blank lines so generated documents do not drift apart as fields are left empty. */
export function tidyDocument(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';
}

/** A Markdown-style bulleted list; returns an empty string for no items so sections disappear cleanly. */
export function bulletList(items: readonly string[], indent = ''): string {
  return items.map((item) => `${indent}- ${item}`).join('\n');
}

export function numberedList(items: readonly string[], indent = ''): string {
  return items.map((item, index) => `${indent}${index + 1}. ${item}`).join('\n');
}

/** CSV escaping: quote when the value contains a comma, quote or newline; double inner quotes. */
export function csvCell(value: unknown): string {
  const text = toText(value);
  if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

export function toCsv(columns: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  return lines.join('\r\n') + '\r\n';
}

/** Escape text for inclusion in generated SVG (ID cards, business cards). */
export function escapeXml(value: unknown): string {
  return toText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Truncate to a maximum width, adding an ellipsis only when something was removed.
 * Keeps generated card layouts from overflowing their container.
 */
export function clampText(value: string, max: number): string {
  const text = toText(value);
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(0, max);
  return text.slice(0, max - 1).trimEnd() + '…';
}
