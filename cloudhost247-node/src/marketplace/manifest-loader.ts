/**
 * Phase 6 — loads and validates manifest YAML files from the catalog directory (spec §10).
 *
 * The on-disk catalog (manifests/<slug>/manifest.yaml) is the SOURCE of truth for what can be
 * imported, but never for what is deployed: importing copies the validated document into
 * application_versions.manifest, and the worker deploys only what the database says.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { validateManifest, type ApplicationManifest, type ManifestValidationResult } from './manifest-schema';

export interface LoadedManifest {
  /** File the manifest came from (for error messages / admin tooling). */
  source: string;
  result: ManifestValidationResult;
}

export interface ManifestCatalogLoadResult {
  /** Root directory that was scanned. */
  dir: string;
  loaded: LoadedManifest[];
  /** Files that failed to parse/validate, with reasons. Importing aborts if this is non-empty. */
  invalid: Array<{ source: string; errors: string[] }>;
}

export function resolveManifestsDir(configured: string): string {
  // Relative paths resolve against the application root (cwd), not dist/src/marketplace — so
  // `manifests` means <repo>/cloudhost247-node/manifests in dev and in production alike.
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

/**
 * Scans the catalog directory for <slug>/manifest.yaml files, parses each as YAML, and validates
 * it against the schema. A manifest whose `id` does not match its directory name is invalid —
 * this keeps slugs honest and prevents two files claiming the same application.
 */
export function loadManifestCatalog(dirInput?: string, envDir?: string): ManifestCatalogLoadResult {
  const dir = dirInput ?? resolveManifestsDir(envDir ?? 'manifests');
  if (!existsSync(dir)) {
    return { dir, loaded: [], invalid: [] };
  }

  const loaded: LoadedManifest[] = [];
  const invalid: ManifestCatalogLoadResult['invalid'] = [];

  for (const entry of readdirSync(dir).sort()) {
    const entryPath = path.join(dir, entry);
    if (!statSync(entryPath).isDirectory()) continue;
    const manifestPath = path.join(entryPath, 'manifest.yaml');
    if (!existsSync(manifestPath)) continue;

    const source = path.relative(process.cwd(), manifestPath) || manifestPath;
    let parsed: unknown;
    try {
      parsed = parseYaml(readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      invalid.push({ source, errors: [`YAML parse error: ${(err as Error).message}`] });
      continue;
    }

    const result = validateManifest(parsed);
    if (!result.valid) {
      invalid.push({ source, errors: result.errors });
      continue;
    }
    if (result.manifest && result.manifest.id !== entry) {
      invalid.push({
        source,
        errors: [`manifest id "${result.manifest.id}" does not match directory name "${entry}"`],
      });
      continue;
    }
    loaded.push({ source, result });
  }

  return { dir, loaded, invalid };
}

/** Convenience accessor for a single already-validated manifest (importer, tests). */
export function validatedManifests(result: ManifestCatalogLoadResult): ApplicationManifest[] {
  return result.loaded.map((l) => l.result.manifest).filter((m): m is ApplicationManifest => !!m);
}

/** Validates one YAML document (admin "validate manifest" API, spec §46). */
export function validateManifestYaml(yamlText: string): ManifestValidationResult {
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (err) {
    return { valid: false, errors: [`YAML parse error: ${(err as Error).message}`] };
  }
  return validateManifest(parsed);
}
