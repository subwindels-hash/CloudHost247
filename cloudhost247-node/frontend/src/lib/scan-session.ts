/**
 * The list a scanning session builds, kept apart from the page so its rules can be tested.
 *
 * A camera sees the same barcode dozens of times a second while it is held in view. The list holds
 * each barcode once and counts how often it was *presented*: a barcode that stays in view is one
 * scan; taken away and shown again, it is another. That gives a plain list for someone reading a
 * few codes and a tally for someone counting stock, without a setting to choose between them.
 */
import { kindOf, visibleText, type ScanHit } from '../../../src/tools/scanner/formats';

export interface ScanRecord {
  /** Position in the order of first appearance, from 1. */
  id: number;
  format: string;
  formatName: string;
  /** Exactly as decoded. */
  text: string;
  kindLabel: string;
  caution: string | null;
  firstSeen: number;
  lastSeen: number;
  count: number;
}

/** A barcode out of view for this long has been taken away; seeing it again is a new scan. */
export const RESCAN_GAP_MS = 1500;

export type ScanSource = 'camera' | 'image';

export interface ScanOutcome {
  records: ScanRecord[];
  /** `new`: first time in the list. `again`: counted once more. `same`: still in view, nothing changed but the time. */
  change: 'new' | 'again' | 'same';
  record: ScanRecord;
}

export function addScan(records: readonly ScanRecord[], hit: ScanHit, now: number, source: ScanSource): ScanOutcome {
  const index = records.findIndex((record) => record.format === hit.format && record.text === hit.text);
  if (index === -1) {
    const kind = kindOf(hit);
    const record: ScanRecord = { id: records.length + 1, format: hit.format, formatName: hit.formatName, text: hit.text, kindLabel: kind.label, caution: kind.caution ?? null, firstSeen: now, lastSeen: now, count: 1 };
    return { records: [...records, record], change: 'new', record };
  }
  const existing = records[index] as ScanRecord;
  // Choosing an image is a deliberate act each time; a camera frame only counts after a gap.
  const again = source === 'image' || now - existing.lastSeen > RESCAN_GAP_MS;
  const record: ScanRecord = { ...existing, lastSeen: now, count: existing.count + (again ? 1 : 0) };
  return { records: records.map((entry, position) => (position === index ? record : entry)), change: again ? 'again' : 'same', record };
}

/** The total number of scans: every barcode, as many times as it was presented. */
export function scanTotal(records: readonly ScanRecord[]): number {
  return records.reduce((sum, record) => sum + record.count, 0);
}

/**
 * One CSV cell. Quoted always, with quotation marks doubled.
 *
 * A scanned barcode is untrusted text, and a spreadsheet runs a cell that begins with =, +, - or @
 * as a formula (a tab or a carriage return in front does not stop it). Such a value is written with
 * a leading apostrophe, which makes the cell text. A phone number or a HIBC code that begins with +
 * is then kept as scanned instead of being calculated. The price is that the apostrophe can show in
 * the cell; the page says so, and "Copy all" gives every value exactly as it was scanned.
 */
export function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/** The session as a CSV file: a header row, then one row per barcode in the order first scanned. */
export function scansToCsv(records: readonly ScanRecord[]): string {
  const rows = [['Number', 'First scanned (UTC)', 'Type', 'Content', 'Kind', 'Times scanned'].map(csvCell).join(',')];
  for (const record of records) {
    rows.push([String(record.id), new Date(record.firstSeen).toISOString(), record.formatName, visibleText(record.text), record.kindLabel, String(record.count)].map(csvCell).join(','));
  }
  // CRLF line ends and a byte order mark: what spreadsheet programs expect of a UTF-8 CSV file.
  return `\uFEFF${rows.join('\r\n')}\r\n`;
}

/** The contents alone, one barcode per line, for pasting into another program. */
export function scansToText(records: readonly ScanRecord[]): string {
  return records.map((record) => record.text).join('\n');
}
