import { describe, expect, it } from 'vitest';
import {
  detectTdFormat,
  generateTdMrz,
  mrzName,
  splitName,
  validateTdMrz,
} from '../../src/tools/mrz/td-formats';
import { MRZ_AUTHENTICITY_NOTICE } from '../../src/tools/mrz/mrz-engine';

// ICAO Doc 9303 Part 5 specimen (TD1). Check digits 7, 2, 9 and composite 6 come from the specimen.
const TD1_SPECIMEN = [
  'I<UTOD231458907<<<<<<<<<<<<<<<',
  '7408122F1204159UTO<<<<<<<<<<<6',
  'ERIKSSON<<ANNA<MARIA<<<<<<<<<<',
];

// ICAO Doc 9303 Part 4 specimen (TD2, same holder as the TD1 specimen).
const TD2_SPECIMEN = [
  'I<UTOERIKSSON<<ANNA<MARIA'.padEnd(36, '<'),
  'D231458907UTO7408122F1204159'.padEnd(35, '<') + '6',
];

const failingChecks = (lines: string[], format: 'TD1' | 'TD2') =>
  Object.entries(validateTdMrz(format, lines).checks)
    .filter(([, status]) => status === 'FAIL')
    .map(([name]) => name);

describe('detectTdFormat', () => {
  it('identifies TD1, TD2, TD3 and unknown layouts from line count and length', () => {
    expect(detectTdFormat(TD1_SPECIMEN)).toBe('TD1');
    expect(detectTdFormat(TD2_SPECIMEN)).toBe('TD2');
    expect(detectTdFormat(['A'.repeat(44), 'B'.repeat(44)])).toBe('TD3');
    expect(detectTdFormat(['short'])).toBe('UNKNOWN');
    expect(detectTdFormat(['A'.repeat(30), 'B'.repeat(36)])).toBe('UNKNOWN');
  });
});

describe('validateTdMrz TD1', () => {
  it('accepts the ICAO specimen and extracts every field', () => {
    const result = validateTdMrz('TD1', TD1_SPECIMEN);
    expect(result.valid).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.fields).toMatchObject({
      documentCode: 'I<',
      issuingState: 'UTO',
      documentNumber: 'D23145890',
      nationality: 'UTO',
      dateOfBirth: '740812',
      sex: 'F',
      expiryDate: '120415',
      surname: 'ERIKSSON',
      givenNames: 'ANNA MARIA',
    });
    expect(result.checkDigits.map((row) => row.status)).toEqual(['PASS', 'PASS', 'PASS', 'PASS']);
    expect(result.authenticityNotice).toBe(MRZ_AUTHENTICITY_NOTICE);
  });

  it('reports a wrong document-number check digit by name, not as a generic failure', () => {
    const lines = [...TD1_SPECIMEN];
    lines[0] = 'I<UTOD231458901<<<<<<<<<<<<<<<';
    expect(failingChecks(lines, 'TD1')).toContain('documentNumberCheck');
    expect(validateTdMrz('TD1', lines).valid).toBe(false);
  });

  it('flags a composite error when optional data changes', () => {
    const lines = [...TD1_SPECIMEN];
    // 'B' (value 11) changes the composite; 'A' would not, because 10 x weight 7 is 0 mod 10.
    lines[0] = 'I<UTOD231458907<<<<<<<<<<<<<<B';
    expect(failingChecks(lines, 'TD1')).toEqual(['compositeCheck']);
  });

  it('rejects the wrong number of lines or line lengths without throwing', () => {
    const short = validateTdMrz('TD1', [TD1_SPECIMEN[0]!, TD1_SPECIMEN[1]!]);
    expect(short.valid).toBe(false);
    expect(short.fields).toBeNull();
    expect(short.reasons[0]).toMatch(/needs 3 lines of 30/);

    const wide = validateTdMrz('TD1', [TD1_SPECIMEN[0]! + '<', TD1_SPECIMEN[1]!, TD1_SPECIMEN[2]!]);
    expect(wide.valid).toBe(false);
  });

  it('rejects lowercase and out-of-alphabet characters', () => {
    const lines = [...TD1_SPECIMEN];
    lines[2] = 'eRIKSSON<<ANNA<MARIA<<<<<<<<<<';
    expect(validateTdMrz('TD1', lines).valid).toBe(false);
  });

  it('rejects impossible dates even when the check digit happens to match', () => {
    const lines = [...TD1_SPECIMEN];
    lines[1] = '7413452F1204159UTO<<<<<<<<<<<6';
    const result = validateTdMrz('TD1', lines);
    expect(result.valid).toBe(false);
    expect(result.checks.dateOfBirthValid).toBe('FAIL');
  });
});

describe('validateTdMrz TD2', () => {
  it('accepts the ICAO specimen and extracts the name and document fields', () => {
    const result = validateTdMrz('TD2', TD2_SPECIMEN);
    expect(result.valid).toBe(true);
    expect(result.fields).toMatchObject({
      documentCode: 'I<',
      issuingState: 'UTO',
      surname: 'ERIKSSON',
      givenNames: 'ANNA MARIA',
      documentNumber: 'D23145890',
      nationality: 'UTO',
      dateOfBirth: '740812',
      sex: 'F',
      expiryDate: '120415',
    });
  });

  it('detects a corrupted expiry check digit', () => {
    const lines = [...TD2_SPECIMEN];
    lines[1] = TD2_SPECIMEN[1]!.slice(0, 27) + '8' + TD2_SPECIMEN[1]!.slice(28);
    expect(failingChecks(lines, 'TD2')).toContain('expiryDateCheck');
  });
});

describe('generateTdMrz', () => {
  const base = {
    issuingState: 'NGA',
    surname: 'Okafor-Bello',
    givenNames: 'Adaeze Chinyere',
    nationality: 'NGA',
    dateOfBirth: '900315',
    sex: 'F',
    documentNumber: 'A1234567',
    expiryDate: '310101',
  };

  it('generates a TD1 MRZ that validates with every check passing', () => {
    const out = generateTdMrz('TD1', { ...base, documentType: 'ID', optionalData: 'OPT12' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.lines).toHaveLength(3);
    expect(out.lines.every((line) => line.length === 30)).toBe(true);
    expect(out.validation.valid).toBe(true);
    expect(out.lines[0]!.slice(0, 2)).toBe('ID');
    expect(out.lines[0]!.slice(15, 20)).toBe('OPT12');
    expect(out.lines[2]).toBe('OKAFOR<BELLO<<ADAEZE<CHINYERE<<<<<<<<'.slice(0, 30));
  });

  it('fills all 15 TD1 optional characters on line 1 and keeps line 2 optional filler', () => {
    const out = generateTdMrz('TD1', { ...base, optionalData: 'X'.repeat(15) });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.lines[0]!.slice(15, 30)).toBe('X'.repeat(15));
    expect(out.validation.valid).toBe(true);
  });

  it('generates a TD2 MRZ that validates', () => {
    const out = generateTdMrz('TD2', { ...base, documentType: 'P' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.lines.every((line) => line.length === 36)).toBe(true);
    expect(out.validation.valid).toBe(true);
    expect(out.validation.fields?.sex).toBe('F');
  });

  it('round-trips: a generated MRZ parses back to the entered identity', () => {
    const out = generateTdMrz('TD1', base);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const parsed = validateTdMrz('TD1', out.mrz.split('\n'));
    expect(parsed.valid).toBe(true);
    expect(parsed.fields?.surname).toBe('OKAFOR BELLO');
    expect(parsed.fields?.givenNames).toBe('ADAEZE CHINYERE');
    expect(parsed.fields?.documentNumber).toBe('A1234567');
  });

  it('refuses inputs that cannot be encoded instead of producing a partial MRZ', () => {
    const bad = generateTdMrz('TD1', { ...base, dateOfBirth: '901340', issuingState: 'NIGERIA' });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.map((e) => e.field)).toEqual(expect.arrayContaining(['dateOfBirth', 'issuingState']));
  });

  it('refuses a name that is too long for TD2', () => {
    const out = generateTdMrz('TD2', { ...base, surname: 'A'.repeat(20), givenNames: 'B'.repeat(20) });
    expect(out.ok).toBe(false);
  });

  it('maps unspecified sex to < and rejects unknown codes', () => {
    const unspecified = generateTdMrz('TD2', { ...base, sex: '' });
    expect(unspecified.ok).toBe(true);
    if (unspecified.ok) expect(unspecified.lines[1]![20]).toBe('<');
    expect(generateTdMrz('TD2', { ...base, sex: 'Q' }).ok).toBe(false);
  });
});

describe('name helpers', () => {
  it('splits surname and given names on the << separator', () => {
    expect(splitName('ERIKSSON<<ANNA<MARIA<<<<')).toEqual({ surname: 'ERIKSSON', givenNames: 'ANNA MARIA' });
    expect(splitName('MONONYM<<<<<')).toEqual({ surname: 'MONONYM', givenNames: '' });
  });

  it('transliterates diacritics and maps spaces and hyphens to <', () => {
    expect(mrzName('Ælfrida Müller-Öz')).toEqual({ ok: false, message: expect.any(String) });
    expect(mrzName('Müller-Öz')).toEqual({ ok: true, value: 'MULLER<OZ' });
    expect(mrzName("O'Brien Smith")).toEqual({ ok: true, value: 'O<BRIEN<SMITH' });
  });
});
