/**
 * Application manifest schema (spec §10, §48, §49, §52) — ported from the original's
 * manifest-schema.ts, which used zod. The validation here is hand-written for the same reason the
 * YAML parser is: no third-party validator is available to this build.
 *
 * Every deployable application is described by ONE declarative manifest. There is no
 * per-application deployment code: the engine renders whatever a validated manifest says into a
 * Docker Compose project, cPanel provisioning calls, or Kubernetes objects.
 *
 * Errors are returned as `path: message` (or `(root): message`), and *every* issue is reported at
 * once — an admin fixing a manifest should not play whack-a-mole. Defaults are applied to the
 * returned manifest, so callers get the same normalised document the original's zod schema produced.
 */
'use strict';

const HOSTING_TYPES = ['shared', 'cpanel', 'vps', 'dedicated', 'docker', 'kubernetes'];
const DEPLOYMENT_ENGINES = ['docker-compose', 'cpanel', 'kubernetes'];
const UPDATE_STRATEGIES = ['recreate', 'pull-and-recreate', 'rolling'];
const DATABASES = ['postgres', 'mysql', 'mariadb', 'mongodb', 'redis'];
const BACKUP_INCLUDES = ['volumes', 'database'];
const HEALTHCHECK_TYPES = ['http', 'tcp', 'command'];
const CPANEL_INSTALLERS = ['wordpress', 'static-site', 'custom'];

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ENV_KEY_RE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+|__[a-zA-Z0-9_]+)*$/;
const SERVICE_NAME_RE = /^[a-z0-9_-]{1,40}$/;
const DURATION_RE = /^\d+(ms|s|m|h)$/;
const URL_RE = /^https?:\/\/[^\s]+$/;

/** The canonical marketplace category list (spec §7) — ported verbatim. */
const CANONICAL_CATEGORIES = [
  { slug: 'ai', name: 'AI', description: 'LLM frontends, model serving, and machine-learning tools', sortOrder: 10 },
  { slug: 'analytics', name: 'Analytics', description: 'Web, product, and event analytics', sortOrder: 20 },
  { slug: 'automation', name: 'Automation', description: 'Workflow automation and integrations', sortOrder: 30 },
  { slug: 'business', name: 'Business', description: 'General business software', sortOrder: 40 },
  { slug: 'cms', name: 'CMS', description: 'Content management and blogging platforms', sortOrder: 50 },
  { slug: 'communication', name: 'Communication', description: 'Chat, email, and collaboration servers', sortOrder: 60 },
  { slug: 'crm', name: 'CRM', description: 'Customer relationship management', sortOrder: 70 },
  { slug: 'database', name: 'Database', description: 'Database servers and management tools', sortOrder: 80 },
  { slug: 'developer-tools', name: 'Developer Tools', description: 'Git, CI, and engineering productivity', sortOrder: 90 },
  { slug: 'documents', name: 'Documents', description: 'Document management and editors', sortOrder: 100 },
  { slug: 'e-commerce', name: 'E-commerce', description: 'Online stores and selling platforms', sortOrder: 110 },
  { slug: 'education', name: 'Education', description: 'Learning management systems', sortOrder: 120 },
  { slug: 'finance', name: 'Finance', description: 'Accounting, budgeting, and invoicing', sortOrder: 130 },
  { slug: 'home-automation', name: 'Home Automation', description: 'Smart home hubs and controllers', sortOrder: 140 },
  { slug: 'media', name: 'Media', description: 'Photo, video, and music servers', sortOrder: 150 },
  { slug: 'monitoring', name: 'Monitoring', description: 'Uptime, metrics, and alerting', sortOrder: 160 },
  { slug: 'networking', name: 'Networking', description: 'DNS, VPN, and network services', sortOrder: 170 },
  { slug: 'productivity', name: 'Productivity', description: 'Files, notes, and personal tools', sortOrder: 180 },
  { slug: 'project-management', name: 'Project Management', description: 'Tasks, boards, and planning', sortOrder: 190 },
  { slug: 'security', name: 'Security', description: 'Secrets, identity, and access management', sortOrder: 200 },
  { slug: 'storage', name: 'Storage', description: 'Object storage and file synchronization', sortOrder: 210 },
  { slug: 'system-administration', name: 'System Administration', description: 'Infrastructure dashboards and ops tooling', sortOrder: 220 },
  { slug: 'web-hosting', name: 'Web Hosting', description: 'Hosting control panels and web serving', sortOrder: 230 },
  { slug: 'infrastructure', name: 'Infrastructure', description: 'Core platform infrastructure components', sortOrder: 240 },
];

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Collects `path: message` issues, mirroring zod's issue paths. */
class Issues {
  constructor() { this.list = []; }
  add(path, message) { this.list.push(`${path || '(root)'}: ${message}`); }
}

function checkString(issues, path, value, options = {}) {
  if (value === undefined) {
    if (options.required) issues.add(path, 'Required');
    return undefined;
  }
  if (value === null) return null;
  if (typeof value !== 'string') { issues.add(path, 'Expected string'); return undefined; }
  if (options.min !== undefined && value.length < options.min) {
    issues.add(path, options.minMessage ?? `String must contain at least ${options.min} character(s)`);
  } else if (options.max !== undefined && value.length > options.max) {
    issues.add(path, `String must contain at most ${options.max} character(s)`);
  } else if (options.regex && !options.regex.test(value)) {
    issues.add(path, options.regexMessage ?? 'Invalid format');
  } else if (options.url && !URL_RE.test(value)) {
    issues.add(path, 'Invalid url');
  }
  return value;
}

function checkNumber(issues, path, value, options = {}) {
  if (value === undefined) {
    if (options.required) issues.add(path, 'Required');
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    issues.add(path, 'Expected number'); return undefined;
  }
  if (options.min !== undefined && value < options.min) issues.add(path, `Number must be greater than or equal to ${options.min}`);
  else if (options.max !== undefined && value > options.max) issues.add(path, `Number must be less than or equal to ${options.max}`);
  return value;
}

function checkBoolean(issues, path, value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') { issues.add(path, 'Expected boolean'); return undefined; }
  return value;
}

function checkEnum(issues, path, value, allowed) {
  if (value === undefined) return undefined;
  if (!allowed.includes(value)) {
    issues.add(path, `Invalid enum value. Expected ${allowed.map((a) => `'${a}'`).join(' | ')}, received '${value}'`);
    return undefined;
  }
  return value;
}

function checkStringArray(issues, path, value, options = {}) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) { issues.add(path, 'Expected array'); return undefined; }
  if (options.min !== undefined && value.length < options.min) issues.add(path, `Array must contain at least ${options.min} element(s)`);
  value.forEach((item, index) => {
    if (typeof item !== 'string') issues.add(`${path}.${index}`, 'Expected string');
    else {
      if (options.itemMin !== undefined && item.length < options.itemMin) issues.add(`${path}.${index}`, `String must contain at least ${options.itemMin} character(s)`);
      if (options.itemMax !== undefined && item.length > options.itemMax) issues.add(`${path}.${index}`, `String must contain at most ${options.itemMax} character(s)`);
    }
  });
  return value;
}

function validateEnvironmentEntry(issues, path, raw) {
  if (!isPlainObject(raw)) { issues.add(path, 'Expected object'); return null; }
  const entry = {};
  entry.key = checkString(issues, `${path}.key`, raw.key, {
    required: true, min: 1, max: 255, regex: ENV_KEY_RE,
    regexMessage: 'environment keys must be UPPER_SNAKE_CASE',
  });
  entry.description = checkString(issues, `${path}.description`, raw.description, { max: 500 });
  entry.secret = checkBoolean(issues, `${path}.secret`, raw.secret) ?? false;
  if (raw.generate !== undefined) entry.generate = checkEnum(issues, `${path}.generate`, raw.generate, ['random_32']);
  entry.defaultFromDomain = checkBoolean(issues, `${path}.defaultFromDomain`, raw.defaultFromDomain) ?? false;
  entry.defaultFromUrl = checkBoolean(issues, `${path}.defaultFromUrl`, raw.defaultFromUrl) ?? false;
  entry.default = checkString(issues, `${path}.default`, raw.default, { max: 2000 });
  entry.label = checkString(issues, `${path}.label`, raw.label, { max: 160 });
  entry.required = checkBoolean(issues, `${path}.required`, raw.required) ?? true;
  return entry;
}

function validateService(issues, path, raw) {
  if (!isPlainObject(raw)) { issues.add(path, 'Expected object'); return null; }
  const service = {};
  service.image = checkString(issues, `${path}.image`, raw.image, { min: 1, max: 500 });
  service.port = checkNumber(issues, `${path}.port`, raw.port, { min: 1, max: 65535 });
  service.internal = checkBoolean(issues, `${path}.internal`, raw.internal) ?? false;
  service.command = checkString(issues, `${path}.command`, raw.command, { max: 2000 });
  service.volumes = checkStringArray(issues, `${path}.volumes`, raw.volumes, { itemMin: 1, itemMax: 255 }) ?? [];
  service.dependsOn = checkStringArray(issues, `${path}.dependsOn`, raw.dependsOn, { itemMin: 1, itemMax: 120 }) ?? [];
  if (raw.environment !== undefined) {
    if (!isPlainObject(raw.environment)) issues.add(`${path}.environment`, 'Expected object');
    else {
      service.environment = {};
      for (const [key, value] of Object.entries(raw.environment)) {
        if (typeof value !== 'string') issues.add(`${path}.environment.${key}`, 'Expected string');
        else service.environment[key] = value;
      }
    }
  } else service.environment = {};
  if (raw.database !== undefined) service.database = checkEnum(issues, `${path}.database`, raw.database, DATABASES);
  service.capabilities = checkStringArray(issues, `${path}.capabilities`, raw.capabilities, { itemMin: 2, itemMax: 32 });
  return service;
}

function validateVersion(issues, path, raw) {
  if (!isPlainObject(raw)) { issues.add(path, 'Expected object'); return null; }
  const version = {};
  version.version = checkString(issues, `${path}.version`, raw.version, { required: true, min: 1, max: 64 });
  version.image = checkString(issues, `${path}.image`, raw.image, { required: true, min: 1, max: 500 });
  version.releaseNotes = checkString(issues, `${path}.releaseNotes`, raw.releaseNotes, { max: 4000 });
  version.stable = checkBoolean(issues, `${path}.stable`, raw.stable) ?? false;
  if (raw.requirements !== undefined) {
    if (!isPlainObject(raw.requirements)) issues.add(`${path}.requirements`, 'Expected object');
    else {
      version.requirements = {
        cpu: checkNumber(issues, `${path}.requirements.cpu`, raw.requirements.cpu, { required: true, min: 1, max: 256 }),
        memory: checkNumber(issues, `${path}.requirements.memory`, raw.requirements.memory, { required: true, min: 64, max: 1048576 }),
        storage: checkNumber(issues, `${path}.requirements.storage`, raw.requirements.storage, { required: true, min: 512, max: 10485760 }),
      };
    }
  }
  return version;
}

/**
 * Validates a parsed YAML document against the manifest schema. Returns every issue at once, plus
 * the normalised manifest (with defaults applied) when valid.
 */
function validateManifest(input) {
  const issues = new Issues();
  if (!isPlainObject(input)) {
    return { valid: false, errors: ['(root): Expected object'] };
  }

  const manifest = {};
  manifest.id = checkString(issues, 'id', input.id, {
    required: true, min: 1, max: 160, regex: SLUG_RE, regexMessage: 'manifest id must be a lowercase slug',
  });
  manifest.name = checkString(issues, 'name', input.name, { required: true, min: 1, max: 160 });
  manifest.category = checkString(issues, 'category', input.category, {
    required: true, min: 1, max: 80, regex: SLUG_RE, regexMessage: 'category must be a lowercase slug',
  });
  manifest.description = checkString(issues, 'description', input.description, { required: true, min: 10, max: 500 });
  manifest.longDescription = checkString(issues, 'longDescription', input.longDescription, { max: 8000 });
  manifest.website = checkString(issues, 'website', input.website, { max: 500, url: true });
  manifest.repository = checkString(issues, 'repository', input.repository, { max: 500, url: true });
  manifest.documentation = checkString(issues, 'documentation', input.documentation, { max: 500, url: true });
  manifest.license = checkString(issues, 'license', input.license, { max: 64 });
  manifest.logo = checkString(issues, 'logo', input.logo, { max: 1000, url: true });
  manifest.featured = checkBoolean(issues, 'featured', input.featured) ?? false;
  manifest.popularity = checkNumber(issues, 'popularity', input.popularity, { min: 0, max: 100000 }) ?? 0;
  manifest.requiresAdminApproval = checkBoolean(issues, 'requiresAdminApproval', input.requiresAdminApproval) ?? false;

  if (input.deployment !== undefined && !isPlainObject(input.deployment)) {
    issues.add('deployment', 'Expected object');
  }
  const deployment = isPlainObject(input.deployment) ? input.deployment : {};
  manifest.deployment = {
    engine: checkEnum(issues, 'deployment.engine', deployment.engine, DEPLOYMENT_ENGINES) ?? 'docker-compose',
  };
  if (deployment.cpanelInstaller !== undefined) {
    manifest.deployment.cpanelInstaller = checkEnum(issues, 'deployment.cpanelInstaller', deployment.cpanelInstaller, CPANEL_INSTALLERS);
  }

  manifest.supportedHostingTypes = checkStringArray(issues, 'supportedHostingTypes', input.supportedHostingTypes, { min: 1 }) ?? ['docker'];
  for (const [index, value] of manifest.supportedHostingTypes.entries()) {
    if (!HOSTING_TYPES.includes(value)) issues.add(`supportedHostingTypes.${index}`, `Invalid enum value. Expected ${HOSTING_TYPES.map((h) => `'${h}'`).join(' | ')}, received '${value}'`);
  }

  if (input.requirements !== undefined && !isPlainObject(input.requirements)) issues.add('requirements', 'Expected object');
  const requirements = isPlainObject(input.requirements) ? input.requirements : {};
  // The schema's canonical form is flat (recommendedCpu/recommendedMemory/recommendedStorage), but
  // the shipped catalog writes them as a nested `recommended:` block, which a stripping validator
  // silently discards. Both are accepted so the 50+ existing manifests keep the recommendations
  // their authors wrote; the flat key wins when both are present.
  const recommended = isPlainObject(requirements.recommended) ? requirements.recommended : {};
  manifest.requirements = {
    cpu: checkNumber(issues, 'requirements.cpu', requirements.cpu, { min: 1, max: 256 }) ?? 1,
    memory: checkNumber(issues, 'requirements.memory', requirements.memory, { min: 64, max: 1048576 }) ?? 512,
    storage: checkNumber(issues, 'requirements.storage', requirements.storage, { min: 512, max: 10485760 }) ?? 5120,
    recommendedCpu: checkNumber(issues, 'requirements.recommendedCpu', requirements.recommendedCpu ?? recommended.cpu, { min: 1, max: 256 }),
    recommendedMemory: checkNumber(issues, 'requirements.recommendedMemory', requirements.recommendedMemory ?? recommended.memory, { min: 64, max: 1048576 }),
    recommendedStorage: checkNumber(issues, 'requirements.recommendedStorage', requirements.recommendedStorage ?? recommended.storage, { min: 512, max: 10485760 }),
    gpu: checkBoolean(issues, 'requirements.gpu', requirements.gpu) ?? false,
  };

  if (input.services !== undefined && !isPlainObject(input.services)) {
    issues.add('services', 'Expected object');
  }
  const services = isPlainObject(input.services) ? input.services : {};
  manifest.services = {};
  for (const [serviceName, service] of Object.entries(services)) {
    manifest.services[serviceName] = validateService(issues, `services.${serviceName}`, service);
  }
  const serviceNames = Object.keys(manifest.services);
  if (!serviceNames.includes('app') || !serviceNames.every((n) => SERVICE_NAME_RE.test(n))) {
    issues.add('services', 'manifest must define an "app" service; service names must be lowercase slug-like');
  }

  if (input.environment !== undefined && !isPlainObject(input.environment)) issues.add('environment', 'Expected object');
  const environment = isPlainObject(input.environment) ? input.environment : {};
  manifest.environment = { required: [], optional: [] };
  for (const bucket of ['required', 'optional']) {
    const entries = environment[bucket];
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) { issues.add(`environment.${bucket}`, 'Expected array'); continue; }
    manifest.environment[bucket] = entries.map((entry, index) => validateEnvironmentEntry(issues, `environment.${bucket}.${index}`, entry)).filter(Boolean);
  }

  if (input.healthcheck !== undefined) {
    const raw = input.healthcheck;
    if (!isPlainObject(raw)) issues.add('healthcheck', 'Expected object');
    else {
      const healthcheck = { type: checkEnum(issues, 'healthcheck.type', raw.type, HEALTHCHECK_TYPES) };
      healthcheck.path = checkString(issues, 'healthcheck.path', raw.path, { max: 255 });
      healthcheck.port = checkNumber(issues, 'healthcheck.port', raw.port, { min: 1, max: 65535 });
      healthcheck.service = checkString(issues, 'healthcheck.service', raw.service, { min: 1, max: 40 });
      healthcheck.command = checkStringArray(issues, 'healthcheck.command', raw.command);
      healthcheck.interval = checkString(issues, 'healthcheck.interval', raw.interval, { regex: DURATION_RE, regexMessage: 'must be a duration like 30s, 5m, 1h' }) ?? '30s';
      healthcheck.timeout = checkString(issues, 'healthcheck.timeout', raw.timeout, { regex: DURATION_RE, regexMessage: 'must be a duration like 30s, 5m, 1h' }) ?? '5s';
      healthcheck.retries = checkNumber(issues, 'healthcheck.retries', raw.retries, { min: 1, max: 10 }) ?? 3;
      manifest.healthcheck = healthcheck;
    }
  }

  const domain = isPlainObject(input.domain) ? input.domain : (input.domain !== undefined ? (issues.add('domain', 'Expected object'), {}) : {});
  manifest.domain = {
    enabled: checkBoolean(issues, 'domain.enabled', domain.enabled) ?? true,
    primaryRequired: checkBoolean(issues, 'domain.primaryRequired', domain.primaryRequired) ?? false,
  };
  const ssl = isPlainObject(input.ssl) ? input.ssl : (input.ssl !== undefined ? (issues.add('ssl', 'Expected object'), {}) : {});
  manifest.ssl = { enabled: checkBoolean(issues, 'ssl.enabled', ssl.enabled) ?? true };
  const backup = isPlainObject(input.backup) ? input.backup : (input.backup !== undefined ? (issues.add('backup', 'Expected object'), {}) : {});
  manifest.backup = {
    enabled: checkBoolean(issues, 'backup.enabled', backup.enabled) ?? true,
    includes: checkStringArray(issues, 'backup.includes', backup.includes) ?? ['volumes', 'database'],
  };
  for (const [index, value] of manifest.backup.includes.entries()) {
    if (!BACKUP_INCLUDES.includes(value)) issues.add(`backup.includes.${index}`, `Invalid enum value. Expected 'volumes' | 'database', received '${value}'`);
  }
  const update = isPlainObject(input.update) ? input.update : (input.update !== undefined ? (issues.add('update', 'Expected object'), {}) : {});
  manifest.update = { strategy: checkEnum(issues, 'update.strategy', update.strategy, UPDATE_STRATEGIES) ?? 'recreate' };

  if (input.versions === undefined) issues.add('versions', 'Required');
  else if (!Array.isArray(input.versions)) issues.add('versions', 'Expected array');
  else {
    if (input.versions.length < 1) issues.add('versions', 'Array must contain at least 1 element(s)');
    manifest.versions = input.versions.map((version, index) => validateVersion(issues, `versions.${index}`, version)).filter(Boolean);
  }

  // Cross-field rules the schema itself cannot express.
  if (manifest.services?.app && manifest.services.app.port === undefined && !manifest.services.app.internal) {
    issues.add('services.app.port', 'services.app.port is required for the customer-facing app service');
  }
  if (manifest.healthcheck?.type === 'http' && !manifest.healthcheck.path) {
    issues.add('healthcheck.path', 'healthcheck.path is required when healthcheck.type is http');
  }
  if (manifest.healthcheck?.type === 'command' && (manifest.healthcheck.command?.length ?? 0) === 0) {
    issues.add('healthcheck.command', 'healthcheck.command is required when healthcheck.type is command');
  }
  if (manifest.deployment?.engine === 'cpanel' && !(manifest.supportedHostingTypes ?? []).includes('cpanel')) {
    issues.add('supportedHostingTypes', 'a cpanel-engine manifest must list "cpanel" in supportedHostingTypes');
  }

  if (issues.list.length > 0) return { valid: false, errors: issues.list };
  return { valid: true, errors: [], manifest };
}

/** Parses "30s"/"5m"/"1h"/"250ms" into milliseconds. Throws on garbage (the schema already gates). */
function parseDuration(value) {
  const match = /^(\d+)(ms|s|m|h)$/.exec(value);
  if (!match) throw new Error(`Invalid duration: ${value}`);
  const amount = Number.parseInt(match[1], 10);
  switch (match[2]) {
    case 'ms': return amount;
    case 's': return amount * 1000;
    case 'm': return amount * 60000;
    default: return amount * 3600000;
  }
}

module.exports = {
  HOSTING_TYPES, DEPLOYMENT_ENGINES, UPDATE_STRATEGIES, CANONICAL_CATEGORIES,
  validateManifest, parseDuration,
};
