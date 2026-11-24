// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PlatformLogo, { KNOWN_PLATFORM_SLUGS, isWidePlatformLogo } from '../../src/components/PlatformLogo';
import AppTile from '../../src/components/AppTile';
import OperatingSystemSelector from '../../src/components/OperatingSystemSelector';
import { PLATFORM_CATALOG } from '../../src/data/platform-catalog';
import originalLogos from '../../src/data/platform-original-logos.json';
import bundleLogos from '../../src/data/platform-bundle-logos.json';
import { createHash } from 'node:crypto';
import { assertSafeOriginalSvg } from '../../../scripts/lib/original-svg.mjs';
import logoSources from '../../src/data/platform-logo-sources.json';
import { hasCodeRenderedLogo } from '../../src/data/generated-platform-icons/registry';

afterEach(cleanup);

const catalogue = new Map(PLATFORM_CATALOG.map((entry) => [entry.slug, entry.name]));
const referenced = Object.keys(logoSources.icons);
const generated = path.resolve(process.cwd(), 'frontend/src/data/generated-platform-icons');

function hasSourcedMark(slug: string) {
  return Object.prototype.hasOwnProperty.call(bundleLogos.bundles, slug) || Object.prototype.hasOwnProperty.call(originalLogos, slug) || KNOWN_PLATFORM_SLUGS.includes(slug) || hasCodeRenderedLogo(slug);
}

describe('Control Panels & Application Platforms: code-rendered marks', () => {
  it('has one auditable, pinned vector per sourced slug, without pretending every entry is covered', () => {
    expect(catalogue.size).toBe(1_092);
    expect(KNOWN_PLATFORM_SLUGS).toHaveLength(14);
    expect(referenced).toHaveLength(940);
    expect(new Set([...KNOWN_PLATFORM_SLUGS, ...referenced]).size).toBe(954);
    for (const slug of referenced) {
      expect(catalogue.has(slug), slug).toBe(true);
      expect(KNOWN_PLATFORM_SLUGS, slug).not.toContain(slug);
      expect(hasCodeRenderedLogo(slug), slug).toBe(true);
      const source = logoSources.icons[slug as keyof typeof logoSources.icons];
      expect(source.sha256, slug).toMatch(/^[a-f0-9]{64}$/);
      expect(logoSources.collections[source.source as keyof typeof logoSources.collections], slug).toHaveProperty('license');
    }
    const missing = PLATFORM_CATALOG.filter(({ slug }) => !hasSourcedMark(slug));
    expect(missing).toHaveLength(12);
    expect(missing.map(({ slug }) => slug)).toContain('budge'); // upstream file is the React boilerplate atom, not a project logo
    expect(missing.map(({ slug }) => slug)).toContain('auto-ontology'); // NVIDIA's mark is not project-specific
    expect(missing.map(({ slug }) => slug)).not.toContain('canarytokens'); // visual coverage only; special GPL terms remain in the notice
    expect(missing.map(({ slug }) => slug)).not.toContain('apollo'); // reviewed GMOD wordmark, not Apollo GraphQL
    expect(missing.map(({ slug }) => slug)).not.toContain('znc'); // unchanged official PNG preserves lettering
    expect(missing.map(({ slug }) => slug)).not.toContain('firefly'); // identified artwork; personal-use restriction remains unresolved
    expect(missing.map(({ slug }) => slug)).not.toContain('plone'); // artwork present; commercial mark agreement not established
    expect(missing.map(({ slug }) => slug)).toContain('wireguard-easy'); // WG mark forbids commercial badge use
    const gapFile = readFileSync(path.resolve(process.cwd(), '../docs/platform-logo-gaps.md'), 'utf8');
    const documented = [...gapFile.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]);
    expect(documented).toEqual(missing.map(({ slug }) => slug).sort());
  });

  it('renders the fourteen remaining panel paths inline, including compact wordmarks', () => {
    for (const slug of KNOWN_PLATFORM_SLUGS) {
      const name = catalogue.get(slug)!;
      const markup = renderToStaticMarkup(<PlatformLogo slug={slug} name={name} compact />);
      expect(markup, slug).toMatch(/^<svg\b/);
      expect(markup, slug).toContain(`aria-label="${name} logo"`);
      expect(markup, slug).not.toMatch(/<(?:img|image)\b/i);
    }
    expect(renderToStaticMarkup(<PlatformLogo slug="plesk" name="Plesk" compact />))
      .toContain('viewBox="40.6 36.4 418.8 173.8"');
  });

  it('loads real SVG paths as React code from each pinned source collection', async () => {
    for (const slug of ['almalinux', 'debian', 'rocky-linux', 'ubuntu', 'alpine-linux', 'arch-linux', 'centos', 'cloudlinux', 'wordpress', 'apache-airflow', 'gogs', 'apache-couchdb', 'grafana-loki', 'dashy', 'zipline', 'lychee', 'apprise-api', 'flagsmith', 'fleet', 'phoenix', 'yarn', 'photoview', 'n8n-queue-mode', 'airsonic-advanced', 'changedetection-io', 'gns3-server', 'xibo-cms', 'apache-hop', 'apache-pinot', 'apache-zeppelin', 'lightdash', 'lightrag', 'usesend', 'sillytavern', 'shoutrrr', 'galaxy', 'indico', 'code-server', 'starrocks', 'tensorzero', 'hasura-graphql-engine', 'corteza', 'illa-builder', 'loomio', 'nuclio', 'rivet', 'sim-studio', 'sqlpage', 'wintercms', 'nextchat', 'agenta', 'classicpress', 'cvat', 'db-browser-for-sqlite', 'exelearning', 'featbit', 'flexget', 'gitingest', 'hfs', 'horilla', 'openremote', 'spice-ai', 'steel-browser', 'universal-media-server', 'webthings-gateway', 'aureuserp', 'argilla', 'dhis2', 'fuxa', 'insforge', 'kafbat-kafka-ui', 'lavinmq', 'openmausbot', 'freellmapi', 'serverstatus', 'agentmemory', 'archivesspace', 'beaverhabits', 'cognee', 'foxel', 'home-gallery', 'hoop', 'huggingchat-chat-ui', 'kotaemon', 'krayin-crm', 'decidim', 'maxkb', 'otobo', 'quasarr', 'ekuiper', 'immudb', 'open-monograph-press', 'open-journal-systems', 'readyset', 'tyk-gateway', 'sherlock', 'thinkdashboard', 'kiwix-serve', 'judge0-ce', 'fusio', 'crawl4ai', 'autobase', 'osrm', 'apache-streampark', 'alerta', 'traduora', 'daptin', 'vane', 'centrifugo', 'annif', 'eve', 'isso', 'synclounge', 'ldap-account-manager', 'microcks', 'openlit', 'reiverr', 'trudesk', 'sickgear', 'aitoearn', 'parse-server', 'senaite-lims', 'starbase-80', 'thumbor', 'scada-lts', 'ckan', 'libredesk', 'owntracks-recorder', 'para', 'posterr', 'smocker', 'speakr', 'dataline', 'readur', 'remark42', 'shynet', 'waline', 'bionic-gpt', 'cheshire-cat-ai', 'domjudge', 'headroom', 'meteroid', 'microweber', 'nod', 'percona-pmm', 'teammapper', 'zeronote', 'faktory', 'redaxo', 'thruk', 'alltube', 'arcadedb', 'artalk', 'teedy', 'bookshelf', 'classroomio', 'eclipse-hawkbit', 'ever-gauzy', 'faraday', 'feedcraft', 'fleetbase', 'form-io', 'hermes-workspace', 'itflow', 'librebooking', 'lms', 'mistserver', 'openhuman', 'openseo', 'openviking', 'paisa', 'paperclip', 'privategpt', 'pycsw', 'ralph', 'razzia', 'scoold', 'serverkit', 'shipshipship', 'songloft', 'tinode', 'vince-analytics', 'wbo']) {
      const name = catalogue.get(slug)!;
      const { unmount } = render(<PlatformLogo slug={slug} name={name} className="test-icon" />);
      const logo = await screen.findByRole('img', { name: `${name} logo` });
      expect(logo.tagName.toLowerCase(), slug).toBe('svg');
      expect(logo.querySelector('path, circle, rect, polygon'), slug).not.toBeNull();
      expect(logo.getAttribute('viewBox'), slug).toMatch(/^[-\d.]+ [-\d.]+ [\d.]+ [\d.]+$/);
      expect(logo.classList.contains('test-icon')).toBe(true);
      expect(document.querySelector('img, image'), slug).toBeNull();
      unmount();
    }
  });

  it('keeps white PMM artwork visible and nested FeedCraft geometry independent of tile props', async () => {
    const { unmount } = render(<PlatformLogo slug="percona-pmm" name="Percona PMM" />);
    const pmm = await screen.findByRole('img', { name: 'Percona PMM logo' });
    expect(pmm.classList.contains('ch247-platform-logo--dark-ground')).toBe(true);
    unmount();
    for (const slug of ['libredesk', 'dataline', 'reiverr', 'synclounge', 'daptin', 'crawl4ai', 'open-monograph-press', 'open-journal-systems', 'ocs-inventory-ng']) {
      const view = render(<PlatformLogo slug={slug} name={slug} />);
      const mark = await screen.findByRole('img', { name: `${slug} logo` });
      expect(mark.classList.contains('ch247-platform-logo--dark-ground')).toBe(true);
      view.unmount();
    }
    const { default: Group } = await import('../../src/data/generated-platform-icons/f');
    const { container } = render(<Group slug="feedcraft" width={44} height={44} aria-label="FeedCraft logo" />);
    const nested = container.querySelector('svg svg');
    expect(nested?.getAttribute('width')).toBe('288');
    expect(nested?.hasAttribute('aria-label')).toBe(false);
    expect(container.querySelectorAll('[aria-label="FeedCraft logo"]')).toHaveLength(1);
  });

  it('clips publishing taglines without replacing their original wordmark paths', async () => {
    const { default: Group } = await import('../../src/data/generated-platform-icons/o');
    for (const [slug, viewBox] of [['open-monograph-press', '0 0 289 128'], ['open-journal-systems', '0 0 231 138']]) {
      const { container, unmount } = render(<Group slug={slug} width={96} height={64} />);
      expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe(viewBox);
      const [, , width, height] = viewBox.split(' ');
      expect(container.querySelector('clipPath path')?.getAttribute('d')).toBe(`M0 0h${width}v${height}H0z`);
      expect(container.querySelector('g[clip-path] path')).not.toBeNull();
      unmount();
    }
  });

  it('renders the large reviewed Pydio trace as paths without leftover module boilerplate', async () => {
    const { default: Group } = await import('../../src/data/generated-platform-icons/p');
    const { container } = render(<Group slug="pydio-cells" />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelectorAll('path').length).toBeGreaterThan(0);
    expect(container.querySelector('image, script, foreignObject')).toBeNull();
    expect(container.textContent).not.toMatch(/import |export default/);
  });

  it('preserves Morphic’s upstream static body and eyes without executing its animation', async () => {
    const { default: Group } = await import('../../src/data/generated-platform-icons/m');
    const { container } = render(<Group slug="morphic" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 256 256');
    expect([...svg.querySelectorAll('circle')].map((circle) =>
      ['cx', 'cy', 'r'].map((attribute) => circle.getAttribute(attribute))
    )).toEqual([['128', '128', '128'], ['102', '128', '18'], ['154', '128', '18']]);
    expect(svg.querySelector('circle')?.getAttribute('fill')).toBe('#000');
    expect(svg.querySelector('g')?.getAttribute('fill')).toBe('#fff');
    expect(svg.querySelector('[class], script, image, animate')).toBeNull();
  });

  it('retains MaxKB gradients and resolves their scoped references', async () => {
    const { default: Group } = await import('../../src/data/generated-platform-icons/m');
    const { container } = render(<Group slug="maxkb" />);
    const svg = container.querySelector('svg')!;
    expect(svg.querySelectorAll('linearGradient').length).toBeGreaterThan(0);
    const ids = new Set([...svg.querySelectorAll('[id]')].map((element) => element.id));
    const refs = [...svg.querySelectorAll('path')]
      .map((element) => (element.style.fill || element.getAttribute('fill') || '').match(/url\(["']?#([^"')]+)["']?\)/)?.[1])
      .filter((id): id is string => Boolean(id));
    expect(refs.length).toBeGreaterThan(0);
    for (const id of refs) expect(ids.has(id), id).toBe(true);
    expect(svg.querySelector('stop[stop-color="#3370FF"]')).not.toBeNull();
  });

  it('uses the same inline paths on marketplace cards and on the platform catalogue', async () => {
    const { container } = render(<AppTile slug="wordpress" name="WordPress" />);
    expect((await screen.findByRole('img', { name: 'WordPress logo' })).tagName.toLowerCase()).toBe('svg');
    expect(container.querySelector('img, image')).toBeNull();
  });

  it('renders OS selector logos in code even when the API supplies an external image URL', async () => {
    const { container } = render(<OperatingSystemSelector
      operatingSystems={[{ id: 'os-1', name: 'Ubuntu', slug: 'ubuntu', vendor: null, description: null, logoUrl: 'https://example.com/tracker.png', versions: [] }]}
      selectedOsId="" selectedVersionId="" selectedArchitecture="x86_64"
      onOsChange={vi.fn()} onVersionChange={vi.fn()} onArchitectureChange={vi.fn()}
    />);
    expect((await screen.findByRole('img', { name: 'Ubuntu logo' })).tagName.toLowerCase()).toBe('svg');
    expect(container.querySelector('img, image')).toBeNull();
  });

  it('keeps real wordmarks readable and converts faithful raster traces into SVG paths', async () => {
    expect(isWidePlatformLogo('ghost')).toBe(true);
    expect(isWidePlatformLogo('appsmith')).toBe(true);
    expect(isWidePlatformLogo('wordpress')).toBe(false);
    expect(isWidePlatformLogo('xibo-cms')).toBe(true); // cropped official wordmark, not an unrelated icon
    expect(isWidePlatformLogo('galaxy')).toBe(true); // white official wordmark needs a contrasting ground
    expect(isWidePlatformLogo('usesend')).toBe(false); // cropped official square symbol
    expect(isWidePlatformLogo('spice-ai')).toBe(false); // cropped first-party orange symbol
    expect(isWidePlatformLogo('lavinmq')).toBe(false); // cropped first-party green app mark
    render(<PlatformLogo slug="lavinmq" name="LavinMQ" />);
    expect((await screen.findByRole('img', { name: 'LavinMQ logo' })).getAttribute('viewBox')).toBe('0 0 81 80');
    render(<PlatformLogo slug="appsmith" name="Appsmith" />);
    expect((await screen.findByRole('img', { name: 'Appsmith logo' })).getAttribute('viewBox')).toBe('0 9 24 6');
    render(<PlatformLogo slug="mylar3" name="Mylar3" />);
    const traced = await screen.findByRole('img', { name: 'Mylar3 logo' });
    expect(traced.tagName.toLowerCase()).toBe('svg');
    expect(traced.querySelector('path')).not.toBeNull();
    expect(traced.querySelector('image')).toBeNull();
    render(<PlatformLogo slug="galaxy" name="Galaxy" />);
    const galaxy = await screen.findByRole('img', { name: 'Galaxy logo' });
    expect(galaxy.classList.contains('ch247-platform-logo--dark-ground')).toBe(true);
    expect(galaxy.querySelector('font, glyph, image')).toBeNull();
  });

  it('keeps nested first-party SVG artwork to one accessible Kotaemon logo', async () => {
    const { container } = render(<PlatformLogo slug="kotaemon" name="Kotaemon" />);
    const logo = await screen.findByRole('img', { name: 'Kotaemon logo' });
    expect(container.querySelectorAll('svg[aria-label="Kotaemon logo"]')).toHaveLength(1);
    expect(logo.querySelectorAll('svg').length).toBeGreaterThan(0);
    expect(logo.querySelectorAll('path').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('img, image, text')).toBeNull();
  });

  it('does not mislabel an initial, generic icon, URL, or embedded raster as a vendor logo', () => {
    for (const slug of ['wireguard-easy', 'not-in-the-catalogue']) {
      const name = catalogue.get(slug) ?? 'My Panel';
      const markup = renderToStaticMarkup(<PlatformLogo slug={slug} name={name} />);
      expect(markup, slug).toContain(`${name} letter badge`);
      expect(markup, slug).not.toContain('SVG pending');
      expect(markup, slug).not.toMatch(/<(?:svg|img|image)\b/i);
    }
    // Even an old API logo_url cannot turn back on image-based rendering.
    const { container } = render(<PlatformLogo slug="unverified" name="Unverified" {...{ logoUrl: 'https://example.com/tracker.svg' }} />);
    expect(container.querySelector('img, image, svg')).toBeNull();
  });

  it('uses the first two letters for every unsourced entry without claiming a real logo', () => {
    const missing = PLATFORM_CATALOG.filter(entry => !hasSourcedMark(entry.slug));
    expect(missing).toHaveLength(12);
    for (const entry of missing) {
      const { unmount } = render(<PlatformLogo slug={entry.slug} name={entry.name} />);
      const badge = screen.getByRole('img', { name: `${entry.name} letter badge` });
      expect(badge.textContent).toBe(entry.name.slice(0, 2).toUpperCase());
      expect(badge.getAttribute('title')).toContain('not an official logo');
      expect(screen.queryByText('SVG pending')).toBeNull();
      unmount();
    }
  });

  it.each([['  Budge', 'BU'], ['Auto Ontology', 'AU'], ['Éclair', 'ÉC'], ['A', 'A'], ['', '?']])('renders safe letter fallback for %s', (name, letters) => {
    render(<PlatformLogo slug="unsourced-test" name={name} />);
    expect(screen.getByRole('img').textContent).toBe(letters);
  });

  it('ties ambiguous catalogue names to the correct projects, and links the Vault mark as required', async () => {
    const source = logoSources.icons;
    expect(source.yarn.repository).toBe('gotamer/yarn');
    expect(source.yarn.file).toBe('internal/logo.svg'); // Yarn.social, not yarnpkg
    expect(source.phoenix.repository).toBe('Arize-ai/phoenix'); // not the Elixir framework
    expect(source['yt-dlp-web-ui'].source).toBe('official-ico');
    expect(source['yt-dlp-web-ui'].file).toBe('frontend/src/assets/favicon.ico');
    expect(source['yt-dlp-web-ui'].icoSize).toBe(128);
    expect(originalLogos.codimd.repository).toBe('hackmdio/codimd'); // not HedgeDoc
    expect(source.pghero.repository).toBe('ankane/pghero');
    expect(source.pghero.file).toBe('app/assets/images/pghero/favicon.png');
    expect(source.pgweb.repository).toBe('sosedoff/pgweb');
    expect(source.pgweb.file).toBe('static/img/icon.png');
    expect(source['powerdns-admin'].repository).toBe('PowerDNS-Admin/PowerDNS-Admin');
    expect(source['powerdns-admin'].file).toBe('powerdnsadmin/static/img/favicon.png');
    expect(source['cassandra-reaper'].repository).toBe('thelastpickle/cassandra-reaper');
    expect(source['cassandra-reaper'].file).toBe('docs/img/logo.png');
    expect(source.photoview.source).toBe('official-png'); // not the flattened third-party diamond
    expect(source.photoview).toHaveProperty('traceProfile', 'gradient-detail');
    expect(originalLogos.cap.repository).toBe('tiagozip/cap'); // CAPTCHA, not the Cap.so screen recorder
    expect(source.vault.icon).toBe('hashicorp-vault'); // not Vaultwarden or Azure Key Vault
    expect(source['xibo-cms'].repository).toBe('xibosignage/xibo');
    expect(source['xibo-cms'].file).toBe('xibologo-blue.png');
    expect(source['apache-hop'].repository).toBe('apache/hop');
    expect(source.usesend.file).toBe('apps/docs/logo/logo-wordmark.svg');
    expect(source.lightrag.repository).toBe('HKUDS/LightRAG');
    expect(source.agenta.file).toBe('web/oss/public/assets/logos/Agenta-symbol-light.svg'); // not its separately licensed website assets
    expect(source['spice-ai'].repository).toBe('spiceai/spiceai');
    expect(source['steel-browser'].file).toBe('.github/assets/steel-logo.svg');
    expect(source.aureuserp.repository).toBe('aureuserp/aureuserp');
    expect(source.argilla.file).toBe('argilla/docs/assets/logo.svg');
    expect(source.lavinmq.repository).toBe('cloudamqp/lavinmq');
    expect(source.lavinmq).toHaveProperty('modifications', expect.stringContaining('ViewBox cropped'));
    expect(source.archivesspace.file).toContain('favicon-AS.svg'); // same blue A as its official wordmark
    expect(source['huggingchat-chat-ui'].file).toBe('static/huggingchat/icon.svg'); // not generic Hugging Face logo
    expect(source.kotaemon.repository).toBe('Cinnamon/kotaemon');
    const { container } = render(<PlatformLogo slug="vault" name="Vault" />);
    expect((await screen.findByRole('img', { name: 'HashiCorp Vault logo' })).tagName.toLowerCase()).toBe('svg');
    expect(container.querySelector('a[href="https://developer.hashicorp.com/vault"]')).not.toBeNull();
    expect(container.querySelector('img, image')).toBeNull();
    for (const { slug, name, url } of [
      { slug: 'xibo-cms', name: 'Xibo CMS', url: 'https://xibosignage.com/' },
      { slug: 'apache-hop', name: 'Apache Hop', url: 'https://hop.apache.org/' },
      { slug: 'apache-zeppelin', name: 'Apache Zeppelin', url: 'https://zeppelin.apache.org/' },
    ]) {
      const { container: host, unmount } = render(<PlatformLogo slug={slug} name={name} />);
      expect((await screen.findByRole('img', { name: `${name} logo` })).tagName.toLowerCase()).toBe('svg');
      expect(host.querySelector('a')?.getAttribute('href')).toBe(url);
      unmount();
    }
  });

  it('keeps all generated source SVG as paths in TSX, with no image tags or runtime fetching', () => {
    for (const file of readdirSync(generated).filter((name) => name.endsWith('.tsx'))) {
      const content = readFileSync(path.join(generated, file), 'utf8');
      expect(content, file).not.toMatch(/<(?:img|image|foreignObject|script)\b/i);
      expect(content, file).not.toMatch(/dangerouslySetInnerHTML|\bfetch\(/);
      expect(content, file).not.toMatch(/line\{stroke:/); // upstream Tunarr's global SVG CSS is stripped
      if (file !== 'registry.tsx') expect(content, file).toMatch(/<svg\b/);
    }
    for (const file of [
      'components/AppTile.tsx', 'components/OperatingSystemSelector.tsx',
      'pages/AdminOperatingSystemsPage.tsx', 'pages/DashboardServersPage.tsx', 'pages/ServerDetailPage.tsx',
      'pages/AdminControlPanelsPage.tsx', 'pages/ControlPanelsPage.tsx', 'pages/ControlPanelDetailPage.tsx',
    ]) {
      expect(readFileSync(path.resolve(process.cwd(), 'frontend/src', file), 'utf8'), file)
        .not.toMatch(/<(?:img|image)\b/);
    }
  });

  it('renders pinned original artwork without tracing or remote image URLs', () => {
    const { container } = render(<PlatformLogo slug="sqlchat" name="SQLChat" />);
    const image = screen.getByRole('img', { name: 'SQLChat logo' });
    expect(image.getAttribute('src')).toBe('/platform-originals/sqlchat.webp');
    expect(container.querySelector('svg')).toBeNull();
    expect(isWidePlatformLogo('sqlchat')).toBe(true);
    cleanup();
    render(<PlatformLogo slug="hiccup" name="Hiccup" />);
    expect(screen.getByRole('img', { name: 'Hiccup logo' }).getAttribute('src')).toBe('/platform-originals/hiccup.png');
    expect(originalLogos.hiccup.file).toBe('public/logo512.png');
    expect(isWidePlatformLogo('hiccup')).toBe(false);
    cleanup();
    render(<PlatformLogo slug="znc" name="ZNC" />);
    expect(screen.getByRole('img', { name: 'ZNC logo' }).getAttribute('src')).toBe('/platform-originals/znc.png');
    expect(originalLogos.znc.repository).toBe('znc/znc');
    expect(isWidePlatformLogo('znc')).toBe(true);
    cleanup();
    render(<PlatformLogo slug="spacedrive" name="Spacedrive" />);
    expect(screen.getByRole('img', { name: 'Spacedrive logo' }).getAttribute('src')).toBe('/platform-originals/spacedrive.png');
    expect(originalLogos.spacedrive.file).toBe('.github/logo.png');
    expect(isWidePlatformLogo('spacedrive')).toBe(false);
    for (const [slug, name] of [['meshcentral', 'MeshCentral'], ['webcord', 'WebCord'], ['taxhacker', 'TaxHacker'], ['screego', 'Screego']]) {
      cleanup();
      render(<PlatformLogo slug={slug} name={name} />);
      expect(screen.getByRole('img', { name: `${name} logo` }).getAttribute('src')).toBe(`/platform-originals/${slug}.png`);
      expect(isWidePlatformLogo(slug)).toBe(false);
    }
    cleanup();
    render(<PlatformLogo slug="plandex" name="Plandex" />);
    expect(screen.getByRole('img', { name: 'Plandex logo' }).getAttribute('src')).toBe('/platform-originals/plandex.png');
    expect(isWidePlatformLogo('plandex')).toBe(true);
    for (const slug of ['classquiz', 'coai', 'dkron', 'trip', 'soulsync', 'karaoke-eternal', 'jelly-clipper', 'atlas-cmms', 'local-deep-research', 'topola-genealogy-viewer']) {
      cleanup();
      const name = catalogue.get(slug)!;
      render(<PlatformLogo slug={slug} name={name} />);
      const image = screen.getByRole('img', { name: `${name} logo` });
      expect(image.getAttribute('src')).toBe(`/platform-originals/${slug}.png`);
      expect(isWidePlatformLogo(slug)).toBe(slug === 'dkron');
      if (slug === 'dkron') expect(image.classList.contains('ch247-platform-logo--dark-ground')).toBe(true);
    }
    expect(Object.keys(originalLogos)).toHaveLength(112);
    expect(new Set([...KNOWN_PLATFORM_SLUGS, ...referenced, ...Object.keys(originalLogos)]).size).toBe(1066);
    for (const slug of ['gotenberg', 'open-archiver', 'skyvern', 'text-generation-web-ui', 'gemini-cli', 'apache-kvrocks']) {
      cleanup();
      const name = catalogue.get(slug)!;
      render(<PlatformLogo slug={slug} name={name} />);
      const image = screen.getByRole('img', { name: `${name} logo` });
      expect(image.getAttribute('src')).toBe(`/platform-originals/${slug}.png`);
      expect(isWidePlatformLogo(slug)).toBe(slug === 'skyvern');
      if (slug === 'skyvern') expect(image.classList.contains('ch247-platform-logo--dark-ground')).toBe(true);
      if (slug === 'apache-kvrocks') expect(image.closest('a')?.getAttribute('href')).toBe('https://kvrocks.apache.org/');
    }
    for (const slug of ['zen', 'deskrpg', 'big-agi', 'cap', 'casibase', 'chiefonboarding', 'coral-talk', 'dialoqbase', 'dograh', 'domoticz']) {
      cleanup();
      const name = catalogue.get(slug)!;
      render(<PlatformLogo slug={slug} name={name} />);
      const image = screen.getByRole('img', { name: `${name} logo` });
      expect(image.getAttribute('src')).toBe(`/platform-originals/${slug}.png`);
      expect(image.tagName.toLowerCase()).toBe('img');
      expect(hasCodeRenderedLogo(slug)).toBe(false);
      expect(isWidePlatformLogo(slug)).toBe(['chiefonboarding', 'dograh'].includes(slug));
    }
    for (const slug of ['eclipse-kura', 'embystat', 'errbit', 'expensave', 'fusiondirectory', 'gpt-researcher', 'hollama', 'dspace', 'cops', 'codimd']) {
      cleanup();
      const name = catalogue.get(slug)!;
      render(<PlatformLogo slug={slug} name={name} />);
      const image = screen.getByRole('img', { name: `${name} logo` });
      expect(image.getAttribute('src')).toBe(`/platform-originals/${slug}.png`);
      expect(hasCodeRenderedLogo(slug)).toBe(false);
      expect(isWidePlatformLogo(slug)).toBe(['eclipse-kura', 'embystat', 'fusiondirectory'].includes(slug));
      if (slug === 'eclipse-kura') expect(image.classList.contains('ch247-platform-logo--dark-ground')).toBe(true);
    }
    for (const slug of ['kill-bill', 'm3db', 'mailtrain', 'mapstore', 'maputnik', 'mediago', 'mirofish', 'mopidy', 'nsq']) {
      cleanup();
      const name = catalogue.get(slug)!;
      render(<PlatformLogo slug={slug} name={name} />);
      const image = screen.getByRole('img', { name: `${name} logo` });
      expect(image.getAttribute('src')).toBe(`/platform-originals/${slug}.png`);
      expect(hasCodeRenderedLogo(slug)).toBe(false);
      expect(isWidePlatformLogo(slug)).toBe(false);
    }
    cleanup();
    render(<PlatformLogo slug="automatisch" name="Automatisch" />);
    expect(screen.getByRole('img', { name: 'Automatisch logo' }).getAttribute('src')).toBe('/platform-originals/automatisch.ico');
    expect(hasCodeRenderedLogo('automatisch')).toBe(false);
    expect(hasSourcedMark('automatisch')).toBe(true);
    cleanup();
    render(<PlatformLogo slug="iceshrimp" name="Iceshrimp" />);
    expect(screen.getByRole('img', { name: 'Iceshrimp logo' }).getAttribute('src')).toBe('/platform-originals/iceshrimp.png');
    expect(screen.getByRole('link', { name: 'Iceshrimp logo attribution and CC BY-SA 4.0 license' }).getAttribute('href')).toBe('/platform-originals/iceshrimp-LICENSE.txt');
    expect(isWidePlatformLogo('iceshrimp')).toBe(true);
    expect(hasSourcedMark('iceshrimp')).toBe(true);
    expect(readFileSync(path.resolve(process.cwd(), 'frontend/public/platform-originals/iceshrimp-LICENSE.txt'), 'utf8')).toContain('Laura Hausmann');
    for (const asset of Object.values(originalLogos)) {
      const bytes = readFileSync(path.resolve(process.cwd(), 'frontend/public' + asset.url));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
    }
  });

  it('renders ten newly sourced originals with their notices, not pending SVGs', () => {
    for (const slug of ['nango', 'redpanda-console', 'spacetimedb', 'koffan', 'jobops', 'evolution-api', 'evolution-go', 'open-source-pos', 'yacy', 'asp-net']) {
      cleanup();
      const name = catalogue.get(slug)!;
      const asset = originalLogos[slug as keyof typeof originalLogos];
      render(<PlatformLogo slug={slug} name={name} />);
      const image = screen.getByRole('img', { name: `${name} logo` });
      expect(image.tagName.toLowerCase()).toBe('img');
      expect(image.getAttribute('src')).toBe(asset.url);
      expect(hasSourcedMark(slug)).toBe(true);
      expect(hasCodeRenderedLogo(slug)).toBe(false);
      expect(isWidePlatformLogo(slug)).toBe(['nango', 'koffan', 'yacy'].includes(slug));
      expect(screen.getByRole('link', { name: `${name} artwork source and license` }).getAttribute('href')).toBe(`/platform-originals/${slug}-LICENSE.txt`);
      expect(readFileSync(path.resolve(process.cwd(), `frontend/public/platform-originals/${slug}-LICENSE.txt`), 'utf8')).toContain(asset.sha256);
      expect(screen.queryByText('SVG pending')).toBeNull();
      if (slug === 'asp-net') {
        expect(image.style.width).toBe('50px');
        expect(image.style.margin).toBe('16px');
      }
    }
  });

  it('shows fourteen bundles as separately labelled original component marks', () => {
    expect(Object.keys(bundleLogos.bundles)).toHaveLength(14);
    expect(new Set([...KNOWN_PLATFORM_SLUGS, ...referenced, ...Object.keys(originalLogos), ...Object.keys(bundleLogos.bundles)]).size).toBe(1080);
    for (const [slug, components] of Object.entries(bundleLogos.bundles)) {
      cleanup();
      const name = catalogue.get(slug)!;
      expect(name).toBeTruthy();
      render(<PlatformLogo slug={slug} name={name} />);
      const group = screen.getByRole('group', { name: `${name} component logos` });
      expect(group.querySelectorAll('img')).toHaveLength(components.length);
      expect(isWidePlatformLogo(slug)).toBe(true);
      expect(hasCodeRenderedLogo(slug)).toBe(false);
      for (const key of components) {
        const asset = bundleLogos.components[key as keyof typeof bundleLogos.components];
        expect(screen.getByRole('img', { name: `${asset.name} logo` }).getAttribute('src')).toBe(asset.url);
        expect(screen.getByText(asset.name)).toBeTruthy();
        const bytes = readFileSync(path.resolve(process.cwd(), 'frontend/public' + asset.url));
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
      }
      expect(screen.queryByText('SVG pending')).toBeNull();
      expect(screen.getByRole('link', { name: 'Component marks · sources' }).getAttribute('href')).toBe('/platform-components/NOTICES.txt');
    }
  });

  it('covers the next eight original images and the exact MEAN/MEVN components', () => {
    expect(bundleLogos.bundles['mean-stack-mongodb-expressjs-angularjs-nodejs']).toEqual(['mongodb', 'express', 'angularjs', 'nodejs']);
    expect(bundleLogos.bundles['mevn-stack-mongodb-expressjs-vuejs-nodejs']).toEqual(['mongodb', 'express', 'vue', 'nodejs']);
    for (const slug of ['aapanel', 'multica', 'nopcommerce', 'fmd-find-my-device', 'foundry-vtt', 'sharkey', 'mcp-server', 'ant-media-server-ce']) {
      cleanup();
      const name = catalogue.get(slug)!;
      render(<PlatformLogo slug={slug} name={name} />);
      const image = screen.getByRole('img', { name: `${name} logo` });
      expect(image.getAttribute('src')).toBe(`/platform-originals/${slug}.png`);
      expect(screen.queryByText('SVG pending')).toBeNull();
      expect(screen.getByRole('link', { name: `${name} artwork source and license` }).getAttribute('href')).toBe(`/platform-originals/${slug}-LICENSE.txt`);
      if (['nopcommerce', 'ant-media-server-ce'].includes(slug)) expect(image.classList.contains('ch247-platform-logo--dark-ground')).toBe(true);
    }
    expect(originalLogos['ant-media-server-ce'].rightsReview).toContain('Unresolved');
  });

  it('loads ten more source originals, including unchanged JPG and SVG files', () => {
    for (const slug of ['matrix-conduit', 'twingate-connector', 'ubooquity', 'komari', 'zenfeed', 'gowa', 'yucca', 'yao', 'emailengine', 'metatrader-5']) {
      cleanup();
      const name = catalogue.get(slug)!;
      const asset = originalLogos[slug as keyof typeof originalLogos];
      render(<PlatformLogo slug={slug} name={name} />);
      expect(screen.getByRole('img', { name: `${name} logo` }).getAttribute('src')).toBe(asset.url);
      expect(screen.queryByText('SVG pending')).toBeNull();
      expect(hasSourcedMark(slug)).toBe(true);
      expect(isWidePlatformLogo(slug)).toBe(slug === 'metatrader-5');
      expect(screen.getByRole('link', { name: `${name} artwork source and license` }).getAttribute('href')).toBe(`/platform-originals/${slug}-LICENSE.txt`);
    }
    expect(originalLogos['metatrader-5']).not.toHaveProperty('gitBlob');
    expect(originalLogos['metatrader-5'].provenanceType).toBe('official-website');
    expect(originalLogos.yucca.url).toMatch(/\.jpg$/);
    expect(originalLogos.gowa.allowEmbeddedPng).toBe(true);
  });

  it('checks original SVG references without changing upstream artwork', () => {
    const load = (slug: 'gowa' | 'yao') => readFileSync(path.resolve(process.cwd(), 'frontend/public' + originalLogos[slug].url), 'utf8');
    expect(() => assertSafeOriginalSvg(load('yao'))).not.toThrow();
    expect(() => assertSafeOriginalSvg(load('gowa'), true)).not.toThrow();
    expect(() => assertSafeOriginalSvg(load('gowa'))).toThrow();
    for (const content of [
      '<svg><script>alert(1)</script></svg>',
      '<svg onload="alert(1)"></svg>',
      '<svg><image href="https://example.com/tracker.png"/></svg>',
      '<svg><image href="data:text/html;base64,YQ=="/></svg>',
      '<svg><foreignObject/></svg>',
      '<svg><style>@import "https://example.com/a.css";</style></svg>',
      '<svg><path fill="url(https://example.com/a.svg)"/></svg>',
      '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///secret">]><svg/>',
    ]) expect(() => assertSafeOriginalSvg(content, true)).toThrow();
  });

  it('renders ten additional identified marks and distinguishes website captures from Git pins', () => {
    for (const slug of ['clustercontrol', 'kusanagi', 'manticore-search', 'letta', 'tinycp', 'r2r', 'apache-jspwiki', 'drizzle-gateway', 'euro-office-documentserver', 'perplexica']) {
      cleanup();
      const name = catalogue.get(slug)!;
      const asset = originalLogos[slug as keyof typeof originalLogos];
      render(<PlatformLogo slug={slug} name={name} />);
      const image = screen.getByRole('img', { name: `${name} logo` });
      expect(image.getAttribute('src')).toBe(asset.url);
      expect(screen.queryByText('SVG pending')).toBeNull();
      expect(hasSourcedMark(slug)).toBe(true);
      if (slug === 'apache-jspwiki') expect(screen.getByRole('link', { name: 'Official Apache JSPWiki project website' }).getAttribute('href')).toBe('https://jspwiki.apache.org/');
      else expect(screen.getByRole('link', { name: `${name} artwork source and license` }).getAttribute('href')).toBe(`/platform-originals/${slug}-LICENSE.txt`);
      if (slug === 'r2r') expect(image.classList.contains('ch247-platform-logo--dark-ground')).toBe(true);
    }
    expect(originalLogos.perplexica.revision).toBe('295334b19502e942339fdde7e343e8bf9e6ed1a1');
    expect(originalLogos['drizzle-gateway'].repository).toBe('drizzle-team/gateway-website');
    expect(originalLogos['apache-jspwiki'].file).toMatch(/jspwiki_logo_s\.png$/);
    expect(originalLogos.tinycp.provenanceType).toBe('third-party-listing');
    expect(originalLogos.r2r.sourceFormat).toBe('svg');
    expect(originalLogos.r2r.storedFormat).toBe('png');
    for (const slug of ['clustercontrol', 'kusanagi', 'manticore-search', 'letta', 'tinycp', 'r2r'] as const) expect(originalLogos[slug]).not.toHaveProperty('gitBlob');
  });

  it('uses MicroRealEstate’s actual static brand SVG, not the old generic building icon', () => {
    render(<PlatformLogo slug="microrealestate" name="MicroRealEstate" />);
    const asset = originalLogos.microrealestate;
    expect(screen.getByRole('img', { name: 'MicroRealEstate logo' }).getAttribute('src')).toBe(asset.url);
    expect(screen.queryByText('SVG pending')).toBeNull();
    expect(screen.getByRole('link', { name: 'MicroRealEstate artwork source and license' }).getAttribute('href')).toBe(asset.noticeUrl);
    const bytes = readFileSync(path.resolve(process.cwd(), 'frontend/public' + asset.url));
    expect(createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex')).toBe(asset.gitBlob);
    expect(() => assertSafeOriginalSvg(bytes.toString())).not.toThrow();
    expect(bytes.toString()).toContain('<title>MicroRealEstate</title>');
    expect(bytes.toString()).toContain('#3B82F6');
    expect(bytes.toString()).toContain('#FBBF24');
    expect(asset.identityFile).toContain('AppLogo.tsx');
    expect(asset.rightsReview).toContain('no separate');
  });

  it('renders ten newly sourced assets while retaining identity and rights qualifications', () => {
    for (const slug of ['atomic-server', 'canarytokens', 'firefly', 'fastpanel', 'geneac', 'open-agent', 'openai-codex', 'plik', 'plone', 'svix'] as const) {
      cleanup();
      const asset = originalLogos[slug];
      const name = catalogue.get(slug)!;
      render(<PlatformLogo slug={slug} name={name} />);
      const image = screen.getByRole('img', { name: `${name} logo` });
      expect(image.getAttribute('src')).toBe(asset.url);
      expect(screen.queryByText('SVG pending')).toBeNull();
      expect(hasSourcedMark(slug)).toBe(true);
      expect(asset.rightsReview).toContain('NOT established');
      if (slug === 'canarytokens' || slug === 'fastpanel') expect(image.classList.contains('ch247-platform-logo--dark-ground')).toBe(true);
      if (slug === 'plone') {
        expect(image.closest('a')?.getAttribute('href')).toBe('https://plone.org/');
        expect(image.getAttribute('style')).toContain('width: 160px');
        expect(image.getAttribute('title')).toContain('registered trademark');
      } else expect(image.closest('a')?.getAttribute('href')).toBe(asset.noticeUrl);
    }
    expect(originalLogos.firefly.repository).toBe('Safe3/firefly');
    expect(originalLogos['open-agent'].repository).toBe('the-open-agent/static');
    expect(originalLogos['openai-codex'].sha256).toBe('de7d43f3386105ab20952958c2c25beb0d903e2aeb6e1aef57c49a648c0d1c07');
    expect(originalLogos.geneac.identityNote).toContain('NOT an isolated logo');
    expect(originalLogos.plik.repository).toBe('YunoHost/apps');
    expect(originalLogos.svix.identityNote).toContain('NOT byte-identical SVG');
  });

  it('adds four verified artwork sources and two explicitly labelled stacks', () => {
    for (const slug of ['juxtapose', 'deepseek-harness', 'grok-build', 'tiny-file-manager'] as const) {
      cleanup();
      const asset = originalLogos[slug];
      const name = catalogue.get(slug)!;
      render(<PlatformLogo slug={slug} name={name} />);
      expect(screen.getByRole('img', { name: `${name} logo` }).getAttribute('src')).toBe(asset.url);
      expect(screen.getByRole('link', { name: `${name} artwork source and license` }).getAttribute('href')).toBe(asset.noticeUrl);
      expect(screen.queryByText('SVG pending')).toBeNull();
      const bytes = readFileSync(path.resolve(process.cwd(), 'frontend/public' + asset.url));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
      if ('gitBlob' in asset) expect(createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex')).toBe(asset.gitBlob);
      if (asset.url.endsWith('.svg')) expect(() => assertSafeOriginalSvg(bytes.toString())).not.toThrow();
    }
    expect(originalLogos.juxtapose.repository).toBe('jc21/juxtapose');
    expect(originalLogos['tiny-file-manager']).not.toHaveProperty('gitBlob');
    expect(originalLogos['tiny-file-manager'].sourceGitBlob).toMatch(/^[a-f0-9]{40}$/);
    expect(originalLogos['grok-build'].sha256).toBe('37ddbcb6e2a7f2e4b3be78a7d41296a3bc7edf6926362434efc00df5a56a3586');
    expect(bundleLogos.bundles['anki-sync-server-enhanced']).toEqual(['anki', 'docker']);
    expect(bundleLogos.bundles.nemoclaw).toEqual(['openshell', 'openclaw']);
    expect(bundleLogos.bundles['openlitespeed-and-node-js']).toEqual(['openlitespeed', 'nodejs']);
    cleanup();
    render(<PlatformLogo slug="openlitespeed-and-node-js" name="OpenLiteSpeed and Node.js" />);
    expect(screen.getByRole('group', { name: 'OpenLiteSpeed and Node.js component logos' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'OpenLiteSpeed logo' }).getAttribute('src')).toBe(bundleLogos.components.openlitespeed.url);
    expect(screen.getByRole('img', { name: 'Node.js logo' }).getAttribute('src')).toBe(bundleLogos.components.nodejs.url);
    expect(screen.queryByText('SVG pending')).toBeNull();
  });

  it('uses the author-identified original Susie logo for Snac2 without tracing', () => {
    const asset = originalLogos.snac2;
    render(<PlatformLogo slug="snac2" name="Snac2" />);
    expect(screen.getByRole('img', { name: 'Snac2 logo' }).getAttribute('src')).toBe('/platform-originals/snac2.png');
    expect(screen.getByRole('link', { name: 'Snac2 artwork source and license' }).getAttribute('href')).toBe(asset.noticeUrl);
    expect(screen.queryByText('SVG pending')).toBeNull();
    expect(asset.file).toBe('doc/susie64.png');
    expect(asset.identitySource).toBe('https://comam.es/snac/grunfink/p/1711176017.741099');
    const bytes = readFileSync(path.resolve(process.cwd(), 'frontend/public' + asset.url));
    expect(createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex')).toBe(asset.gitBlob);
    expect(bytes.readUInt32BE(16)).toBe(64);
    expect(bytes.readUInt32BE(20)).toBe(64);
    const notice = readFileSync(path.resolve(process.cwd(), 'frontend/public' + asset.noticeUrl), 'utf8');
    expect(notice).toContain(asset.sha256);
    expect(notice).toContain('MIT License');
    expect(notice).toContain('logo of #snac');
  });

  it('keeps Fasten Health and fazer.ai agents separate and preserves the legacy Fasten identifier', () => {
    const fasten = PLATFORM_CATALOG.find(x => x.slug === 'fasten-healthfazer-ai-agents')!;
    const fazer = PLATFORM_CATALOG.find(x => x.slug === 'fazerai-agents')!;
    expect(fasten.id).toBe('app-fasten-healthfazer-ai-agents');
    expect(fasten.name).toBe('Fasten Health');
    expect(fasten.websiteUrl).toBe('https://github.com/fastenhealth/fasten-onprem');
    expect(fazer.id).toBe('app-fazerai-agents');
    expect(fazer.name).toBe('fazer.ai agents');
    expect(fazer.websiteUrl).toBe('https://github.com/fazer-ai/agents');
    expect(PLATFORM_CATALOG.some(x => x.name === 'Fasten Healthfazer.ai agents')).toBe(false);
    for (const slug of ['fasten-healthfazer-ai-agents', 'fazerai-agents'] as const) {
      cleanup();
      const name = catalogue.get(slug)!;
      const asset = originalLogos[slug];
      render(<PlatformLogo slug={slug} name={name} />);
      const image = screen.getByRole('img', { name: `${name} logo` });
      expect(image.getAttribute('src')).toBe(asset.url);
      expect(image.closest('a')?.getAttribute('href')).toBe(asset.noticeUrl);
      expect(screen.queryByText('SVG pending')).toBeNull();
      if (slug === 'fazerai-agents') expect(image.classList.contains('ch247-platform-logo--dark-ground')).toBe(true);
      const bytes = readFileSync(path.resolve(process.cwd(), 'frontend/public' + asset.url));
      expect(createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex')).toBe(asset.gitBlob);
    }
  });

  it.todo('source, review and code-render verified logos for the remaining 12 catalogue entries');
});
