/**
 * Tools Center — JSON tools (spec §34 "JSON tools").
 *
 * Format, validate with a real error position, minify, sort keys, query by path, convert to/from
 * CSV, and compare two documents. Everything is parsed with `JSON.parse` — this platform does not
 * hand-roll a JSON parser and does not "fix" invalid JSON silently.
 */
import { invalidInput } from '../core/errors';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface JsonValidation {
  valid: boolean;
  error: { message: string; line: number | null; column: number | null; position: number | null } | null;
  stats: {
    sizeBytes: number;
    sizeBytesMinified: number | null;
    depth: number;
    objects: number;
    arrays: number;
    keys: number;
    strings: number;
    numbers: number;
    booleans: number;
    nulls: number;
  };
  preview: string | null;
}

const MAX_JSON_BYTES = 2 * 1024 * 1024;

function assertSize(text: string, label: string): void {
  if (Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) {
    throw invalidInput(`${label} is larger than the ${Math.round(MAX_JSON_BYTES / 1024 / 1024)} MB limit for this tool.`);
  }
}

/** Converts a JSON.parse error into a line/column position. */
export function locateJsonError(text: string, error: Error): { message: string; line: number | null; column: number | null; position: number | null } {
  const message = error instanceof Error ? error.message : 'Invalid JSON.';
  const positionMatch = /position\s+(\d+)/i.exec(message);
  const lineMatch = /line\s+(\d+)\s+column\s+(\d+)/i.exec(message);
  if (lineMatch) {
    return { message, line: Number(lineMatch[1]), column: Number(lineMatch[2]), position: positionMatch ? Number(positionMatch[1]) : null };
  }
  if (positionMatch) {
    const position = Number(positionMatch[1]);
    const before = text.slice(0, position);
    const line = before.split('\n').length;
    const column = position - before.lastIndexOf('\n');
    return { message, line, column, position };
  }
  return { message, line: null, column: null, position: null };
}

function walk(value: unknown, stats: JsonValidation['stats'], depth: number): number {
  stats.depth = Math.max(stats.depth, depth);
  if (value === null) {
    stats.nulls += 1;
    return depth;
  }
  if (Array.isArray(value)) {
    stats.arrays += 1;
    for (const entry of value) walk(entry, stats, depth + 1);
    return depth;
  }
  switch (typeof value) {
    case 'object': {
      stats.objects += 1;
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        stats.keys += 1;
        void key;
        walk(entry, stats, depth + 1);
      }
      return depth;
    }
    case 'string':
      stats.strings += 1;
      return depth;
    case 'number':
      stats.numbers += 1;
      return depth;
    case 'boolean':
      stats.booleans += 1;
      return depth;
    default:
      return depth;
  }
}

export function validateJson(text: string): JsonValidation {
  if (typeof text !== 'string') throw invalidInput('Paste JSON to validate.');
  assertSize(text, 'The document');
  const stats: JsonValidation['stats'] = {
    sizeBytes: Buffer.byteLength(text, 'utf8'),
    sizeBytesMinified: null,
    depth: 0,
    objects: 0,
    arrays: 0,
    keys: 0,
    strings: 0,
    numbers: 0,
    booleans: 0,
    nulls: 0,
  };

  try {
    const parsed = JSON.parse(text) as unknown;
    walk(parsed, stats, 1);
    const minified = JSON.stringify(parsed);
    stats.sizeBytesMinified = Buffer.byteLength(minified, 'utf8');
    return {
      valid: true,
      error: null,
      stats,
      preview: minified.length > 2000 ? `${minified.slice(0, 2000)}…` : minified,
    };
  } catch (error) {
    return { valid: false, error: locateJsonError(text, error as Error), stats, preview: null };
  }
}

export interface JsonTransformResult {
  text: string;
  stats: { bytesBefore: number; bytesAfter: number; changed: boolean };
  notes: string[];
}

export function formatJson(input: { text: string; indent?: number | 'tab'; sortKeys?: boolean; minify?: boolean; trailingNewline?: boolean }): JsonTransformResult {
  const parsed = (() => {
    try {
      return JSON.parse(input.text) as unknown;
    } catch (error) {
      const located = locateJsonError(input.text, error as Error);
      throw invalidInput(`Invalid JSON${located.line !== null ? ` at line ${located.line}, column ${located.column}` : ''}: ${located.message}`);
    }
  })();

  const sort = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sort);
    if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
      return Object.fromEntries(entries.map(([key, entry]) => [key, sort(entry)]));
    }
    return value;
  };

  const target = input.sortKeys ? sort(parsed) : parsed;
  const indent = input.minify ? undefined : input.indent === 'tab' ? '\t' : (input.indent ?? 2);
  const text = `${JSON.stringify(target, null, indent) ?? 'null'}${input.trailingNewline === false ? '' : '\n'}`;

  return {
    text,
    stats: {
      bytesBefore: Buffer.byteLength(input.text, 'utf8'),
      bytesAfter: Buffer.byteLength(text, 'utf8'),
      changed: text !== input.text,
    },
    notes: [
      input.minify ? 'Minified: whitespace outside strings was removed.' : `Indented with ${typeof indent === 'string' ? 'a tab' : `${indent ?? 2} spaces`}.`,
      input.sortKeys ? 'Object keys are sorted with localeCompare at every level. Arrays keep their order.' : 'Key order is preserved as parsed. Object key order is not semantically significant in JSON, but it is preserved here so diffs stay readable.',
      'Duplicate keys are collapsed by JSON.parse: the last occurrence wins. Use the validator if you need to know whether duplicates existed.',
    ],
  };
}

/** A minimal, documented JSON path: `a.b[0].c` and `$..key` are the supported forms. */
export function queryJson(input: { text: string; path: string }): { path: string; matches: Array<{ path: string; value: unknown; type: string }>; notes: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.text) as unknown;
  } catch (error) {
    const located = locateJsonError(input.text, error as Error);
    throw invalidInput(`Invalid JSON${located.line !== null ? ` at line ${located.line}, column ${located.column}` : ''}: ${located.message}`);
  }
  const path = (input.path ?? '').trim();
  if (path.length === 0) throw invalidInput('Enter a path such as data.items[0].name, or $..name to search recursively.');

  const matches: Array<{ path: string; value: unknown; type: string }> = [];
  const describe = (value: unknown): string => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);

  if (path.startsWith('$..')) {
    const wanted = path.slice(3);
    if (wanted.length === 0) throw invalidInput('Enter a key name after $..');
    const visit = (value: unknown, current: string): void => {
      if (Array.isArray(value)) {
        value.forEach((entry, index) => visit(entry, `${current}[${index}]`));
        return;
      }
      if (value !== null && typeof value === 'object') {
        for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
          if (key === wanted) matches.push({ path: `${current}.${key}`, value: entry, type: describe(entry) });
          visit(entry, `${current}.${key}`);
        }
      }
    };
    visit(parsed, '$');
    return {
      path,
      matches: matches.slice(0, 500),
      notes: ['Recursive search returns every match, capped at 500. Values are returned verbatim as parsed JSON — this tool does not evaluate expressions or call functions.'],
    };
  }

  const segments = path
    .replace(/^\$\.?/, '')
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((segment) => segment.length > 0);
  let current: unknown = parsed;
  let currentPath = '$';
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw invalidInput(`Array index "${segment}" is out of range at ${currentPath} (length ${current.length}).`);
      }
      current = current[index];
      currentPath += `[${index}]`;
      continue;
    }
    if (current !== null && typeof current === 'object' && segment in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[segment];
      currentPath += `.${segment}`;
      continue;
    }
    throw invalidInput(`The path segment "${segment}" does not exist at ${currentPath}.`);
  }

  return {
    path,
    matches: [{ path: currentPath, value: current, type: describe(current) }],
    notes: ['Numeric segments index arrays. No wildcard support in this mode — use $..key for a recursive search.'],
  };
}

export interface CsvConversionResult {
  format: 'json-to-csv' | 'csv-to-json';
  output: string;
  rows: number;
  columns: string[];
  warnings: string[];
}

export function jsonToCsv(input: { text: string; delimiter?: ',' | ';' | '\t' }): CsvConversionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.text) as unknown;
  } catch (error) {
    const located = locateJsonError(input.text, error as Error);
    throw invalidInput(`Invalid JSON${located.line !== null ? ` at line ${located.line}, column ${located.column}` : ''}: ${located.message}`);
  }
  if (!Array.isArray(parsed)) throw invalidInput('JSON-to-CSV expects an array of objects at the top level.');
  if (parsed.length === 0) throw invalidInput('The array is empty, so there are no rows to convert.');
  if (parsed.length > 20_000) throw invalidInput('Conversions are limited to 20,000 rows.');

  const delimiter = input.delimiter ?? ',';
  const warnings: string[] = [];
  const columns: string[] = [];
  for (const row of parsed) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      warnings.push('At least one array element is not an object; those rows are skipped.');
      continue;
    }
    for (const key of Object.keys(row as Record<string, unknown>)) if (!columns.includes(key)) columns.push(key);
  }
  if (columns.length === 0) throw invalidInput('No object rows were found to convert.');

  const field = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };
  const rowText = (values: string[]): string => values.map((value) => (/["\n\r]|,|;|\t/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)).join(delimiter);

  const lines = [rowText(columns.map((column) => column))];
  for (const row of parsed) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue;
    lines.push(rowText(columns.map((column) => field((row as Record<string, unknown>)[column]))));
  }

  return {
    format: 'json-to-csv',
    output: lines.join('\n'),
    rows: lines.length - 1,
    columns,
    warnings: [...warnings, 'Nested objects and arrays are serialised as JSON text inside their cell; CSV has no nested structure.'],
  };
}

function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      inQuotes = true;
      continue;
    }
    if (character === delimiter) {
      row.push(field);
      field = '';
      continue;
    }
    if (character === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    if (character !== '\r') field += character;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((cell) => cell.trim().length > 0));
}

export function csvToJson(input: { text: string; delimiter?: ',' | ';' | '\t'; inferTypes?: boolean }): CsvConversionResult {
  if (!input.text?.trim()) throw invalidInput('Paste CSV to convert.');
  const delimiter = input.delimiter ?? (input.text.split('\n')[0]?.includes(';') ? ';' : ',');
  const rows = parseCsv(input.text, delimiter);
  if (rows.length < 2) throw invalidInput('CSV needs a header row and at least one data row.');
  if (rows.length > 20_001) throw invalidInput('Conversions are limited to 20,000 data rows.');

  const header = rows[0]!.map((column, index) => column.trim() || `column_${index + 1}`);
  const warnings: string[] = [];
  if (new Set(header).size !== header.length) warnings.push('The header row contains duplicate column names; later columns overwrite earlier ones in the output objects.');

  const infer = (value: string): unknown => {
    if (input.inferTypes === false) return value;
    const trimmed = value.trim();
    if (trimmed.length === 0) return '';
    if (/^-?\d+$/.test(trimmed) && Math.abs(Number(trimmed)) <= Number.MAX_SAFE_INTEGER) return Number(trimmed);
    if (/^-?\d*\.\d+$/.test(trimmed)) return Number(trimmed);
    if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
    if (/^null$/i.test(trimmed)) return null;
    return value;
  };

  const objects = rows.slice(1).map((row) => {
    const object: Record<string, unknown> = {};
    header.forEach((column, index) => {
      object[column] = infer(row[index] ?? '');
    });
    return object;
  });

  return {
    format: 'csv-to-json',
    output: JSON.stringify(objects, null, 2),
    rows: objects.length,
    columns: header,
    warnings: [
      ...warnings,
      input.inferTypes === false
        ? 'Type inference is off, so every value is a string.'
        : 'Values that look like numbers, booleans or null were converted. Turn inference off when a column such as a postal code or a phone number must stay text.',
    ],
  };
}

export interface JsonDiffEntry {
  path: string;
  change: 'added' | 'removed' | 'changed';
  before: unknown;
  after: unknown;
}

export function diffJson(input: { before: string; after: string }): { entries: JsonDiffEntry[]; summary: { added: number; removed: number; changed: number; equal: boolean } } {
  const parse = (text: string, label: string): unknown => {
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      const located = locateJsonError(text, error as Error);
      throw invalidInput(`The ${label} document is invalid JSON${located.line !== null ? ` at line ${located.line}, column ${located.column}` : ''}: ${located.message}`);
    }
  };

  const before = parse(input.before, 'first');
  const after = parse(input.after, 'second');
  const entries: JsonDiffEntry[] = [];

  const compare = (a: unknown, b: unknown, path: string): void => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
    if (isObject(a) && isObject(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (!(key in a)) entries.push({ path: `${path}.${key}`, change: 'added', before: undefined, after: b[key] });
        else if (!(key in b)) entries.push({ path: `${path}.${key}`, change: 'removed', before: a[key], after: undefined });
        else compare(a[key], b[key], `${path}.${key}`);
      }
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      const length = Math.max(a.length, b.length);
      for (let index = 0; index < length; index += 1) {
        if (index >= a.length) entries.push({ path: `${path}[${index}]`, change: 'added', before: undefined, after: b[index] });
        else if (index >= b.length) entries.push({ path: `${path}[${index}]`, change: 'removed', before: a[index], after: undefined });
        else compare(a[index], b[index], `${path}[${index}]`);
      }
      return;
    }
    entries.push({ path, change: 'changed', before: a, after: b });
  };

  compare(before, after, '$');
  return {
    entries: entries.slice(0, 1000),
    summary: {
      added: entries.filter((entry) => entry.change === 'added').length,
      removed: entries.filter((entry) => entry.change === 'removed').length,
      changed: entries.filter((entry) => entry.change === 'changed').length,
      equal: entries.length === 0,
    },
  };
}

export { invalidInput as jsonInvalidInput };
