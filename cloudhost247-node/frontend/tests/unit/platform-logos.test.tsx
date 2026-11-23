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
import logoSources from '../../src/data/platform-logo-sources.json';
import { hasCodeRenderedLogo } from '../../src/data/generated-platform-icons/registry';

afterEach(cleanup);

const catalogue = new Map(PLATFORM_CATALOG.map((entry) => [entry.slug, entry.name]));
const referenced = Object.keys(logoSources.icons);
const generated = path.resolve(process.cwd(), 'frontend/src/data/generated-platform-icons');

function hasSourcedMark(slug: string) {
  return KNOWN_PLATFORM_SLUGS.includes(slug) || hasCodeRenderedLogo(slug);
}

describe('Control Panels & Application Platforms: code-rendered marks', () => {
  it('has one auditable, pinned vector per sourced slug, without pretending every entry is covered', () => {
    expect(catalogue.size).toBe(1_091);
    expect(KNOWN_PLATFORM_SLUGS).toHaveLength(14);
    expect(referenced).toHaveLength(965);
    expect(new Set([...KNOWN_PLATFORM_SLUGS, ...referenced]).size).toBe(979);
    for (const slug of referenced) {
      expect(catalogue.has(slug), slug).toBe(true);
      expect(KNOWN_PLATFORM_SLUGS, slug).not.toContain(slug);
      expect(hasCodeRenderedLogo(slug), slug).toBe(true);
      const source = logoSources.icons[slug as keyof typeof logoSources.icons];
      expect(source.sha256, slug).toMatch(/^[a-f0-9]{64}$/);
      expect(logoSources.collections[source.source as keyof typeof logoSources.collections], slug).toHaveProperty('license');
    }
    const missing = PLATFORM_CATALOG.filter(({ slug }) => !hasSourcedMark(slug));
    expect(missing).toHaveLength(112);
    expect(missing.map(({ slug }) => slug)).toContain('budge'); // upstream file is the React boilerplate atom, not a project logo
    expect(missing.map(({ slug }) => slug)).toContain('auto-ontology'); // NVIDIA's mark is not project-specific
    expect(missing.map(({ slug }) => slug)).toContain('canarytokens'); // first-party asset has special GPL terms; clarify before embedding
    expect(missing.map(({ slug }) => slug)).not.toContain('apollo'); // reviewed GMOD wordmark, not Apollo GraphQL
    expect(missing.map(({ slug }) => slug)).toContain('znc'); // available PNG trace distorts its distinctive wordmark
    expect(missing.map(({ slug }) => slug)).toContain('firefly'); // first-party graphic is personal-use only
    expect(missing.map(({ slug }) => slug)).toContain('plone'); // commercial mark use requires an agreement
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
    for (const slug of ['almalinux', 'debian', 'rocky-linux', 'ubuntu', 'alpine-linux', 'arch-linux', 'centos', 'cloudlinux', 'wordpress', 'apache-airflow', 'gogs', 'apache-couchdb', 'grafana-loki', 'dashy', 'zipline', 'lychee', 'apprise-api', 'flagsmith', 'fleet', 'phoenix', 'yarn', 'photoview', 'cap', 'n8n-queue-mode', 'airsonic-advanced', 'changedetection-io', 'gns3-server', 'xibo-cms', 'apache-hop', 'apache-pinot', 'apache-zeppelin', 'lightdash', 'lightrag', 'usesend', 'sillytavern', 'shoutrrr', 'galaxy', 'indico', 'code-server', 'starrocks', 'tensorzero', 'hasura-graphql-engine', 'corteza', 'illa-builder', 'loomio', 'nuclio', 'rivet', 'sim-studio', 'sqlpage', 'wintercms', 'nextchat', 'agenta', 'classicpress', 'cvat', 'db-browser-for-sqlite', 'exelearning', 'featbit', 'flexget', 'gitingest', 'hfs', 'horilla', 'openremote', 'spice-ai', 'steel-browser', 'universal-media-server', 'webthings-gateway', 'aureuserp', 'argilla', 'dhis2', 'fuxa', 'insforge', 'kafbat-kafka-ui', 'lavinmq', 'openmausbot', 'freellmapi', 'serverstatus', 'agentmemory', 'archivesspace', 'beaverhabits', 'cognee', 'foxel', 'home-gallery', 'hoop', 'huggingchat-chat-ui', 'kotaemon', 'krayin-crm', 'decidim', 'maxkb', 'otobo', 'quasarr', 'ekuiper', 'immudb', 'open-monograph-press', 'open-journal-systems', 'readyset', 'tyk-gateway', 'sherlock', 'thinkdashboard', 'coral-talk', 'kiwix-serve', 'casibase', 'judge0-ce', 'fusio', 'crawl4ai', 'autobase', 'osrm', 'apache-streampark', 'alerta', 'traduora', 'daptin', 'vane', 'centrifugo', 'annif', 'eve', 'isso', 'synclounge', 'ldap-account-manager', 'dspace', 'microcks', 'openlit', 'dograh', 'reiverr', 'trudesk', 'sickgear', 'mopidy', 'nsq', 'aitoearn', 'kill-bill', 'parse-server', 'senaite-lims', 'starbase-80', 'thumbor', 'scada-lts', 'ckan', 'dialoqbase', 'domoticz', 'embystat', 'gpt-researcher', 'libredesk', 'owntracks-recorder', 'para', 'posterr', 'smocker', 'speakr', 'dataline', 'expensave', 'readur', 'remark42', 'shynet', 'waline', 'bionic-gpt', 'cheshire-cat-ai', 'domjudge', 'headroom', 'meteroid', 'microweber', 'nod', 'percona-pmm', 'teammapper', 'zeronote', 'faktory', 'redaxo', 'thruk', 'alltube', 'arcadedb', 'artalk', 'big-agi', 'teedy', 'mediago', 'bookshelf', 'classroomio', 'eclipse-hawkbit', 'ever-gauzy', 'faraday', 'feedcraft', 'fleetbase', 'form-io', 'hermes-workspace', 'itflow', 'librebooking', 'lms', 'mistserver', 'openhuman', 'openseo', 'openviking', 'paisa', 'paperclip', 'privategpt', 'pycsw', 'ralph', 'razzia', 'scoold', 'serverkit', 'shipshipship', 'songloft', 'tinode', 'vince-analytics', 'wbo']) {
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
    for (const slug of ['firefly', 'znc', 'plone', 'wireguard-easy', 'atomic-server', 'aapanel', 'fastpanel', 'tinycp', 'kusanagi', 'hiccup', 'not-in-the-catalogue']) {
      const name = catalogue.get(slug) ?? 'My Panel';
      const markup = renderToStaticMarkup(<PlatformLogo slug={slug} name={name} />);
      expect(markup, slug).toContain(`Verified SVG logo pending for ${name}`);
      expect(markup, slug).toContain('SVG pending');
      expect(markup, slug).not.toMatch(/<(?:svg|img|image)\b/i);
    }
    // Even an old API logo_url cannot turn back on image-based rendering.
    const { container } = render(<PlatformLogo slug="unverified" name="Unverified" {...{ logoUrl: 'https://example.com/tracker.svg' }} />);
    expect(container.querySelector('img, image, svg')).toBeNull();
  });

  it('ties ambiguous catalogue names to the correct projects, and links the Vault mark as required', async () => {
    const source = logoSources.icons;
    expect(source.yarn.repository).toBe('gotamer/yarn');
    expect(source.yarn.file).toBe('internal/logo.svg'); // Yarn.social, not yarnpkg
    expect(source.phoenix.repository).toBe('Arize-ai/phoenix'); // not the Elixir framework
    expect(source['yt-dlp-web-ui'].source).toBe('official-ico');
    expect(source['yt-dlp-web-ui'].file).toBe('frontend/src/assets/favicon.ico');
    expect(source['yt-dlp-web-ui'].icoSize).toBe(128);
    expect(source.codimd.repository).toBe('hackmdio/codimd'); // not HedgeDoc
    expect(source.pghero.repository).toBe('ankane/pghero');
    expect(source.pghero.file).toBe('app/assets/images/pghero/favicon.png');
    expect(source.pgweb.repository).toBe('sosedoff/pgweb');
    expect(source.pgweb.file).toBe('static/img/icon.png');
    expect(source.photoview.source).toBe('official-png'); // not the flattened third-party diamond
    expect(source.photoview).toHaveProperty('traceProfile', 'gradient-detail');
    expect(source.cap.repository).toBe('tiagozip/cap'); // CAPTCHA, not the Cap.so screen recorder
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
      'components/PlatformLogo.tsx', 'components/AppTile.tsx', 'components/OperatingSystemSelector.tsx',
      'pages/AdminOperatingSystemsPage.tsx', 'pages/DashboardServersPage.tsx', 'pages/ServerDetailPage.tsx',
      'pages/AdminControlPanelsPage.tsx', 'pages/ControlPanelsPage.tsx', 'pages/ControlPanelDetailPage.tsx',
    ]) {
      expect(readFileSync(path.resolve(process.cwd(), 'frontend/src', file), 'utf8'), file)
        .not.toMatch(/<(?:img|image)\b/);
    }
  });

  it.todo('source, review and code-render verified logos for the remaining 112 catalogue entries');
});
