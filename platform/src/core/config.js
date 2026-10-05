/**
 * Configuration — replaces `dotenv` + the zod env schema in
 * cloudhost247-node/src/config/env.ts.
 *
 * Rules carried over from the existing platform:
 *   - No secret ever has a hardcoded production fallback. Missing secrets fail startup loudly.
 *   - PORT comes from the hosting environment (cPanel Passenger injects it); the 3000 fallback is
 *     development-only.
 *   - DATABASE_URL is optional here (unlike the old platform) because the JSON file store is a
 *     first-class backend. When it IS set it must be a postgres:// URL.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { v } = require('./validate');

/**
 * Minimal .env parser. Handles KEY=value, quoted values with escapes, `#` comments, blank lines
 * and `export ` prefixes. Existing process.env entries always win, so a container/host env var
 * is never overwritten by a stale file.
 */
function parseEnvFile(text) {
  const out = Object.create(null);
  let line = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    line += 1;
    const trimmed = rawLine.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const withoutExport = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const eq = withoutExport.indexOf('=');
    if (eq === -1) continue; // not a fatal error: tolerate junk lines in a hand-edited .env

    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = withoutExport.slice(eq + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"') && value.length >= 2)
      || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else {
      // Unquoted: strip a trailing inline comment (` KEY=value # note `).
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }

    out[key] = value;
  }
  return out;
}

function loadEnvFile(file) {
  try {
    if (fs.existsSync(file)) return parseEnvFile(fs.readFileSync(file, 'utf8'));
  } catch {
    // A unreadable .env is not fatal — host-provided env vars may be sufficient.
  }
  return {};
}

const boolSchema = v
  .enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'])
  .transform((s) => ['true', '1', 'yes', 'on'].includes(s.toLowerCase()));

const envSchema = v.object({
  NODE_ENV: v.enum(['development', 'test', 'production']).default('development'),
  PORT: v.coerce.number().int().positive().max(65535).default(3000),
  HOST: v.string().min(1).default('0.0.0.0'),
  SOCKET_PATH: v.string().optional(),
  APP_URL: v.string().url().default('http://localhost:3000'),

  // --- storage ---
  // Optional: absent means the zero-dependency JSON file store is used.
  DATABASE_URL: v.string().min(1).optional(),
  DATA_DIR: v.string().min(1).default('./data'),
  DATABASE_SSL: boolSchema.default('false'),
  DATABASE_SSL_REJECT_UNAUTHORIZED: boolSchema.default('true'),
  DATABASE_POOL_MAX: v.coerce.number().int().positive().max(50).default(5),

  // --- auth ---
  // Optional at schema level; enforced in validateSecrets() so development can derive one.
  JWT_SECRET: v.string().min(32, 'JWT_SECRET must be at least 32 characters').optional(),
  JWT_EXPIRES_IN: v.string().min(2).default('12h'),
  REFRESH_TOKEN_EXPIRES_IN: v.string().min(2).default('30d'),
  CRON_JOB_TOKEN: v.string().min(16).optional(),

  // --- ops ---
  LOG_LEVEL: v.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // --- serving ---
  PUBLIC_DIR: v.string().default('./public'),
  SPA_DIR: v.string().default('./spa/dist'),
  STATIC_MAX_AGE: v.coerce.number().int().min(0).default(3600),
  SERVE_SPA: boolSchema.default('true'),

  // --- rate limiting ---
  RATE_LIMIT_WINDOW_MS: v.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX: v.coerce.number().int().positive().default(300),
  RATE_LIMIT_AUTH_MAX: v.coerce.number().int().positive().default(20),

  // --- payments (optional) ---
  MANUAL_PAYMENT_INSTRUCTIONS: v.string().max(2000).optional(),
  SANDBOX_GATEWAY_WEBHOOK_SECRET: v.string().min(16).optional(),
  // When true, the sandbox gateway can be charged/completed without a live PSP. Refused in
  // production so a misconfigured prod host cannot mint "paid" invoices.
  SANDBOX_PAYMENTS: boolSchema.default('true'),

  // --- agent (optional) ---
  // Shared secret the on-server agent presents. Absent disables the agent endpoints.
  AGENT_TOKEN: v.string().min(16).optional(),
}).passthrough();

/** Parse "12h", "30d", "90s", "500ms" into milliseconds. */
function parseDuration(input) {
  if (typeof input === 'number') return input;
  const match = /^(\d+)\s*(ms|s|m|h|d)$/.exec(String(input).trim());
  if (!match) throw new Error(`Invalid duration: ${input}`);
  const value = Number(match[1]);
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]];
  return value * unit;
}

/**
 * Load and validate configuration.
 * @param {object} options
 * @param {string} [options.cwd]      project root (defaults to platform/)
 * @param {object} [options.overrides] extra env values, used by tests
 */
function loadConfig(options = {}) {
  const cwd = options.cwd ?? path.join(__dirname, '..', '..');
  const envPath = options.envPath ?? path.join(cwd, '.env');

  const fileVars = loadEnvFile(envPath);
  const merged = { ...fileVars, ...process.env, ...(options.overrides ?? {}) };

  // Strip empty strings so `JWT_SECRET=` in .env reads as "unset", not "set to empty".
  const input = {};
  for (const [key, value] of Object.entries(merged)) {
    if (value !== '' && value !== undefined) input[key] = value;
  }

  const parsed = envSchema.parse(input);
  const warnings = [];

  // Secrets: no hardcoded production fallback. In development we derive an ephemeral one so a
  // fresh checkout boots, and say so loudly on every start.
  if (!parsed.JWT_SECRET) {
    if (parsed.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET is required in production and must be at least 32 characters');
    }
    parsed.JWT_SECRET = crypto.randomBytes(48).toString('base64url');
    parsed.JWT_SECRET_EPHEMERAL = true;
    warnings.push('JWT_SECRET is not set — using an ephemeral secret; all sessions end on restart');
  }

  const resolve = (p) => (path.isAbsolute(p) ? p : path.resolve(cwd, p));
  parsed.DATA_DIR = resolve(parsed.DATA_DIR);
  parsed.PUBLIC_DIR = resolve(parsed.PUBLIC_DIR);
  parsed.SPA_DIR = resolve(parsed.SPA_DIR);
  parsed.CWD = cwd;

  parsed.JWT_EXPIRES_MS = parseDuration(parsed.JWT_EXPIRES_IN);
  parsed.REFRESH_TOKEN_EXPIRES_MS = parseDuration(parsed.REFRESH_TOKEN_EXPIRES_IN);

  parsed.usingPostgres = Boolean(parsed.DATABASE_URL);
  if (parsed.DATABASE_URL && !/^postgres(ql)?:\/\//.test(parsed.DATABASE_URL)) {
    throw new Error('DATABASE_URL must be a postgres:// or postgresql:// connection string');
  }

  return { config: parsed, warnings };
}

module.exports = { loadConfig, parseEnvFile, parseDuration, envSchema };
