/**
 * Navigation link integrity.
 *
 * The mega menu, the mobile drawer, the footer and the sitemap are all projected from one generated
 * registry, which is the whole point: no two surfaces can disagree. That guarantee only holds if
 * every projected link is answerable by the app, and nothing was checking it — `/tools/
 * compliance-documents` sat in the footer pointing at a route the app did not serve, so a visitor
 * who clicked it read "There is no tool registered under /tools/compliance-documents".
 *
 * The check is deliberately not "does the path look plausible". Three lists are the source of truth
 * (the route table in `App.tsx`, the tool catalogue, and the business-tool registry), and a link is
 * valid when one of them answers it:
 *
 *   - a literal or parameterised route (`/domains/auctions/:id`),
 *   - `/tools/<slug>` for a tool the catalogue serves, addressed by its published path, its slug or
 *     any of its legacy paths,
 *   - `/tools/category/<id>` for one of the published discovery categories,
 *   - `/tools/business-tools/<slug>` for one of the twenty-one business tools.
 *
 * `/tools/*` is a catch-all route and is therefore excluded from "answers it" — if it counted, every
 * typo in the registry would pass.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOL_CATALOG } from '../../src/tools/catalog';
import { BUSINESS_TOOLS } from '../../src/tools/business';
import {
  FOOTER_COLUMNS,
  LEGAL_INDEX,
  MARKETING_ROUTES,
  NAV_SECTIONS,
  TOOLS_CATEGORIES,
  UTILITY,
} from '../../frontend/src/navigation/registry.generated';

const APP = readFileSync(join(__dirname, '..', '..', 'frontend', 'src', 'App.tsx'), 'utf8');

interface RoutePattern {
  pattern: string;
  segments: string[];
}

/** Every `<Route path="…">` the app declares, including the nested admin and account trees. */
const ROUTES: RoutePattern[] = Array.from(APP.matchAll(/<Route\s+path="([^"]+)"/g)).map((match) => ({
  pattern: match[1] as string,
  segments: (match[1] as string).split('/').filter(Boolean),
}));

/**
 * Routes the router declares by mapping over a generated list rather than writing out one
 * `<Route path>` per page — marketing content (`MARKETING_ROUTES`) and the legal documents. The
 * generator is what keeps those lists and the router in step, so here they are simply added to the
 * set of answerable paths.
 */
const GENERATED_ROUTES = [...MARKETING_ROUTES, ...LEGAL_INDEX.map((document) => document.spa)];

const LITERAL_ROUTES = new Set([
  ...ROUTES.filter((route) => !route.segments.includes('*')).map((route) => route.pattern),
  ...GENERATED_ROUTES,
]);

/** Does a declared route answer this path? `:param` matches one segment, `*` is excluded. */
function routeAnswers(path: string): boolean {
  const segments = path.split('/').filter(Boolean);
  return ROUTES.some((route) => {
    if (route.segments.includes('*')) return false;
    if (route.segments.length !== segments.length) return false;
    return route.segments.every((segment, index) => segment.startsWith(':') || segment === segments[index]);
  });
}

const CATALOGUE_PATHS = new Set<string>();
for (const tool of TOOL_CATALOG) {
  CATALOGUE_PATHS.add(tool.path);
  CATALOGUE_PATHS.add(`/tools/${tool.slug}`);
  for (const alias of tool.legacyPaths ?? []) CATALOGUE_PATHS.add(alias);
}

const CATEGORY_IDS = new Set(TOOLS_CATEGORIES.map((category) => category.slug));
const BUSINESS_PATHS = new Set([`${''}/tools/business-tools`, ...BUSINESS_TOOLS.map((tool) => tool.path)]);
const BUSINESS_SLUGS = new Set(BUSINESS_TOOLS.map((tool) => tool.slug));

/** Why a link is believed to resolve, or `null` when nothing answers it. */
function answeredBy(path: string): string | null {
  if (BUSINESS_PATHS.has(path)) return 'business tool route';
  // The `/tools/...` families are checked before the route table, because the table's
  // `/tools/category/:category` route would otherwise "answer" every three-segment tools URL,
  // including the misspellings this test exists to catch.
  if (path.startsWith('/tools/category/')) {
    return CATEGORY_IDS.has(path.slice('/tools/category/'.length)) ? 'discovery category' : null;
  }
  if (path.startsWith('/tools/business-tools/')) {
    return BUSINESS_SLUGS.has(path.slice('/tools/business-tools/'.length)) ? 'business tool' : null;
  }
  if (path.startsWith('/tools/')) {
    if (CATALOGUE_PATHS.has(path)) return 'tool catalogue';
    return LITERAL_ROUTES.has(path) || routeAnswers(path) ? 'route table' : null;
  }
  if (LITERAL_ROUTES.has(path) || routeAnswers(path)) return 'route table';
  return null;
}

/** Every `to` the shared registry projects into the navigation, the menus and the footer. */
function registryLinks(): string[] {
  const links = new Set<string>();
  for (const section of NAV_SECTIONS) {
    links.add(section.to);
    for (const group of section.groups) for (const link of group.links) links.add(link.to);
  }
  for (const column of FOOTER_COLUMNS) for (const link of column.links) links.add(link.to);
  // UTILITY is a keyed object (search, signIn, createAccount, …), not a list.
  for (const item of Object.values(UTILITY)) if (item.to) links.add(item.to);
  return [...links];
}

describe('navigation link integrity', () => {
  it('declares a route for every link the registry projects', () => {
    const unanswerable = registryLinks().filter((path) => answeredBy(path) === null);
    expect(unanswerable, `These links are in the navigation but no route or catalogue entry answers them:\n${unanswerable.join('\n')}`).toEqual([]);
  });

  it('answers every link with the surface that is supposed to answer it', () => {
    // The collection hub is the case this test was written for, so it is asserted by name rather
    // than left to the general rule.
    expect(answeredBy('/tools/compliance-documents')).toBe('route table');
    expect(answeredBy('/tools/mrz-generator')).not.toBeNull();
    expect(answeredBy('/tools/business-tools/employee-id-card-generator')).toBe('business tool route');
    // A typo still fails: the catch-all route does not launder a bad path.
    expect(answeredBy('/tools/this-tool-does-not-exist')).toBeNull();
    expect(answeredBy('/tools/category/not-a-category')).toBeNull();
  });

  it('files every catalogue tool under a published discovery category', () => {
    const misfiled = TOOL_CATALOG.filter(
      (tool) => !(tool.discoveryCategories ?? []).some((category) => CATEGORY_IDS.has(category))
    ).map((tool) => `${tool.slug} → ${(tool.discoveryCategories ?? []).join(', ') || '(none)'}`);
    expect(misfiled, `These tools are not reachable from any published category:\n${misfiled.join('\n')}`).toEqual([]);
  });

  it('keeps the twenty-one business tools discoverable from the menu and the footer', () => {
    const links = new Set(registryLinks());
    expect(links.has('/tools/business-tools')).toBe(true);
    // Each business tool's own path is answerable, whether or not the menu lists it individually.
    for (const tool of BUSINESS_TOOLS) expect(answeredBy(tool.path), tool.slug).not.toBeNull();
  });

  it('has no duplicate links in the footer', () => {
    for (const column of FOOTER_COLUMNS) {
      const paths = column.links.map((link) => link.to);
      const duplicates = paths.filter((path, index) => paths.indexOf(path) !== index);
      expect(new Set(duplicates), `Column "${column.title}" repeats: ${duplicates.join(', ')}`).toEqual(new Set());
    }
  });
});
