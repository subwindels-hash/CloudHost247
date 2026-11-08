import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { knownServiceKeys, readProductMapFile } from '../../src/whmcs/product-map';

/**
 * Completeness gate for the WHMCS mapping (plan slice C1.2).
 *
 * The failure this prevents is quiet: somebody adds a hosting page, ships it, and because nothing
 * binds it to a WHMCS product the page shows either a stale price or no plan at all — and no test
 * notices. So every service the site advertises must have a *disposition* in the product map:
 * either a verified binding, or an explicit "not orderable, and here is why".
 *
 * The service list is derived from the website's own content (the same files the generator projects
 * into both frontends), not from a hand-kept list, so adding a page without a disposition fails here.
 */

const APP_ROOT = process.cwd();
const REPO_ROOT = path.resolve(APP_ROOT, '..');
const CONTENT_DIR = path.join(REPO_ROOT, 'shared', 'site', 'content');
const REGISTRY = path.join(REPO_ROOT, 'shared', 'site', 'registry.json');
const REGISTER = path.join(REPO_ROOT, 'config', 'whmcs', 'service-register.csv');
const MAP = path.join(APP_ROOT, 'config', 'whmcs', 'product-map.json');

const SERVICE_FAMILIES = new Set(['hosting', 'cloud', 'developers', 'platforms', 'products']);

interface ContentPage {
  route: string;
  title: string;
  family: string;
}

function contentPages(): ContentPage[] {
  const pages: ContentPage[] = [];
  for (const file of readdirSync(CONTENT_DIR)) {
    if (!file.endsWith('.json') || file.includes('legal')) continue;
    const parsed = JSON.parse(readFileSync(path.join(CONTENT_DIR, file), 'utf8')) as {
      family?: string;
      pages?: Array<{ route?: string; title?: string }>;
    };
    if (!parsed.family || !SERVICE_FAMILIES.has(parsed.family)) continue;
    for (const page of parsed.pages ?? []) {
      if (!page.route || !page.title) continue;
      pages.push({ route: page.route, title: page.title, family: parsed.family });
    }
  }
  return pages;
}

/** The same derivation the service register uses, so a mismatch is a real drift, not a spelling. */
function serviceKeyForRoute(route: string): string {
  if (route.startsWith('/domains')) {
    const rest = route.slice('/domains'.length).replaceAll('/', '-').replaceAll(':domain', 'domain');
    return `domains${rest}`;
  }
  return route.replace(/^\//, '').replaceAll('/', '-');
}

/** Domain surfaces live in the SPA router rather than the content files. */
function domainRoutes(): string[] {
  const app = readFileSync(path.join(APP_ROOT, 'frontend', 'src', 'App.tsx'), 'utf8');
  const routes = [...app.matchAll(/<Route path="(\/domains[^"]*)"/g)]
    .map((match) => match[1]!)
    // Parameterised routes are detail views of a service above (e.g. one auction), not a service.
    .filter((route) => !route.includes(':'));
  return [...new Set(routes)];
}

/** Service pages that exist only on the PHP/WHMCS side (no SPA route). */
function phpOnlyServicePages(): string[] {
  const registry = JSON.parse(readFileSync(REGISTRY, 'utf8')) as {
    menus?: Array<{ columns?: Array<{ items?: Array<{ label?: string; href?: { spa?: string | null; php?: string | null } }> }> }>;
  };
  const out: string[] = [];
  for (const menu of registry.menus ?? []) {
    for (const column of menu.columns ?? []) {
      for (const item of column.items ?? []) {
        const php = item.href?.php ?? '';
        if (item.href?.spa || !php) continue;
        if (!/(hosting|server|cloud|domain|ssl|email|vps|dedicated)/.test(php)) continue;
        out.push(php);
      }
    }
  }
  return [...new Set(out)];
}

function advertisedServiceKeys(): string[] {
  const keys = new Set<string>();
  for (const page of contentPages()) keys.add(serviceKeyForRoute(page.route));
  for (const route of domainRoutes()) keys.add(serviceKeyForRoute(route));
  // The PHP hosting catalogue page and the two nav-only service pages are named explicitly because
  // they are surfaces rather than content records.
  keys.add('hosting-catalogue');
  for (const php of phpOnlyServicePages()) {
    keys.add(php.replace(/\.php$/, '').replaceAll('_', '-'));
  }
  return [...keys].sort();
}

function registerKeys(): string[] {
  const text = readFileSync(REGISTER, 'utf8').trim().split(/\r?\n/);
  const header = text[0]!.split(',');
  const keyIndex = header.indexOf('service_key');
  return text
    .slice(1)
    .map((line) => line.split(',')[keyIndex] ?? '')
    .filter(Boolean)
    .map((key) => key.replace(/^"|"$/g, ''));
}

describe('WHMCS service coverage', () => {
  it('has a valid, checksummed product map', () => {
    expect(existsSync(MAP)).toBe(true);
    const map = readProductMapFile(MAP);
    expect(map.version).toBe(1);
    expect(map.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('leaves no advertised service without a disposition', () => {
    const map = readProductMapFile(MAP);
    const known = new Set(knownServiceKeys(map));
    const missing = advertisedServiceKeys().filter((key) => !known.has(key));
    expect(missing).toEqual([]);
  });

  it('keeps the service register in step with the website', () => {
    const inRegister = new Set(registerKeys());
    const missingFromRegister = advertisedServiceKeys().filter((key) => !inRegister.has(key));
    expect(missingFromRegister).toEqual([]);
  });

  it('does not claim a binding for a service the site does not advertise', () => {
    const map = readProductMapFile(MAP);
    const advertised = new Set(advertisedServiceKeys());
    // Extra keys are allowed only when they are explicitly dispositioned, never silently bound.
    for (const key of Object.keys(map.services)) {
      expect(advertised.has(key)).toBe(true);
    }
  });

  it('is currently sold-out rather than pretend-available (0 bindings until discovery runs)', () => {
    const map = readProductMapFile(MAP);
    // This assertion is deliberately inverted by the discovery slice: after `snapshot` + `bind` the
    // count must be > 0 and every binding must name a product from the snapshot. Until then the map
    // must admit that nothing is orderable.
    if (Object.keys(map.services).length === 0) {
      expect(Object.keys(map.unmapped).length).toBeGreaterThan(0);
      expect(map.products).toEqual([]);
    } else {
      expect(map.products.length).toBeGreaterThan(0);
    }
  });
});
