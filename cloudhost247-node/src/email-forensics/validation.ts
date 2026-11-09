/**
 * Input validation schemas for the Email Trace & Forensics Analyzer API.
 *
 * Uses zod, matching the rest of the platform (core/validate.js is the legacy runtime, but the
 * Node backend routes use zod directly — see src/routes/email-trace-customer.ts).
 */

import { z } from 'zod';
import { ValidationError } from '../lib/errors';

/** Analyze request body: pasted headers. */
export const analyzeBodySchema = z.object({
  rawHeaders: z.string().min(1, 'Email headers are required').max(2_000_000, 'Headers are too large'),
});

/** Analyze-file response metadata (the upload itself is multipart; validated in the route). */
export const analyzeFileMetaSchema = z.object({
  originalFilename: z.string().min(1, 'Filename is required').max(255),
});

/** History list query. */
export const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(['pending', 'complete', 'failed']).optional(),
});

/** Report format query. */
export const reportFormatSchema = z.object({
  format: z.enum(['json', 'pdf']),
});

/** Admin database-update request body. */
export const databaseUpdateBodySchema = z.object({
  provider: z.string().min(1).max(128),
  // A URL is accepted but the dataset is fetched and verified locally; no arbitrary script
  // execution. The URL is validated and the downloaded bundle is integrity-checked.
  sourceUrl: z.string().url().optional(),
  version: z.string().min(1).max(64).optional(),
});

/** Feature disable/enable request body. */
export const featureToggleBodySchema = z.object({
  enabled: z.boolean(),
});

/** Helper: parse or throw a platform-friendly validation error. */
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const messages = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new ValidationError(`Validation failed: ${messages.join(', ')}`);
  }
  return parsed.data;
}
