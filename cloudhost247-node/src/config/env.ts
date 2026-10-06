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

  // --- Phase 6: Marketplace / deployments ----------------------------------------------------
  // Key ring for encrypting server credentials and application secrets at rest
  // (src/lib/crypto.ts). Optional at boot — but every code path that stores or reads a secret
  // fails loudly until it is configured (MissingEncryptionKeyError), so a production deployment
  // cannot silently run without it.
  //   CREDENTIAL_ENCRYPTION_KEY=<hex64 or base64 of 32 bytes>              → single key, version 1
  //   CREDENTIAL_ENCRYPTION_KEYS=1:<hex64>,2:<hex64>                       → versioned ring
  CREDENTIAL_ENCRYPTION_KEY: z.string().optional(),
  CREDENTIAL_ENCRYPTION_KEYS: z.string().optional(),

  // Directory containing the application manifest catalog (manifests/<slug>/manifest.yaml).
  MARKETPLACE_MANIFESTS_DIR: z.string().default('manifests'),

  // When 'true', the Docker deployment adapter executes against a simulated in-process agent
  // that records every step but never touches a real server or Docker. This exists so the full
  // order → payment → deployment pipeline can be exercised in CI, staging, and demos WITHOUT
  // pretending a real deployment happened: installation rows are visibly marked
  // `simulated: true` in the API. Must never be enabled in production.
  DEPLOYMENT_SIMULATION_MODE: boolFromString.optional().default('false'),

  // --- Phase 6: Deployment worker -------------------------------------------------------------
  WORKER_ID: z.string().min(1).max(64).default(() => `worker-${process.pid}`),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(2000),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  // How long a claimed-but-unrenewed deployment lease stays valid before another worker may
  // take the job over (crash recovery). Jobs renew the lease while running.
  WORKER_LEASE_MS: z.coerce.number().int().min(10_000).max(600_000).default(120_000),
  // cPanel must invoke a bounded one-shot cycle from Cron rather than leave an SSH-launched
  // daemon running. `npm run worker:once` sets this through the CLI; this environment flag is
  // available for hosts whose scheduler cannot pass arguments.
  WORKER_ONCE: boolFromString.optional().default('false'),
  // Cycle-wide Cron lease. It serialises periodic sweeps while per-deployment leases continue to
  // protect individual provider operations. It is renewed while a one-shot cycle is running.
  WORKER_ONCE_LEASE_MS: z.coerce.number().int().min(10_000).max(3_600_000).default(900_000),

  // --- Phase 6: Backups (off-server storage) --------------------------------------------------
  // Optional S3-compatible target (AWS S3, Cloudflare R2, Wasabi, MinIO…). When unset, backups
  // can only use storage_provider='local' on the app's own server, and the admin UI reports
  // that no off-server target is configured (never silently pretending one exists).
  BACKUP_S3_ENDPOINT: z.string().url().optional(),
  BACKUP_S3_REGION: z.string().optional(),
  BACKUP_S3_BUCKET: z.string().min(1).optional(),
  BACKUP_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  BACKUP_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),

  // --- Phase 6: Kubernetes adapter ------------------------------------------------------------
  // The Kubernetes adapter is optional and OFF by default (spec §39: not mandatory for the
  // first release). Cluster access configuration lives per-server in server_credentials
  // (kubernetes_kubeconfig); this flag only enables the adapter at all.
  KUBERNETES_ADAPTER_ENABLED: boolFromString.optional().default('false'),

  // --- Infrastructure providers / OS provisioning ------------------------------------------
  // Provider secrets are optional at process boot because each CloudHost247 deployment chooses
  // its own providers. The adapter fails closed with PROVIDER_NOT_CONFIGURED when its credentials
  // are absent; no route or seed silently selects a mock provider.
  HETZNER_API_URL: z.string().url().optional(),
  HETZNER_API_TOKEN: z.string().min(1).optional(),
  DIGITALOCEAN_API_URL: z.string().url().optional(),
  DIGITALOCEAN_API_TOKEN: z.string().min(1).optional(),
  VULTR_API_URL: z.string().url().optional(),
  VULTR_API_KEY: z.string().min(1).optional(),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  AWS_REGION: z.string().min(1).optional(),
  CONTABO_API_URL: z.string().url().optional(),
  CONTABO_CLIENT_ID: z.string().min(1).optional(),
  CONTABO_CLIENT_SECRET: z.string().min(1).optional(),
  CONTABO_API_USER: z.string().min(1).optional(),
  CONTABO_API_PASSWORD: z.string().min(1).optional(),
  OVH_API_ENDPOINT: z.string().url().optional(),
  OVH_APPLICATION_KEY: z.string().min(1).optional(),
  OVH_APPLICATION_SECRET: z.string().min(1).optional(),
  OVH_CONSUMER_KEY: z.string().min(1).optional(),
  // OVH Public Cloud project ("service name") that owns the provisioned instances.
  OVH_CLOUD_PROJECT_ID: z.string().min(1).optional(),
  PROXMOX_API_URL: z.string().url().optional(),
  PROXMOX_API_TOKEN: z.string().min(1).optional(),
  VIRTUALIZOR_API_URL: z.string().url().optional(),
  VIRTUALIZOR_API_KEY: z.string().min(1).optional(),
  VIRTUALIZOR_API_SECRET: z.string().min(1).optional(),
  SOLUSVM_API_URL: z.string().url().optional(),
  SOLUSVM_API_ID: z.string().min(1).optional(),
  SOLUSVM_API_KEY: z.string().min(1).optional(),
  SOLUSVM_API_TOKEN: z.string().min(1).optional(),
  // OpenStack accepts either a Keystone v3 password login or a pre-issued token plus the Nova
  // endpoint. The adapter fails closed with PROVIDER_NOT_CONFIGURED unless one set is complete.
  OPENSTACK_AUTH_URL: z.string().url().optional(),
  OPENSTACK_USERNAME: z.string().min(1).optional(),
  OPENSTACK_PASSWORD: z.string().min(1).optional(),
  OPENSTACK_PROJECT_ID: z.string().min(1).optional(),
  OPENSTACK_PROJECT_NAME: z.string().min(1).optional(),
  OPENSTACK_USER_DOMAIN_NAME: z.string().min(1).optional(),
  OPENSTACK_PROJECT_DOMAIN_NAME: z.string().min(1).optional(),
  OPENSTACK_REGION: z.string().min(1).optional(),
  OPENSTACK_IMAGE_URL: z.string().url().optional(),
  OPENSTACK_API_URL: z.string().url().optional(),
  OPENSTACK_API_TOKEN: z.string().min(1).optional(),
  // Development-only opt-in for the mock infrastructure provider (spec §35). It is ignored in
  // production: the mock adapter refuses to run when NODE_ENV=production, and an administrator
  // must still register a provider whose adapter is literally `mock` for it to be reachable.
  ALLOW_MOCK_PROVIDER: boolFromString.optional().default('false'),
  // URL of an operator-built, self-contained server-agent installer. Required before a real
  // provision/reinstall job can become READY; the worker refuses to skip monitoring attestation.
  SERVER_AGENT_INSTALL_URL: z.string().url().optional(),
  PROVISIONING_HEALTH_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(3_600_000).default(600_000),
  // --- AI Website Builder / Logo Maker: optional external model provider -----------------------
  // The built-in ("rules") generator needs nothing. These configure an external chat-completion
  // provider; while they are unset the model engines report CONFIGURATION_REQUIRED, exactly like an
  // unconfigured registrar — no route ever substitutes the built-in generator for a model request.
  // `AI_LLM_BASE_URL` is the API root (e.g. https://api.openai.com/v1 or an OpenAI-compatible
  // gateway); `AI_LLM_API_STYLE` selects the request/response shape actually spoken.
  AI_LLM_BASE_URL: z.string().url().optional(),
  AI_LLM_API_KEY: z.string().min(8).optional(),
  AI_LLM_MODEL: z.string().min(1).max(120).optional(),
  AI_LLM_API_STYLE: z.enum(['openai', 'anthropic']).optional().default('openai'),
  AI_LLM_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(300_000).optional().default(60_000),

  // Existing mail systems can expose a server-side webhook. Neither value is sent to browsers.
  /**
   * Shared secret for `POST /api/v1/inbox/inbound`. Unset means external channels cannot post into
   * the unified inbox yet, and the route answers 503 CONFIGURATION_REQUIRED rather than accepting an
   * unauthenticated message.
   */
  INBOX_INBOUND_WEBHOOK_SECRET: z.string().min(24).optional(),
  NOTIFICATION_EMAIL_WEBHOOK_URL: z.string().url().optional(),
  /**
   * Digital-marketing integration credentials (all optional). A channel is reported as connected
   * only when its own variable is present; see src/marketing-services/campaign-service.ts.
   */
  MARKETING_PROVIDER_GOOGLE_SEARCH_CONSOLE_TOKEN: z.string().min(8).optional(),
  MARKETING_PROVIDER_AHREFS_TOKEN: z.string().min(8).optional(),
  MARKETING_PROVIDER_SEMRUSH_TOKEN: z.string().min(8).optional(),
  MARKETING_PROVIDER_GOOGLE_ADS_TOKEN: z.string().min(8).optional(),
  MARKETING_PROVIDER_BING_ADS_TOKEN: z.string().min(8).optional(),
  MARKETING_PROVIDER_META_BUSINESS_TOKEN: z.string().min(8).optional(),
  MARKETING_PROVIDER_LINKEDIN_ADS_TOKEN: z.string().min(8).optional(),
  MARKETING_PROVIDER_GOOGLE_ANALYTICS_TOKEN: z.string().min(8).optional(),
  MARKETING_PROVIDER_PLAUSIBLE_TOKEN: z.string().min(8).optional(),
  MARKETING_PROVIDER_GOOGLE_TAG_MANAGER_TOKEN: z.string().min(8).optional(),
  NOTIFICATION_EMAIL_WEBHOOK_TOKEN: z.string().min(16).optional(),
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
