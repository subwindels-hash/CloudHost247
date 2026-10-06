/**
 * Tools Center — the slug → handler map.
 *
 * One place that answers "what code runs when slug X is executed?". `runnableSlugs()` is asserted
 * against the catalogue in the test suite, so a tool can never be added to the UI without an
 * implementation (and an implementation can never be orphaned silently).
 */
import { TOOL_CATALOG, NON_RUNNABLE_TOOL_SLUGS, type ToolCatalogEntry } from '../catalog';
import { dnsHandlers, dnsTargets } from './dns';
import { ipNetworkHandlers, ipNetworkTargets } from './ip-network';
import { developerWebmasterHandlers, developerWebmasterTargets } from './developer-webmaster';
import { securityDomainHandlers, securityDomainTargets } from './security-domain';
import { productivityHandlers, productivityTargets } from './productivity';
import { documentHandlers, documentTargets } from './document';
import type { ToolHandler } from './kit';

export * from './kit';

export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  ...dnsHandlers,
  ...ipNetworkHandlers,
  ...developerWebmasterHandlers,
  ...securityDomainHandlers,
  ...productivityHandlers,
  ...documentHandlers,
};

/** Safe target labels for history/audit rows; tools without a natural target return null. */
export const TOOL_TARGETS: Record<string, (input: Record<string, unknown>) => string | null> = {
  ...dnsTargets,
  ...ipNetworkTargets,
  ...developerWebmasterTargets,
  ...securityDomainTargets,
  ...productivityTargets,
  ...documentTargets,
};

/** Slugs that are executable (everything in the catalogue except the portal pages). */
export function runnableSlugs(): string[] {
  return TOOL_CATALOG.map((entry) => entry.slug).filter((slug) => !NON_RUNNABLE_TOOL_SLUGS.has(slug));
}

export function handlerFor(slug: string): ToolHandler | null {
  return TOOL_HANDLERS[slug] ?? null;
}

export function targetFor(slug: string, input: Record<string, unknown>): string | null {
  const resolver = TOOL_TARGETS[slug];
  if (!resolver) return null;
  try {
    return resolver(input);
  } catch {
    return null;
  }
}

/**
 * Catalogue entries whose slug has no handler. Used by the admin overview and by tests; an empty
 * array is a hard requirement for a release.
 */
export function missingHandlers(catalog: readonly ToolCatalogEntry[] = TOOL_CATALOG): string[] {
  return catalog.map((entry) => entry.slug).filter((slug) => {
    if (NON_RUNNABLE_TOOL_SLUGS.has(slug)) return false;
    return typeof TOOL_HANDLERS[slug] !== 'function';
  });
}
