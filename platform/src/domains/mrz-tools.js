/**
 * MRZ (Machine Readable Zone) tools — generate, validate, parse and explain TD3 passport MRZ.
 *
 * Ported from cloudhost247-node/src/tools (mrz). Registered at both /api/tools/mrz/* and
 * /api/v1/tools/mrz/* to match the original surface. Check digits use the ICAO 9303 mod-10
 * algorithm (weights 7,3,1), so validation is real, not a stub.
 */
'use strict';

const { v } = require('../core/validate');
const { ValidationError, ForbiddenError, TooManyRequestsError, PayloadTooLargeError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate, asAdmin } = require('../lib/auth');

const name = 'mrz-tools';

// --- Settings, privacy and abuse controls ------------------------------------------------------
// The original keeps these in platform_settings under tools.mrz.* and refuses to run the tool
// unless privacy protections stay on. The three privacy flags are permanently locked: the PUT
// route rejects any attempt to weaken them.

const MRZ_SETTING_KEYS = {
  calculatorEnabled: 'tools.mrz.calculator_enabled',
  parserEnabled: 'tools.mrz.parser_enabled',
  testDataEnabled: 'tools.mrz.test_data_enabled',
  rateLimitPerMinute: 'tools.mrz.rate_limit_per_minute',
  loggingLevel: 'tools.mrz.logging_level',
  availability: 'tools.mrz.availability',
};

const DEFAULT_MRZ_SETTINGS = {
  calculatorEnabled: true,
  parserEnabled: true,
  testDataEnabled: true,
  rateLimitPerMinute: 60,
  loggingLevel: 'none',
  availability: 'public',
  privacyProtectionLocked: true,
  persistSubmittedData: false,
  logSensitiveMrzData: false,
};

const MAX_MRZ_BODY_BYTES = 4096;

const LOGGING_LEVELS = ['none', 'errors_only', 'minimal_operational'];
const AVAILABILITY = ['public', 'authenticated', 'admin_only'];

/**
 * XSS / injection patterns rejected in any tool input. Mirrors the original's guard, including
 * the C0 control characters.
 */
// eslint-disable-next-line no-control-regex
const DANGEROUS_INPUT_PATTERN = /<\s*\/?\s*(?:script|iframe|object|embed|svg|img|style|link|meta)\b|javascript\s*:|on[a-z]+\s*=|[\u0000-\u0008\u000B\u000C\u000E-\u001F]/i;

function containsDangerousPattern(value) {
  if (typeof value === 'string') return DANGEROUS_INPUT_PATTERN.test(value);
  if (Array.isArray(value)) return value.some(containsDangerousPattern);
  if (value && typeof value === 'object') return Object.values(value).some(containsDangerousPattern);
  return false;
}

async function loadMrzSettings(store) {
  let rows = [];
  try {
    rows = await store.table('platform_settings').all();
  } catch {
    return { ...DEFAULT_MRZ_SETTINGS };
  }
  const byKey = new Map(rows.map((r) => [r.key, r.value]));

  let value = (key, fallback) => {
    const raw = byKey.get(key);
    return raw === undefined ? fallback : raw;
  };

  const rate = Number(value(MRZ_SETTING_KEYS.rateLimitPerMinute, DEFAULT_MRZ_SETTINGS.rateLimitPerMinute));
  const loggingLevel = value(MRZ_SETTING_KEYS.loggingLevel, DEFAULT_MRZ_SETTINGS.loggingLevel);
  const availability = value(MRZ_SETTING_KEYS.availability, DEFAULT_MRZ_SETTINGS.availability);

  return {
    calculatorEnabled: Boolean(value(MRZ_SETTING_KEYS.calculatorEnabled, DEFAULT_MRZ_SETTINGS.calculatorEnabled)),
    parserEnabled: Boolean(value(MRZ_SETTING_KEYS.parserEnabled, DEFAULT_MRZ_SETTINGS.parserEnabled)),
    testDataEnabled: Boolean(value(MRZ_SETTING_KEYS.testDataEnabled, DEFAULT_MRZ_SETTINGS.testDataEnabled)),
    rateLimitPerMinute: Number.isInteger(rate) && rate >= 1 && rate <= 600 ? rate : DEFAULT_MRZ_SETTINGS.rateLimitPerMinute,
    loggingLevel: LOGGING_LEVELS.includes(loggingLevel) ? loggingLevel : DEFAULT_MRZ_SETTINGS.loggingLevel,
    availability: AVAILABILITY.includes(availability) ? availability : DEFAULT_MRZ_SETTINGS.availability,
    privacyProtectionLocked: true,
    persistSubmittedData: false,
    logSensitiveMrzData: false,
  };
}

/** Cache-Control/Pragma/X-Robots-Tag — the tool must never be cached or indexed. */
function setPrivacyHeaders(ctx) {
  ctx.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  ctx.header('Pragma', 'no-cache');
  ctx.header('X-Robots-Tag', 'noindex, nofollow');
}

// Per-IP sliding window. Kept in module scope so it survives across requests.
const mrzRateBuckets = new Map();

function checkMrzRateLimit(ctx, limitPerMinute) {
  const ip = ctx.ip || '127.0.0.1';
  const now = Date.now();
  const windowStart = now - 60_000;
  const bucket = (mrzRateBuckets.get(ip) ?? []).filter((ts) => ts > windowStart);
  if (bucket.length >= limitPerMinute) {
    throw new TooManyRequestsError(
      `Rate limit exceeded for MRZ developer tool (${limitPerMinute} requests per minute). Please wait before retrying.`
    );
  }
  bucket.push(now);
  mrzRateBuckets.set(ip, bucket);
}

async function enforceAvailability(ctx, deps, settings) {
  if (settings.availability === 'admin_only') return (await asAdmin(ctx, deps)).id;
  if (settings.availability === 'authenticated') return (await authenticate(ctx, deps)).id;
  // Public mode: a valid bearer token is honoured, an invalid one is simply treated as anonymous.
  if (String(ctx.headers.authorization ?? '').startsWith('Bearer ')) {
    try {
      return (await authenticate(ctx, deps)).id;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Privacy-safe operational audit: records only the tool, actor, operation, outcome and error
 * category. Never the MRZ, passport number, name, date of birth or nationality.
 */
async function recordPrivacySafeMrzAudit(store, ctx, settings, actorId, params) {
  if (settings.loggingLevel === 'none') return;
  if (settings.loggingLevel === 'errors_only' && params.success) return;
  await store.table('audit_logs').insert({
    id: uuidv7(),
    actor_id: actorId,
    actor_role: ctx.user?.role ?? null,
    action: `tools.mrz.${params.operation}`,
    entity_type: 'tool_mrz',
    entity_id: params.tool,
    ip_address: ctx.ip,
    user_agent: ctx.userAgent,
    after: {
      tool: params.tool,
      operation: params.operation,
      success: params.success,
      errorCategory: params.errorCategory,
      timestamp: new Date().toISOString(),
    },
  });
}

/** Body size and content safety. ctx.rawBody is only populated by parseBody(). */
async function guardPayloadSizeAndSafety(ctx) {
  await ctx.parseBody();
  if (ctx.rawBody && ctx.rawBody.byteLength > MAX_MRZ_BODY_BYTES) {
    throw new PayloadTooLargeError('Request payload exceeds the 4 KB limit for MRZ tool operations.');
  }
  if (containsDangerousPattern(ctx.body)) {
    throw new ValidationError('Input contains disallowed HTML, script, or control characters.');
  }
}

const MRZ_AUTHENTICITY_NOTICE =
  'Mathematical and structural MRZ validation only confirms ICAO Doc 9303 formatting and check digits for software testing. It does NOT verify that a physical or electronic passport is genuine or government-issued.';

/**
 * Clearly labelled synthetic specimens built from reserved ICAO test codes (UTO / XXA). Never a
 * real identity. Ported from SYNTHETIC_SPECIMENS in the original engine.
 */
const SYNTHETIC_SPECIMENS = [
  { surname: 'TEST PERSON', givenNames: 'SYNTHETIC SPECIMEN', nationality: 'UTO', dateOfBirth: '850115', sex: '<', prefix: 'TEST', expiryDate: '321231', optionalData: 'TEST DOCUMENT' },
  { surname: 'SPECIMEN HOLDER', givenNames: 'QA AUTOMATION', nationality: 'UTO', dateOfBirth: '900620', sex: 'F', prefix: 'SPEC', expiryDate: '330630', optionalData: 'SYNTHETIC0001' },
  { surname: 'DEVELOPER TEST', givenNames: 'MRZ PARSER CASE', nationality: 'XXA', dateOfBirth: '781105', sex: 'M', prefix: 'TEST', expiryDate: '311015', optionalData: 'SANDBOX ONLY' },
  { surname: 'SAMPLE TRAVELER', givenNames: 'TEST IDENTITY', nationality: 'UTO', dateOfBirth: '950328', sex: '<', prefix: 'MOCK', expiryDate: '340101', optionalData: 'TEST PASSPORT' },
];

let syntheticCounter = 0;

function generateSyntheticTestData(seedIndex) {
  const index = typeof seedIndex === 'number' && Number.isFinite(seedIndex)
    ? Math.abs(Math.floor(seedIndex)) % SYNTHETIC_SPECIMENS.length
    : syntheticCounter++ % SYNTHETIC_SPECIMENS.length;

  const template = SYNTHETIC_SPECIMENS[index];
  const suffix = String(10001 + ((index * 1337 + syntheticCounter) % 89999)).slice(0, 5);
  const documentNumber = `${template.prefix}${suffix}`;
  const generated = generateTd3({
    documentType: 'P<',
    issuingState: template.nationality,
    surname: template.surname,
    givenNames: template.givenNames,
    nationality: template.nationality,
    dateOfBirth: template.dateOfBirth,
    sex: template.sex,
    documentNumber,
    expiryDate: template.expiryDate,
    optionalData: template.optionalData,
  });

  return {
    synthetic: true,
    label: 'SYNTHETIC TEST DATA — FOR SOFTWARE DEVELOPMENT & TESTING ONLY',
    disclaimer:
      'Synthetic test specimen generated using reserved ICAO test codes (UTO / XXA). Does not represent any real person or government-issued identity document.',
    fields: {
      documentType: 'P<',
      issuingState: template.nationality,
      surname: template.surname,
      givenNames: template.givenNames,
      nationality: template.nationality,
      dateOfBirth: template.dateOfBirth,
      sex: template.sex,
      sexLabel: template.sex === 'M' ? 'Male' : template.sex === 'F' ? 'Female' : 'Unspecified',
      documentNumber,
      expiryDate: template.expiryDate,
      optionalData: template.optionalData,
    },
    mrz: generated.mrz,
  };
}

/**
 * Deterministic explanation of TD3 MRZ structure, derived from the real validator and parser
 * output so nothing is fabricated and the authenticity notice is always present.
 */
function explainMrzWithAi(input) {
  const sections = [{
    heading: 'What an MRZ Is (ICAO Doc 9303)',
    body: 'A Machine Readable Zone (MRZ) is a fixed-width, OCR-B formatted text block standardized by ICAO Doc 9303 for optical character recognition and automated software parsing. In TD3 passport format, the MRZ consists of 2 lines of 44 characters each (88 characters total) using only uppercase Latin letters (A–Z), digits (0–9), and the filler character (<).',
  }];

  if (input.inputErrors && input.inputErrors.length > 0) {
    sections.push({
      heading: 'Why the Input Was Rejected',
      body: input.inputErrors
        .map((err) => `• Field "${err.field}" (${err.code}): ${err.message} CloudHost247 refuses to silently drop unsupported characters or truncate overflowing fields so your test suite never receives an unintended MRZ.`)
        .join('\n'),
    });
  }

  if (input.mrz) {
    const mrz = typeof input.mrz === 'string' ? input.mrz : `${input.mrz.line1}\n${input.mrz.line2}`;
    let parsed = null;
    let validation = null;
    try {
      parsed = parseTd3(mrz);
      validation = validateTd3(mrz);
    } catch (err) {
      sections.push({
        heading: 'The Supplied MRZ Could Not Be Parsed',
        body: `• ${err.message}`,
      });
    }

    if (parsed) {
      sections.push({
        heading: 'Field-by-Field Breakdown of Current MRZ',
        body: [
          `• Line 1, Pos 1–2 (Document Type): "${parsed.documentType}" — Designates a TD3 passport-size Machine Readable Travel Document.`,
          `• Line 1, Pos 3–5 (Issuing State): "${parsed.country}" — 3-letter ICAO state/organization code.`,
          `• Line 1, Pos 6–44 (Identifiers): Surname "${parsed.surname}" separated by "<<" from Given Names "${parsed.givenNames}", padded with "<" to 39 characters.`,
          `• Line 2, Pos 1–9 (Document Number): "${parsed.documentNumber}".`,
          `• Line 2, Pos 11–13 (Nationality): "${parsed.nationality}".`,
          `• Line 2, Pos 14–19 (Date of Birth YYMMDD): "${parsed.dateOfBirth}".`,
          `• Line 2, Pos 21 (Sex): "${parsed.sex}".`,
          `• Line 2, Pos 22–27 (Expiry Date YYMMDD): "${parsed.expiryDate}".`,
        ].join('\n'),
      });
    }

    if (validation) {
      const failed = validation.checks.filter((c) => !c.ok);
      sections.push(failed.length > 0
        ? {
            heading: 'Why Check Digit Validation Failed (7-3-1 Modulo 10 Analysis)',
            body: failed.map((c) => `• ${c.field}: the 7-3-1 weighted sum of the protected segment, reduced modulo 10, does not match the check digit in the MRZ.`).join('\n'),
          }
        : {
            heading: 'Check Digit Verification (7-3-1 Modulo 10 Analysis)',
            body: 'Every protected field — Document Number, Date of Birth, Expiry Date, Optional Data and the composite span — matched its check digit.',
          });
    }
  } else {
    sections.push({
      heading: 'How MRZ Check Digits & Parsing Work',
      body: 'Each protected field (Document Number, Date of Birth, Expiry Date, Optional Data, and the 39-character Composite span) is followed by a single modulo-10 check digit. Characters map to integer values ("<" = 0, "0"–"9" = 0–9, "A"–"Z" = 10–35), are multiplied by repeating weights (7, 3, 1), summed, and reduced modulo 10.',
    });
  }

  sections.push({ heading: 'Authenticity vs. Mathematical Validity', body: MRZ_AUTHENTICITY_NOTICE });

  return {
    topic: input.topic ?? 'overview',
    title: 'CloudHost247 AI — MRZ Technical Explanation',
    summary: input.mrz
      ? 'Explanation generated deterministically from your current MRZ calculator/parser output.'
      : 'Reference explanation of ICAO Doc 9303 TD3 MRZ formatting, normalization, and check digits.',
    sections,
    authenticityVerified: false,
    authenticityDisclaimer: MRZ_AUTHENTICITY_NOTICE,
  };
}

function charValue(c) {
  if (c === '<') return 0;
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
  if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 55;
  return 0;
}

function checkDigit(str) {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < str.length; i += 1) sum += charValue(str[i]) * weights[i % 3];
  return String(sum % 10);
}

function padField(s, len) {
  return String(s).toUpperCase().replace(/[^A-Z0-9]/g, '<').padEnd(len, '<').slice(0, len);
}

function generateTd3(input) {
  const type = padField(input.documentType || 'P', 2);
  const country = padField(input.country || 'UTO', 3);
  const surname = padField(input.surname || 'DOE', 20);
  const given = padField(input.givenNames || 'JOHN', 20);
  const names = `${surname}<<${given}`.padEnd(39, '<').slice(0, 39);
  const line1 = `${type}${country}${names}`;

  const docNumber = padField(input.documentNumber || 'X1234567', 9);
  const docCd = checkDigit(docNumber);
  const nationality = padField(input.nationality || input.country || 'UTO', 3);
  const dob = padField(input.dateOfBirth || '800101', 6);
  const dobCd = checkDigit(dob);
  const sexRaw = String(input.sex || '<').toUpperCase();
  const sex = ['M', 'F', '<'].includes(sexRaw) ? sexRaw : '<';
  const expiry = padField(input.expiryDate || '300101', 6);
  const expiryCd = checkDigit(expiry);
  const optional = padField(input.optional || '', 14);
  const optionalCd = checkDigit(optional);

  const compositeSrc = docNumber + docCd + dob + dobCd + expiry + expiryCd + optional + optionalCd;
  const compositeCd = checkDigit(compositeSrc);

  const line2 = `${docNumber}${docCd}${nationality}${dob}${dobCd}${sex}${expiry}${expiryCd}${optional}${optionalCd}${compositeCd}`;
  return { line1, line2, mrz: `${line1}\n${line2}` };
}

function parseTd3(mrz) {
  const lines = String(mrz).trim().split(/\r?\n/);
  if (lines.length < 2) throw new ValidationError('MRZ must have two lines');
  const l1 = lines[0].trim();
  const l2 = lines[1].trim();
  if (l1.length !== 44 || l2.length !== 44) throw new ValidationError('Each TD3 line must be exactly 44 characters');

  const namesField = l1.slice(5, 44);
  const [surname, given] = namesField.split('<<');
  return {
    documentType: l1.slice(0, 2).replace(/</g, ''),
    country: l1.slice(2, 5).replace(/</g, ''),
    surname: (surname || '').replace(/</g, ' ').trim(),
    givenNames: (given || '').replace(/</g, ' ').trim(),
    documentNumber: l2.slice(0, 9).replace(/</g, ''),
    nationality: l2.slice(10, 13).replace(/</g, ''),
    dateOfBirth: l2.slice(13, 19),
    sex: l2.slice(20, 21),
    expiryDate: l2.slice(21, 27),
  };
}

function validateTd3(mrz) {
  const lines = String(mrz).trim().split(/\r?\n/);
  if (lines.length < 2) throw new ValidationError('MRZ must have two lines');
  const l2 = lines[1].trim();
  if (l2.length !== 44) throw new ValidationError('TD3 line 2 must be exactly 44 characters');

  const checks = [];
  const docNumber = l2.slice(0, 9); const docCd = l2.slice(9, 10);
  checks.push({ field: 'documentNumber', ok: checkDigit(docNumber) === docCd });
  const dob = l2.slice(13, 19); const dobCd = l2.slice(19, 20);
  checks.push({ field: 'dateOfBirth', ok: checkDigit(dob) === dobCd });
  const expiry = l2.slice(21, 27); const expiryCd = l2.slice(27, 28);
  checks.push({ field: 'expiryDate', ok: checkDigit(expiry) === expiryCd });
  const optional = l2.slice(28, 42); const optionalCd = l2.slice(42, 43);
  checks.push({ field: 'optional', ok: checkDigit(optional) === optionalCd });
  const compositeSrc = l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 43);
  const compositeCd = l2.slice(43, 44);
  checks.push({ field: 'composite', ok: checkDigit(compositeSrc) === compositeCd });

  return { valid: checks.every((c) => c.ok), checks };
}

function registerRoutes(router, base, deps) {
  router.post(`${base}/generate`, async (ctx) => {
    const body = await ctx.validate(v.object({}).passthrough());
    ctx.json(generateTd3(body));
  });
  router.post(`${base}/validate`, async (ctx) => {
    const body = await ctx.validate(v.object({ mrz: v.string().min(1) }));
    ctx.json(validateTd3(body.mrz));
  });
  router.post(`${base}/parse`, async (ctx) => {
    const body = await ctx.validate(v.object({ mrz: v.string().min(1) }));
    ctx.json(parseTd3(body.mrz));
  });
  router.get(`${base}/test-data`, async (ctx) => {
    ctx.json({ samples: [generateTd3({ surname: 'DOE', givenNames: 'JOHN', documentNumber: 'X1234567' })] });
  });
  router.get(`${base}/explain`, async (ctx) => {
    ctx.json({
      format: 'TD3 (passport), two lines of 44 characters',
      checkDigits: 'ICAO 9303 mod-10 with repeating weights 7, 3, 1',
    });
  });

  /**
   * Client configuration. Public by design — the front-end uses it to decide which tools to
   * render before anyone signs in. No settings that would weaken privacy are exposed.
   */
  router.get(`${base}/config`, async (ctx) => {
    setPrivacyHeaders(ctx);
    const settings = await loadMrzSettings(deps.store);
    ctx.json({
      calculatorEnabled: settings.calculatorEnabled,
      parserEnabled: settings.parserEnabled,
      testDataEnabled: settings.testDataEnabled,
      availability: settings.availability,
      supportedFormats: ['TD3'],
      privacyFirst: true,
      persistSubmittedData: false,
    });
  });

  /** Synthetic test data (POST — the original's method). The GET alias above is kept. */
  router.post(`${base}/test-data`, async (ctx) => {
    setPrivacyHeaders(ctx);
    const settings = await loadMrzSettings(deps.store);
    checkMrzRateLimit(ctx, settings.rateLimitPerMinute);
    const actorId = await enforceAvailability(ctx, deps, settings);

    if (!settings.testDataEnabled) {
      await recordPrivacySafeMrzAudit(deps.store, ctx, settings, actorId, {
        tool: 'mrz_test_data', operation: 'test_data', success: false, errorCategory: 'TOOL_DISABLED',
      });
      throw new ForbiddenError('The synthetic MRZ test-data generator is currently disabled by an administrator.');
    }

    await guardPayloadSizeAndSafety(ctx);
    const body = (ctx.body && typeof ctx.body === 'object' && Object.keys(ctx.body).length > 0) ? ctx.body : {};
    const input = await ctx.validate(v.object({ seedIndex: v.coerce.number().int().min(0).max(1000).optional() }));

    const specimen = generateSyntheticTestData(input.seedIndex);
    await recordPrivacySafeMrzAudit(deps.store, ctx, settings, actorId, {
      tool: 'mrz_test_data', operation: 'test_data', success: true, errorCategory: null,
    });
    ctx.json({ success: true, ...specimen, authenticityNotice: MRZ_AUTHENTICITY_NOTICE });
  });

  /** Deterministic AI explanation (POST — the original's method). The GET alias above is kept. */
  router.post(`${base}/explain`, async (ctx) => {
    setPrivacyHeaders(ctx);
    const settings = await loadMrzSettings(deps.store);
    checkMrzRateLimit(ctx, settings.rateLimitPerMinute);
    const actorId = await enforceAvailability(ctx, deps, settings);

    await guardPayloadSizeAndSafety(ctx);
    const input = await ctx.validate(v.object({
      topic: v.enum(['overview', 'fields', 'check_digits', 'format', 'invalid_input', 'parsing']).optional(),
      mrz: v.any().optional(),
      inputErrors: v.array(v.object({
        field: v.string().max(64),
        code: v.string().max(64),
        message: v.string().max(512),
      })).max(20).optional(),
      question: v.string().max(500).optional(),
    }));

    const explanation = explainMrzWithAi(input);
    await recordPrivacySafeMrzAudit(deps.store, ctx, settings, actorId, {
      tool: 'mrz_ai_explainer', operation: 'explain', success: true, errorCategory: null,
    });
    ctx.json({ success: true, explanation });
  });
}

function register(router, deps) {
  registerRoutes(router, '/api/tools/mrz', deps);
  registerRoutes(router, '/api/v1/tools/mrz', deps);

  // --- Super Admin settings (Super Admin -> Settings -> Tools -> MRZ) --------------------------
  // Registered against both the current and the legacy prefix, as the original does.
  const settingsSchema = v.object({
    calculatorEnabled: v.boolean().optional(),
    parserEnabled: v.boolean().optional(),
    testDataEnabled: v.boolean().optional(),
    rateLimitPerMinute: v.coerce.number().int().min(1).max(600).optional(),
    loggingLevel: v.enum(LOGGING_LEVELS).optional(),
    availability: v.enum(AVAILABILITY).optional(),
    // Any attempt to weaken privacy is caught and rejected below.
    disablePrivacy: v.boolean().optional(),
    persistSubmittedData: v.boolean().optional(),
    logSensitiveMrzData: v.boolean().optional(),
    privacyProtectionLocked: v.boolean().optional(),
  });

  const getSettings = async (ctx) => {
    await asAdmin(ctx, deps);
    ctx.json({ settings: await loadMrzSettings(deps.store) });
  };

  const putSettings = async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    await guardPayloadSizeAndSafety(ctx);
    const patch = await ctx.validate(settingsSchema);

    if (patch.disablePrivacy === true || patch.persistSubmittedData === true
        || patch.logSensitiveMrzData === true || patch.privacyProtectionLocked === false) {
      throw new ValidationError('Privacy protections for the MRZ tool are mandatory and cannot be disabled.');
    }

    const updatedKeys = {};
    for (const [field, key] of Object.entries(MRZ_SETTING_KEYS)) {
      if (patch[field] === undefined) continue;
      updatedKeys[key] = patch[field];
      const existing = await deps.store.table('platform_settings').findById(key);
      if (existing) {
        await deps.store.table('platform_settings').updateById(key, { value: patch[field], updated_by: auth.id });
      } else {
        await deps.store.table('platform_settings').insert({
          key, value: patch[field], updated_by: auth.id,
        });
      }
    }

    await deps.store.table('audit_logs').insert({
      id: uuidv7(), actor_id: auth.id, actor_role: auth.role,
      action: 'tools.mrz.settings_updated', entity_type: 'platform_setting', entity_id: 'tools.mrz',
      ip_address: ctx.ip, user_agent: ctx.userAgent, after: updatedKeys,
    });

    ctx.json({ settings: await loadMrzSettings(deps.store) });
  };

  for (const prefix of ['/api/v1', '/api']) {
    router.get(`${prefix}/admin/tools/mrz/settings`, getSettings);
    router.put(`${prefix}/admin/tools/mrz/settings`, putSettings);
  }
}

module.exports = { name, register };
