import { describe, expect, it } from 'vitest';
import {
  computeMrzCheckDigit,
  computeMrzCheckDigitDetailed,
  explainMrzWithAi,
  generateSyntheticTestData,
  generateTd3Mrz,
  isValidMrzDateYYMMDD,
  mrzCharValue,
  normalizeMrzNameComponent,
  normalizeMrzNameField,
  parseTd3Mrz,
  redactMrzSensitiveData,
  validateTd3Mrz,
} from '../../src/tools/mrz/mrz-engine';
import { retrieveKnowledge } from '../../src/ai/knowledge';

describe('CloudHost247 Native ePassport MRZ Engine (ICAO Doc 9303 TD3)', () => {
  const ICAO_LINE_1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<';
  const ICAO_LINE_2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';

  describe('Check-digit algorithm (7, 3, 1 weights modulo 10)', () => {
    it('maps ICAO MRZ characters to standard numerical values', () => {
      expect(mrzCharValue('<')).toBe(0);
      expect(mrzCharValue('0')).toBe(0);
      expect(mrzCharValue('9')).toBe(9);
      expect(mrzCharValue('A')).toBe(10);
      expect(mrzCharValue('Z')).toBe(35);
      expect(() => mrzCharValue('@')).toThrow();
      expect(() => mrzCharValue('a')).toThrow();
    });

    it('calculates exact check digits matching ICAO Doc 9303 Part 4 Appendix B', () => {
      expect(computeMrzCheckDigit('L898902C3')).toBe('6');
      expect(computeMrzCheckDigit('740812')).toBe('2');
      expect(computeMrzCheckDigit('120415')).toBe('9');
      expect(computeMrzCheckDigit('ZE184226B<<<<<')).toBe('1');
      expect(computeMrzCheckDigit('L898902C3674081221204159ZE184226B<<<<<1')).toBe('0');
    });

    it('returns weighted sum details for check digit calculation', () => {
      const detail = computeMrzCheckDigitDetailed('740812');
      // 7*7(49) + 4*3(12) + 0*1(0) + 8*7(56) + 1*3(3) + 2*1(2) = 122
      expect(detail.weightedSum).toBe(122);
      expect(detail.checkDigit).toBe('2');
    });
  });

  describe('Valid MRZ generation and validation', () => {
    it('generates the exact ICAO Doc 9303 TD3 reference MRZ and passes all validation checks', () => {
      const res = generateTd3Mrz({
        documentType: 'P<',
        issuingState: 'UTO',
        surname: 'ERIKSSON',
        givenNames: 'ANNA MARIA',
        nationality: 'UTO',
        dateOfBirth: '740812',
        sex: 'Female',
        documentNumber: 'L898902C3',
        expiryDate: '120415',
        optionalData: 'ZE184226B',
      });

      expect(res.success).toBe(true);
      if (!res.success) return;

      expect(res.documentType).toBe('TD3');
      expect(res.mrz.line1).toBe(ICAO_LINE_1);
      expect(res.mrz.line2).toBe(ICAO_LINE_2);
      expect(res.mrz.line1).toHaveLength(44);
      expect(res.mrz.line2).toHaveLength(44);
      expect(res.validation.structure).toBe(true);
      expect(res.validation.checkDigits).toBe(true);
      expect(res.checkDigits).toEqual({
        documentNumber: '6',
        dateOfBirth: '2',
        expiryDate: '9',
        optionalData: '1',
        composite: '0',
      });

      const val = validateTd3Mrz(res.mrz);
      expect(val.valid).toBe(true);
      expect(val.status).toBe('VALID');
      expect(val.summary).toBe('MRZ structure is valid.');
      expect(val.reasons).toEqual([]);
      expect(val.authenticityVerified).toBe(false);
      expect(val.checks).toEqual({
        documentFormat: 'PASS',
        lineLength: 'PASS',
        documentNumber: 'PASS',
        dateOfBirth: 'PASS',
        expiryDate: 'PASS',
        checkDigits: 'PASS',
        characterValidation: 'PASS',
        issuingState: 'PASS',
        nationality: 'PASS',
        sex: 'PASS',
        optionalData: 'PASS',
        compositeCheckDigit: 'PASS',
        structuralValidity: 'PASS',
      });
    });

    it('supports Male, Female, and Unspecified sex options and Germany D<< state code', () => {
      const res = generateTd3Mrz({
        documentType: 'P',
        issuingState: 'D',
        surname: 'MÜLLER',
        givenNames: 'HANS JÜRGEN',
        nationality: 'D<<',
        dateOfBirth: '880229', // leap year 88
        sex: 'Unspecified',
        documentNumber: 'C01X00T47',
        expiryDate: '301231',
      });

      expect(res.success).toBe(true);
      if (!res.success) return;
      expect(res.mrz.line1.startsWith('P<D<<MUELLER<<HANS<JUERGEN<')).toBe(true);
      expect(res.mrz.line1).toHaveLength(44);
      expect(res.mrz.line2).toHaveLength(44);
      expect(res.mrz.line2[20]).toBe('<');
      expect(validateTd3Mrz(res.mrz).valid).toBe(true);
    });
  });

  describe('Invalid MRZ detection', () => {
    it('fails on incorrect line length or wrong number of lines', () => {
      const singleLine = validateTd3Mrz(ICAO_LINE_1);
      expect(singleLine.valid).toBe(false);
      expect(singleLine.status).toBe('INVALID');
      expect(singleLine.summary).toBe('MRZ validation failed.');
      expect(singleLine.checks.lineLength).toBe('FAIL');

      const shortLine = validateTd3Mrz({
        line1: ICAO_LINE_1.slice(0, 42),
        line2: ICAO_LINE_2,
      });
      expect(shortLine.valid).toBe(false);
      expect(shortLine.checks.lineLength).toBe('FAIL');
      expect(shortLine.reasons.some((r) => r.includes('44 characters'))).toBe(true);
    });

    it('fails on invalid characters in Line 1 or Line 2', () => {
      const badCharLine1 = validateTd3Mrz({
        line1: 'P<UTOERIKSSON<<ANNA<MARIA123<<<<<<<<<<<<<<<<',
        line2: ICAO_LINE_2,
      });
      expect(badCharLine1.valid).toBe(false);
      expect(badCharLine1.checks.characterValidation).toBe('FAIL');

      const lowercaseMrz = validateTd3Mrz({
        line1: ICAO_LINE_1.toLowerCase(),
        line2: ICAO_LINE_2,
      });
      expect(lowercaseMrz.valid).toBe(false);
      expect(lowercaseMrz.checks.characterValidation).toBe('FAIL');
    });

    it('fails on invalid calendar dates in YYMMDD format', () => {
      expect(isValidMrzDateYYMMDD('851301').valid).toBe(false); // month 13
      expect(isValidMrzDateYYMMDD('850229').valid).toBe(false); // 85 is not divisible by 4
      expect(isValidMrzDateYYMMDD('840229').valid).toBe(true);  // 84 is leap year
      expect(isValidMrzDateYYMMDD('850431').valid).toBe(false); // April has 30 days

      // Construct line2 with invalid DOB 741312 and its check digit
      const badDobCheck = computeMrzCheckDigit('741312');
      const badLine2 = `L898902C36UTO741312${badDobCheck}F1204159ZE184226B<<<<<10`;
      const val = validateTd3Mrz({ line1: ICAO_LINE_1, line2: badLine2 });
      expect(val.valid).toBe(false);
      expect(val.checks.dateOfBirth).toBe('FAIL');
    });

    it('fails on incorrect document number check digit', () => {
      // Flip position 10 from '6' to '7'
      const line2 = ICAO_LINE_2.slice(0, 9) + '7' + ICAO_LINE_2.slice(10);
      const val = validateTd3Mrz({ line1: ICAO_LINE_1, line2 });
      expect(val.valid).toBe(false);
      expect(val.checks.documentNumber).toBe('FAIL');
      expect(val.checks.checkDigits).toBe('FAIL');
      expect(val.reasons.some((r) => r.includes('document number'))).toBe(true);
    });

    it('fails on incorrect date of birth check digit', () => {
      // Flip position 20 from '2' to '5'
      const line2 = ICAO_LINE_2.slice(0, 19) + '5' + ICAO_LINE_2.slice(20);
      const val = validateTd3Mrz({ line1: ICAO_LINE_1, line2 });
      expect(val.valid).toBe(false);
      expect(val.checks.dateOfBirth).toBe('FAIL');
      expect(val.checks.checkDigits).toBe('FAIL');
      expect(val.reasons.some((r) => r.includes('date of birth'))).toBe(true);
    });

    it('fails on incorrect expiry date check digit', () => {
      // Flip position 28 from '9' to '4'
      const line2 = ICAO_LINE_2.slice(0, 27) + '4' + ICAO_LINE_2.slice(28);
      const val = validateTd3Mrz({ line1: ICAO_LINE_1, line2 });
      expect(val.valid).toBe(false);
      expect(val.checks.expiryDate).toBe('FAIL');
      expect(val.checks.checkDigits).toBe('FAIL');
      expect(val.reasons.some((r) => r.includes('expiry date'))).toBe(true);
    });

    it('fails on incorrect composite check digit', () => {
      // Flip position 44 from '0' to '8'
      const line2 = ICAO_LINE_2.slice(0, 43) + '8';
      const val = validateTd3Mrz({ line1: ICAO_LINE_1, line2 });
      expect(val.valid).toBe(false);
      expect(val.checks.compositeCheckDigit).toBe('FAIL');
      expect(val.checks.checkDigits).toBe('FAIL');
      expect(val.reasons.some((r) => r.includes('composite'))).toBe(true);
    });
  });

  describe('Input normalization & validation rules', () => {
    it('normalizes lowercase names, spaces, hyphens, apostrophes, and European diacritics', () => {
      const surnameRes = normalizeMrzNameComponent("o'connor-müller", 'Surname');
      expect(surnameRes.ok).toBe(true);
      if (surnameRes.ok) {
        expect(surnameRes.stage.transliterated).toBe('OCONNOR MUELLER');
        expect(surnameRes.stage.mrzCompatible).toBe('OCONNOR<MUELLER');
      }

      const givenRes = normalizeMrzNameComponent('françois   göran   ørsted   łukasz   åström', 'Given names');
      expect(givenRes.ok).toBe(true);
      if (givenRes.ok) {
        expect(givenRes.stage.mrzCompatible).toBe('FRANCOIS<GOERAN<OERSTED<LUKASZ<AASTROEM');
      }
    });

    it('rejects special characters, digits, HTML tags, and non-Latin scripts in names without silently stripping', () => {
      expect(normalizeMrzNameComponent('SMITH123', 'Surname').ok).toBe(false);
      expect(normalizeMrzNameComponent('<script>alert(1)</script>', 'Surname').ok).toBe(false);
      expect(normalizeMrzNameComponent('DOE@EXAMPLE', 'Surname').ok).toBe(false);
      expect(normalizeMrzNameComponent('ИВАНОВ', 'Surname').ok).toBe(false);
    });

    it('rejects missing values and excessively long values', () => {
      const missingRes = generateTd3Mrz({
        documentType: 'P<',
        issuingState: '',
        surname: '',
        givenNames: '',
        nationality: '',
        dateOfBirth: '',
        sex: '',
        documentNumber: '',
        expiryDate: '',
      });
      expect(missingRes.success).toBe(false);
      if (!missingRes.success) {
        expect(missingRes.errors.length).toBeGreaterThanOrEqual(6);
      }

      const overflowName = normalizeMrzNameField(
        'ALEXANDERSSONVANDERBERGHENRIKSSON',
        'CHRISTOPHERMAXIMILIANFERDINAND'
      );
      expect(overflowName.ok).toBe(false);
      if (!overflowName.ok) {
        expect(overflowName.errors[0]?.code).toBe('NAME_FIELD_OVERFLOW');
      }

      const longDoc = generateTd3Mrz({
        documentType: 'P<',
        issuingState: 'UTO',
        surname: 'TEST',
        givenNames: 'PERSON',
        nationality: 'UTO',
        dateOfBirth: '850115',
        sex: 'M',
        documentNumber: '12345678901', // 11 chars > 9 max
        expiryDate: '321231',
      });
      expect(longDoc.success).toBe(false);
    });
  });

  describe('MRZ Parser & non-authenticity distinction', () => {
    it('parses a valid TD3 MRZ into structured fields and explicitly marks authenticityVerified as false', () => {
      const parsed = parseTd3Mrz(`${ICAO_LINE_1}\n${ICAO_LINE_2}`);
      expect(parsed.success).toBe(true);
      expect(parsed.parsedStatus).toBe('Successfully parsed');
      expect(parsed.structureValid).toBe(true);
      expect(parsed.authenticityVerified).toBe(false);
      expect(parsed.authenticityStatus).toContain('Not verified');
      expect(parsed.fields).toEqual({
        documentType: 'P',
        documentFormat: 'TD3',
        issuingState: 'UTO',
        surname: 'ERIKSSON',
        givenNames: 'ANNA MARIA',
        nationality: 'UTO',
        documentNumber: 'L898902C3',
        dateOfBirth: '740812',
        sex: 'Female',
        sexCode: 'F',
        expiryDate: '120415',
        optionalData: 'ZE184226B',
        checkDigitStatus: 'PASS',
      });
    });

    it('reports checkDigitStatus FAIL when parsing a structurally 2x44 MRZ with a corrupted check digit', () => {
      const corruptedLine2 = ICAO_LINE_2.slice(0, 43) + '9';
      const parsed = parseTd3Mrz({ line1: ICAO_LINE_1, line2: corruptedLine2 });
      expect(parsed.success).toBe(true);
      expect(parsed.parsedStatus).toBe('Successfully parsed');
      expect(parsed.structureValid).toBe(false);
      expect(parsed.authenticityVerified).toBe(false);
      expect(parsed.fields?.checkDigitStatus).toBe('FAIL');
    });
  });

  describe('Synthetic test data & CloudHost247 AI integration', () => {
    it('generates clearly labeled synthetic test specimens that pass TD3 validation', () => {
      const specimen = generateSyntheticTestData(0);
      expect(specimen.synthetic).toBe(true);
      expect(specimen.label).toContain('SYNTHETIC TEST DATA');
      expect(['UTO', 'XXA']).toContain(specimen.fields.issuingState);
      expect(validateTd3Mrz(specimen.mrz).valid).toBe(true);
    });

    it('explains MRZ fields and check digit failures using actual calculator/parser output and never claims authenticity', () => {
      const corruptedLine2 = ICAO_LINE_2.slice(0, 9) + '9' + ICAO_LINE_2.slice(10);
      const explanation = explainMrzWithAi({
        topic: 'check_digits',
        mrz: { line1: ICAO_LINE_1, line2: corruptedLine2 },
      });

      expect(explanation.authenticityVerified).toBe(false);
      expect(explanation.authenticityDisclaimer).toContain('does NOT verify');
      const checkDigitSection = explanation.sections.find((s) =>
        s.heading.includes('Why Check Digit Validation Failed')
      );
      expect(checkDigitSection).toBeDefined();
      expect(checkDigitSection?.body).toContain('expected "6", found "9"');

      // Also verify knowledge base retrieval for AI support widget
      const kb = retrieveKnowledge('How does the ePassport MRZ calculator check digit work?');
      expect(kb?.id).toBe('mrz-developer-tool');
    });

    it('redacts sensitive MRZ fields from arbitrary objects', () => {
      const redacted = redactMrzSensitiveData({
        tool: 'mrz_calculator',
        surname: 'ERIKSSON',
        givenNames: 'ANNA MARIA',
        documentNumber: 'L898902C3',
        dateOfBirth: '740812',
        nationality: 'UTO',
        mrz: {
          line1: ICAO_LINE_1,
          line2: ICAO_LINE_2,
        },
      });

      expect(redacted.tool).toBe('mrz_calculator');
      expect(redacted.surname).toBe('[REDACTED]');
      expect(redacted.givenNames).toBe('[REDACTED]');
      expect(redacted.documentNumber).toBe('[REDACTED]');
      expect(redacted.dateOfBirth).toBe('[REDACTED]');
      expect(redacted.nationality).toBe('[REDACTED]');
      expect(redacted.mrz).toBe('[REDACTED]');
    });
  });
});
