/**
 * CloudHost247 Native ePassport MRZ (Machine Readable Zone) Developer Engine
 *
 * Implements ICAO Doc 9303 Part 3 (Specifications Common to all MRTDs) and
 * Part 4 (Specifications for Machine Readable Passports — TD3 format).
 *
 * Intended strictly for legitimate software development, document-format testing,
 * OCR/parser development, and integration testing.
 *
 * Privacy-first & stateless:
 * - Performs pure, deterministic calculation, normalization, validation, and parsing.
 * - Never persists or logs personal data, passport numbers, names, dates, or MRZ strings.
 * - Never claims that a mathematically valid MRZ proves a physical document is genuine.
 */

export type MrzSexInput = 'M' | 'F' | '<' | 'X' | 'Male' | 'Female' | 'Unspecified' | 'male' | 'female' | 'unspecified';
export type MrzSexCode = 'M' | 'F' | '<';
export type MrzSexLabel = 'Male' | 'Female' | 'Unspecified';

export interface MrzGenerateInput {
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

export interface MrzNormalizationStage {
  original: string;
  transliterated: string;
  mrzCompatible: string;
}

export interface MrzNormalizationReport {
  surname: MrzNormalizationStage;
  givenNames: MrzNormalizationStage;
  combinedIdentifier: string;
  fixedWidthField: string;
  fillerCount: number;
}

export interface MrzCheckDigitDetail {
  field: 'documentNumber' | 'dateOfBirth' | 'expiryDate' | 'optionalData' | 'composite';
  label: string;
  sourceSegment: string;
  expected: string;
  actual: string;
  valid: boolean;
  weightedSum: number;
}

export interface MrzGenerateResult {
  success: true;
  documentType: 'TD3';
  mrz: {
    line1: string;
    line2: string;
  };
  validation: {
    structure: boolean;
    checkDigits: boolean;
  };
  checkDigits: {
    documentNumber: string;
    dateOfBirth: string;
    expiryDate: string;
    optionalData: string;
    composite: string;
  };
  normalization: MrzNormalizationReport;
  authenticityNotice: string;
}

export interface MrzFieldError {
  field: string;
  code: string;
  message: string;
}

export interface MrzGenerateFailure {
  success: false;
  error: string;
  message: string;
  errors: MrzFieldError[];
}

export type MrzGenerateOutcome = MrzGenerateResult | MrzGenerateFailure;

export type PassFail = 'PASS' | 'FAIL';

export interface MrzValidationChecks {
  documentFormat: PassFail;
  lineLength: PassFail;
  documentNumber: PassFail;
  dateOfBirth: PassFail;
  expiryDate: PassFail;
  checkDigits: PassFail;
  characterValidation: PassFail;
  issuingState: PassFail;
  nationality: PassFail;
  sex: PassFail;
  optionalData: PassFail;
  compositeCheckDigit: PassFail;
  structuralValidity: PassFail;
}

export interface MrzValidationResult {
  valid: boolean;
  status: 'VALID' | 'INVALID';
  documentFormat: 'TD3';
  summary: string;
  reasons: string[];
  lineCount: number;
  lineLengths: [number, number];
  checks: MrzValidationChecks;
  checkDigitDetails: MrzCheckDigitDetail[];
  authenticityVerified: false;
  authenticityNotice: string;
}

export interface MrzParsedFields {
  documentType: string;
  documentFormat: 'TD3';
  issuingState: string;
  surname: string;
  givenNames: string;
  nationality: string;
  documentNumber: string;
  dateOfBirth: string;
  sex: MrzSexLabel;
  sexCode: MrzSexCode;
  expiryDate: string;
  optionalData: string;
  checkDigitStatus: PassFail;
}

export interface MrzParseResult {
  success: boolean;
  parsedStatus: 'Successfully parsed' | 'Parse failed';
  structureValid: boolean;
  authenticityVerified: false;
  authenticityStatus: 'Not verified — MRZ format and check-digit validation only';
  authenticityNotice: string;
  fields: MrzParsedFields | null;
  validation: MrzValidationResult;
}

export interface MrzSyntheticTestData {
  synthetic: true;
  label: 'SYNTHETIC TEST DATA — FOR SOFTWARE DEVELOPMENT & TESTING ONLY';
  disclaimer: string;
  fields: {
    documentType: string;
    issuingState: string;
    surname: string;
    givenNames: string;
    nationality: string;
    dateOfBirth: string;
    sex: MrzSexCode;
    sexLabel: MrzSexLabel;
    documentNumber: string;
    expiryDate: string;
    optionalData: string;
  };
  mrz: {
    line1: string;
    line2: string;
  };
}

export interface MrzAiExplanationTopic {
  topic?: 'overview' | 'fields' | 'check_digits' | 'format' | 'invalid_input' | 'parsing';
  mrz?: string | { line1: string; line2: string };
  inputErrors?: MrzFieldError[];
  question?: string;
}

export interface MrzAiExplanationResult {
  topic: string;
  title: string;
  summary: string;
  sections: Array<{
    heading: string;
    body: string;
  }>;
  authenticityVerified: false;
  authenticityDisclaimer: string;
}

export const MRZ_AUTHENTICITY_NOTICE =
  'Mathematical and structural MRZ validation only confirms ICAO Doc 9303 formatting and check digits for software testing. It does NOT verify that a physical or electronic passport is genuine or government-issued.';

export const MRZ_WEIGHTS = [7, 3, 1] as const;

/**
 * ICAO Doc 9303 Part 3 Section 6 — Recommended transliteration of Latin-based characters
 * into the permitted MRZ ASCII subset (A–Z).
 */
const ICAO_TRANSLITERATION_MAP: Readonly<Record<string, string>> = {
  // Multi-letter expansions per ICAO Doc 9303 Part 3 Table A
  'Ä': 'AE',
  'Æ': 'AE',
  'Ö': 'OE',
  'Œ': 'OE',
  'Ø': 'OE',
  'Ü': 'UE',
  'ß': 'SS',
  'ẞ': 'SS',
  'Å': 'AA',
  'Þ': 'TH',
  'Ĳ': 'IJ',
  // Single-letter transliterations per ICAO Doc 9303 Part 3 Table A
  'Á': 'A',
  'À': 'A',
  'Â': 'A',
  'Ã': 'A',
  'Ā': 'A',
  'Ă': 'A',
  'Ą': 'A',
  'Ć': 'C',
  'Ĉ': 'C',
  'Ċ': 'C',
  'Č': 'C',
  'Ç': 'C',
  'Ð': 'D',
  'Ď': 'D',
  'Đ': 'D',
  'É': 'E',
  'È': 'E',
  'Ê': 'E',
  'Ë': 'E',
  'Ē': 'E',
  'Ĕ': 'E',
  'Ė': 'E',
  'Ę': 'E',
  'Ě': 'E',
  'Ĝ': 'G',
  'Ğ': 'G',
  'Ġ': 'G',
  'Ģ': 'G',
  'Ĥ': 'H',
  'Ħ': 'H',
  'Í': 'I',
  'Ì': 'I',
  'Î': 'I',
  'Ï': 'I',
  'Ĩ': 'I',
  'Ī': 'I',
  'Ĭ': 'I',
  'Į': 'I',
  'İ': 'I',
  'I': 'I',
  'ı': 'I',
  'Ĵ': 'J',
  'Ķ': 'K',
  'Ĺ': 'L',
  'Ļ': 'L',
  'Ľ': 'L',
  'Ŀ': 'L',
  'Ł': 'L',
  'Ñ': 'N',
  'Ń': 'N',
  'Ņ': 'N',
  'Ň': 'N',
  'Ŋ': 'N',
  'Ó': 'O',
  'Ò': 'O',
  'Ô': 'O',
  'Õ': 'O',
  'Ō': 'O',
  'Ŏ': 'O',
  'Ő': 'O',
  'Ŕ': 'R',
  'Ŗ': 'R',
  'Ř': 'R',
  'Ś': 'S',
  'Ŝ': 'S',
  'Ş': 'S',
  'Š': 'S',
  'Ţ': 'T',
  'Ť': 'T',
  'Ŧ': 'T',
  'Ú': 'U',
  'Ù': 'U',
  'Û': 'U',
  'Ũ': 'U',
  'Ū': 'U',
  'Ŭ': 'U',
  'Ů': 'U',
  'Ű': 'U',
  'Ų': 'U',
  'Ŵ': 'W',
  'Ý': 'Y',
  'Ŷ': 'Y',
  'Ÿ': 'Y',
  'Ź': 'Z',
  'Ż': 'Z',
  'Ž': 'Z',
};

/**
 * Standard ICAO Doc 9303 Part 3 Section 4.9 character value mapping:
 * - '<'   -> 0
 * - '0'-'9' -> 0-9
 * - 'A'-'Z' -> 10-35
 */
export function mrzCharValue(char: string): number {
  if (char.length !== 1) {
    throw new Error(`Expected single MRZ character, got length ${char.length}`);
  }
  if (char === '<') return 0;
  const code = char.charCodeAt(0);
  if (code >= 48 && code <= 57) {
    return code - 48;
  }
  if (code >= 65 && code <= 90) {
    return code - 65 + 10;
  }
  throw new Error(`Invalid MRZ character: "${char}"`);
}

/**
 * Computes the standard ICAO Doc 9303 check digit using repeating weights 7, 3, 1.
 */
export function computeMrzCheckDigitDetailed(segment: string): { checkDigit: string; weightedSum: number } {
  let weightedSum = 0;
  for (let i = 0; i < segment.length; i++) {
    const val = mrzCharValue(segment[i]!);
    const weight = MRZ_WEIGHTS[i % 3]!;
    weightedSum += val * weight;
  }
  return {
    checkDigit: String(weightedSum % 10),
    weightedSum,
  };
}

export function computeMrzCheckDigit(segment: string): string {
  return computeMrzCheckDigitDetailed(segment).checkDigit;
}

/**
 * Validates whether a 6-character string is a valid YYMMDD calendar date.
 * Note: In 2-digit year representation, years divisible by 4 (including 00 for 2000)
 * permit Feb 29; years not divisible by 4 never have Feb 29 in any century.
 */
export function isValidMrzDateYYMMDD(raw: string): { valid: boolean; reason?: string } {
  if (typeof raw !== 'string' || !/^\d{6}$/.test(raw)) {
    return { valid: false, reason: 'Date must be exactly 6 numeric digits in YYMMDD format.' };
  }
  const yy = Number.parseInt(raw.slice(0, 2), 10);
  const mm = Number.parseInt(raw.slice(2, 4), 10);
  const dd = Number.parseInt(raw.slice(4, 6), 10);

  if (mm < 1 || mm > 12) {
    return { valid: false, reason: `Invalid month "${raw.slice(2, 4)}" in YYMMDD date (must be 01–12).` };
  }

  const isLeapYear = yy % 4 === 0;
  const daysInMonths = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDay = daysInMonths[mm - 1]!;
  if (dd < 1 || dd > maxDay) {
    return {
      valid: false,
      reason: `Invalid day "${raw.slice(4, 6)}" for month "${raw.slice(2, 4)}" in YYMMDD date (must be 01–${String(maxDay).padStart(2, '0')}).`,
    };
  }
  return { valid: true };
}

/**
 * Transliterates and normalizes a single name field (Surname or Given Names)
 * according to ICAO Doc 9303 Part 3 rules.
 *
 * Never silently strips unsupported characters (such as digits, '@', '<', '>', scripts, or
 * non-Latin characters). Returns an explicit error if the input cannot be safely represented.
 */
export function normalizeMrzNameComponent(
  rawInput: string,
  fieldLabel: string
): { ok: true; stage: MrzNormalizationStage } | { ok: false; error: MrzFieldError } {
  const fieldKey = fieldLabel.toLowerCase().includes('surname') ? 'surname' : 'givenNames';
  if (typeof rawInput !== 'string') {
    return {
      ok: false,
      error: { field: fieldKey, code: 'INVALID_TYPE', message: `${fieldLabel} must be a text string.` },
    };
  }

  const trimmed = rawInput.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      error: { field: fieldKey, code: 'REQUIRED', message: `${fieldLabel} is required and cannot be empty.` },
    };
  }

  if (trimmed.length > 80) {
    return {
      ok: false,
      error: {
        field: fieldKey,
        code: 'MAX_LENGTH_EXCEEDED',
        message: `${fieldLabel} exceeds maximum input length.`,
      },
    };
  }

  // NFC normalize first so composed characters like Ä, Ö, Ü, Å are matched by ICAO_TRANSLITERATION_MAP
  // before falling back to NFD combining-diacritic decomposition.
  const nfc = trimmed.normalize('NFC');
  let transliterated = '';

  for (let i = 0; i < nfc.length; i++) {
    const ch = nfc[i]!;
    const upperCh = ch === 'ß' ? 'ß' : ch.toUpperCase();

    if (ICAO_TRANSLITERATION_MAP[ch]) {
      transliterated += ICAO_TRANSLITERATION_MAP[ch];
      continue;
    }
    if (ICAO_TRANSLITERATION_MAP[upperCh]) {
      transliterated += ICAO_TRANSLITERATION_MAP[upperCh];
      continue;
    }
    if (/^[A-Z]$/.test(upperCh)) {
      transliterated += upperCh;
      continue;
    }
    // Apostrophes and periods in prefixes/initials (e.g. O'Connor, D'Artagnan) are omitted per ICAO Doc 9303
    if (ch === "'" || ch === '’' || ch === '`') {
      continue;
    }
    // Spaces and hyphens separate name components and become single '<' in MRZ
    if (ch === ' ' || ch === '-') {
      transliterated += ' ';
      continue;
    }
    // Check if NFD decomposition yields a Latin base letter + combining diacritical marks (U+0300..U+036F)
    const nfd = ch.normalize('NFD');
    if (nfd.length > 1) {
      const base = nfd[0]!;
      const rest = nfd.slice(1);
      if (/^[A-Za-z]$/.test(base) && /^[\u0300-\u036f]+$/.test(rest)) {
        const mappedBase = ICAO_TRANSLITERATION_MAP[base.toUpperCase()] ?? base.toUpperCase();
        transliterated += mappedBase;
        continue;
      }
    }

    // Any other character (digits, '<', '>', punctuation, HTML tags, emojis, non-Latin scripts) is rejected.
    return {
      ok: false,
      error: {
        field: fieldKey,
        code: 'UNSUPPORTED_CHARACTER',
        message: `${fieldLabel} contains unsupported character "${ch}". Only Latin letters, supported diacritics, spaces, hyphens, and apostrophes are permitted in ICAO MRZ names.`,
      },
    };
  }

  const tokens = transliterated
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  if (tokens.length === 0) {
    return {
      ok: false,
      error: {
        field: fieldKey,
        code: 'EMPTY_AFTER_NORMALIZATION',
        message: `${fieldLabel} must contain at least one transliterable letter.`,
      },
    };
  }

  const cleanTransliterated = tokens.join(' ');
  const mrzCompatible = tokens.join('<');

  return {
    ok: true,
    stage: {
      original: rawInput,
      transliterated: cleanTransliterated,
      mrzCompatible,
    },
  };
}

/**
 * Normalizes the full 39-character TD3 name field: `SURNAME<<GIVEN<NAMES<<<<...`
 * Rejects if the combined normalized length exceeds 39 characters (never silently produces an
 * invalid or unexpectedly truncated MRZ).
 */
export function normalizeMrzNameField(
  surnameRaw: string,
  givenNamesRaw: string
): { ok: true; report: MrzNormalizationReport } | { ok: false; errors: MrzFieldError[] } {
  const errors: MrzFieldError[] = [];
  const surnameRes = normalizeMrzNameComponent(surnameRaw, 'Surname');
  if (!surnameRes.ok) errors.push(surnameRes.error);

  const givenRes = normalizeMrzNameComponent(givenNamesRaw, 'Given names');
  if (!givenRes.ok) errors.push(givenRes.error);

  if (!surnameRes.ok || !givenRes.ok) {
    return { ok: false, errors };
  }

  const combinedIdentifier = `${surnameRes.stage.mrzCompatible}<<${givenRes.stage.mrzCompatible}`;
  if (combinedIdentifier.length > 39) {
    return {
      ok: false,
      errors: [
        {
          field: 'surname',
          code: 'NAME_FIELD_OVERFLOW',
          message: `Normalized name "${combinedIdentifier}" is ${combinedIdentifier.length} characters, exceeding the 39-character TD3 MRZ name field limit (Positions 6–44 of Line 1).`,
        },
      ],
    };
  }

  const fillerCount = 39 - combinedIdentifier.length;
  const fixedWidthField = combinedIdentifier.padEnd(39, '<');

  return {
    ok: true,
    report: {
      surname: surnameRes.stage,
      givenNames: givenRes.stage,
      combinedIdentifier,
      fixedWidthField,
      fillerCount,
    },
  };
}

/**
 * Normalizes a 3-character ICAO Issuing State or Nationality code.
 * Supports 3-letter codes `[A-Z]{3}` and Germany's ICAO code `D` / `D<<`.
 */
export function normalizeMrzStateCode(
  raw: string,
  fieldKey: 'issuingState' | 'nationality',
  fieldLabel: string
): { ok: true; code: string } | { ok: false; error: MrzFieldError } {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return {
      ok: false,
      error: { field: fieldKey, code: 'REQUIRED', message: `${fieldLabel} is required (3-letter ICAO code, e.g. UTO).` },
    };
  }
  const upper = raw.trim().toUpperCase();
  if (upper === 'D' || upper === 'D<<') {
    return { ok: true, code: 'D<<' };
  }
  if (!/^[A-Z]{3}$/.test(upper)) {
    return {
      ok: false,
      error: {
        field: fieldKey,
        code: 'INVALID_STATE_CODE',
        message: `${fieldLabel} must be a 3-letter uppercase ICAO country/organization code (A–Z, e.g. UTO, USA, GBR, or D<<).`,
      },
    };
  }
  return { ok: true, code: upper };
}

/**
 * Normalizes the 2-character TD3 Document Type code.
 * Per ICAO Doc 9303 Part 4, first character must be 'P', second character '<' or 'A'–'Z'.
 */
export function normalizeMrzDocumentType(
  raw?: string
): { ok: true; code: string } | { ok: false; error: MrzFieldError } {
  if (raw === undefined || raw === null || raw.trim() === '' || raw.trim().toUpperCase() === 'TD3') {
    return { ok: true, code: 'P<' };
  }
  const upper = raw.trim().toUpperCase();
  if (upper === 'P') {
    return { ok: true, code: 'P<' };
  }
  if (/^P[A-Z<]$/.test(upper)) {
    return { ok: true, code: upper };
  }
  return {
    ok: false,
    error: {
      field: 'documentType',
      code: 'INVALID_DOCUMENT_TYPE',
      message: 'Document type for TD3 passport format must start with "P" followed by "<" or a single letter A–Z (e.g. "P<", "PO", "PD").',
    },
  };
}

/**
 * Normalizes Sex input into ICAO MRZ sex code ('M', 'F', or '<').
 */
export function normalizeMrzSex(
  raw: string
): { ok: true; code: MrzSexCode; label: MrzSexLabel } | { ok: false; error: MrzFieldError } {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return {
      ok: false,
      error: { field: 'sex', code: 'REQUIRED', message: 'Sex is required (Male, Female, or Unspecified).' },
    };
  }
  const upper = raw.trim().toUpperCase();
  if (upper === 'M' || upper === 'MALE') {
    return { ok: true, code: 'M', label: 'Male' };
  }
  if (upper === 'F' || upper === 'FEMALE') {
    return { ok: true, code: 'F', label: 'Female' };
  }
  if (upper === '<' || upper === 'X' || upper === 'UNSPECIFIED' || upper === 'U') {
    return { ok: true, code: '<', label: 'Unspecified' };
  }
  return {
    ok: false,
    error: {
      field: 'sex',
      code: 'INVALID_SEX',
      message: 'Sex must be Male (M), Female (F), or Unspecified (<).',
    },
  };
}

/**
 * Normalizes a TD3 Document/Passport Number (1 to 9 alphanumeric characters, padded with '<' to 9).
 */
export function normalizeMrzDocumentNumber(
  raw: string
): { ok: true; field: string; clean: string } | { ok: false; error: MrzFieldError } {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return {
      ok: false,
      error: {
        field: 'documentNumber',
        code: 'REQUIRED',
        message: 'Document/passport number is required (1–9 alphanumeric characters).',
      },
    };
  }
  const upper = raw.trim().toUpperCase().replace(/<+$/, '');
  if (upper.length === 0) {
    return {
      ok: false,
      error: {
        field: 'documentNumber',
        code: 'REQUIRED',
        message: 'Document/passport number must contain at least one letter or digit.',
      },
    };
  }
  if (upper.length > 9) {
    return {
      ok: false,
      error: {
        field: 'documentNumber',
        code: 'MAX_LENGTH_EXCEEDED',
        message: `Document/passport number is ${upper.length} characters; TD3 format allows at most 9 characters.`,
      },
    };
  }
  if (!/^[A-Z0-9]+$/.test(upper)) {
    return {
      ok: false,
      error: {
        field: 'documentNumber',
        code: 'INVALID_CHARACTERS',
        message: 'Document/passport number may only contain uppercase letters (A–Z) and digits (0–9).',
      },
    };
  }
  return {
    ok: true,
    clean: upper,
    field: upper.padEnd(9, '<'),
  };
}

/**
 * Normalizes TD3 Optional Document Data (0 to 14 characters, padded with '<' to 14).
 */
export function normalizeMrzOptionalData(
  raw?: string
): { ok: true; field: string; clean: string } | { ok: false; error: MrzFieldError } {
  if (raw === undefined || raw === null || raw.trim() === '') {
    return {
      ok: true,
      clean: '',
      field: '<'.repeat(14),
    };
  }
  const upper = raw.trim().toUpperCase().replace(/\s+/g, '<');
  if (upper.length > 14) {
    return {
      ok: false,
      error: {
        field: 'optionalData',
        code: 'MAX_LENGTH_EXCEEDED',
        message: `Optional data is ${upper.length} characters; TD3 format allows at most 14 characters.`,
      },
    };
  }
  if (!/^[A-Z0-9<]+$/.test(upper)) {
    return {
      ok: false,
      error: {
        field: 'optionalData',
        code: 'INVALID_CHARACTERS',
        message: 'Optional data may only contain letters (A–Z), digits (0–9), spaces, or filler "<".',
      },
    };
  }
  return {
    ok: true,
    clean: upper.replace(/<+$/, ''),
    field: upper.padEnd(14, '<'),
  };
}

/**
 * Generates a complete, validated 2-line TD3 (88-character) ePassport MRZ.
 */
export function generateTd3Mrz(input: MrzGenerateInput): MrzGenerateOutcome {
  const errors: MrzFieldError[] = [];

  const docTypeRes = normalizeMrzDocumentType(input.documentType);
  if (!docTypeRes.ok) errors.push(docTypeRes.error);

  const issuingRes = normalizeMrzStateCode(input.issuingState, 'issuingState', 'Issuing state');
  if (!issuingRes.ok) errors.push(issuingRes.error);

  const nameRes = normalizeMrzNameField(input.surname, input.givenNames);
  if (!nameRes.ok) errors.push(...nameRes.errors);

  const natRes = normalizeMrzStateCode(input.nationality, 'nationality', 'Nationality');
  if (!natRes.ok) errors.push(natRes.error);

  const docNumRes = normalizeMrzDocumentNumber(input.documentNumber);
  if (!docNumRes.ok) errors.push(docNumRes.error);

  const dobTrimmed = typeof input.dateOfBirth === 'string' ? input.dateOfBirth.trim() : '';
  const dobCheck = isValidMrzDateYYMMDD(dobTrimmed);
  if (!dobCheck.valid) {
    errors.push({
      field: 'dateOfBirth',
      code: 'INVALID_DATE',
      message: `Date of birth invalid: ${dobCheck.reason}`,
    });
  }

  const sexRes = normalizeMrzSex(input.sex);
  if (!sexRes.ok) errors.push(sexRes.error);

  const expTrimmed = typeof input.expiryDate === 'string' ? input.expiryDate.trim() : '';
  const expCheck = isValidMrzDateYYMMDD(expTrimmed);
  if (!expCheck.valid) {
    errors.push({
      field: 'expiryDate',
      code: 'INVALID_DATE',
      message: `Expiry date invalid: ${expCheck.reason}`,
    });
  }

  const optRes = normalizeMrzOptionalData(input.optionalData);
  if (!optRes.ok) errors.push(optRes.error);

  if (
    errors.length > 0 ||
    !docTypeRes.ok ||
    !issuingRes.ok ||
    !nameRes.ok ||
    !natRes.ok ||
    !docNumRes.ok ||
    !sexRes.ok ||
    !optRes.ok
  ) {
    return {
      success: false,
      error: 'VALIDATION_ERROR',
      message: errors.map((e) => e.message).join(' '),
      errors,
    };
  }

  const line1 = `${docTypeRes.code}${issuingRes.code}${nameRes.report.fixedWidthField}`;

  const docNumCheckDigit = computeMrzCheckDigit(docNumRes.field);
  const dobCheckDigit = computeMrzCheckDigit(dobTrimmed);
  const expCheckDigit = computeMrzCheckDigit(expTrimmed);
  const optCheckDigit = computeMrzCheckDigit(optRes.field);

  // Composite check digit in TD3 covers:
  // Line 2 positions 1–10 (docNum + check) + 14–20 (dob + check) + 22–43 (exp + check + opt + check)
  const compositeSource = `${docNumRes.field}${docNumCheckDigit}${dobTrimmed}${dobCheckDigit}${expTrimmed}${expCheckDigit}${optRes.field}${optCheckDigit}`;
  const compositeCheckDigit = computeMrzCheckDigit(compositeSource);

  const line2 = `${docNumRes.field}${docNumCheckDigit}${natRes.code}${dobTrimmed}${dobCheckDigit}${sexRes.code}${expTrimmed}${expCheckDigit}${optRes.field}${optCheckDigit}${compositeCheckDigit}`;

  const validation = validateTd3Mrz({ line1, line2 });

  return {
    success: true,
    documentType: 'TD3',
    mrz: {
      line1,
      line2,
    },
    validation: {
      structure: validation.valid,
      checkDigits: validation.checks.checkDigits === 'PASS',
    },
    checkDigits: {
      documentNumber: docNumCheckDigit,
      dateOfBirth: dobCheckDigit,
      expiryDate: expCheckDigit,
      optionalData: optCheckDigit,
      composite: compositeCheckDigit,
    },
    normalization: nameRes.report,
    authenticityNotice: MRZ_AUTHENTICITY_NOTICE,
  };
}

/**
 * Extracts raw lines from an MRZ input (string with newline or { line1, line2 } object).
 */
export function splitMrzLines(input: string | { line1: string; line2: string }): string[] {
  if (typeof input === 'string') {
    const trimmed = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rawLines = trimmed.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    return rawLines;
  }
  if (input && typeof input === 'object' && typeof input.line1 === 'string' && typeof input.line2 === 'string') {
    return [input.line1.trim(), input.line2.trim()];
  }
  return [];
}

/**
 * Validates a TD3 MRZ string or line pair against ICAO Doc 9303 structural, character, date,
 * and check-digit rules.
 */
export function validateTd3Mrz(input: string | { line1: string; line2: string }): MrzValidationResult {
  const lines = splitMrzLines(input);
  const reasons: string[] = [];

  const line1 = lines[0] ?? '';
  const line2 = lines[1] ?? '';

  const lineCountOk = lines.length === 2;
  if (!lineCountOk) {
    reasons.push(`Expected exactly 2 MRZ lines for TD3 format, received ${lines.length} line(s).`);
  }

  const lineLengthOk = lineCountOk && line1.length === 44 && line2.length === 44;
  if (lineCountOk && !lineLengthOk) {
    reasons.push(
      `Invalid line length: TD3 requires 44 characters per line (Line 1 is ${line1.length} chars, Line 2 is ${line2.length} chars).`
    );
  }

  // Character set validation across both lines
  const allowedCharsetRegex = /^[A-Z0-9<]+$/;
  const line1CharsetOk = line1.length > 0 && allowedCharsetRegex.test(line1);
  const line2CharsetOk = line2.length > 0 && allowedCharsetRegex.test(line2);

  if (!line1CharsetOk && line1.length > 0) {
    reasons.push('Line 1 contains invalid characters outside the ICAO MRZ character set (A–Z, 0–9, <).');
  }
  if (!line2CharsetOk && line2.length > 0) {
    reasons.push('Line 2 contains invalid characters outside the ICAO MRZ character set (A–Z, 0–9, <).');
  }

  // Document type check (Line 1, pos 1–2)
  const docTypeSlice = line1.slice(0, 2);
  const docFormatOk = lineCountOk && /^P[A-Z<]$/.test(docTypeSlice);
  if (!docFormatOk) {
    reasons.push(
      `Invalid document format "${docTypeSlice || 'empty'}" at Line 1 positions 1–2 (TD3 passport must begin with "P<" or "P" + A–Z).`
    );
  }

  // Issuing state check (Line 1, pos 3–5)
  const issuingSlice = line1.slice(2, 5);
  const issuingOk = /^[A-Z]{3}$/.test(issuingSlice) || issuingSlice === 'D<<';
  if (!issuingOk) {
    reasons.push(
      `Invalid issuing state code "${issuingSlice || 'empty'}" at Line 1 positions 3–5 (must be 3 letters A–Z or D<<).`
    );
  }

  // Name field structure & characters (Line 1, pos 6–44)
  const nameSlice = line1.slice(5, 44);
  const nameCharsOk = nameSlice.length === 39 && /^[A-Z<]{39}$/.test(nameSlice);
  if (!nameCharsOk && line1.length === 44) {
    reasons.push('Line 1 name field (positions 6–44) contains digits or invalid characters; only A–Z and "<" are allowed.');
  }

  const nameParts = nameSlice.split('<<');
  const primaryId = (nameParts[0] ?? '').replace(/<+/g, ' ').trim();
  const hasDoubleSeparator = nameSlice.includes('<<');
  const nameStructureOk = nameCharsOk && hasDoubleSeparator && primaryId.length > 0;
  if (line1.length === 44 && !hasDoubleSeparator) {
    reasons.push('Line 1 name field (positions 6–44) is missing the mandatory "<<" separator between surname and given names.');
  } else if (line1.length === 44 && primaryId.length === 0) {
    reasons.push('Line 1 primary identifier (surname) cannot be empty.');
  }

  // Line 2 subfields
  const docNumField = line2.slice(0, 9);
  const docNumCheckChar = line2.slice(9, 10);
  const nationalitySlice = line2.slice(10, 13);
  const dobField = line2.slice(13, 19);
  const dobCheckChar = line2.slice(19, 20);
  const sexChar = line2.slice(20, 21);
  const expField = line2.slice(21, 27);
  const expCheckChar = line2.slice(27, 28);
  const optField = line2.slice(28, 42);
  const optCheckChar = line2.slice(42, 43);
  const compositeCheckChar = line2.slice(43, 44);

  const docNumFormatOk =
    docNumField.length === 9 &&
    /^[A-Z0-9<]{9}$/.test(docNumField) &&
    docNumField.replace(/</g, '').length > 0 &&
    /^[0-9]$/.test(docNumCheckChar);
  if (!docNumFormatOk) {
    reasons.push('Invalid document number format or non-numeric document number check digit at Line 2 positions 1–10.');
  }

  const nationalityOk = /^[A-Z]{3}$/.test(nationalitySlice) || nationalitySlice === 'D<<';
  if (!nationalityOk) {
    reasons.push(
      `Invalid nationality code "${nationalitySlice || 'empty'}" at Line 2 positions 11–13 (must be 3 letters A–Z or D<<).`
    );
  }

  const dobDateValidation = isValidMrzDateYYMMDD(dobField);
  const dobFormatOk = dobDateValidation.valid && /^[0-9]$/.test(dobCheckChar);
  if (!dobDateValidation.valid) {
    reasons.push(`Invalid date of birth at Line 2 positions 14–19: ${dobDateValidation.reason}`);
  } else if (!/^[0-9]$/.test(dobCheckChar)) {
    reasons.push('Date of birth check digit at Line 2 position 20 must be a numeric digit (0–9).');
  }

  const sexOk = sexChar === 'M' || sexChar === 'F' || sexChar === '<';
  if (!sexOk) {
    reasons.push(`Invalid sex indicator "${sexChar || 'empty'}" at Line 2 position 21 (must be M, F, or <).`);
  }

  const expDateValidation = isValidMrzDateYYMMDD(expField);
  const expFormatOk = expDateValidation.valid && /^[0-9]$/.test(expCheckChar);
  if (!expDateValidation.valid) {
    reasons.push(`Invalid expiry date at Line 2 positions 22–27: ${expDateValidation.reason}`);
  } else if (!/^[0-9]$/.test(expCheckChar)) {
    reasons.push('Expiry date check digit at Line 2 position 28 must be a numeric digit (0–9).');
  }

  const optFormatOk =
    optField.length === 14 &&
    /^[A-Z0-9<]{14}$/.test(optField) &&
    /^[0-9<]$/.test(optCheckChar);
  if (!optFormatOk) {
    reasons.push('Invalid optional data field or check digit at Line 2 positions 29–43.');
  }

  const compositeFormatOk = /^[0-9]$/.test(compositeCheckChar);
  if (!compositeFormatOk) {
    reasons.push('Composite check digit at Line 2 position 44 must be a numeric digit (0–9).');
  }

  // Compute check digits if line2 has valid MRZ characters
  const checkDigitDetails: MrzCheckDigitDetail[] = [];
  let docNumCheckOk = false;
  let dobCheckOk = false;
  let expCheckOk = false;
  let optCheckOk = false;
  let compositeCheckOk = false;

  if (line2.length === 44 && line2CharsetOk) {
    const docCalc = computeMrzCheckDigitDetailed(docNumField);
    docNumCheckOk = docNumFormatOk && docCalc.checkDigit === docNumCheckChar;
    checkDigitDetails.push({
      field: 'documentNumber',
      label: 'Document number check digit (Line 2, pos 10)',
      sourceSegment: docNumField,
      expected: docCalc.checkDigit,
      actual: docNumCheckChar,
      valid: docNumCheckOk,
      weightedSum: docCalc.weightedSum,
    });
    if (!docNumCheckOk) {
      reasons.push(
        `Check digit mismatch for document number: expected "${docCalc.checkDigit}", found "${docNumCheckChar}".`
      );
    }

    const dobCalc = computeMrzCheckDigitDetailed(dobField);
    dobCheckOk = dobFormatOk && dobCalc.checkDigit === dobCheckChar;
    checkDigitDetails.push({
      field: 'dateOfBirth',
      label: 'Date of birth check digit (Line 2, pos 20)',
      sourceSegment: dobField,
      expected: dobCalc.checkDigit,
      actual: dobCheckChar,
      valid: dobCheckOk,
      weightedSum: dobCalc.weightedSum,
    });
    if (!dobCheckOk) {
      reasons.push(
        `Check digit mismatch for date of birth: expected "${dobCalc.checkDigit}", found "${dobCheckChar}".`
      );
    }

    const expCalc = computeMrzCheckDigitDetailed(expField);
    expCheckOk = expFormatOk && expCalc.checkDigit === expCheckChar;
    checkDigitDetails.push({
      field: 'expiryDate',
      label: 'Expiry date check digit (Line 2, pos 28)',
      sourceSegment: expField,
      expected: expCalc.checkDigit,
      actual: expCheckChar,
      valid: expCheckOk,
      weightedSum: expCalc.weightedSum,
    });
    if (!expCheckOk) {
      reasons.push(
        `Check digit mismatch for expiry date: expected "${expCalc.checkDigit}", found "${expCheckChar}".`
      );
    }

    const optCalc = computeMrzCheckDigitDetailed(optField);
    const isOptAllFiller = optField === '<'.repeat(14);
    // Per ICAO Doc 9303 Part 4, when optional data is all '<', position 43 may be '0' or '<'.
    optCheckOk =
      optFormatOk &&
      (optCalc.checkDigit === optCheckChar || (isOptAllFiller && optCheckChar === '<'));
    checkDigitDetails.push({
      field: 'optionalData',
      label: 'Optional data check digit (Line 2, pos 43)',
      sourceSegment: optField,
      expected: isOptAllFiller && optCheckChar === '<' ? '<' : optCalc.checkDigit,
      actual: optCheckChar,
      valid: optCheckOk,
      weightedSum: optCalc.weightedSum,
    });
    if (!optCheckOk) {
      reasons.push(
        `Check digit mismatch for optional data: expected "${optCalc.checkDigit}", found "${optCheckChar}".`
      );
    }

    const compositeSource = `${docNumField}${docNumCheckChar}${dobField}${dobCheckChar}${expField}${expCheckChar}${optField}${optCheckChar}`;
    const compCalc = computeMrzCheckDigitDetailed(compositeSource);
    compositeCheckOk = compositeFormatOk && compCalc.checkDigit === compositeCheckChar;
    checkDigitDetails.push({
      field: 'composite',
      label: 'Composite check digit (Line 2, pos 44)',
      sourceSegment: compositeSource,
      expected: compCalc.checkDigit,
      actual: compositeCheckChar,
      valid: compositeCheckOk,
      weightedSum: compCalc.weightedSum,
    });
    if (!compositeCheckOk) {
      reasons.push(
        `Check digit mismatch for composite check data: expected "${compCalc.checkDigit}", found "${compositeCheckChar}".`
      );
    }
  }

  const allCheckDigitsOk = docNumCheckOk && dobCheckOk && expCheckOk && optCheckOk && compositeCheckOk;
  const characterValidationOk =
    line1CharsetOk &&
    line2CharsetOk &&
    nameCharsOk &&
    issuingOk &&
    nationalityOk &&
    sexOk &&
    docNumFormatOk &&
    optFormatOk;
  const structuralOk = lineCountOk && lineLengthOk && docFormatOk && nameStructureOk;

  const checks: MrzValidationChecks = {
    documentFormat: docFormatOk ? 'PASS' : 'FAIL',
    lineLength: lineLengthOk ? 'PASS' : 'FAIL',
    documentNumber: docNumFormatOk && docNumCheckOk ? 'PASS' : 'FAIL',
    dateOfBirth: dobFormatOk && dobCheckOk ? 'PASS' : 'FAIL',
    expiryDate: expFormatOk && expCheckOk ? 'PASS' : 'FAIL',
    checkDigits: allCheckDigitsOk ? 'PASS' : 'FAIL',
    characterValidation: characterValidationOk ? 'PASS' : 'FAIL',
    issuingState: issuingOk ? 'PASS' : 'FAIL',
    nationality: nationalityOk ? 'PASS' : 'FAIL',
    sex: sexOk ? 'PASS' : 'FAIL',
    optionalData: optFormatOk && optCheckOk ? 'PASS' : 'FAIL',
    compositeCheckDigit: compositeCheckOk ? 'PASS' : 'FAIL',
    structuralValidity: structuralOk ? 'PASS' : 'FAIL',
  };

  const valid =
    structuralOk &&
    characterValidationOk &&
    dobFormatOk &&
    expFormatOk &&
    allCheckDigitsOk &&
    reasons.length === 0;

  return {
    valid,
    status: valid ? 'VALID' : 'INVALID',
    documentFormat: 'TD3',
    summary: valid ? 'MRZ structure is valid.' : 'MRZ validation failed.',
    reasons,
    lineCount: lines.length,
    lineLengths: [line1.length, line2.length],
    checks,
    checkDigitDetails,
    authenticityVerified: false,
    authenticityNotice: MRZ_AUTHENTICITY_NOTICE,
  };
}

/**
 * Parses a TD3 MRZ string into structured fields and explicitly separates
 * "Successfully parsed" from "Authenticity verified" (which is always false).
 */
export function parseTd3Mrz(input: string | { line1: string; line2: string }): MrzParseResult {
  const lines = splitMrzLines(input);
  const validation = validateTd3Mrz(input);

  if (lines.length !== 2 || lines[0]!.length !== 44 || lines[1]!.length !== 44) {
    return {
      success: false,
      parsedStatus: 'Parse failed',
      structureValid: false,
      authenticityVerified: false,
      authenticityStatus: 'Not verified — MRZ format and check-digit validation only',
      authenticityNotice: MRZ_AUTHENTICITY_NOTICE,
      fields: null,
      validation,
    };
  }

  const line1 = lines[0]!;
  const line2 = lines[1]!;

  const docTypeRaw = line1.slice(0, 2);
  const issuingState = line1.slice(2, 5).replace(/<+$/, '');
  const nameField = line1.slice(5, 44);
  const [rawSurnamePart = '', ...rawGivenParts] = nameField.split('<<');
  const rawGivenPart = rawGivenParts.join(' ');

  const surname = rawSurnamePart.replace(/<+/g, ' ').trim();
  const givenNames = rawGivenPart.replace(/<+/g, ' ').trim();

  const documentNumber = line2.slice(0, 9).replace(/<+$/, '');
  const nationality = line2.slice(10, 13).replace(/<+$/, '');
  const dateOfBirth = line2.slice(13, 19);
  const sexRaw = line2.slice(20, 21);
  const sexCode: MrzSexCode = sexRaw === 'M' || sexRaw === 'F' ? sexRaw : '<';
  const sexLabel: MrzSexLabel = sexRaw === 'M' ? 'Male' : sexRaw === 'F' ? 'Female' : 'Unspecified';
  const expiryDate = line2.slice(21, 27);
  const optionalData = line2.slice(28, 42).replace(/<+$/, '');

  return {
    success: true,
    parsedStatus: 'Successfully parsed',
    structureValid: validation.valid,
    authenticityVerified: false,
    authenticityStatus: 'Not verified — MRZ format and check-digit validation only',
    authenticityNotice: MRZ_AUTHENTICITY_NOTICE,
    fields: {
      documentType: docTypeRaw.replace(/<+$/, '') || 'P',
      documentFormat: 'TD3',
      issuingState,
      surname,
      givenNames,
      nationality,
      documentNumber,
      dateOfBirth,
      sex: sexLabel,
      sexCode,
      expiryDate,
      optionalData: optionalData || 'None',
      checkDigitStatus: validation.checks.checkDigits,
    },
    validation,
  };
}

/**
 * Pool of obviously synthetic test specimens for software/OCR/parser testing.
 * Uses ICAO Doc 9303 reserved test state codes (UTO = Utopia, XXA/XXB/XXC = stateless/test)
 * and explicit "TEST" / "SPECIMEN" / "SYNTHETIC" names and document numbers.
 */
const SYNTHETIC_SPECIMENS: ReadonlyArray<{
  documentType: string;
  issuingState: string;
  surname: string;
  givenNames: string;
  nationality: string;
  dateOfBirth: string;
  sex: MrzSexCode;
  documentNumberPrefix: string;
  expiryDate: string;
  optionalData: string;
}> = [
  {
    documentType: 'P<',
    issuingState: 'UTO',
    surname: 'TEST PERSON',
    givenNames: 'SYNTHETIC SPECIMEN',
    nationality: 'UTO',
    dateOfBirth: '850115',
    sex: '<',
    documentNumberPrefix: 'TEST',
    expiryDate: '321231',
    optionalData: 'TEST DOCUMENT',
  },
  {
    documentType: 'P<',
    issuingState: 'UTO',
    surname: 'SPECIMEN HOLDER',
    givenNames: 'QA AUTOMATION',
    nationality: 'UTO',
    dateOfBirth: '900620',
    sex: 'F',
    documentNumberPrefix: 'SPEC',
    expiryDate: '330630',
    optionalData: 'SYNTHETIC0001',
  },
  {
    documentType: 'P<',
    issuingState: 'XXA',
    surname: 'DEVELOPER TEST',
    givenNames: 'MRZ PARSER CASE',
    nationality: 'XXA',
    dateOfBirth: '781105',
    sex: 'M',
    documentNumberPrefix: 'TEST',
    expiryDate: '311015',
    optionalData: 'SANDBOX ONLY',
  },
  {
    documentType: 'P<',
    issuingState: 'UTO',
    surname: 'SAMPLE TRAVELER',
    givenNames: 'TEST IDENTITY',
    nationality: 'UTO',
    dateOfBirth: '950328',
    sex: '<',
    documentNumberPrefix: 'MOCK',
    expiryDate: '340101',
    optionalData: 'TEST PASSPORT',
  },
];

let syntheticCounter = 0;

/**
 * Generates clearly labeled synthetic test data for software testing.
 * Never uses real personal identities.
 */
export function generateSyntheticTestData(seedIndex?: number): MrzSyntheticTestData {
  const index =
    typeof seedIndex === 'number' && Number.isFinite(seedIndex)
      ? Math.abs(Math.floor(seedIndex)) % SYNTHETIC_SPECIMENS.length
      : syntheticCounter++ % SYNTHETIC_SPECIMENS.length;

  const template = SYNTHETIC_SPECIMENS[index]!;
  const suffixNum = String(10001 + ((index * 1337 + syntheticCounter) % 89999)).slice(0, 5);
  const documentNumber = `${template.documentNumberPrefix}${suffixNum}`;

  const generated = generateTd3Mrz({
    documentType: template.documentType,
    issuingState: template.issuingState,
    surname: template.surname,
    givenNames: template.givenNames,
    nationality: template.nationality,
    dateOfBirth: template.dateOfBirth,
    sex: template.sex,
    documentNumber,
    expiryDate: template.expiryDate,
    optionalData: template.optionalData,
  });

  if (!generated.success) {
    throw new Error(`Synthetic test template failed validation: ${generated.message}`);
  }

  const sexLabel: MrzSexLabel =
    template.sex === 'M' ? 'Male' : template.sex === 'F' ? 'Female' : 'Unspecified';

  return {
    synthetic: true,
    label: 'SYNTHETIC TEST DATA — FOR SOFTWARE DEVELOPMENT & TESTING ONLY',
    disclaimer:
      'Synthetic test specimen generated using reserved ICAO test codes (UTO / XXA). Does not represent any real person or government-issued identity document.',
    fields: {
      documentType: template.documentType,
      issuingState: template.issuingState,
      surname: template.surname,
      givenNames: template.givenNames,
      nationality: template.nationality,
      dateOfBirth: template.dateOfBirth,
      sex: template.sex,
      sexLabel,
      documentNumber,
      expiryDate: template.expiryDate,
      optionalData: template.optionalData,
    },
    mrz: generated.mrz,
  };
}

/**
 * CloudHost247 Native AI deterministic explanation engine for MRZ Calculator, Validator & Parser.
 * Uses the actual calculator/validator/parser output to explain MRZ concepts, field breakdown,
 * check-digit failures, format rules, and input validation errors without fabricating claims or
 * ever claiming that an MRZ represents an authentic government-issued document.
 */
export function explainMrzWithAi(request: MrzAiExplanationTopic): MrzAiExplanationResult {
  const sections: Array<{ heading: string; body: string }> = [];

  // Always include what an MRZ and TD3 format are
  sections.push({
    heading: 'What an MRZ Is (ICAO Doc 9303)',
    body: 'A Machine Readable Zone (MRZ) is a fixed-width, OCR-B formatted text block standardized by ICAO Doc 9303 for optical character recognition and automated software parsing. In TD3 passport format, the MRZ consists of 2 lines of 44 characters each (88 characters total) using only uppercase Latin letters (A–Z), digits (0–9), and the filler character (<).',
  });

  if (request.inputErrors && request.inputErrors.length > 0) {
    sections.push({
      heading: 'Why the Input Was Rejected',
      body: request.inputErrors
        .map(
          (err) =>
            `• Field "${err.field}" (${err.code}): ${err.message} CloudHost247 refuses to silently drop unsupported characters or truncate overflowing fields so your test suite never receives an unintended MRZ.`
        )
        .join('\n'),
    });
  }

  if (request.mrz) {
    const parsed = parseTd3Mrz(request.mrz);
    const val = parsed.validation;

    if (parsed.fields) {
      const f = parsed.fields;
      sections.push({
        heading: 'Field-by-Field Breakdown of Current MRZ',
        body: [
          `• Line 1, Pos 1–2 (Document Type): "${f.documentType}" — Designates a TD3 passport-size Machine Readable Travel Document.`,
          `• Line 1, Pos 3–5 (Issuing State): "${f.issuingState}" — 3-letter ICAO state/organization code.`,
          `• Line 1, Pos 6–44 (Identifiers): Surname "${f.surname}" separated by "<<" from Given Names "${f.givenNames}", padded with "<" to 39 characters.`,
          `• Line 2, Pos 1–9 & 10 (Document Number & Check Digit): "${f.documentNumber}" (Check digit status: ${val.checks.documentNumber}).`,
          `• Line 2, Pos 11–13 (Nationality): "${f.nationality}".`,
          `• Line 2, Pos 14–19 & 20 (Date of Birth YYMMDD & Check Digit): "${f.dateOfBirth}" (Check digit status: ${val.checks.dateOfBirth}).`,
          `• Line 2, Pos 21 (Sex): "${f.sexCode}" (${f.sex}).`,
          `• Line 2, Pos 22–27 & 28 (Expiry Date YYMMDD & Check Digit): "${f.expiryDate}" (Check digit status: ${val.checks.expiryDate}).`,
          `• Line 2, Pos 29–42 & 43 (Optional Data & Check Digit): "${f.optionalData}" (Check digit status: ${val.checks.optionalData}).`,
          `• Line 2, Pos 44 (Composite Check Digit): Overall check across positions 1–10, 14–20, and 22–43 (Status: ${val.checks.compositeCheckDigit}).`,
        ].join('\n'),
      });
    }

    const failedCheckDigits = val.checkDigitDetails.filter((d) => !d.valid);
    if (failedCheckDigits.length > 0) {
      sections.push({
        heading: 'Why Check Digit Validation Failed (7-3-1 Modulo 10 Analysis)',
        body: failedCheckDigits
          .map(
            (d) =>
              `• ${d.label}: Segment "${d.sourceSegment}" produced a 7-3-1 weighted sum of ${d.weightedSum} (${d.weightedSum} mod 10 = "${d.expected}"), expected "${d.expected}", found "${d.actual}".`
          )
          .join('\n'),
      });
    } else if (val.checkDigitDetails.length > 0) {
      sections.push({
        heading: 'Check Digit Verification (7-3-1 Modulo 10 Analysis)',
        body: val.checkDigitDetails
          .map(
            (d) =>
              `• ${d.label}: Weighted sum = ${d.weightedSum} → ${d.weightedSum} mod 10 = "${d.expected}" (matches "${d.actual}").`
          )
          .join('\n'),
      });
    }

    if (!val.valid && val.reasons.length > 0) {
      sections.push({
        heading: 'Structural & Format Validation Findings',
        body: val.reasons.map((r) => `• ${r}`).join('\n'),
      });
    }
  } else {
    sections.push({
      heading: 'How MRZ Check Digits & Parsing Work',
      body: 'Each protected field (Document Number, Date of Birth, Expiry Date, Optional Data, and the 39-character Composite span) is followed by a single modulo-10 check digit. Characters map to integer values ("<" = 0, "0"–"9" = 0–9, "A"–"Z" = 10–35), are multiplied by repeating weights (7, 3, 1), summed, and reduced modulo 10.',
    });
  }

  sections.push({
    heading: 'Authenticity vs. Mathematical Validity',
    body: MRZ_AUTHENTICITY_NOTICE,
  });

  return {
    topic: request.topic ?? 'overview',
    title: 'CloudHost247 AI — MRZ Technical Explanation',
    summary: request.mrz
      ? 'Explanation generated deterministically from your current MRZ calculator/parser output.'
      : 'Reference explanation of ICAO Doc 9303 TD3 MRZ formatting, normalization, and check digits.',
    sections,
    authenticityVerified: false,
    authenticityDisclaimer: MRZ_AUTHENTICITY_NOTICE,
  };
}

/**
 * Sensitive field names that must NEVER be logged or persisted in audit trails.
 */
const SENSITIVE_MRZ_KEYS = new Set([
  'mrz',
  'line1',
  'line2',
  'surname',
  'givennames',
  'given_names',
  'documentnumber',
  'document_number',
  'passportnumber',
  'passport_number',
  'dateofbirth',
  'date_of_birth',
  'dob',
  'expirydate',
  'expiry_date',
  'nationality',
  'optionaldata',
  'optional_data',
]);

/**
 * Deeply redacts any MRZ/passport personal fields from an arbitrary payload before logging.
 */
export function redactMrzSensitiveData<T>(input: T): T {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    // Redact any string that looks like a 44-char TD3 MRZ line
    if (/^[A-Z0-9<]{30,44}$/.test(input.trim())) {
      return '[REDACTED_MRZ]' as unknown as T;
    }
    return input;
  }
  if (Array.isArray(input)) {
    return input.map((item) => redactMrzSensitiveData(item)) as unknown as T;
  }
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_MRZ_KEYS.has(k.toLowerCase())) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactMrzSensitiveData(v);
      }
    }
    return out as T;
  }
  return input;
}
