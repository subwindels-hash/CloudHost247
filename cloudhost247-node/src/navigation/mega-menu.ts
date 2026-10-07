/**
 * CloudHost247 navigation — the single definition of the platform's public navigation.
 *
 * This module is now a thin, typed adapter over `registry.generated.ts`, which is emitted from
 * `shared/site/registry.json` by `node scripts/site/generate.mjs`. That file is the source of
 * truth; this one exists so the API routes, the SEO sitemap and the tests keep a stable import
 * without any of them knowing how the registry is stored.
 *
 * Why it is data and not code:
 *   - the desktop mega menu, the mobile drawer, the footer, the sitemap page and `/sitemap.xml`
 *     all render the same list, so a menu can never advertise a page the app does not serve;
 *   - the PHP/WHMCS surface is generated from the same registry, so the two websites the
 *     organisation operates cannot drift apart;
 *   - link integrity is a build step, not a code review.
 *
 * Invariants (all enforced by `node scripts/site/generate.mjs`, then re-asserted here by tests):
 *   - every `to` is a unique, internal, non-empty route the SPA router declares;
 *   - every entry has a description, because the mega menu and the mobile accordion both show
 *     one, and a blank description is a visibly broken panel;
 *   - badges are budgeted at two per section, so "NEW" keeps meaning something.
 */

import {
  BRAND,
  FOOTER_COLUMNS,
  LEGAL_INDEX,
  MARKETING_ROUTES,
  NAV_SECTIONS,
  PUBLIC_DOC_ROUTES,
  REGISTRY_ROUTES,
  REGISTRY_VERSION,
  SITEMAP_POLICY,
  SPA_ROUTE_PATTERNS,
  TOOLS_CATEGORIES,
  UTILITY,
} from './registry.generated';

export type Badge = 'NEW' | 'POPULAR' | 'TRENDING' | 'INCLUDED' | 'SALE';

export interface NavLink {
  label: string;
  to: string;
  description: string;
  badge?: Badge;
  icon?: string;
}

export interface NavGroup {
  title: string;
  links: NavLink[];
}

export interface NavSection {
  id: string;
  label: string;
  blurb: string;
  to: string;
  groups: NavGroup[];
  featured?: { title: string; body: string; to: string; ctaLabel: string };
  /**
   * The Tools menu is the one section whose contents are live data: its categories come from the
   * registry and its entries from `/api/tools/navigation`, because an operator can add a tool
   * without a redeploy. It therefore has no statically declared groups, by design.
   */
  toolsDriven?: boolean;
}

export interface NavFooterColumn {
  title: string;
  links: Array<{ label: string; to: string }>;
}

export { BRAND, REGISTRY_VERSION, UTILITY, TOOLS_CATEGORIES, SITEMAP_POLICY, REGISTRY_ROUTES, LEGAL_INDEX, PUBLIC_DOC_ROUTES };

/** The mega-menu definition, as the API serves it and every navigation surface renders it. */
export const MEGA_MENU: readonly NavSection[] = NAV_SECTIONS.map((section) => ({
  id: section.id,
  label: section.label,
  blurb: section.blurb,
  to: section.to,
  groups: section.groups,
  toolsDriven: section.toolsDriven,
  ...(section.featured ? { featured: section.featured } : {}),
}));

/** Footer columns — same registry, different projection. */
export const FOOTER_NAV: readonly NavFooterColumn[] = FOOTER_COLUMNS.map((column) => ({
  title: column.title,
  links: column.links,
}));

/** Flat list of every link in the menu, used by the sitemap and by link-integrity tests. */
export function allNavLinks(): NavLink[] {
  return MEGA_MENU.flatMap((section) => [
    { label: section.label, to: section.to, description: section.blurb, icon: 'grid' },
    ...(section.featured
      ? [{ label: section.featured.title, to: section.featured.to, description: section.featured.body, icon: 'star' }]
      : []),
    ...section.groups.flatMap((group) => group.links),
  ]);
}

/** Flat list of every footer link, for the same reasons. */
export function allFooterLinks(): Array<{ label: string; to: string }> {
  return FOOTER_NAV.flatMap((column) => column.links);
}

export interface NavigationValidation {
  ok: boolean;
  errors: string[];
  linkCount: number;
}

/**
 * Structural validation. Every one of these conditions is already a hard failure in the
 * generator; this re-checks the emitted data so a hand-edit of the generated file, or a bad
 * merge, fails a test instead of shipping a broken menu.
 */
export function validateNavigation(sections: readonly NavSection[] = MEGA_MENU): NavigationValidation {
  const errors: string[] = [];
  let linkCount = 0;

  for (const section of sections) {
    const seenInSection = new Map<string, string>();
    if (!section.label.trim()) errors.push(`section ${section.id} has no label`);
    if (!section.blurb.trim()) errors.push(`section ${section.id} has no blurb`);
    if (section.groups.length === 0 && !section.toolsDriven) errors.push(`section ${section.id} has no groups`);
    let badgeCount = 0;

    for (const group of section.groups) {
      if (!group.title.trim()) errors.push(`section ${section.id} has a group with no title`);
      if (group.links.length === 0) errors.push(`section ${section.id} / ${group.title} has no links`);
      for (const link of group.links) {
        linkCount += 1;
        if (!link.label.trim()) errors.push(`a link in ${section.id}/${group.title} has no label`);
        if (!link.description.trim()) errors.push(`${link.label || '(unnamed link)'} has no description`);
        if (!link.to.startsWith('/') || link.to.startsWith('//')) {
          errors.push(`${link.label} must use an internal application path (got "${link.to}")`);
        }
        if (link.to.includes('://')) errors.push(`${link.label} must not be an absolute URL`);
        // A destination may legitimately appear in more than one family — backups belong to
        // hosting, to cloud and to websites, and pretending otherwise would force a visitor to
        // remember which of the nine menus we filed it under. A destination repeated *within* one
        // menu is the actual defect: it means the menu grew by accretion.
        if (seenInSection.has(link.to) && seenInSection.get(link.to) !== group.title) {
          errors.push(`"${link.to}" appears twice in the ${section.label} menu (${seenInSection.get(link.to)} and ${group.title})`);
        }
        seenInSection.set(link.to, group.title);
        if (link.badge) badgeCount += 1;
      }
    }
    // Badge budget: at most two per section. With a dozen links per section, two draws the eye to
    // the two things actually worth flagging; more than that and every label competes equally.
    if (badgeCount > 2) errors.push(`section ${section.id} uses ${badgeCount} badges — at most two per section`);
  }

  return { ok: errors.length === 0, errors, linkCount };
}

/**
 * URL patterns the frontend router serves, generated from the router's own `<Route>` declarations
 * in `frontend/src/App.tsx`. Keeping this generated is the difference between "the menu cannot
 * point at a missing page" being a claim and being a fact.
 */
export const ROUTE_PATTERNS: readonly string[] = SPA_ROUTE_PATTERNS;

/**
 * Routes the router declares in code rather than as a literal `path="…"` attribute: the marketing
 * pages and the legal documents are both mapped from the generated registry, so they do not appear
 * in the parsed route table. They are still routes the application serves, and the generator has
 * already proven each one has a page.
 */
const REGISTRY_ROUTE_SET = new Set<string>([
  ...MARKETING_ROUTES,
  ...LEGAL_INDEX.map((document) => document.spa),
]);

export function routeExists(path: string): boolean {
  const normalized = path.split('?')[0]!.split('#')[0]!.replace(/\/$/, '') || '/';
  if (normalized.startsWith('/tools')) return true;
  if (REGISTRY_ROUTE_SET.has(normalized)) return true;
  return ROUTE_PATTERNS.some((pattern) => {
    if (pattern === normalized) return true;
    const patternParts = pattern.split('/');
    const pathParts = normalized.split('/');
    if (patternParts.length !== pathParts.length) return false;
    return patternParts.every((part, index) => part.startsWith(':') || part === pathParts[index]);
  });
}

/** Every menu link must resolve to a route the app actually serves. Used by the navigation test. */
export function validateNavigationTargets(sections: readonly NavSection[] = MEGA_MENU): NavigationValidation {
  const base = validateNavigation(sections);
  const errors = [...base.errors];
  for (const link of sections.flatMap((section) => section.groups.flatMap((group) => group.links))) {
    if (!routeExists(link.to)) errors.push(`"${link.label}" points at ${link.to}, which no route renders`);
  }
  return { ok: errors.length === 0, errors, linkCount: base.linkCount };
}

/** Footer validation, so the footer is held to the same standard as the header. */
export function validateFooterTargets(columns: readonly NavFooterColumn[] = FOOTER_NAV): NavigationValidation {
  const errors: string[] = [];
  let linkCount = 0;
  for (const column of columns) {
    if (!column.title.trim()) errors.push('a footer column has no title');
    if (column.links.length === 0) errors.push(`footer column ${column.title} has no links`);
    for (const link of column.links) {
      linkCount += 1;
      if (!link.label.trim()) errors.push(`a footer link in ${column.title} has no label`);
      if (!routeExists(link.to)) errors.push(`footer "${link.label}" points at ${link.to}, which no route renders`);
    }
  }
  return { ok: errors.length === 0, errors, linkCount };
}
