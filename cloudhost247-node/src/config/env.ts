/**
 * Environment validation for CloudHost247 (cPanel Passenger + external/managed PostgreSQL).
 *
 * Design constraints (see docs/CPANEL_DEPLOYMENT.md):
 *  - No secret ever has a hardcoded fallback. Missing secrets fail startup loudly.
 *  - PORT is supplied by the hosting environment (cPanel Passenger / Application Manager).
 *    A development-only fallback is provided so `npm run dev` works locally.
 *  - DATABASE_URL is a single connection string so the same code works whether PostgreSQL
 *    is provided locally by the host or by an external managed provider.
 */
import { z } from 'zod';

// Loaded once, lazily, so unit tests can set process.env before first access.
let cached: Env | null = null;

const boolFromString = z
  .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Supplied by cPanel Passenger/Application Manager in production. A fallback is only used
  // for local `npm run dev`; production must never rely on the fallback.
  PORT: z.coerce.number().int().positive().default(3000),

  // Optional: some Passenger setups bind to a unix domain socket path instead of a TCP port.
  // Not commonly required for cPanel Application Manager, but supported if provided.
  SOCKET_PATH: z.string().optional(),

  // Public URL of the deployed application (used for building absolute links in emails, etc.)
  APP_URL: z.string().url().default('http://localhost:3000'),

  // Single connection string. Works for local PostgreSQL (if the cPanel account has it) and
  // for an external managed PostgreSQL provider. Never construct this from separate
  // hardcoded host/user/password fields.
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine((v) => v.startsWith('postgres://') || v.startsWith('postgresql://'), {
      message: 'DATABASE_URL must be a postgres:// or postgresql:// connection string',
    }),

  // Set to true when the external provider requires SSL (most managed providers do) and the
  // provider uses a certificate that should still be validated. Set DATABASE_SSL_REJECT_UNAUTHORIZED
  // to false only for providers that require it (document why in ops notes) - never by default.
  DATABASE_SSL: boolFromString.optional().default('false'),
  DATABASE_SSL_REJECT_UNAUTHORIZED: boolFromString.optional().default('true'),

  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(50).default(5),

  // JWT signing secret for the authentication foundation. Must be injected via cPanel
  // environment variables / .env (never committed).
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('12h'),

  // Reserved for Phase 2+ (secured cron/webhook endpoints). Validated now so later phases
  // do not need another env-schema migration; unused until those routes exist.
  CRON_JOB_TOKEN: z.string().min(16).optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // --- Phase 5C: payment gateways (src/payments/*) -------------------------------------------
  // Free-text bank-transfer/cash payment instructions shown to a customer who chooses the manual/
  // offline gateway (src/payments/manual-gateway.ts). Deliberately optional with no fabricated
  // default bank details — if unset, the gateway returns an honest "not configured yet, contact
  // support" message instead of inventing a fake account number.
  MANUAL_PAYMENT_INSTRUCTIONS: z.string().max(2000).optional(),

  // HMAC secret the self-contained sandbox gateway (src/payments/sandbox-gateway.ts) uses to sign
  // the webhook payloads it produces, and that Phase 5D's webhook receiver will use to verify them
  // (src/payments/webhook-signing.ts). This is not a "real" secret shared with any external
  // party — the sandbox gateway is this same application simulating both sides of a provider
  // integration purely for testing — but it still isn't given a hardcoded fallback, consistent
  // with this file's no-fabricated-secrets rule; a deployment that never exercises the sandbox
  // gateway never needs to set it.
  SANDBOX_GATEWAY_WEBHOOK_SECRET: z.string().min(16).optional(),

  // --- Phase 5D: External payment provider webhook secrets ----------------------------------
  // Secrets for verifying incoming asynchronous webhook signatures. Optional with no hardcoded
  // fallbacks. Required only when handling live webhooks for that specific provider.
  STRIPE_WEBHOOK_SECRET: z.string().min(16).optional(),
  PAYPAL_WEBHOOK_ID: z.string().min(10).optional(),
  PAYSTACK_SECRET_KEY: z.string().min(16).optional(),
});

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n - ${issues.join('\n - ')}`);
    this.name = 'EnvValidationError';
  }
}

/**
 * Parses and validates process.env. Throws EnvValidationError with human-readable, secret-free
 * messages on failure. Never logs the offending values (they may be partially-typed secrets).
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new EnvValidationError(issues);
  }
  return result.data;
}

/** Cached accessor for use across the app; call resetEnvCache() in tests between cases. */
export function getEnv(): Env {
  if (!cached) {
    cached = loadEnv();
  }
  return cached;
}

export function resetEnvCache(): void {
  cached = null;
}
