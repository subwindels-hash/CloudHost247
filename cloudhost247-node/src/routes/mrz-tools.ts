/**
 * CloudHost247 Native ePassport MRZ Calculator, Validator, Parser & Admin Settings API
 *
 * Endpoints:
 *   GET  /api/tools/mrz/config           (also /api/v1/tools/mrz/config)
 *   POST /api/tools/mrz/generate         (also /api/v1/tools/mrz/generate)
 *   POST /api/tools/mrz/validate         (also /api/v1/tools/mrz/validate)
 *   POST /api/tools/mrz/parse            (also /api/v1/tools/mrz/parse)
 *   POST /api/tools/mrz/test-data        (also /api/v1/tools/mrz/test-data)
 *   POST /api/tools/mrz/explain          (also /api/v1/tools/mrz/explain)
 *   GET  /api/v1/admin/tools/mrz/settings (also /api/admin/tools/mrz/settings)
 *   PUT  /api/v1/admin/tools/mrz/settings (also /api/admin/tools/mrz/settings)
 *
 * Security & Privacy guarantees:
 * - Stateless by default: never persists MRZ strings, passport numbers, names, dates of birth,
 *   expiry dates, nationalities, or optional document data.
 * - Never logs sensitive MRZ inputs or outputs to application logs or audit trails.
 * - Enforces request body size limits, dynamic per-IP rate limiting, XSS/control-char rejection,
 *   and configurable availability (public, authenticated, admin_only).
 * - Privacy protections are permanently locked ON and cannot be disabled by any setting.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { getSetting, setSetting } from '../db/ops-tables';
import { authenticate } from '../lib/require-auth';
import { requireRole } from '../lib/require-role';
import { auditRequest, recordAuditBestEffort, requestAuditContext } from '../lib/audit';
import { ForbiddenError, HttpError, ValidationError } from '../lib/errors';
import {
  explainMrzWithAi,
  generateSyntheticTestData,
  generateTd3Mrz,
  MRZ_AUTHENTICITY_NOTICE,
  parseTd3Mrz,
  validateTd3Mrz,
} from '../tools/mrz/mrz-engine';

export type MrzLoggingLevel = 'none' | 'errors_only' | 'minimal_operational';
export type MrzAvailability = 'public' | 'authenticated' | 'admin_only';

export interface MrzToolSettings {
  calculatorEnabled: boolean;
  parserEnabled: boolean;
  testDataEnabled: boolean;
  rateLimitPerMinute: number;
  loggingLevel: MrzLoggingLevel;
  availability: MrzAvailability;
  privacyProtectionLocked: true;
  persistSubmittedData: false;
  logSensitiveMrzData: false;
}

export const MRZ_SETTING_KEYS = {
  calculatorEnabled: 'tools.mrz.calculator_enabled',
  parserEnabled: 'tools.mrz.parser_enabled',
  testDataEnabled: 'tools.mrz.test_data_enabled',
  rateLimitPerMinute: 'tools.mrz.rate_limit_per_minute',
  loggingLevel: 'tools.mrz.logging_level',
  availability: 'tools.mrz.availability',
} as const;

const DEFAULT_MRZ_SETTINGS: MrzToolSettings = {
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

/**
 * Dangerous XSS / injection patterns that must be rejected immediately in any tool input.
 */
const DANGEROUS_INPUT_PATTERN = /<\s*\/?\s*(?:script|iframe|object|embed|svg|img|style|link|meta)\b|javascript\s*:|on[a-z]+\s*=|[\u0000-\u0008\u000B\u000C\u000E-\u001F]/i;

function containsDangerousPattern(value: unknown): boolean {
  if (typeof value === 'string') {
    return DANGEROUS_INPUT_PATTERN.test(value);
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsDangerousPattern(item));
  }
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((v) => containsDangerousPattern(v));
  }
  return false;
}

export async function loadMrzToolSettings(db?: Queryable): Promise<MrzToolSettings> {
  if (!db) {
    return { ...DEFAULT_MRZ_SETTINGS };
  }
  try {
    const [
      calculatorEnabled,
      parserEnabled,
      testDataEnabled,
      rateLimitPerMinute,
      loggingLevel,
      availability,
    ] = await Promise.all([
      getSetting<boolean>(db, MRZ_SETTING_KEYS.calculatorEnabled, DEFAULT_MRZ_SETTINGS.calculatorEnabled),
      getSetting<boolean>(db, MRZ_SETTING_KEYS.parserEnabled, DEFAULT_MRZ_SETTINGS.parserEnabled),
      getSetting<boolean>(db, MRZ_SETTING_KEYS.testDataEnabled, DEFAULT_MRZ_SETTINGS.testDataEnabled),
      getSetting<number>(db, MRZ_SETTING_KEYS.rateLimitPerMinute, DEFAULT_MRZ_SETTINGS.rateLimitPerMinute),
      getSetting<MrzLoggingLevel>(db, MRZ_SETTING_KEYS.loggingLevel, DEFAULT_MRZ_SETTINGS.loggingLevel),
      getSetting<MrzAvailability>(db, MRZ_SETTING_KEYS.availability, DEFAULT_MRZ_SETTINGS.availability),
    ]);

    return {
      calculatorEnabled: Boolean(calculatorEnabled),
      parserEnabled: Boolean(parserEnabled),
      testDataEnabled: Boolean(testDataEnabled),
      rateLimitPerMinute:
        typeof rateLimitPerMinute === 'number' && rateLimitPerMinute >= 1 && rateLimitPerMinute <= 600
          ? Math.floor(rateLimitPerMinute)
          : DEFAULT_MRZ_SETTINGS.rateLimitPerMinute,
      loggingLevel:
        loggingLevel === 'none' || loggingLevel === 'errors_only' || loggingLevel === 'minimal_operational'
          ? loggingLevel
          : DEFAULT_MRZ_SETTINGS.loggingLevel,
      availability:
        availability === 'public' || availability === 'authenticated' || availability === 'admin_only'
          ? availability
          : DEFAULT_MRZ_SETTINGS.availability,
      privacyProtectionLocked: true,
      persistSubmittedData: false,
      logSensitiveMrzData: false,
    };
  } catch {
    return { ...DEFAULT_MRZ_SETTINGS };
  }
}

interface RateBucket {
  timestamps: number[];
}

export async function registerMrzToolRoutes(
  app: FastifyInstance,
  env: Env,
  overridePool?: Queryable
) {
  const pool = overridePool ?? getPool(env);
  const rateBuckets = new Map<string, RateBucket>();

  function checkMrzRateLimit(request: FastifyRequest, limitPerMinute: number): void {
    const ip = request.ip || '127.0.0.1';
    const now = Date.now();
    const windowStart = now - 60_000;
    const existing = rateBuckets.get(ip) ?? { timestamps: [] };
    existing.timestamps = existing.timestamps.filter((ts) => ts > windowStart);
    if (existing.timestamps.length >= limitPerMinute) {
      throw new HttpError(
        429,
        `Rate limit exceeded for MRZ developer tool (${limitPerMinute} requests per minute). Please wait before retrying.`,
        'RATE_LIMITED'
      );
    }
    existing.timestamps.push(now);
    rateBuckets.set(ip, existing);
  }

  async function enforceAvailabilityAndGetActor(
    request: FastifyRequest,
    settings: MrzToolSettings
  ): Promise<string | null> {
    if (settings.availability === 'admin_only') {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      return auth.userId;
    }
    if (settings.availability === 'authenticated') {
      const auth = await authenticate(request, env, pool);
      return auth.userId;
    }
    // Public mode: optionally resolve caller userId if a valid bearer token was sent
    if (request.headers.authorization?.startsWith('Bearer ')) {
      try {
        const auth = await authenticate(request, env, pool);
        return auth.userId;
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Privacy-safe operational audit recorder (spec §20).
   * Stores ONLY: tool, user/account ID, timestamp, operation, success/failure, error category.
   * NEVER stores passport number, full name, date of birth, full MRZ, nationality, or optional data.
   */
  async function recordPrivacySafeMrzAudit(
    request: FastifyRequest,
    settings: MrzToolSettings,
    actorId: string | null,
    params: {
      tool: 'mrz_calculator' | 'mrz_validator' | 'mrz_parser' | 'mrz_test_data' | 'mrz_ai_explainer';
      operation: 'generate' | 'validate' | 'parse' | 'test_data' | 'explain';
      success: boolean;
      errorCategory: string | null;
    }
  ): Promise<void> {
    if (settings.loggingLevel === 'none') return;
    if (settings.loggingLevel === 'errors_only' && params.success) return;

    await recordAuditBestEffort(
      pool,
      {
        actorId,
        action: `tools.mrz.${params.operation}`,
        resourceType: 'tool_mrz',
        resourceId: params.tool,
        metadata: {
          tool: params.tool,
          operation: params.operation,
          success: params.success,
          errorCategory: params.errorCategory,
          timestamp: new Date().toISOString(),
        },
      },
      requestAuditContext(request)
    );
  }

  function guardPayloadSizeAndSafety(request: FastifyRequest): void {
    const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;
    if (rawBody && rawBody.byteLength > MAX_MRZ_BODY_BYTES) {
      throw new HttpError(413, 'Request payload exceeds the 4 KB limit for MRZ tool operations.', 'PAYLOAD_TOO_LARGE');
    }
    if (containsDangerousPattern(request.body)) {
      throw new ValidationError('Input contains disallowed HTML, script, or control characters.');
    }
  }

  function setPrivacyHeaders(reply: FastifyReply): void {
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    reply.header('Pragma', 'no-cache');
    reply.header('X-Robots-Tag', 'noindex, nofollow');
  }

  // --- Public / Client Configuration Endpoint ---------------------------------------------------
  const configHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    setPrivacyHeaders(reply);
    const settings = await loadMrzToolSettings(pool);
    return {
      calculatorEnabled: settings.calculatorEnabled,
      parserEnabled: settings.parserEnabled,
      testDataEnabled: settings.testDataEnabled,
      availability: settings.availability,
      supportedFormats: ['TD3'],
      privacyFirst: true,
      persistSubmittedData: false,
    };
  };

  app.get('/api/tools/mrz/config', configHandler);
  app.get('/api/v1/tools/mrz/config', configHandler);

  // --- Generate MRZ Endpoint --------------------------------------------------------------------
  const generateBodySchema = z
    .object({
      documentType: z.string().max(10).optional(),
      issuingState: z.string().max(10),
      surname: z.string().max(80),
      givenNames: z.string().max(80),
      nationality: z.string().max(10),
      dateOfBirth: z.string().max(16),
      sex: z.string().max(20),
      documentNumber: z.string().max(20),
      expiryDate: z.string().max(16),
      optionalData: z.string().max(30).optional(),
    })
    .strict();

  const generateHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    setPrivacyHeaders(reply);
    const settings = await loadMrzToolSettings(pool);
    checkMrzRateLimit(request, settings.rateLimitPerMinute);
    const actorId = await enforceAvailabilityAndGetActor(request, settings);

    if (!settings.calculatorEnabled) {
      await recordPrivacySafeMrzAudit(request, settings, actorId, {
        tool: 'mrz_calculator',
        operation: 'generate',
        success: false,
        errorCategory: 'TOOL_DISABLED',
      });
      throw new ForbiddenError('The MRZ Calculator is currently disabled by an administrator.');
    }

    try {
      guardPayloadSizeAndSafety(request);
    } catch (err) {
      await recordPrivacySafeMrzAudit(request, settings, actorId, {
        tool: 'mrz_calculator',
        operation: 'generate',
        success: false,
        errorCategory: err instanceof HttpError ? err.code : 'INVALID_INPUT',
      });
      throw err;
    }

    const parsedBody = generateBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      await recordPrivacySafeMrzAudit(request, settings, actorId, {
        tool: 'mrz_calculator',
        operation: 'generate',
        success: false,
        errorCategory: 'SCHEMA_VALIDATION_ERROR',
      });
      throw new ValidationError(
        parsedBody.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')
      );
    }

    const outcome = generateTd3Mrz(parsedBody.data);
    if (!outcome.success) {
      await recordPrivacySafeMrzAudit(request, settings, actorId, {
        tool: 'mrz_calculator',
        operation: 'generate',
        success: false,
        errorCategory: outcome.errors[0]?.code ?? 'VALIDATION_ERROR',
      });
      reply.code(400);
      return {
        success: false,
        error: outcome.error,
        message: outcome.message,
        errors: outcome.errors,
      };
    }

    await recordPrivacySafeMrzAudit(request, settings, actorId, {
      tool: 'mrz_calculator',
      operation: 'generate',
      success: true,
      errorCategory: null,
    });

    // Spec §17: Do not include unnecessary personal information in responses.
    return {
      success: true,
      documentType: outcome.documentType,
      mrz: outcome.mrz,
      validation: outcome.validation,
      checkDigits: outcome.checkDigits,
      authenticityNotice: outcome.authenticityNotice,
    };
  };

  app.post('/api/tools/mrz/generate', { bodyLimit: MAX_MRZ_BODY_BYTES }, generateHandler);
  app.post('/api/v1/tools/mrz/generate', { bodyLimit: MAX_MRZ_BODY_BYTES }, generateHandler);

  // --- Validate MRZ Endpoint --------------------------------------------------------------------
  const mrzInputSchema = z
    .object({
      mrz: z.string().min(1).max(256).optional(),
      line1: z.string().min(1).max(128).optional(),
      line2: z.string().min(1).max(128).optional(),
    })
    .strict()
    .refine(
      (data) =>
        (typeof data.mrz === 'string' && data.mrz.trim().length > 0) ||
        (typeof data.line1 === 'string' && typeof data.line2 === 'string'),
      { message: 'Provide either "mrz" (two lines) or both "line1" and "line2".' }
    );

  const validateHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    setPrivacyHeaders(reply);
    const settings = await loadMrzToolSettings(pool);
    checkMrzRateLimit(request, settings.rateLimitPerMinute);
    const actorId = await enforceAvailabilityAndGetActor(request, settings);

    if (!settings.calculatorEnabled && !settings.parserEnabled) {
      await recordPrivacySafeMrzAudit(request, settings, actorId, {
        tool: 'mrz_validator',
        operation: 'validate',
        success: false,
        errorCategory: 'TOOL_DISABLED',
      });
      throw new ForbiddenError('The MRZ Validator is currently disabled by an administrator.');
    }

    try {
      guardPayloadSizeAndSafety(request);
    } catch (err) {
      await recordPrivacySafeMrzAudit(request, settings, actorId, {
        tool: 'mrz_validator',
        operation: 'validate',
        success: false,
        errorCategory: err instanceof HttpError ? err.code : 'INVALID_INPUT',
      });
      throw err;
    }

    const parsedBody = mrzInputSchema.safeParse(request.body);
    if (!parsedBody.success) {
      await recordPrivacySafeMrzAudit(request, settings, actorId, {
        tool: 'mrz_validator',
        operation: 'validate',
        success: false,
        errorCategory: 'SCHEMA_VALIDATION_ERROR',
      });
      throw new ValidationError(parsedBody.error.issues.map((i) => i.message).join('; '));
    }

    const target =
      parsedBody.data.mrz !== undefined
        ? parsedBody.data.mrz
        : { line1: parsedBody.data.line1!, line2: parsedBody.data.line2! };

    const validation = validateTd3Mrz(target);

    await recordPrivacySafeMrzAudit(request, settings, actorId, {
      tool: 'mrz_validator',
      operation: 'validate',
      success: validation.valid,
      errorCategory: validation.valid ? null : 'MRZ_INVALID',
    });

    return {
      success: true,
      ...validation,
    };
  };

  app.post('/api/tools/mrz/validate', { bodyLimit: MAX_MRZ_BODY_BYTES }, validateHandler);
  app.post('/api/v1/tools/mrz/validate', { bodyLimit: MAX_MRZ_BODY_BYTES }, validateHandler);

  // --- Parse MRZ Endpoint -----------------------------------------------------------------------
  const parseHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    setPrivacyHeaders(reply);
    const settings = await loadMrzToolSettings(pool);
    checkMrzRateLimit(request, settings.rateLimitPerMinute);
    const actorId = await enforceAvailabilityAndGetActor(request, settings);

    if (!settings.parserEnabled) {
      await recordPrivacySafeMrzAudit(request, settings, actorId, {
        tool: 'mrz_parser',
        operation: 'parse',
        success: false,
        errorCategory: 'TOOL_DISABLED',
      });
      throw new ForbiddenError('The MRZ Parser is currently disabled by an administrator.');
    }

    try {
      guardPayloadSizeAndSafety(request);
    } catch (err) {
      await recordPrivacySafeMrzAudit(request, settings, actorId, {
        tool: 'mrz_parser',
        operation: 'parse',
        success: false,
        errorCategory: err instanceof HttpError ? err.code : 'INVALID_INPUT',
      });
      throw err;
    }

    const parsedBody = mrzInputSchema.safeParse(request.body);
    if (!parsedBody.success) {
      await recordPrivacySafeMrzAudit(request, settings, actorId, {
        tool: 'mrz_parser',
        operation: 'parse',
        success: false,
        errorCategory: 'SCHEMA_VALIDATION_ERROR',
      });
      throw new ValidationError(parsedBody.error.issues.map((i) => i.message).join('; '));
    }

    const target =
      parsedBody.data.mrz !== undefined
        ? parsedBody.data.mrz
        : { line1: parsedBody.data.line1!, line2: parsedBody.data.line2! };

    const parsed = parseTd3Mrz(target);

    await recordPrivacySafeMrzAudit(request, settings, actorId, {
      tool: 'mrz_parser',
      operation: 'parse',
      success: parsed.success,
      errorCategory: parsed.success ? null : 'PARSE_FAILED',
    });

    if (!parsed.success) {
      reply.code(400);
    }
    return parsed;
  };

  app.post('/api/tools/mrz/parse', { bodyLimit: MAX_MRZ_BODY_BYTES }, parseHandler);
  app.post('/api/v1/tools/mrz/parse', { bodyLimit: MAX_MRZ_BODY_BYTES }, parseHandler);

  // --- Synthetic Test Data Endpoint -------------------------------------------------------------
  const testDataSchema = z
    .object({
      seedIndex: z.number().int().min(0).max(1000).optional(),
    })
    .strict()
    .optional();

  const testDataHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    setPrivacyHeaders(reply);
    const settings = await loadMrzToolSettings(pool);
    checkMrzRateLimit(request, settings.rateLimitPerMinute);
    const actorId = await enforceAvailabilityAndGetActor(request, settings);

    if (!settings.testDataEnabled) {
      await recordPrivacySafeMrzAudit(request, settings, actorId, {
        tool: 'mrz_test_data',
        operation: 'test_data',
        success: false,
        errorCategory: 'TOOL_DISABLED',
      });
      throw new ForbiddenError('The synthetic MRZ test-data generator is currently disabled by an administrator.');
    }

    guardPayloadSizeAndSafety(request);
    const bodyObj =
      request.body && typeof request.body === 'object' && Object.keys(request.body as object).length > 0
        ? request.body
        : undefined;
    const parsedBody = testDataSchema.safeParse(bodyObj);
    if (!parsedBody.success) {
      throw new ValidationError(parsedBody.error.issues.map((i) => i.message).join('; '));
    }

    const specimen = generateSyntheticTestData(parsedBody.data?.seedIndex);

    await recordPrivacySafeMrzAudit(request, settings, actorId, {
      tool: 'mrz_test_data',
      operation: 'test_data',
      success: true,
      errorCategory: null,
    });

    return {
      success: true,
      ...specimen,
      authenticityNotice: MRZ_AUTHENTICITY_NOTICE,
    };
  };

  app.post('/api/tools/mrz/test-data', { bodyLimit: MAX_MRZ_BODY_BYTES }, testDataHandler);
  app.post('/api/v1/tools/mrz/test-data', { bodyLimit: MAX_MRZ_BODY_BYTES }, testDataHandler);

  // --- CloudHost247 AI Explanation Endpoint -----------------------------------------------------
  const explainSchema = z
    .object({
      topic: z.enum(['overview', 'fields', 'check_digits', 'format', 'invalid_input', 'parsing']).optional(),
      mrz: z
        .union([
          z.string().max(256),
          z.object({ line1: z.string().max(128), line2: z.string().max(128) }).strict(),
        ])
        .optional(),
      inputErrors: z
        .array(
          z
            .object({
              field: z.string().max(64),
              code: z.string().max(64),
              message: z.string().max(512),
            })
            .strict()
        )
        .max(20)
        .optional(),
      question: z.string().max(500).optional(),
    })
    .strict();

  const explainHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    setPrivacyHeaders(reply);
    const settings = await loadMrzToolSettings(pool);
    checkMrzRateLimit(request, settings.rateLimitPerMinute);
    const actorId = await enforceAvailabilityAndGetActor(request, settings);

    guardPayloadSizeAndSafety(request);
    const parsedBody = explainSchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      throw new ValidationError(parsedBody.error.issues.map((i) => i.message).join('; '));
    }

    const explanation = explainMrzWithAi(parsedBody.data);

    await recordPrivacySafeMrzAudit(request, settings, actorId, {
      tool: 'mrz_ai_explainer',
      operation: 'explain',
      success: true,
      errorCategory: null,
    });

    return {
      success: true,
      explanation,
    };
  };

  app.post('/api/tools/mrz/explain', { bodyLimit: MAX_MRZ_BODY_BYTES }, explainHandler);
  app.post('/api/v1/tools/mrz/explain', { bodyLimit: MAX_MRZ_BODY_BYTES }, explainHandler);

  // --- Super Admin Settings (Super Admin → Settings → Tools → MRZ) ------------------------------
  const adminGetSettingsHandler = async (request: FastifyRequest) => {
    await requireRole(request, env, pool, ['admin', 'super_admin']);
    const settings = await loadMrzToolSettings(pool);
    return { settings };
  };

  const adminUpdateSettingsSchema = z
    .object({
      calculatorEnabled: z.boolean().optional(),
      parserEnabled: z.boolean().optional(),
      testDataEnabled: z.boolean().optional(),
      rateLimitPerMinute: z.coerce.number().int().min(1).max(600).optional(),
      loggingLevel: z.enum(['none', 'errors_only', 'minimal_operational']).optional(),
      availability: z.enum(['public', 'authenticated', 'admin_only']).optional(),
      // Any attempt to weaken or disable privacy protections is caught and rejected below
      disablePrivacy: z.boolean().optional(),
      persistSubmittedData: z.boolean().optional(),
      logSensitiveMrzData: z.boolean().optional(),
      privacyProtectionLocked: z.boolean().optional(),
    })
    .strict();

  const adminPutSettingsHandler = async (request: FastifyRequest) => {
    const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
    guardPayloadSizeAndSafety(request);

    const parsed = adminUpdateSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
    }

    const patch = parsed.data;
    if (
      patch.disablePrivacy === true ||
      patch.persistSubmittedData === true ||
      patch.logSensitiveMrzData === true ||
      patch.privacyProtectionLocked === false
    ) {
      throw new ValidationError(
        'Privacy protections for the MRZ tool are mandatory and cannot be disabled.'
      );
    }

    const updatedKeys: Record<string, unknown> = {};

    if (patch.calculatorEnabled !== undefined) {
      await setSetting(pool, MRZ_SETTING_KEYS.calculatorEnabled, patch.calculatorEnabled, auth.userId);
      updatedKeys[MRZ_SETTING_KEYS.calculatorEnabled] = patch.calculatorEnabled;
    }
    if (patch.parserEnabled !== undefined) {
      await setSetting(pool, MRZ_SETTING_KEYS.parserEnabled, patch.parserEnabled, auth.userId);
      updatedKeys[MRZ_SETTING_KEYS.parserEnabled] = patch.parserEnabled;
    }
    if (patch.testDataEnabled !== undefined) {
      await setSetting(pool, MRZ_SETTING_KEYS.testDataEnabled, patch.testDataEnabled, auth.userId);
      updatedKeys[MRZ_SETTING_KEYS.testDataEnabled] = patch.testDataEnabled;
    }
    if (patch.rateLimitPerMinute !== undefined) {
      await setSetting(pool, MRZ_SETTING_KEYS.rateLimitPerMinute, patch.rateLimitPerMinute, auth.userId);
      updatedKeys[MRZ_SETTING_KEYS.rateLimitPerMinute] = patch.rateLimitPerMinute;
    }
    if (patch.loggingLevel !== undefined) {
      await setSetting(pool, MRZ_SETTING_KEYS.loggingLevel, patch.loggingLevel, auth.userId);
      updatedKeys[MRZ_SETTING_KEYS.loggingLevel] = patch.loggingLevel;
    }
    if (patch.availability !== undefined) {
      await setSetting(pool, MRZ_SETTING_KEYS.availability, patch.availability, auth.userId);
      updatedKeys[MRZ_SETTING_KEYS.availability] = patch.availability;
    }

    await auditRequest(pool, request, auth.userId, {
      action: 'tools.mrz.settings_updated',
      resourceType: 'platform_setting',
      resourceId: 'tools.mrz',
      metadata: updatedKeys,
    });

    const settings = await loadMrzToolSettings(pool);
    return { settings };
  };

  app.get('/api/v1/admin/tools/mrz/settings', adminGetSettingsHandler);
  app.get('/api/admin/tools/mrz/settings', adminGetSettingsHandler);
  app.put('/api/v1/admin/tools/mrz/settings', adminPutSettingsHandler);
  app.put('/api/admin/tools/mrz/settings', adminPutSettingsHandler);
}
