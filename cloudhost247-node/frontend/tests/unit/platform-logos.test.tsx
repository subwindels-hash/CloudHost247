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
    expect(referenced).toHaveLength(817);
    expect(new Set([...KNOWN_PLATFORM_SLUGS, ...referenced]).size).toBe(831);
    for (const slug of referenced) {
      expect(catalogue.has(slug), slug).toBe(true);
      expect(KNOWN_PLATFORM_SLUGS, slug).not.toContain(slug);
      expect(hasCodeRenderedLogo(slug), slug).toBe(true);
      const source = logoSources.icons[slug as keyof typeof logoSources.icons];
      expect(source.sha256, slug).toMatch(/^[a-f0-9]{64}$/);
      expect(logoSources.collections[source.source as keyof typeof logoSources.collections], slug).toHaveProperty('license');
    }
    const missing = PLATFORM_CATALOG.filter(({ slug }) => !hasSourcedMark(slug));
    expect(missing).toHaveLength(260);
    expect(missing.map(({ slug }) => slug)).toContain('budge'); // upstream file is the React boilerplate atom, not a project logo
    expect(missing.map(({ slug }) => slug)).toContain('auto-ontology'); // NVIDIA's mark is not project-specific
    expect(missing.map(({ slug }) => slug)).toContain('canarytokens'); // first-party asset has special GPL terms; clarify before embedding
    expect(missing.map(({ slug }) => slug)).toContain('apollo'); // first-party PNG trace damages its letters
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
    for (const slug of ['almalinux', 'debian', 'rocky-linux', 'ubuntu', 'alpine-linux', 'arch-linux', 'centos', 'cloudlinux', 'wordpress', 'apache-airflow', 'gogs', 'apache-couchdb', 'grafana-loki', 'dashy', 'zipline', 'lychee', 'apprise-api', 'flagsmith', 'fleet', 'phoenix', 'yarn', 'photoview', 'cap', 'n8n-queue-mode', 'airsonic-advanced', 'changedetection-io', 'gns3-server', 'xibo-cms', 'apache-hop', 'apache-pinot', 'apache-zeppelin', 'lightdash', 'lightrag', 'usesend', 'sillytavern', 'shoutrrr', 'galaxy', 'indico', 'code-server', 'starrocks', 'tensorzero', 'hasura-graphql-engine', 'corteza', 'illa-builder', 'loomio', 'nuclio', 'rivet', 'sim-studio', 'sqlpage', 'wintercms', 'nextchat', 'agenta', 'classicpress', 'cvat', 'db-browser-for-sqlite', 'exelearning', 'featbit', 'flexget', 'gitingest', 'hfs', 'horilla', 'openremote', 'spice-ai', 'steel-browser', 'universal-media-server', 'webthings-gateway', 'aureuserp', 'argilla', 'dhis2', 'fuxa', 'insforge', 'kafbat-kafka-ui', 'lavinmq', 'openmausbot', 'freellmapi', 'serverstatus', 'agentmemory', 'archivesspace', 'beaverhabits', 'cognee', 'foxel', 'home-gallery', 'hoop', 'huggingchat-chat-ui', 'kotaemon', 'krayin-crm']) {
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
    for (const slug of ['apollo', 'firefly', 'znc', 'plone', 'wireguard-easy', 'atomic-server', 'aapanel', 'fastpanel', 'tinycp', 'kusanagi', 'sherlock', 'not-in-the-catalogue']) {
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

  it.todo('source, review and code-render verified logos for the remaining 260 catalogue entries');
});
