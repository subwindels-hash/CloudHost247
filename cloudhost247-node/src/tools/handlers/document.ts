/**
 * Tools Center — Document category handlers (ICAO Doc 9303 TD3 machine-readable zone).
 *
 * The MRZ engine is a pure function, so the only real risk in this file is retention. The privacy
 * contract, enforced here and by the catalogue entry (`cacheSeconds: 0`, no history target):
 *   • the submitted document fields exist only in memory for the duration of one request;
 *   • nothing in the returned object that the executor persists (the `status`/`summary` keys it
 *     keeps for the execution log and the customer history row) contains the zone or a date of
 *     birth — the persisted summary is a fixed verdict string;
 *   • the executor's cache is disabled for this tool, so no MRZ string is ever written to
 *     `tool_cache`, a report or an export;
 *   • a malformed field is reported with the engine's own message instead of being silently
 *     normalised away, because a generator that quietly changes an identity field is worse than an
 *     error (the same rule the rest of the Tools Center follows).
 *
 * This handler produces machine-readable *text*. It cannot and does not claim that a document is
 * genuine; `MRZ_AUTHENTICITY_NOTICE` travels with every result that could be mistaken for that claim.
 */
import { invalidInput } from '../core/errors';
import {
  generateTd3Mrz,
  parseTd3Mrz,
  validateTd3Mrz,
  MRZ_AUTHENTICITY_NOTICE,
  type MrzGenerateInput,
} from '../mrz/mrz-engine';
import { oneOf, str, type ToolHandler } from './kit';

const MRZ_MODES = ['generate', 'validate', 'parse'] as const;
type MrzMode = (typeof MRZ_MODES)[number];

/**
 * Fixed privacy text returned with every response. It is deliberately part of the payload rather
 * than documentation: the caller can see exactly how the submitted values were handled.
 */
const MRZ_PRIVACY_NOTICE =
  'Submitted fields are processed in memory for this single request. CloudHost247 does not cache, log or permanently store the machine-readable zone, passport number or dates of birth.';

/** Longest value any single MRZ field can carry; anything larger is refused before parsing. */
const MAX_FIELD = 64;
const MAX_MRZ = 256;

/** Reads the caller's MRZ input exactly the way the documented /api/tools/mrz/* API does. */
function readMrzSource(input: Record<string, unknown>): string | { line1: string; line2: string } {
  const single = str(input, 'mrz', { max: MAX_MRZ });
  if (single) return single;
  const line1 = str(input, 'line1', { max: MAX_MRZ });
  const line2 = str(input, 'line2', { max: MAX_MRZ });
  if (line1 && line2) return { line1, line2 };
  throw invalidInput('Provide the two MRZ lines in "mrz", or in "line1" and "line2".');
}

function readGenerateInput(input: Record<string, unknown>): MrzGenerateInput {
  return {
    documentType: str(input, 'documentType', { max: 8 }) || 'P<',
    issuingState: str(input, 'issuingState', { required: true, min: 3, max: 3 }),
    surname: str(input, 'surname', { required: true, min: 1, max: MAX_FIELD }),
    givenNames: str(input, 'givenNames', { required: true, min: 1, max: MAX_FIELD }),
    nationality: str(input, 'nationality', { required: true, min: 3, max: 3 }),
    dateOfBirth: str(input, 'dateOfBirth', { required: true, min: 6, max: 6 }),
    sex: str(input, 'sex', { required: true, max: 16 }),
    documentNumber: str(input, 'documentNumber', { required: true, min: 1, max: 9 }),
    expiryDate: str(input, 'expiryDate', { required: true, min: 6, max: 6 }),
    optionalData: str(input, 'optionalData', { max: 14 }),
  };
}

/** Check-digit table used by both the generator and the validator result. */
function checkDigitRows(validation: ReturnType<typeof validateTd3Mrz>) {
  return validation.checkDigitDetails.map((detail) => ({
    Field: detail.label,
    Expected: detail.expected,
    Found: detail.actual,
    Result: detail.valid ? 'PASS' : 'FAIL',
  }));
}

async function mrzGenerate(input: Record<string, unknown>) {
  const outcome = generateTd3Mrz(readGenerateInput(input));
  if (!outcome.success) {
    // The engine's message names the offending field; nothing else from the input is echoed.
    throw invalidInput(outcome.errors.map((error) => error.message).join(' '));
  }
  return {
    status: outcome.validation.checkDigits && outcome.validation.structure ? 'VALID' : 'INVALID',
    summary:
      outcome.validation.checkDigits && outcome.validation.structure
        ? 'TD3 machine-readable zone generated with valid ICAO Doc 9303 check digits.'
        : 'TD3 machine-readable zone generated, but the resulting structure failed validation.',
    documentType: outcome.documentType,
    lines: { line1: outcome.mrz.line1, line2: outcome.mrz.line2 },
    composed: `${outcome.mrz.line1}\n${outcome.mrz.line2}`,
    structureValid: outcome.validation.structure,
    checkDigits: checkDigitRows(validateTd3Mrz({ line1: outcome.mrz.line1, line2: outcome.mrz.line2 })),
    nameNormalization: {
      surname: outcome.normalization.surname,
      givenNames: outcome.normalization.givenNames,
      combinedIdentifier: outcome.normalization.combinedIdentifier,
      fillerCount: outcome.normalization.fillerCount,
    },
    authenticityNotice: MRZ_AUTHENTICITY_NOTICE,
    privacyNotice: MRZ_PRIVACY_NOTICE,
  };
}

async function mrzValidate(input: Record<string, unknown>) {
  const validation = validateTd3Mrz(readMrzSource(input));
  return {
    status: validation.status,
    summary: validation.summary,
    valid: validation.valid,
    reasons: validation.reasons,
    lineLengths: validation.lineLengths,
    checks: validation.checks,
    checkDigits: checkDigitRows(validation),
    authenticityVerified: false,
    authenticityNotice: MRZ_AUTHENTICITY_NOTICE,
    privacyNotice: MRZ_PRIVACY_NOTICE,
  };
}

async function mrzParse(input: Record<string, unknown>) {
  const result = parseTd3Mrz(readMrzSource(input));
  return {
    status: result.parsedStatus === 'Successfully parsed' ? result.validation.status : 'PARSE_FAILED',
    summary: result.parsedStatus,
    parsedStatus: result.parsedStatus,
    structureValid: result.structureValid,
    fields: result.fields,
    checkDigits: checkDigitRows(result.validation),
    reasons: result.validation.reasons,
    authenticityStatus: result.authenticityStatus,
    authenticityVerified: false,
    authenticityNotice: result.authenticityNotice,
    privacyNotice: MRZ_PRIVACY_NOTICE,
  };
}

export const documentHandlers: Record<string, ToolHandler> = {
  'mrz-generator': async (input) => {
    const mode: MrzMode = oneOf(input, 'mode', MRZ_MODES, { default: 'generate' });
    if (mode === 'validate') return mrzValidate(input);
    if (mode === 'parse') return mrzParse(input);
    return mrzGenerate(input);
  },
};

/**
 * No execution-log or history target. A target label is meant to be a hostname or an IP address;
 * for this tool the only candidates are a passport number, a name or a date of birth, so the honest
 * answer is "none" — see the catalogue note and the handler's privacy contract above.
 */
export const documentTargets: Record<string, (input: Record<string, unknown>) => string | null> = {
  'mrz-generator': () => null,
};
