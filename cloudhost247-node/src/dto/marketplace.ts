/**
 * Phase 6 — DTOs for the public marketplace API (spec §22, §42).
 *
 * Same rule as the hosting catalog (src/dto/catalog.ts): public responses expose slugs, never
 * internal ids or workflow states. Installable versions are surfaced with their stable marker;
 * non-published versions are not listed at all.
 */
import type { ApplicationRow, ApplicationVersionRow } from '../db/applications';
import type { ApplicationCategoryRow } from '../db/application-categories';
import type { HostingType } from '../marketplace/manifest-schema';

export interface MarketplaceCategoryDTO {
  slug: string;
  name: string;
  description: string | null;
}

export interface MarketplaceAppCardDTO {
  slug: string;
  name: string;
  description: string;
  logoUrl: string | null;
  category: { slug: string; name: string } | null;
  license: string | null;
  featured: boolean;
  popularity: number;
  installCount: number;
  requirements: {
    minCpu: number;
    minMemoryMb: number;
    minStorageMb: number;
    recommendedCpu: number;
    recommendedMemoryMb: number;
    recommendedStorageMb: number;
    gpu: boolean;
  };
  supportedHostingTypes: HostingType[];
  stableVersion: string | null;
}

export interface MarketplaceAppDetailDTO extends MarketplaceAppCardDTO {
  longDescription: string | null;
  websiteUrl: string | null;
  repositoryUrl: string | null;
  documentationUrl: string | null;
  deploymentType: string;
  versions: Array<{
    id: string;
    version: string;
    releaseNotes: string | null;
    stable: boolean;
    requirements: { minCpu: number; minMemoryMb: number; minStorageMb: number };
  }>;
  /**
   * Keys the installer will ask for (values are NEVER included; secrets stay server-side).
   * The flags tell the UI which blank inputs are valid because the worker will generate or derive
   * them server-side; without them the browser cannot distinguish "customer must provide" from
   * "leave blank to generate".
   */
  environment: {
    required: Array<{
      key: string;
      label: string | null;
      description: string | null;
      secret: boolean;
      generated: boolean;
      defaultFromDomain: boolean;
      defaultFromUrl: boolean;
      default: string | null;
      customerProvided: boolean;
    }>;
    optional: Array<{
      key: string;
      label: string | null;
      description: string | null;
      secret: boolean;
      default: string | null;
      defaultFromDomain: boolean;
      defaultFromUrl: boolean;
    }>;
  };
  domainRequired: boolean;
  sslSupported: boolean;
  backupsSupported: boolean;
}

export function toAppCardDTO(
  application: ApplicationRow,
  category: ApplicationCategoryRow | null,
  stableVersion: string | null,
  installCount: number
): MarketplaceAppCardDTO {
  return {
    slug: application.slug,
    name: application.name,
    description: application.description,
    logoUrl: application.logo_url,
    category: category ? { slug: category.slug, name: category.name } : null,
    license: application.license,
    featured: application.featured,
    popularity: application.popularity,
    installCount,
    requirements: {
      minCpu: application.min_cpu,
      minMemoryMb: application.min_memory_mb,
      minStorageMb: application.min_storage_mb,
      recommendedCpu: application.recommended_cpu,
      recommendedMemoryMb: application.recommended_memory_mb,
      recommendedStorageMb: application.recommended_storage_mb,
      gpu: application.gpu_required,
    },
    supportedHostingTypes: application.supported_hosting_types,
    stableVersion,
  };
}

export function toAppDetailDTO(
  application: ApplicationRow,
  category: ApplicationCategoryRow | null,
  versions: ApplicationVersionRow[],
  installCount: number
): MarketplaceAppDetailDTO {
  const stable = versions.find((v) => v.is_stable);
  const manifest = stable?.manifest ?? versions[0]?.manifest;
  const card = toAppCardDTO(application, category, stable?.version ?? null, installCount);

  return {
    ...card,
    longDescription: application.long_description,
    websiteUrl: application.website_url,
    repositoryUrl: application.repository_url,
    documentationUrl: application.documentation_url,
    deploymentType: application.deployment_type,
    versions: versions.map((v) => ({
      id: v.id,
      version: v.version,
      releaseNotes: v.release_notes,
      stable: v.is_stable,
      requirements: { minCpu: v.minimum_cpu, minMemoryMb: v.minimum_memory_mb, minStorageMb: v.minimum_storage_mb },
    })),
    environment: {
      required: (manifest?.environment.required ?? []).map((e) => {
        const generated = e.generate === 'random_32';
        const hasServerDefault = generated || e.defaultFromDomain || e.defaultFromUrl || e.default !== undefined;
        return {
          key: e.key,
          label: e.label ?? null,
          description: e.description ?? null,
          secret: e.secret,
          generated,
          defaultFromDomain: e.defaultFromDomain,
          defaultFromUrl: e.defaultFromUrl,
          default: e.default ?? null,
          customerProvided: !hasServerDefault,
        };
      }),
      optional: (manifest?.environment.optional ?? []).map((e) => ({
        key: e.key,
        label: e.label ?? null,
        description: e.description ?? null,
        secret: e.secret,
        default: e.default ?? null,
        defaultFromDomain: e.defaultFromDomain,
        defaultFromUrl: e.defaultFromUrl,
      })),
    },
    domainRequired: manifest?.domain.primaryRequired ?? false,
    sslSupported: manifest?.ssl.enabled ?? true,
    backupsSupported: manifest?.backup.enabled ?? true,
  };
}

export function toCategoryDTO(category: ApplicationCategoryRow): MarketplaceCategoryDTO {
  return { slug: category.slug, name: category.name, description: category.description };
}
