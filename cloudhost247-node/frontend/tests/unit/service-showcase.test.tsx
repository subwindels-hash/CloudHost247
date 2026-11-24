// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ServiceHeroVisual, { serviceSceneForRoute, SERVICE_HERO_ASSETS } from '../../src/components/marketing/ServiceHeroVisual';
import { MARKETING_PAGES } from '../../src/content/registry';

const publicFile = (file: string) => path.join(process.cwd(), 'frontend/public', file);
describe('public service visual coverage', () => {
  it('opts every service family in without changing informational or account pages', () => {
    const pages = MARKETING_PAGES.filter(p => /^\/(hosting|cloud|developers|platforms|websites)(\/|$)/.test(p.route));
    expect(pages).toHaveLength(46);
    for (const p of pages) {
      expect(serviceSceneForRoute(p.route), p.route).not.toBeNull();
      expect(SERVICE_HERO_ASSETS).toHaveProperty(p.route);
    }
    for (const route of ['/about', '/help', '/docs', '/status', '/blog', '/dashboard', '/admin', '/checkout', '/hosting-other']) expect(serviceSceneForRoute(route)).toBeNull();
  });
  it('uses a distinct file AND distinct image bytes on all 55 refreshed service pages', () => {
    const sources = Object.values(SERVICE_HERO_ASSETS).map(a => a.root + (a.format === 'svg' ? '.svg' : '-960.webp'));
    sources.push('/media/brands/google-productivity-reference.webp', '/media/brands/team-collaboration.webp');
    expect(sources).toHaveLength(55);
    expect(new Set(sources).size).toBe(55);
    const hashes = sources.map(src => createHash('sha256').update(readFileSync(publicFile(src))).digest('hex'));
    expect(new Set(hashes).size).toBe(55);
    // Detect duplicate responsive variants as well, not only fallback images.
    for (const size of [640, 960, 1280]) {
      const files = Object.values(SERVICE_HERO_ASSETS).filter(a => a.format === 'raster').map(a => `${a.root}-${size}.avif`);
      const digests = files.map(src => createHash('sha256').update(readFileSync(publicFile(src))).digest('hex'));
      expect(new Set(digests).size).toBe(files.length);
    }
  });
  it.each(Object.keys(SERVICE_HERO_ASSETS))('renders the dedicated asset for %s', route => {
    const markup = renderToStaticMarkup(<ServiceHeroVisual route={route} scene={serviceSceneForRoute(route) ?? 'business'} title="Example service" />);
    const dom = new DOMParser().parseFromString(markup, 'text/html');
    const img = dom.querySelector('img')!;
    expect(img.alt).toContain('not a photograph of our facilities or customers');
    expect(dom.querySelectorAll('li')).toHaveLength(3);
    expect(markup).toContain('Options vary by plan');
    const sources = dom.querySelector('source')?.getAttribute('srcset')?.split(',').map(x => x.trim().split(' ')[0]) ?? [];
    for (const file of [img.getAttribute('src')!, ...sources]) expect(existsSync(publicFile(file)), file).toBe(true);
  });
});
