/**
 * Design Studio — CSV parsing, mapping and batch validation.
 *
 * Every bulk feature in this module (label batches, VDA batches, shipping batches) goes through this
 * file, so delimiter handling, quoting, row numbering and error reporting behave identically no
 * matter which tool started the import.
 *
 * ## The three rules that matter
 *
 * 1. **Never silently drop a row.** Every parsed row is either accepted or rejected with a reason,
 *    and the rejected rows can be downloaded as a CSV that opens in the same spreadsheet the user
 *    started from — with their original values plus an error column.
 * 2. **A spreadsheet cell is data, not a formula.** Values beginning with `=`, `+`, `-`, `@`, tab or
 *    CR are escaped on *export* (see `csvCell`) because Excel, LibreOffice and Google Sheets execute
 *    them on open. The importer keeps the value as text and never evaluates it.
 * 3. **Report a row number the user can find.** CSV line numbers are 1-based and include the header,
 *    so a rejected row says "line 14" and the user can go straight to it.
 */

import type { Issue } from './validate';

export interface ParsedCsv {
  /** Header cells, trimmed. Duplicates get a numeric suffix so mapping stays unambiguous. */
  headers: string[];
  /** Data rows, keyed by header. */
  rows: Record<string, string>[];
  /** Raw data rows, for the preview table. */
  raw: string[][];
  delimiter: string;
  warnings: string[];
  /** 1-based line number of each data row in the original file. */
  lineNumbers: number[];
}

export const MAX_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_CSV_ROWS = 2000;
export const MAX_CSV_COLUMNS = 64;

/** Detect the delimiter from the header line, preferring the one that appears most often. */
export function detectDelimiter(text: string): string {
  const headerLine = text.split(/\r?\n/)[0] ?? '';
  const candidates = [
    { delimiter: ',', count: (headerLine.match(/,/g) ?? []).length },
    { delimiter: ';', count: (headerLine.match(/;/g) ?? []).length },
    { delimiter: '\t', count: (headerLine.match(/\t/g) ?? []).length },
    { delimiter: '|', count: (headerLine.match(/\|/g) ?? []).length },
  ].sort((left, right) => right.count - left.count);
  const best = candidates[0];
  return best && best.count > 0 ? best.delimiter : ',';
}

/**
 * Parse CSV text (RFC 4180 with the usual real-world tolerance).
 *
 * Handles quoted fields, escaped quotes, embedded newlines, CRLF, and a UTF-8 BOM — the four things
 * that make a "valid" spreadsheet export fail in a naive splitter. Unbalanced quotes are reported
 * rather than guessed at, because a mis-parsed address is worse than a refusal.
 */
export function parseCsv(text: string, options: { delimiter?: string } = {}): ParsedCsv {
  const warnings: string[] = [];
  if (text.length > MAX_CSV_BYTES) {
    throw new Error(`The CSV is ${(text.length / 1024).toFixed(0)} kB; the limit is ${(MAX_CSV_BYTES / 1024).toFixed(0)} kB. Split it into smaller batches.`);
  }
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = options.delimiter ?? detectDelimiter(withoutBom);

  const rows: string[][] = [];
  const lineNumbers: number[] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  let line = 1;
  let rowStartLine = 1;

  const pushRow = (): void => {
    // A trailing newline produces one empty field; ignore blank lines entirely.
    if (row.length === 1 && row[0] === '' && field === '') {
      row = [];
      return;
    }
    row.push(field);
    rows.push(row);
    lineNumbers.push(rowStartLine);
    row = [];
    field = '';
    rowStartLine = line;
  };

  for (let index = 0; index < withoutBom.length; index += 1) {
    const char = withoutBom[index];
    if (quoted) {
      if (char === '"') {
        if (withoutBom[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === '\n') line += 1;
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && withoutBom[index + 1] === '\n') index += 1;
      line += 1;
      pushRow();
      rowStartLine = line;
      continue;
    }
    field += char;
  }
  if (quoted) warnings.push('The file ends inside a quoted field, which usually means a missing closing quote. The last row may be incomplete.');
  if (field !== '' || row.length > 0) pushRow();

  if (rows.length === 0) throw new Error('The CSV is empty — it needs a header row and at least one data row.');

  const headerRow = rows[0] ?? [];
  if (headerRow.length > MAX_CSV_COLUMNS) {
    throw new Error(`The CSV has ${headerRow.length} columns; the limit is ${MAX_CSV_COLUMNS}.`);
  }
  const seen = new Map<string, number>();
  const headers = headerRow.map((raw, index) => {
    const base = raw.trim() === '' ? `column${index + 1}` : raw.trim();
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    if (count > 1) {
      warnings.push(`The header “${base}” appears more than once; the second is treated as “${base}_${count}”.`);
      return `${base}_${count}`;
    }
    return base;
  });

  const dataRows = rows.slice(1);
  if (dataRows.length === 0) throw new Error('The CSV has a header but no data rows.');
  if (dataRows.length > MAX_CSV_ROWS) {
    throw new Error(`The CSV has ${dataRows.length} rows; a batch is limited to ${MAX_CSV_ROWS}. Split it into smaller files.`);
  }

  const records: Record<string, string>[] = [];
  dataRows.forEach((cells, index) => {
    const record: Record<string, string> = {};
    headers.forEach((header, column) => {
      record[header] = (cells[column] ?? '').trim();
    });
    if (cells.length > headers.length) {
      warnings.push(`Line ${lineNumbers[index + 1]} has ${cells.length} values but the header has ${headers.length} columns; the extra values were ignored.`);
    }
    records.push(record);
  });
  if (warnings.length > 6) {
    const extra = warnings.length - 6;
    warnings.length = 6;
    warnings.push(`…and ${extra} more row-level warnings.`);
  }

  return { headers, rows: records, raw: dataRows, delimiter, warnings, lineNumbers: lineNumbers.slice(1) };
}

/**
 * Serialise one CSV cell.
 *
 * Formula injection: a cell that starts with `=`, `+`, `-`, `@`, tab or CR is prefixed with a single
 * quote. That is the OWASP recommendation and it is what stops a malicious CSV from running
 * `=HYPERLINK(...)` or a DDE payload when an operator opens the rejected-rows report. Quoting and
 * embedded quotes are handled the RFC 4180 way.
 */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers: string[], rows: Array<Record<string, unknown> | unknown[]>): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) {
    const cells = Array.isArray(row) ? row : headers.map((header) => row[header]);
    lines.push(cells.map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** A blank CSV with the given headers and one example row, offered as a download. */
export function csvTemplate(headers: string[], example?: Record<string, string>): string {
  const lines = [headers.map(csvCell).join(',')];
  if (example) lines.push(headers.map((header) => csvCell(example[header] ?? '')).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/* ------------------------------------------------------------------ */
/* Column mapping                                                      */
/* ------------------------------------------------------------------ */

export interface ColumnMapping {
  /** Binding key (a template field) → CSV header. Empty/unmapped keys fall back to the template. */
  [key: string]: string;
}

export interface MappingSuggestion {
  mapping: ColumnMapping;
  /** Keys that found no matching column. */
  unmatched: string[];
  /** Columns that are not used by any key. */
  unused: string[];
}

/**
 * Suggest a mapping between template keys and CSV headers.
 *
 * Matching is by normalised name (case, spaces, underscores, punctuation removed), then by a small
 * synonym table for the fields that spreadsheets name differently across organisations. A suggestion
 * is always shown to the user for confirmation — auto-mapping silently is how a batch ends up with
 * the postcode printed in the city field.
 */
export function suggestMapping(keys: string[], headers: string[]): MappingSuggestion {
  const normalise = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const byNormalised = new Map<string, string>();
  for (const header of headers) byNormalised.set(normalise(header), header);

  const synonyms: Record<string, string[]> = {
    recipient: ['recipientname', 'name', 'contact', 'addressee', 'deliverto'],
    recipientname: ['recipient', 'name', 'contact', 'addressee'],
    address: ['street', 'addressline1', 'line1', 'deliveryaddress'],
    city: ['town', 'locality', 'municipality'],
    postalcode: ['zip', 'zipcode', 'postcode', 'postal'],
    state: ['province', 'region', 'county'],
    telephone: ['phone', 'tel', 'phonenumber', 'mobile'],
    email: ['mail', 'emailaddress'],
    tracking: ['trackingnumber', 'reference', 'ref', 'consignment'],
    gtin: ['ean', 'barcode', 'upc', 'gtin13', 'ean13'],
    sku: ['itemcode', 'productcode', 'partnumber', 'code'],
    quantity: ['qty', 'amount', 'count'],
    weight: ['mass', 'grossweight'],
  };

  const mapping: ColumnMapping = {};
  const used = new Set<string>();
  const unmatched: string[] = [];
  for (const key of keys) {
    const candidates = [key, ...(synonyms[normalise(key)] ?? [])].map(normalise);
    let match: string | undefined;
    for (const candidate of candidates) {
      const header = byNormalised.get(candidate);
      if (header && !used.has(header)) {
        match = header;
        break;
      }
    }
    if (match) {
      mapping[key] = match;
      used.add(match);
    } else {
      unmatched.push(key);
    }
  }
  return { mapping, unmatched, unused: headers.filter((header) => !used.has(header)) };
}

/* ------------------------------------------------------------------ */
/* Batch validation                                                    */
/* ------------------------------------------------------------------ */

export interface BatchRowResult<TOutput> {
  /** 1-based line number in the source file. */
  line: number;
  row: Record<string, string>;
  /** Values rebound to the template's keys. */
  values: Record<string, string>;
  accepted: boolean;
  issues: Issue[];
  output?: TOutput;
}

export interface BatchResult<TOutput> {
  results: BatchRowResult<TOutput>[];
  accepted: number;
  rejected: number;
  warnings: number;
}

/**
 * Apply a mapping to each row and validate it.
 *
 * Duplicate detection is on the *mapped* values, not the raw line: two rows that differ only in a
 * column the template does not print are the same label, and printing it twice is the mistake the
 * operator wants warned about. Duplicates are flagged as warnings, not rejections — a warehouse that
 * genuinely needs two identical labels must be able to print them.
 */
export function processBatch<TOutput>(
  parsed: ParsedCsv,
  mapping: ColumnMapping,
  validate: (values: Record<string, string>, line: number) => { issues: Issue[]; output?: TOutput },
  options: { detectDuplicates?: boolean } = {}
): BatchResult<TOutput> {
  const results: BatchRowResult<TOutput>[] = [];
  const seen = new Map<string, number>();

  parsed.rows.forEach((row, index) => {
    const line = parsed.lineNumbers[index] ?? index + 2;
    const values: Record<string, string> = {};
    for (const [key, header] of Object.entries(mapping)) {
      if (!header) continue;
      values[key] = row[header] ?? '';
    }
    const { issues, output } = validate(values, line);
    const fingerprint = JSON.stringify(Object.keys(values).sort().map((key) => [key, values[key]]));
    if (options.detectDuplicates !== false && fingerprint !== '[]') {
      const first = seen.get(fingerprint);
      if (first !== undefined) {
        issues.push({
          level: 'warn',
          field: 'row',
          message: `This row is identical to line ${first}. Two labels will be identical — that is correct for a quantity of two, and a copy-paste error otherwise.`,
        });
      } else {
        seen.set(fingerprint, line);
      }
    }
    results.push({
      line,
      row,
      values,
      accepted: !issues.some((issue) => issue.level === 'error'),
      issues,
      output,
    });
  });

  return {
    results,
    accepted: results.filter((result) => result.accepted).length,
    rejected: results.filter((result) => !result.accepted).length,
    warnings: results.reduce((total, result) => total + result.issues.filter((issue) => issue.level === 'warn').length, 0),
  };
}

/** A CSV of rejected rows: the original values plus the reason, ready to fix and re-import. */
export function rejectedRowsCsv(result: BatchResult<unknown>, headers: string[]): string {
  const rejected = result.results.filter((row) => !row.accepted);
  const rows = rejected.map((row) => {
    const cells: Record<string, unknown> = {};
    for (const header of headers) cells[header] = row.row[header] ?? '';
    cells.Line = String(row.line);
    cells.Error = row.issues.filter((issue) => issue.level === 'error').map((issue) => issue.message).join(' | ');
    return cells;
  });
  return toCsv([...headers, 'Line', 'Error'], rows);
}
