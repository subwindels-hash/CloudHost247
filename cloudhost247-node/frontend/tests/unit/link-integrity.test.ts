import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGAL_INDEX, MARKETING_ROUTES } from '../../src/navigation/registry.generated';

/**
 * Website functionality audit — static link integrity (2026-11-07).
 *
 * Every internal navigation target written anywhere in the SPA source
 * (`<Link to>`, `<a href>`, `navigate(...)`, template literals carrying an id/slug)
 * must resolve to a route the router actually declares, and placeholder links
 * (`href="#"`, empty hrefs, href-less anchors) are forbidden outright. This is the
 * static half of the audit; the browser half (rendered pages, clicks, redirects,
 * permission guards) lives in e2e/link-integrity.spec.ts and was verified live
 * against the running application — see docs/WEBSITE-FUNCTIONALITY-AUDIT.md.
 *
 * Server-served non-SPA resources linked deliberately from the sitemap page
 * (robots.txt, sitemap.xml, the public navigation JSON) are allow-listed: they
 * are real endpoints answered by the Fastify server, verified live with HTTP 200.
 */
const SRC = path.resolve(__dirname, '../../src');
const SERVER_RESOURCES = new Set(['/robots.txt', '/sitemap.xml', '/api/v1/navigation']);
/** File-download anchors answered by the API (digital-product delivery), not SPA routes. */
const SERVER_PREFIXES = ['/api/v1/public/downloads/'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

function routePatterns(): string[] {
  const app = readFileSync(path.join(SRC, 'App.tsx'), 'utf8');
  const literal = [...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]!);
  const legal = LEGAL_INDEX.map((doc) => doc.spa);
  return [...literal, ...MARKETING_ROUTES, ...legal];
}

function templateTarget(literal: string): string {
  const chunks = literal.split('${');
  let out = chunks[0]!;
  for (const chunk of chunks.slice(1)) {
    const rest = chunk.slice(chunk.indexOf('}') + 1);
    if (!out.endsWith('/') && !rest.startsWith('/')) out += '/';
    out += `:param${rest}`;
  }
  return out.split('?')[0];
}

function matchesRoute(target: string, patterns: string[]): boolean {
  const clean = target.split('?')[0].split('#')[0];
  if (patterns.includes(clean)) return true;
  const segments = clean.split('/').filter(Boolean);
  return patterns.some((pattern) => {
    const parts = pattern.split('/').filter(Boolean);
    if (parts.length !== segments.length && !pattern.endsWith('/*')) return false;
    return parts.every((part, i) => part.startsWith(':') || part === '*' || part === segments[i]);
  });
}

function linkTargets(): Array<{ file: string; target: string }> {
  const found: Array<{ file: string; target: string }> = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    const rel = path.relative(SRC, file);
    for (const m of text.matchAll(/(?:to|href)\s*=\s*["'](\/[^"'#? ]*)/g)) found.push({ file: rel, target: m[1]! });
    for (const m of text.matchAll(/navigate\(\s*["'](\/[^"']*)/g)) found.push({ file: rel, target: m[1]!.split('?')[0] });
    // Template-literal targets carry context (product/plan/domain/service ids). Rebuild the
    // path with each ${...} expression replaced by a :param segment, keeping static text after
    // the expression (e.g. `/operating-systems/${slug}/versions`). Nested template literals
    // (e.g. `/admin/cloudflare${cond ? '' : `/${tab}`}`) truncate at the inner backtick, which
    // still yields the correct static prefix.
    for (const m of text.matchAll(/(?:to|href)\s*=\s*\{\s*`(\/[^`]*)`?\s*\}?/g)) found.push({ file: rel, target: templateTarget(m[1]!) });
    for (const m of text.matchAll(/navigate\(\s*`(\/[^`]*)`?/g)) found.push({ file: rel, target: templateTarget(m[1]!) });
  }
  return found;
}

describe('link integrity: every internal target resolves to a declared route', () => {
  const patterns = routePatterns();

  it('declares a real route table (sanity)', () => {
    expect(patterns.length).toBeGreaterThan(150);
    expect(patterns).toContain('/');
    expect(patterns).toContain('/cart');
    expect(patterns).toContain('/dashboard');
  });

  it('resolves every internal link/navigate target in the source', () => {
    const unresolved = linkTargets().filter(
      ({ target }) =>
        !SERVER_RESOURCES.has(target) &&
        !SERVER_PREFIXES.some((prefix) => target.startsWith(prefix)) &&
        !matchesRoute(target, patterns),
    );
    expect(unresolved, JSON.stringify(unresolved.slice(0, 20), null, 1)).toEqual([]);
  });

  it('contains no placeholder or dead anchors anywhere', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf8');
      const rel = path.relative(SRC, file);
      if (/href\s*=\s*["']#["']/.test(text)) offenders.push(`${rel}: href="#"`);
      if (/(?:to|href)\s*=\s*["']["']/.test(text)) offenders.push(`${rel}: empty to/href`);
      if (/href\s*=\s*["']javascript:/.test(text)) offenders.push(`${rel}: javascript: href`);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps per-account tools pages behind the auth guard in App.tsx', () => {
    const app = readFileSync(path.join(SRC, 'App.tsx'), 'utf8');
    for (const route of ['/tools/history', '/tools/favorites', '/tools/reports', '/tools/monitors']) {
      const idx = app.indexOf(`path="${route}"`);
      expect(idx, `${route} route missing`).toBeGreaterThan(-1);
      const guardIdx = app.lastIndexOf('<Route element={<RequireAuth />}>', idx);
      expect(guardIdx, `${route} is not nested under RequireAuth`).toBeGreaterThan(-1);
      // The guard block that opens before this route must not have closed again before it.
      const between = app.slice(guardIdx, idx);
      const opens = (between.match(/<Route[\s>]/g) ?? []).length;
      const closes = (between.match(/<\/Route>/g) ?? []).length;
      expect(opens, `${route} guard nesting`).toBeGreaterThan(closes);
    }
  });
});
