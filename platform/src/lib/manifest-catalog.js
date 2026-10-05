/**
 * Manifest catalog loader and importer (spec §10) — ported from the original's
 * marketplace/manifest-loader.ts and marketplace/import-service.ts.
 *
 * The on-disk catalog (manifests/<slug>/manifest.yaml) is the SOURCE of truth for what can be
 * imported, but never for what is deployed: importing copies the validated document into the
 * application record, and the engine deploys only what the database says.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseYaml } = require('./yaml');
const { CANONICAL_CATEGORIES, validateManifest } = require('./manifest-schema');
const { uuidv7 } = require('./ids');

/** Relative paths resolve against the application root (cwd), like the original. */
function resolveManifestsDir(configured, cwd) {
  if (!configured) return path.resolve(cwd, 'manifests');
  return path.isAbsolute(configured) ? configured : path.resolve(cwd, configured);
}

/**
 * Scans the catalog directory for <slug>/manifest.yaml files, parses each, and validates it. A
 * manifest whose `id` does not match its directory name is invalid — this keeps slugs honest and
 * prevents two files claiming the same application.
 */
function loadManifestCatalog(dir) {
  const result = { dir, loaded: [], invalid: [] };
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir).sort()) {
    const entryPath = path.join(dir, entry);
    if (!fs.statSync(entryPath).isDirectory()) continue;
    const manifestPath = path.join(entryPath, 'manifest.yaml');
    if (!fs.existsSync(manifestPath)) continue;
    const source = path.relative(process.cwd(), manifestPath) || manifestPath;
    let parsed;
    try {
      parsed = parseYaml(fs.readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      result.invalid.push({ source, errors: [`YAML parse error: ${error.message}`] });
      continue;
    }
    const validation = validateManifest(parsed);
    if (!validation.valid) {
      result.invalid.push({ source, errors: validation.errors });
      continue;
    }
    if (validation.manifest.id !== entry) {
      result.invalid.push({
        source,
        errors: [`manifest id "${validation.manifest.id}" does not match directory name "${entry}"`],
      });
      continue;
    }
    result.loaded.push({ source, result: validation });
  }
  return result;
}

/** Validates one YAML document (the admin "validate manifest" API, spec §46). */
function validateManifestYaml(yamlText) {
  let parsed;
  try {
    parsed = parseYaml(yamlText);
  } catch (error) {
    return { valid: false, errors: [`YAML parse error: ${error.message}`] };
  }
  return validateManifest(parsed);
}

const validatedManifests = (catalog) => catalog.loaded.map((item) => item.result.manifest);

/** Idempotently ensures the canonical category rows exist; returns the slugs it created. */
async function ensureCanonicalCategories(store) {
  const existing = await store.table('application_categories').all();
  const bySlug = new Set(existing.map((row) => row.slug));
  const created = [];
  for (const canonical of CANONICAL_CATEGORIES) {
    if (bySlug.has(canonical.slug)) continue;
    await store.table('application_categories').insert({
      id: uuidv7(), slug: canonical.slug, name: canonical.name,
      description: canonical.description, sort_order: canonical.sortOrder, active: true,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    created.push(canonical.slug);
  }
  return created;
}

const EMPTY_REPORT = () => ({ categoriesCreated: [], applicationsCreated: [], applicationsUpdated: [], versionsUpserted: 0 });

/** Imports one validated manifest, reporting which entities were created versus updated. */
async function importManifest(store, manifest) {
  const report = EMPTY_REPORT();

  let category = await store.table('application_categories').findOne({ slug: manifest.category });
  if (!category) {
    const canonical = CANONICAL_CATEGORIES.find((c) => c.slug === manifest.category);
    category = await store.table('application_categories').insert({
      id: uuidv7(), slug: manifest.category, name: canonical?.name ?? manifest.category,
      description: canonical?.description ?? null, sort_order: canonical?.sortOrder ?? 500, active: true,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    report.categoriesCreated.push(category.slug);
  }

  const deploymentType = manifest.deployment.engine === 'cpanel' ? 'cpanel'
    : manifest.deployment.engine === 'kubernetes' ? 'kubernetes' : 'docker_compose';
  const latest = manifest.versions[manifest.versions.length - 1];
  const fields = {
    category_id: category.id,
    name: manifest.name,
    description: manifest.description,
    long_description: manifest.longDescription ?? null,
    logo_url: manifest.logo ?? null,
    website_url: manifest.website ?? null,
    repository_url: manifest.repository ?? null,
    documentation_url: manifest.documentation ?? null,
    license: manifest.license ?? null,
    deployment_type: deploymentType,
    featured: manifest.featured,
    popularity: manifest.popularity,
    requires_admin_approval: manifest.requiresAdminApproval,
    min_cpu: manifest.requirements.cpu,
    min_memory_mb: manifest.requirements.memory,
    min_storage_mb: manifest.requirements.storage,
    recommended_cpu: manifest.requirements.recommendedCpu ?? manifest.requirements.cpu,
    recommended_memory_mb: manifest.requirements.recommendedMemory ?? manifest.requirements.memory,
    recommended_storage_mb: manifest.requirements.recommendedStorage ?? manifest.requirements.storage,
    gpu_required: manifest.requirements.gpu ?? false,
    supported_hosting_types: manifest.supportedHostingTypes,
    version: latest?.version ?? null,
    icon: manifest.logo ?? null,
    updated_at: new Date().toISOString(),
  };

  const existing = await store.table('applications').findOne({ slug: manifest.id });
  let applicationId;
  if (!existing) {
    // Newly imported applications start in draft: the approval workflow (spec §47) — not the
    // importer — moves them to published.
    const created = await store.table('applications').insert({
      id: uuidv7(), slug: manifest.id, status: 'draft', active: true, ...fields,
      created_at: new Date().toISOString(),
    });
    applicationId = created.id;
    report.applicationsCreated.push(created.slug);
  } else {
    const updated = await store.table('applications').updateById(existing.id, fields);
    applicationId = updated?.id ?? existing.id;
    report.applicationsUpdated.push(existing.slug);
  }

  for (const version of manifest.versions) {
    const stored = {
      application_id: applicationId,
      version: version.version,
      release_notes: version.releaseNotes ?? null,
      is_stable: version.stable ?? false,
      // Version publication also follows the approval workflow: imported versions are drafts.
      status: 'draft',
      manifest,
      updated_at: new Date().toISOString(),
    };
    const existingVersion = await store.table('application_versions').findOne({
      application_id: applicationId, version: version.version,
    });
    if (existingVersion) await store.table('application_versions').updateById(existingVersion.id, stored);
    else await store.table('application_versions').insert({ id: uuidv7(), ...stored, created_at: new Date().toISOString() });
    report.versionsUpserted += 1;
  }

  return report;
}

/** Imports a validated manifest set: canonical categories first, then each manifest. */
async function importManifests(store, manifests) {
  const combined = EMPTY_REPORT();
  combined.categoriesCreated.push(...await ensureCanonicalCategories(store));
  for (const manifest of manifests) {
    const report = await importManifest(store, manifest);
    combined.categoriesCreated.push(...report.categoriesCreated);
    combined.applicationsCreated.push(...report.applicationsCreated);
    combined.applicationsUpdated.push(...report.applicationsUpdated);
    combined.versionsUpserted += report.versionsUpserted;
  }
  return combined;
}

module.exports = {
  resolveManifestsDir, loadManifestCatalog, validateManifestYaml, validatedManifests,
  ensureCanonicalCategories, importManifest, importManifests,
};
