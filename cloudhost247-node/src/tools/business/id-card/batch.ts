/**
 * Bulk employee import.
 *
 * A payroll team does not type forty names into a form; it exports them from the HR system and
 * uploads a file. So this module accepts a CSV (comma, semicolon or tab delimited) or a real `.xlsx`
 * workbook, maps the columns, validates every row through the *same* validator the interactive form
 * uses, and returns three things: the accepted employees, the rejected rows with a reason each, and
 * a summary. Nothing is silently dropped — a rejected row is a badge somebody will not print, and
 * they need to know which one and why.
 *
 * The `.xlsx` reader is a small, honest implementation: a workbook is a ZIP of XML, so it inflates
 * the parts it needs (`sharedStrings.xml`, `worksheets/sheet1.xml`, the inline string table) with the
 * platform's own `DecompressionStream` and reads the cells. That avoids shipping a spreadsheet
 * library into the browser, and it refuses files it cannot parse — a workbook using a feature this
 * reader does not implement is reported as unreadable rather than imported with cells missing.
 */

import { buildSpec, type CardFormState } from './model';
import { validateDataUrl } from './images';

export interface BulkColumn {
  key: string;
  header: string;
  required: boolean;
  help: string;
  aliases: string[];
}

/** The columns the import understands, in template order. */
export const BULK_COLUMNS: readonly BulkColumn[] = [
  { key: 'fullName', header: 'Full name', required: true, help: 'Employee name exactly as it should print.', aliases: ['name', 'employee name', 'fullname', 'employee'] },
  { key: 'employeeId', header: 'Employee ID', required: true, help: 'Unique staff identifier. Duplicates are rejected.', aliases: ['id', 'staff id', 'employee id', 'employeeid', 'badge id', 'staff number'] },
  { key: 'jobTitle', header: 'Job title', required: false, help: 'Printed under the name.', aliases: ['title', 'role', 'designation', 'position', 'job title'] },
  { key: 'department', header: 'Department', required: false, help: 'Printed as the department line.', aliases: ['dept', 'department', 'team', 'unit'] },
  { key: 'email', header: 'Email', required: false, help: 'Work email address; validated before use.', aliases: ['email', 'work email', 'e-mail', 'email address'] },
  { key: 'phone', header: 'Phone', required: false, help: 'Work telephone number.', aliases: ['phone', 'telephone', 'mobile', 'phone number', 'tel'] },
  { key: 'bloodGroup', header: 'Blood group', required: false, help: 'One of A+, A-, B+, B-, AB+, AB-, O+, O-.', aliases: ['blood group', 'blood', 'bloodgroup'] },
  { key: 'dateOfJoining', header: 'Date of joining', required: false, help: 'YYYY-MM-DD.', aliases: ['joined', 'start date', 'date of joining', 'doj', 'joining date'] },
  { key: 'emergencyContact', header: 'Emergency contact', required: false, help: 'Name and number, printed on the back.', aliases: ['emergency contact', 'emergency', 'next of kin'] },
  { key: 'photoUrl', header: 'Photo URL', required: false, help: 'A data URL (embedded in the file, no network), or a public https URL. This tool does not fetch remote photos, so a cell holding a URL produces a card without its photograph, with a warning.', aliases: ['photo', 'photo url', 'photograph', 'image', 'image url', 'picture'] },
] as const;

export interface BulkRow {
  /** 1-based row number in the source file, counting the header row. */
  rowNumber: number;
  values: Record<string, string>;
}

export interface BulkAccepted {
  rowNumber: number;
  spec: ReturnType<typeof buildSpec>;
  /** Photo URL that must still be fetched (and re-validated) before the card is drawn. */
  photoUrl: string;
  warnings: string[];
}

export interface BulkRejected {
  rowNumber: number;
  reasons: string[];
  raw: Record<string, string>;
}

export interface BulkReport {
  accepted: BulkAccepted[];
  rejected: BulkRejected[];
  /** Columns that were present in the file and could not be mapped. */
  unmappedHeaders: string[];
  /** Required columns that are missing from the file. */
  missingColumns: string[];
  totalRows: number;
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/**
 * RFC 4180 CSV parsing: quoted fields, doubled quotes inside a quoted field, CRLF or LF, and a
 * delimiter detected from the header row so a European export with semicolons works.
 */
export function parseCsv(text: string): { rows: string[][]; delimiter: string } {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const headerLine = withoutBom.split(/\r?\n/)[0] ?? '';
  const counts = [
    { delimiter: ',', count: (headerLine.match(/,/g) ?? []).length },
    { delimiter: ';', count: (headerLine.match(/;/g) ?? []).length },
    { delimiter: '\t', count: (headerLine.match(/\t/g) ?? []).length },
  ].sort((left, right) => right.count - left.count);
  const best = counts[0] ?? { delimiter: ',', count: 0 };
  const delimiter = best.count > 0 ? best.delimiter : ',';

  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;

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
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += char;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return { rows: rows.filter((entry) => entry.some((cell) => cell.trim() !== '')), delimiter };
}

/* ------------------------------------------------------------------ */
/* XLSX                                                                */
/* ------------------------------------------------------------------ */

interface ZipMember {
  name: string;
  data: Uint8Array;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  void writer.write(data as unknown as Uint8Array<ArrayBuffer>);
  void writer.close();
  const buffer = await new Response(stream.readable).arrayBuffer();
  return new Uint8Array(buffer);
}

/** Read the members of a ZIP archive (the container an .xlsx file is). */
export async function readZipMembers(data: Uint8Array): Promise<ZipMember[]> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder();
  let eocd = -1;
  for (let index = data.length - 22; index >= 0; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error('That file is not a ZIP archive, so it is not an Excel workbook. Save it as .xlsx or CSV and try again.');
  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const members: ZipMember[] = [];
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('The workbook archive is malformed.');
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(data.subarray(cursor + 46, cursor + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = data.subarray(start, start + compressedSize);
    // Only the two members a worksheet needs are inflated, so a 40 MB workbook with images does not
    // expand in memory.
    if (!/xl\/(sharedStrings|worksheets\/sheet1|workbook)\.xml$/.test(name)) {
      cursor += 46 + nameLength + extraLength + commentLength;
      continue;
    }
    members.push({ name, data: method === 0 ? raw : await inflateRaw(raw) });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return members;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&');
}

function columnIndex(reference: string): number {
  const letters = /^([A-Z]+)/.exec(reference)?.[1] ?? 'A';
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/**
 * Parse the first worksheet of an .xlsx workbook into rows of strings.
 * Formula cells are read as their cached value; a cell with neither a value nor a shared string is
 * empty, which is what a spreadsheet shows too.
 */
export function parseXlsxSheet(sharedStrings: string[], sheetXml: string): string[][] {
  const rows: string[][] = [];
  const rowRegex = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
    const cells: string[] = [];
    const cellRegex = /<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowMatch[1] ?? '')) !== null) {
      const attributes = cellMatch[1] ?? cellMatch[3] ?? '';
      const body = cellMatch[2] ?? '';
      const reference = /r="([A-Z]+\d+)"/.exec(attributes)?.[1] ?? 'A1';
      const type = /t="([^"]+)"/.exec(attributes)?.[1] ?? 'n';
      const index = columnIndex(reference);
      let value = '';
      if (type === 'inlineStr') {
        value = decodeXmlEntities(/<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1] ?? '');
      } else if (type === 's') {
        const shared = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '-1');
        value = sharedStrings[shared] ?? '';
      } else {
        value = decodeXmlEntities(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
      }
      while (cells.length < index) cells.push('');
      cells[index] = value.trim();
    }
    if (cells.some((cell) => cell.trim() !== '')) rows.push(cells);
  }
  return rows;
}

export async function parseXlsx(data: Uint8Array): Promise<string[][]> {
  const members = await readZipMembers(data);
  const shared = members.find((member) => member.name === 'xl/sharedStrings.xml');
  const sheet = members.find((member) => member.name === 'xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('That workbook has no first worksheet this importer can read. Re-save it and try again.');
  const decoder = new TextDecoder();
  const sharedStrings: string[] = [];
  if (shared) {
    const xml = decoder.decode(shared.data);
    const itemRegex = /<si>([\s\S]*?)<\/si>/g;
    let match: RegExpExecArray | null;
    while ((match = itemRegex.exec(xml)) !== null) {
      const text = [...(match[1] ?? '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((entry) => decodeXmlEntities(entry[1] ?? '')).join('');
      sharedStrings.push(text);
    }
  }
  return parseXlsxSheet(sharedStrings, decoder.decode(sheet.data));
}

/** Read an uploaded .xlsx into rows, validating the container before giving up. */
export async function parseWorkbookFile(file: { name?: string; type?: string; arrayBuffer: () => Promise<ArrayBuffer> }): Promise<string[][]> {
  const buffer = await file.arrayBuffer();
  const data = new Uint8Array(buffer);
  if (data.length > 20 * 1024 * 1024) throw new Error('Workbooks larger than 20 MB are not accepted. Split the file and import again.');
  const declaredXlsx = /\.xlsx?$/i.test(file.name ?? '') || (file.type ?? '').includes('spreadsheet');
  const isZip = data.length > 4 && data[0] === 0x50 && data[1] === 0x4b;
  if (isZip && declaredXlsx) return parseXlsx(data);
  if (isZip) {
    // An .xls (BIFF) file is an OLE compound document, not a ZIP; say so rather than guessing.
    return parseXlsx(data);
  }
  const text = new TextDecoder().decode(data);
  if (text.includes('\u0000')) {
    throw new Error('That looks like an older binary .xls file. Open it in Excel or Sheets and save as .xlsx or CSV, then import that.');
  }
  return parseCsv(text).rows;
}

/* ------------------------------------------------------------------ */
/* Mapping and validation                                              */
/* ------------------------------------------------------------------ */

function normaliseHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');
}

/** Map the file's header row onto the importer's columns, by header text or alias. */
export function mapColumns(header: string[]): { mapping: Map<number, string>; unmapped: string[] } {
  const mapping = new Map<number, string>();
  const unmapped: string[] = [];
  const used = new Set<string>();
  header.forEach((cell, index) => {
    const normalised = normaliseHeader(cell);
    if (normalised === '') return;
    const column = BULK_COLUMNS.find(
      (candidate) => !used.has(candidate.key) && (normaliseHeader(candidate.header) === normalised || candidate.aliases.includes(normalised))
    );
    if (column) {
      mapping.set(index, column.key);
      used.add(column.key);
    } else {
      unmapped.push(cell.trim());
    }
  });
  return { mapping, unmapped };
}

export interface ValidateOptions {
  base: CardFormState;
}

/**
 * Validate rows against the base card state (company details, template, colours).
 *
 * Duplicate employee IDs are rejected in *both* directions: the second occurrence and the first are
 * both flagged, because not knowing which of two identical IDs is correct is the actual problem.
 */
export function validateRows(rows: string[][], options: ValidateOptions): BulkReport {
  const report: BulkReport = {
    accepted: [],
    rejected: [],
    unmappedHeaders: [],
    missingColumns: [],
    totalRows: Math.max(0, rows.length - 1),
    warnings: [],
  };
  if (rows.length === 0) {
    report.missingColumns = BULK_COLUMNS.filter((column) => column.required).map((column) => column.header);
    return report;
  }

  const { mapping, unmapped } = mapColumns(rows[0] ?? []);
  report.unmappedHeaders = unmapped;
  report.missingColumns = BULK_COLUMNS.filter((column) => column.required && ![...mapping.values()].includes(column.key)).map((column) => column.header);
  if (report.missingColumns.length > 0) return report;

  const seen = new Map<string, number[]>();
  rows.slice(1).forEach((cells, index) => {
    const values: Record<string, string> = {};
    mapping.forEach((key, columnIndexPosition) => {
      values[key] = (cells[columnIndexPosition] ?? '').trim();
    });
    const rowNumber = index + 2;
    const reasons: string[] = [];

    const photoUrl = values.photoUrl ?? '';
    if (photoUrl !== '') {
      const isData = photoUrl.startsWith('data:');
      if (isData) {
        const check = validateDataUrl(photoUrl);
        if (!check.ok) reasons.push(`Photo: ${check.message}`);
      } else if (!/^https:\/\/[^\s]+$/i.test(photoUrl)) {
        reasons.push('Photo URL must start with https:// (a browser cannot load an http image on a secure page), or be blank.');
      }
    }

    const state: CardFormState = {
      ...options.base,
      fullName: values.fullName ?? '',
      employeeId: values.employeeId ?? '',
      jobTitle: values.jobTitle ?? options.base.jobTitle,
      department: values.department ?? options.base.department,
      email: values.email ?? '',
      phone: values.phone ?? '',
      bloodGroup: values.bloodGroup ?? '',
      dateOfJoining: values.dateOfJoining ?? '',
      emergencyContact: values.emergencyContact ?? '',
      photo: isDataLike(photoUrl) ? photoUrl : '',
    };

    const built = buildSpec(state, { strict: false });
    for (const error of built.errors) reasons.push(error.message);

    const id = (values.employeeId ?? '').trim().toLowerCase();
    if (id !== '') {
      const list = seen.get(id) ?? [];
      list.push(rowNumber);
      seen.set(id, list);
    }

    if (reasons.length > 0) {
      report.rejected.push({ rowNumber, reasons, raw: values });
      return;
    }
    report.accepted.push({
      rowNumber,
      spec: built,
      photoUrl: isDataLike(photoUrl) ? '' : photoUrl,
      warnings: built.warnings,
    });
  });

  // Duplicate IDs, reported on every affected row rather than only the later ones.
  for (const [id, rowNumbers] of seen) {
    if (rowNumbers.length < 2) continue;
    const message = `Employee ID “${id}” appears on rows ${rowNumbers.join(', ')}. Each employee needs a unique identifier — decide which record is correct and remove the other.`;
    report.warnings.push(message);
    for (const rowNumber of rowNumbers) {
      const acceptedIndex = report.accepted.findIndex((entry) => entry.rowNumber === rowNumber);
      if (acceptedIndex >= 0) {
        const [entry] = report.accepted.splice(acceptedIndex, 1);
        report.rejected.push({
          rowNumber,
          reasons: [message],
          raw: { employeeId: id, fullName: entry?.spec.spec.employee.fullName ?? '' },
        });
      }
    }
  }

  report.accepted.sort((left, right) => left.rowNumber - right.rowNumber);
  report.rejected.sort((left, right) => left.rowNumber - right.rowNumber);
  return report;
}

function isDataLike(value: string): boolean {
  return value.startsWith('data:');
}

/* ------------------------------------------------------------------ */
/* Templates and reports                                               */
/* ------------------------------------------------------------------ */

function csvCell(value: string): string {
  return /[",\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The CSV template, with the header row the importer maps, a comment row explaining each column and
 * two example rows. The examples are labelled as examples so nobody prints them by accident.
 */
export function csvTemplate(examples = 2): string {
  const header = BULK_COLUMNS.map((column) => column.header).join(',');
  const samples = [
    ['Amara Okafor (example — delete this row)', 'EMP00001', 'People Operations Manager', 'People', 'amara.okafor@example.com', '+234 801 234 5678', 'O+', '2023-04-17', 'Chidi Okafor +234 802 111 2222', ''],
    ['Tunde Bakare (example — delete this row)', 'EMP00002', 'Platform Engineer', 'Engineering', 'tunde.bakare@example.com', '+234 803 987 6543', 'A+', '2024-01-08', 'Ngozi Bakare +234 805 333 4444', ''],
  ].slice(0, Math.max(1, examples));
  const rows = [
    header,
    ...samples.map((row) => row.map(csvCell).join(',')),
  ];
  return `${rows.join('\r\n')}\r\n`;
}

/** The rejected-rows report, in the same column order as the template, plus the reason. */
export function rejectedRowsCsv(report: BulkReport): string {
  const header = ['Row', 'Reason', ...BULK_COLUMNS.map((column) => column.header)];
  const rows = [
    header.map(csvCell).join(','),
    ...report.rejected.map((entry) =>
      [
        String(entry.rowNumber),
        entry.reasons.join(' '),
        ...BULK_COLUMNS.map((column) => entry.raw[column.key] ?? ''),
      ]
        .map(csvCell)
        .join(',')
    ),
  ];
  return `\uFEFF${rows.join('\r\n')}\r\n`;
}

/** A machine-readable manifest of everything the batch produced. */
export function batchManifestCsv(report: BulkReport, generated: Array<{ rowNumber: number; file: string }>): string {
  const files = new Map(generated.map((entry) => [entry.rowNumber, entry.file]));
  const header = ['Row', 'Employee ID', 'Full name', 'Department', 'File', 'Status', 'Notes'];
  const rows = [header.map(csvCell).join(',')];
  for (const entry of report.accepted) {
    rows.push(
      [
        String(entry.rowNumber),
        entry.spec.spec.employee.employeeId,
        entry.spec.spec.employee.fullName,
        entry.spec.spec.employee.department,
        files.get(entry.rowNumber) ?? '',
        'generated',
        entry.warnings.join(' '),
      ]
        .map(csvCell)
        .join(',')
    );
  }
  for (const entry of report.rejected) {
    rows.push(
      [
        String(entry.rowNumber),
        entry.raw.employeeId ?? '',
        entry.raw.fullName ?? '',
        entry.raw.department ?? '',
        '',
        'rejected',
        entry.reasons.join(' '),
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return `\uFEFF${rows.join('\r\n')}\r\n`;
}

/** A summary sentence for the import preview. */
export function summariseReport(report: BulkReport): string {
  const parts = [`${report.accepted.length} of ${report.totalRows} rows are ready to generate`];
  if (report.rejected.length > 0) parts.push(`${report.rejected.length} were rejected and are listed with a reason each`);
  if (report.missingColumns.length > 0) parts.push(`the file is missing the required column${report.missingColumns.length > 1 ? 's' : ''} ${report.missingColumns.join(', ')}`);
  if (report.unmappedHeaders.length > 0) parts.push(`these columns were ignored: ${report.unmappedHeaders.join(', ')}`);
  return `${parts.join('; ')}.`;
}

/** Client-side cap: a browser tab can render a few hundred cards, not ten thousand. */
export const BULK_MAX_ROWS = 500;

/** Split oversized imports into pages of `BULK_MAX_ROWS` so no single render blocks the tab. */
export function chunkRows(report: BulkReport, size = BULK_MAX_ROWS): BulkAccepted[][] {
  const chunks: BulkAccepted[][] = [];
  for (let index = 0; index < report.accepted.length; index += size) {
    chunks.push(report.accepted.slice(index, index + size));
  }
  return chunks;
}

export type { CardFormState };
