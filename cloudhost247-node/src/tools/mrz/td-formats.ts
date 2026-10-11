/**
 * MRZ formats TD1 (ID card, 3 lines of 30) and TD2 (2 lines of 36), per ICAO Doc 9303 Part 5.
 *
 * TD3 (passport, 2 lines of 44) lives in `mrz-engine.ts`. This module is pure and isomorphic, so
 * the server routes and the browser page share it.
 *
 * Every format is described by one table of field positions (`SPECS`). Validation, field
 * extraction and generation all read that table, so a layout is written down once. Positions are
 * 0-based: `[line, start, end)`. The ICAO tables are 1-based, so each entry carries a comment with
 * the 1-based range.
 *
 * Check digits use the Doc 9303 weighting (7, 3, 1) via the same function the TD3 engine uses. A
 * passing check digit means the printed characters are internally consistent. It does not show
 * that a document is genuine, and every result carries the authenticity notice.
 */
import { computeMrzCheckDigit, isValidMrzDateYYMMDD, MRZ_AUTHENTICITY_NOTICE } from './mrz-engine';

export type TdFormat = 'TD1' | 'TD2';
export type TdDetected = TdFormat | 'TD3' | 'UNKNOWN';
export type CheckStatus = 'PASS' | 'FAIL';

type Slice = readonly [line: number, start: number, end: number];
type FieldName =
  | 'documentCode'
  | 'issuingState'
  | 'name'
  | 'documentNumber'
  | 'nationality'
  | 'dateOfBirth'
  | 'sex'
  | 'expiryDate'
  | 'optional'
  | 'optional2';
type CheckName = 'documentNumber' | 'dateOfBirth' | 'expiryDate' | 'composite';

interface CheckSpec {
  label: string;
  /** Characters the check digit covers, in ICAO order. */
  of: readonly Slice[];
  /** Position of the check digit itself. */
  at: readonly [line: number, pos: number];
  /** Human-readable 1-based location for the report. */
  where: string;
}

interface FormatSpec {
  format: TdFormat;
  lineCount: number;
  lineLength: number;
  fields: Partial<Record<FieldName, Slice>>;
  checks: Record<CheckName, CheckSpec>;
  nameCapacity: number;
  optionalCapacity: number;
}

// TD1 — ICAO 9303 Part 5, three lines of 30 characters.
//   line 1: 1–2 document code, 3–5 issuing state, 6–14 document number, 15 check digit,
//           16–30 optional data
//   line 2: 1–6 date of birth, 7 check, 8 sex, 9–14 expiry, 15 check, 16–18 nationality,
//           19–29 optional data, 30 composite check
//   line 3: 1–30 surname and given names
const TD1: FormatSpec = {
  format: 'TD1',
  lineCount: 3,
  lineLength: 30,
  fields: {
    documentCode: [0, 0, 2],
    issuingState: [0, 2, 5],
    documentNumber: [0, 5, 14],
    optional: [0, 15, 30],
    dateOfBirth: [1, 0, 6],
    sex: [1, 7, 8],
    expiryDate: [1, 8, 14],
    nationality: [1, 15, 18],
    optional2: [1, 18, 29],
    name: [2, 0, 30],
  },
  checks: {
    documentNumber: { label: 'Document number', of: [[0, 5, 14]], at: [0, 14], where: 'Line 1, position 15' },
    dateOfBirth: { label: 'Date of birth', of: [[1, 0, 6]], at: [1, 6], where: 'Line 2, position 7' },
    expiryDate: { label: 'Expiry date', of: [[1, 8, 14]], at: [1, 14], where: 'Line 2, position 15' },
    composite: {
      label: 'Composite',
      of: [[0, 5, 30], [1, 0, 7], [1, 8, 15], [1, 18, 29]],
      at: [1, 29],
      where: 'Line 2, position 30',
    },
  },
  nameCapacity: 30,
  optionalCapacity: 15,
};

// TD2 — ICAO 9303 Part 5, two lines of 36 characters.
//   line 1: 1–2 document code, 3–5 issuing state, 6–36 surname and given names
//   line 2: 1–9 document number, 10 check, 11–13 nationality, 14–19 date of birth, 20 check,
//           21 sex, 22–27 expiry, 28 check, 29–35 optional data, 36 composite check
const TD2: FormatSpec = {
  format: 'TD2',
  lineCount: 2,
  lineLength: 36,
  fields: {
    documentCode: [0, 0, 2],
    issuingState: [0, 2, 5],
    name: [0, 5, 36],
    documentNumber: [1, 0, 9],
    nationality: [1, 10, 13],
    dateOfBirth: [1, 13, 19],
    sex: [1, 20, 21],
    expiryDate: [1, 21, 27],
    optional: [1, 28, 35],
  },
  checks: {
    documentNumber: { label: 'Document number', of: [[1, 0, 9]], at: [1, 9], where: 'Line 2, position 10' },
    dateOfBirth: { label: 'Date of birth', of: [[1, 13, 19]], at: [1, 19], where: 'Line 2, position 20' },
    expiryDate: { label: 'Expiry date', of: [[1, 21, 27]], at: [1, 27], where: 'Line 2, position 28' },
    composite: {
      label: 'Composite',
      of: [[1, 0, 10], [1, 13, 20], [1, 21, 35]],
      at: [1, 35],
      where: 'Line 2, position 36',
    },
  },
  nameCapacity: 31,
  optionalCapacity: 7,
};

const SPECS: Record<TdFormat, FormatSpec> = { TD1, TD2 };

const DOC_CODE = /^[ACIPV][A-Z<]$/;
const STATE = /^[A-Z]{3}$/;
const NATIONALITY = /^[A-Z]{3}$/;
const CHARSET = /^[A-Z0-9<]*$/;

export interface TdFieldReport {
  documentCode: string;
  issuingState: string;
  surname: string;
  givenNames: string;
  documentNumber: string;
  nationality: string;
  dateOfBirth: string;
  sex: string;
  expiryDate: string;
  optionalData: string;
}

export interface TdCheckRow {
  name: string;
  position: string;
  expected: string;
  actual: string;
  status: CheckStatus;
}

export interface TdValidationResult {
  format: TdFormat;
  valid: boolean;
  /** Each validation rule and its outcome, so the page can show exactly what failed. */
  checks: Record<string, CheckStatus>;
  reasons: string[];
  /** Null when the line layout itself is wrong, because no field can be located. */
  fields: TdFieldReport | null;
  checkDigits: TdCheckRow[];
  authenticityNotice: string;
}

/** Identifies the format from the line count and lengths. */
export function detectTdFormat(lines: string[]): TdDetected {
  const clean = lines.map((line) => line.trim());
  if (clean.length === 3 && clean.every((line) => line.length === 30)) return 'TD1';
  if (clean.length === 2 && clean.every((line) => line.length === 36)) return 'TD2';
  if (clean.length === 2 && clean.every((line) => line.length === 44)) return 'TD3';
  return 'UNKNOWN';
}

const read = (lines: string[], [line, start, end]: Slice): string => lines[line]!.slice(start, end);

/** Splits `SURNAME<<GIVEN<NAMES` into surname and given names, with < shown as spaces. */
export function splitName(raw: string): { surname: string; givenNames: string } {
  const at = raw.indexOf('<<');
  const display = (value: string) => value.replace(/<+$/, '').replace(/</g, ' ').trim();
  if (at < 0) return { surname: display(raw), givenNames: '' };
  return { surname: display(raw.slice(0, at)), givenNames: display(raw.slice(at + 2)) };
}

function extractFields(spec: FormatSpec, lines: string[]): TdFieldReport {
  const f = spec.fields;
  const get = (name: FieldName) => (f[name] ? read(lines, f[name]!) : '');
  const { surname, givenNames } = splitName(get('name'));
  const optional = [get('optional'), get('optional2')]
    .map((value) => value.replace(/<+/g, ' ').trim())
    .filter((value) => value.length > 0)
    .join(' / ');
  return {
    documentCode: get('documentCode'),
    issuingState: get('issuingState'),
    surname,
    givenNames,
    documentNumber: get('documentNumber').replace(/<+$/, ''),
    nationality: get('nationality'),
    dateOfBirth: get('dateOfBirth'),
    sex: get('sex'),
    expiryDate: get('expiryDate'),
    optionalData: optional,
  };
}

/** Validates a TD1 or TD2 document. Problems are reported, never thrown. */
export function validateTdMrz(format: TdFormat, input: string[]): TdValidationResult {
  const spec = SPECS[format];
  const lines = input.map((line) => line.trim());
  const reasons: string[] = [];
  const checks: Record<string, CheckStatus> = {};
  const checkDigits: TdCheckRow[] = [];
  const result = (valid: boolean, fields: TdFieldReport | null): TdValidationResult => ({
    format, valid, checks, reasons, fields, checkDigits, authenticityNotice: MRZ_AUTHENTICITY_NOTICE,
  });

  const lengths = lines.map((line) => line.length);
  if (lines.length !== spec.lineCount || lengths.some((length) => length !== spec.lineLength)) {
    checks.layout = 'FAIL';
    reasons.push(
      `${format} needs ${spec.lineCount} lines of ${spec.lineLength} characters; received ${lines.length} line(s) of ${lengths.join(', ') || 'no'} characters.`
    );
    return result(false, null);
  }
  checks.layout = 'PASS';

  checks.characters = lines.every((line) => CHARSET.test(line)) ? 'PASS' : 'FAIL';
  if (checks.characters === 'FAIL') reasons.push('Only uppercase A–Z, digits 0–9 and the filler < may appear in an MRZ.');

  const fields = extractFields(spec, lines);

  checks.documentCode = DOC_CODE.test(fields.documentCode) ? 'PASS' : 'FAIL';
  if (checks.documentCode === 'FAIL') {
    reasons.push(`Document code "${fields.documentCode}" must start with A, C, I, P or V and be followed by a letter or <.`);
  }
  checks.issuingState = STATE.test(fields.issuingState) ? 'PASS' : 'FAIL';
  if (checks.issuingState === 'FAIL') reasons.push(`Issuing state "${fields.issuingState}" must be a three-letter code.`);
  checks.nationality = NATIONALITY.test(fields.nationality) ? 'PASS' : 'FAIL';
  if (checks.nationality === 'FAIL') reasons.push(`Nationality "${fields.nationality}" must be a three-letter code.`);
  checks.sex = ['M', 'F', '<'].includes(fields.sex) ? 'PASS' : 'FAIL';
  if (checks.sex === 'FAIL') reasons.push(`Sex "${fields.sex}" must be M, F or < (unspecified).`);
  const nameField = read(lines, spec.fields.name!);
  checks.name = /^[A-Z<]+$/.test(nameField) ? 'PASS' : 'FAIL';
  if (checks.name === 'FAIL') reasons.push('The name field may contain only A–Z and <.');

  const dateChecks = [
    ['dateOfBirth', 'Date of birth'],
    ['expiryDate', 'Expiry date'],
  ] as const;
  for (const [key, label] of dateChecks) {
    const date = isValidMrzDateYYMMDD(fields[key]);
    checks[`${key}Valid`] = date.valid ? 'PASS' : 'FAIL';
    if (!date.valid) reasons.push(`${label}: ${date.reason}`);
  }

  for (const checkName of ['documentNumber', 'dateOfBirth', 'expiryDate', 'composite'] as const) {
    const check = spec.checks[checkName];
    const covered = check.of.map((slice) => read(lines, slice)).join('');
    const expected = computeMrzCheckDigit(covered);
    const actual = lines[check.at[0]]![check.at[1]]!;
    const status: CheckStatus = expected === actual ? 'PASS' : 'FAIL';
    checks[`${checkName}Check`] = status;
    checkDigits.push({ name: check.label, position: check.where, expected, actual, status });
    if (status === 'FAIL') reasons.push(`The ${check.label.toLowerCase()} check digit does not match (expected ${expected}, found ${actual}).`);
  }

  const valid = Object.values(checks).every((status) => status === 'PASS');
  return result(valid, fields);
}

/** Converts a free-text name to the MRZ alphabet: diacritics removed, spaces and hyphens become <. */
export function mrzName(raw: string): { ok: true; value: string } | { ok: false; message: string } {
  const transliterated = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[\s'-]+/g, '<');
  if (!/^[A-Z<]+$/.test(transliterated)) {
    return { ok: false, message: 'Names may contain only letters, spaces, hyphens and apostrophes.' };
  }
  return { ok: true, value: transliterated };
}

export interface TdGenerateInput {
  documentType?: string;
  issuingState: string;
  surname: string;
  givenNames: string;
  nationality: string;
  dateOfBirth: string;
  sex: string;
  documentNumber: string;
  expiryDate: string;
  optionalData?: string;
}

export interface TdGenerateSuccess {
  ok: true;
  format: TdFormat;
  lines: string[];
  mrz: string;
  validation: TdValidationResult;
}

export interface TdGenerateFailure {
  ok: false;
  format: TdFormat;
  message: string;
  errors: Array<{ field: string; message: string }>;
}

/** Generates a TD1 or TD2 MRZ from the entered details, then validates the output before returning it. */
export function generateTdMrz(format: TdFormat, input: TdGenerateInput): TdGenerateSuccess | TdGenerateFailure {
  const spec = SPECS[format];
  const errors: Array<{ field: string; message: string }> = [];
  const fail = (field: string, message: string) => errors.push({ field, message });

  const code = (input.documentType ?? 'I<').trim().toUpperCase().padEnd(2, '<');
  if (!DOC_CODE.test(code)) fail('documentType', 'Document type must be A, C, I, P or V, followed by a letter or <.');
  const state = input.issuingState.trim().toUpperCase();
  if (!STATE.test(state)) fail('issuingState', 'Issuing state must be a three-letter code (for example NGA).');
  const nationality = input.nationality.trim().toUpperCase();
  if (!NATIONALITY.test(nationality)) fail('nationality', 'Nationality must be a three-letter code.');
  const documentNumber = input.documentNumber.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,9}$/.test(documentNumber)) fail('documentNumber', 'Document number must be 1 to 9 letters or digits.');
  const dob = input.dateOfBirth.trim();
  const dobDate = isValidMrzDateYYMMDD(dob);
  if (!dobDate.valid) fail('dateOfBirth', `Date of birth: ${dobDate.reason}`);
  const expiry = input.expiryDate.trim();
  const expiryDate = isValidMrzDateYYMMDD(expiry);
  if (!expiryDate.valid) fail('expiryDate', `Expiry date: ${expiryDate.reason}`);
  const sexRaw = input.sex.trim().toUpperCase();
  const sex = sexRaw === '' || sexRaw === 'X' ? '<' : sexRaw;
  if (!['M', 'F', '<'].includes(sex)) fail('sex', 'Sex must be M, F, or X/blank for unspecified.');
  const surname = mrzName(input.surname.trim());
  if (!surname.ok) fail('surname', surname.message);
  const given = mrzName(input.givenNames.trim());
  if (!given.ok) fail('givenNames', given.message);
  const optional = (input.optionalData ?? '').trim().toUpperCase().replace(/\s+/g, '<');
  if (!CHARSET.test(optional) || optional.length > spec.optionalCapacity) {
    fail('optionalData', `Optional data is up to ${spec.optionalCapacity} letters, digits or < for ${format}.`);
  }
  if (errors.length > 0) return { ok: false, format, message: 'Some fields cannot be encoded.', errors };

  const name = `${surname.ok ? surname.value : ''}<<${given.ok ? given.value : ''}`;
  if (name.length > spec.nameCapacity) {
    return {
      ok: false,
      format,
      message: `The name needs ${name.length} characters but ${format} allows ${spec.nameCapacity}.`,
      errors: [{ field: 'surname', message: `Shorten the name to ${spec.nameCapacity} characters, including the << separator.` }],
    };
  }

  const grid = Array.from({ length: spec.lineCount }, () => Array.from({ length: spec.lineLength }, () => '<'));
  const put = (slice: Slice, value: string) => {
    const [line, start, end] = slice;
    for (let i = start; i < end; i += 1) grid[line]![i] = value[i - start] ?? '<';
  };
  const f = spec.fields;
  put(f.documentCode!, code);
  put(f.issuingState!, state);
  put(f.name!, name);
  put(f.documentNumber!, documentNumber);
  put(f.nationality!, nationality);
  put(f.dateOfBirth!, dob);
  put(f.sex!, sex);
  put(f.expiryDate!, expiry);
  if (f.optional) put(f.optional, optional);

  const lineText = (line: number) => grid[line]!.join('');
  // Check digits are written in dependency order: the composite covers the others.
  for (const checkName of ['documentNumber', 'dateOfBirth', 'expiryDate', 'composite'] as const) {
    const check = spec.checks[checkName];
    const covered = check.of.map(([line, start, end]) => lineText(line).slice(start, end)).join('');
    grid[check.at[0]]![check.at[1]] = computeMrzCheckDigit(covered);
  }

  const lines = Array.from({ length: spec.lineCount }, (_, line) => lineText(line));
  const validation = validateTdMrz(format, lines);
  if (!validation.valid) {
    return {
      ok: false,
      format,
      message: 'The generated MRZ did not pass its own validation. Please report this input.',
      errors: validation.reasons.map((message) => ({ field: 'mrz', message })),
    };
  }
  return { ok: true, format, lines, mrz: lines.join('\n'), validation };
}
