/**
 * Phase 6 — application manifest schema (spec §10, §48, §49, §52).
 *
 * Every deployable application is described by ONE declarative manifest (manifests/<slug>/manifest.yaml).
 * There is no per-application deployment code: the deployment engine renders whatever a validated
 * manifest says into a Docker Compose project (Docker adapter), cPanel provisioning calls
 * (cPanel adapter), or Kubernetes objects (Kubernetes adapter).
 *
 * This module is the single definition of what a manifest may contain. It is used in three
 * places, always through the same code:
 *   1. The manifest importer (validates files on disk before anything reaches the database).
 *   2. The admin "validate manifest" API (spec §46) — validation without importing.
 *   3. The worker (re-validates the stored manifest jsonb before deploying, defense in depth).
 *
 * Design rules:
 *   - `id` is the slug and must match the manifest's directory name.
 *   - The `app` service is the customer-facing main service; any other services are dependencies
 *     (databases, queues) that the engine starts in the same isolated Compose project.
 *   - Required environment entries declare HOW their value is produced: `generate: random_32`
 *     (platform generates a strong secret), `default_from_domain` (the installation's primary
 *     domain), or customer-supplied (wizard collects it; install refuses to run without it).
 *   - Health checks (spec §52) are declared here and enforced by the worker's healthcheck job.
 */
import { z } from 'zod';

export const HOSTING_TYPES = ['shared', 'cpanel', 'vps', 'dedicated', 'docker', 'kubernetes'] as const;
export type HostingType = (typeof HOSTING_TYPES)[number];

export const DEPLOYMENT_ENGINES = ['docker-compose', 'cpanel', 'kubernetes'] as const;
export type DeploymentEngine = (typeof DEPLOYMENT_ENGINES)[number];

export const UPDATE_STRATEGIES = ['recreate', 'pull-and-recreate', 'rolling'] as const;

/** Duration string like "30s", "5m", "1h" — kept as a string; the worker parses with parseDuration. */
const durationString = z
  .string()
  .regex(/^\d+(ms|s|m|h)$/, 'must be a duration like 30s, 5m, 1h');

const hostingTypesSchema = z.array(z.enum(HOSTING_TYPES)).min(1);

export const manifestEnvironmentEntrySchema = z.object({
  key: z
    .string()
    .min(1)
    .max(255)
    // UPPER_SNAKE_CASE, additionally permitting lowercase segments after a double underscore
    // (Gitea's GITEA__section__KEY convention).
    .regex(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+|__[a-zA-Z0-9_]+)*$/, 'environment keys must be UPPER_SNAKE_CASE'),
  description: z.string().max(500).optional(),
  /** Secret values are encrypted at rest and never returned by any API (only their keys are). */
  secret: z.boolean().optional().default(false),
  /** random_32 — the platform generates a 32-byte URL-safe secret at install time. */
  generate: z.enum(['random_32']).optional(),
  /** Value defaults to the installation's primary domain (e.g. N8N_EDITOR_BASE_URL). */
  defaultFromDomain: z.boolean().optional().default(false),
  /** Value defaults to the platform's external URL for this installation (https://domain). */
  defaultFromUrl: z.boolean().optional().default(false),
  /** Static default applied when the customer supplies nothing. */
  default: z.string().max(2000).optional(),
  label: z.string().max(160).optional(),
  required: z.boolean().optional().default(true),
});

export const manifestServiceSchema = z.object({
  image: z.string().min(1).max(500).optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  /** Internal services (databases) are never exposed through Traefik. */
  internal: z.boolean().optional().default(false),
  command: z.string().max(2000).optional(),
  volumes: z.array(z.string().min(1).max(255)).optional().default([]),
  dependsOn: z.array(z.string().min(1).max(120)).optional().default([]),
  environment: z.record(z.string()).optional().default({}),
  /** Declared so the engine can pre-provision a managed database of this type. */
  database: z.enum(['postgres', 'mysql', 'mariadb', 'mongodb', 'redis']).optional(),
  /** Linux capabilities the container needs (e.g. NET_ADMIN for VPN containers). */
  capabilities: z.array(z.string().min(2).max(32)).optional(),
});

export const manifestHealthcheckSchema = z.object({
  type: z.enum(['http', 'tcp', 'command']),
  path: z.string().max(255).optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  /** Which service to probe when the customer-facing app proxies to an internal one. */
  service: z.string().min(1).max(40).optional(),
  command: z.array(z.string()).optional(),
  interval: durationString.default('30s'),
  timeout: durationString.default('5s'),
  retries: z.coerce.number().int().min(1).max(10).default(3),
});

export const manifestVersionSchema = z.object({
  version: z.string().min(1).max(64),
  image: z.string().min(1).max(500),
  releaseNotes: z.string().max(4000).optional(),
  stable: z.boolean().optional().default(false),
  /** Per-version minimums override the application-level defaults (spec §9). */
  requirements: z
    .object({
      cpu: z.coerce.number().int().min(1).max(256),
      memory: z.coerce.number().int().min(64).max(1048576),
      storage: z.coerce.number().int().min(512).max(10485760),
    })
    .optional(),
});

export const applicationManifestSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(160)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'manifest id must be a lowercase slug'),
  name: z.string().min(1).max(160),
  category: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'category must be a lowercase slug'),
  description: z.string().min(10).max(500),
  longDescription: z.string().max(8000).optional(),
  website: z.string().url().max(500).optional(),
  repository: z.string().url().max(500).optional(),
  documentation: z.string().url().max(500).optional(),
  license: z.string().max(64).optional(),
  logo: z.string().url().max(1000).optional(),
  featured: z.boolean().optional().default(false),
  popularity: z.coerce.number().int().min(0).max(100000).optional().default(0),
  requiresAdminApproval: z.boolean().optional().default(false),

  deployment: z.object({
    engine: z.enum(DEPLOYMENT_ENGINES).default('docker-compose'),
    /** For cPanel engine: the installable package kind (spec §38). */
    cpanelInstaller: z.enum(['wordpress', 'static-site', 'custom']).optional(),
  }),

  supportedHostingTypes: hostingTypesSchema.default(['docker']),

  requirements: z.object({
    cpu: z.coerce.number().int().min(1).max(256).default(1),
    memory: z.coerce.number().int().min(64).max(1048576).default(512),
    storage: z.coerce.number().int().min(512).max(10485760).default(5120),
    recommendedCpu: z.coerce.number().int().min(1).max(256).optional(),
    recommendedMemory: z.coerce.number().int().min(64).max(1048576).optional(),
    recommendedStorage: z.coerce.number().int().min(512).max(10485760).optional(),
    gpu: z.boolean().optional().default(false),
  }),

  services: z.record(manifestServiceSchema).refine(
    (services) => {
      const names = Object.keys(services);
      return names.includes('app') && names.every((n) => /^[a-z0-9_-]{1,40}$/.test(n));
    },
    { message: 'manifest must define an "app" service; service names must be lowercase slug-like' }
  ),

  environment: z
    .object({
      required: z.array(manifestEnvironmentEntrySchema).optional().default([]),
      optional: z.array(manifestEnvironmentEntrySchema).optional().default([]),
    })
    .optional()
    .default({ required: [], optional: [] }),

  healthcheck: manifestHealthcheckSchema.optional(),

  domain: z
    .object({
      enabled: z.boolean().default(true),
      primaryRequired: z.boolean().default(false),
    })
    .optional()
    .default({ enabled: true, primaryRequired: false }),

  ssl: z
    .object({
      enabled: z.boolean().default(true),
    })
    .optional()
    .default({ enabled: true }),

  backup: z
    .object({
      enabled: z.boolean().default(true),
      includes: z.array(z.enum(['volumes', 'database'])).optional().default(['volumes', 'database']),
    })
    .optional()
    .default({ enabled: true, includes: ['volumes', 'database'] }),

  update: z
    .object({
      strategy: z.enum(UPDATE_STRATEGIES).default('recreate'),
    })
    .optional()
    .default({ strategy: 'recreate' }),

  versions: z.array(manifestVersionSchema).min(1),
});

export type ApplicationManifest = z.infer<typeof applicationManifestSchema>;
export type ManifestService = z.infer<typeof manifestServiceSchema>;
export type ManifestEnvironmentEntry = z.infer<typeof manifestEnvironmentEntrySchema>;
export type ManifestHealthcheck = z.infer<typeof manifestHealthcheckSchema>;

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
  manifest?: ApplicationManifest;
}

/**
 * Validates a parsed YAML document (or any unknown object) against the manifest schema.
 * Returns every issue at once — an admin fixing a manifest should not play whack-a-mole.
 */
export function validateManifest(input: unknown): ManifestValidationResult {
  const result = applicationManifestSchema.safeParse(input);
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    };
  }
  const manifest = result.data;

  const errors: string[] = [];
  if (manifest.services.app?.port === undefined && !manifest.services.app?.internal) {
    errors.push('services.app.port is required for the customer-facing app service');
  }
  if (manifest.healthcheck?.type === 'http' && !manifest.healthcheck.path) {
    errors.push('healthcheck.path is required when healthcheck.type is http');
  }
  if (manifest.healthcheck?.type === 'command' && (manifest.healthcheck.command?.length ?? 0) === 0) {
    errors.push('healthcheck.command is required when healthcheck.type is command');
  }
  if (
    manifest.deployment.engine === 'cpanel' &&
    !manifest.supportedHostingTypes.includes('cpanel')
  ) {
    errors.push('a cpanel-engine manifest must list "cpanel" in supportedHostingTypes');
  }
  if (errors.length > 0) {
    return { valid: false, errors, manifest };
  }
  return { valid: true, errors: [], manifest };
}

/** Parses "30s"/"5m"/"1h"/"250ms" into milliseconds. Throws on garbage (schema already gates). */
export function parseDuration(value: string): number {
  const match = /^(\d+)(ms|s|m|h)$/.exec(value);
  const amountPart = match?.[1];
  const unitPart = match?.[2];
  if (!amountPart || !unitPart) throw new Error(`Invalid duration: ${value}`);
  const amount = Number.parseInt(amountPart, 10);
  switch (unitPart) {
    case 'ms':
      return amount;
    case 's':
      return amount * 1000;
    case 'm':
      return amount * 60_000;
    case 'h':
      return amount * 3_600_000;
    default:
      throw new Error(`Invalid duration: ${value}`);
  }
}
