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

it.each([
  ['/domains', /An entrepreneur reviewing domain search results/],
  ["/platforms", /A platform engineer at an application monitor beside a server cabinet/],
  ["/platforms/applications", /A developer reviewing an application catalog on a desktop monitor beside a laptop/],
  ["/platforms/databases", /A database administrator reviewing tables and schema on a monitor beside a storage server/],
  ["/platforms/containers", /An engineer at dual monitors showing container resources and a terminal beside a server rack/],
  ["/platforms/paas", /Two engineers reviewing an application deployment dashboard on a desktop monitor/],
  ["/hosting/cpanel", /A website administrator reviewing hosting controls on a monitor beside a computer tower/],
  ["/websites", /A web designer reviewing a website layout on a desktop monitor beside a laptop/],
  ["/hosting/rdp", /A remote worker using a desktop monitor with application windows beside a laptop/],
  ["/digital-products", /A creative professional reviewing digital templates on a monitor beside a graphics tablet/],
  ["/proxy-services", /A network engineer reviewing a routing diagram on a monitor beside a network appliance/],
  ["/hosting/business", /A business owner reviewing an online shop on a desktop monitor beside a laptop and computer tower/],
  ["/hosting/wordpress", /A content creator at a blog editor monitor beside a computer tower/],
  ["/hosting/reseller", /Two agency professionals reviewing client websites on a monitor beside a server cabinet/],
  ["/hosting/windows", /A systems administrator at a server configuration monitor beside server equipment/],
  ["/hosting/developer", /A developer using a laptop beside a code and website preview monitor/],
  ["/hosting/api", /An engineer at a request and response monitor beside a laptop and server tower/],
  ["/hosting/ssl", /A website administrator reviewing certificate settings on a desktop monitor/],
  ["/hosting/backups", /An administrator at a backup scheduling monitor beside a storage array/],
  ["/hosting/migration", /An engineer at dual monitors showing source and destination website files/],
  ["/hosting/security", /A security engineer at a website audit monitor beside a server rack/],
  ["/developers", /Two developers reviewing code on a desktop monitor beside a computer tower/],
  ["/developers/deployment", /A release engineer using a laptop beside a deployment pipeline monitor and server rack/],
  ["/developers/environments", /An engineer using dual monitors with code and application previews beside a workstation tower/],
  ["/developers/nodejs", /A developer at a code editor monitor with a laptop and computer tower/],
  ["/developers/php", /A web developer at a monitor showing code and a web application preview/],
  ["/developers/python", /A developer reviewing code and data visualizations on a monitor beside a computer tower/],
  ["/developers/laravel", /A web developer at a code and dashboard monitor beside a laptop and computer tower/],
  ["/developers/docker", /A DevOps engineer at dual monitors showing a container diagram and terminal beside a server cabinet/],
  ["/cloud/operating-systems", /A systems administrator at an operating system settings monitor beside a server tower/],
  ["/cloud/server-management", /A server administrator using a laptop beside an open server rack/],
  ["/cloud/monitoring", /An operations analyst reviewing resource charts on dual monitors beside a server rack/],
  ["/cloud/backups", /A backup administrator at a file scheduling monitor beside a storage array/],
  ["/cloud/firewall", /A network specialist reviewing firewall rules at a monitor beside a network appliance/],
  ["/cloud/security", /A security analyst at an audit monitor beside glass-front server equipment/],
  ["/cloud/ip-management", /A network administrator reviewing address allocation on a monitor beside network switches/],
  ["/cloud/managed-services", /Two support professionals reviewing a service ticket monitor beside a server cabinet/],
  ['/cloud', /Two cloud specialists.*desktop monitor/],
  ['/cloud/public', /laptop and large cloud resource monitor/],
  ['/cloud/private', /laptop beside an enclosed private server cabinet/],
  ['/cloud/enterprise-servers', /Two engineers.*enterprise server racks/],
  ['/cloud/game-servers', /game developer.*dual monitors/],
  ['/cloud/infrastructure', /tablet.*topology monitor/],
  ['/cloud/data-centers', /laptop on a cart/],
  ['/cloud/network', /desktop monitor.*network cables/],
  ['/smtp-hosting', /Send button.*email compose window/],
  ['/hosting/email', /composing and sending an email/],
  ['/hosting', /desktop monitor.*server room/],
  ['/hosting/web-hosting', /monitor displaying a website editor/],
  ['/hosting/vps', /two monitors.*server cabinet/],
  ['/hosting/dedicated', /laptop.*dedicated server rack/],
] as const)('keeps the dedicated people scene fully framed for %s', (route, description) => {
  const html = renderToStaticMarkup(<ServiceHeroVisual route={route} scene={route === '/smtp-hosting' ? 'email' : (serviceSceneForRoute(route) ?? 'business')} title="Hosting" />);
  const dom = new DOMParser().parseFromString(html, 'text/html');
  expect(dom.querySelector('figure')?.classList.contains('service-showcase--people')).toBe(true);
  expect(dom.querySelector('img')?.alt).toMatch(description);
  expect(dom.querySelector('img')?.alt).toContain('AI-generated');
  expect(dom.querySelector('img')?.getAttribute('src')).toContain('/service-people/');
});

it.each([['cloud-infrastructure-sources.json', 8], ['cloud-operations-sources.json', 8], ['developer-sources.json', 8], ['hosting-specialties-sources.json', 10], ['platform-services-sources.json', 10], ['domain-sources.json', 1]] as const)('verifies the scenes in %s against published images', (manifest, count) => {
  const entries = JSON.parse(readFileSync(publicFile(`/media/cloudhost247/service-people/${manifest}`), 'utf8')) as Array<{ name: string; files: Array<{ file: string; sha256: string }> }>;
  expect(entries).toHaveLength(count);
  for (const entry of entries) {
    expect(entry.files).toHaveLength(6);
    for (const asset of entry.files) {
      expect(createHash('sha256').update(readFileSync(publicFile(asset.file))).digest('hex')).toBe(asset.sha256);
    }
  }
});

it('uses a fresh URL for the revised Business Hosting image', () => {
  expect(SERVICE_HERO_ASSETS['/hosting/business'].root).toBe('/media/cloudhost247/service-people/business-hosting-shop-v2');
});
