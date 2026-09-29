import type { MarketplaceApp } from '../lib/marketplace-api';

/**
 * Deterministic "letter tile" logo. Most catalog apps have no bundled logo asset, and loading
 * third-party images leaks browsing data to external CDNs — instead, every app gets a stable,
 * brand-colored tile derived from its slug. Admins can set a real logo_url later; this tile is
 * the honest, self-contained default.
 */
const PALETTE = ['#0756d8', '#0b7285', '#5f3dc4', '#c2255c', '#e8590c', '#2b8a3e', '#862e9c', '#1971c2'];

export default function AppTile({ name, slug, size = 44 }: { name: string; slug: string; size?: number }) {
  const colorIndex = [...slug].reduce((acc, char) => acc + char.charCodeAt(0), 0) % PALETTE.length;
  const initials = name
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span
      className="ch247-app-tile"
      aria-hidden="true"
      style={{ width: size, height: size, background: PALETTE[colorIndex], fontSize: Math.round(size * 0.38) }}
    >
      {initials || '?'}
    </span>
  );
}

export function formatMemory(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`;
}

export function formatStorage(mb: number): string {
  return mb >= 1024 ? `${Math.round(mb / 1024)} GB` : `${mb} MB`;
}

/** Marketplace card (spec §42): logo, name, description, category, requirements, install. */
export function AppCard({ app }: { app: MarketplaceApp }) {
  return (
    <div className="ch247-market-card">
      <div className="ch247-market-card__head">
        <AppTile name={app.name} slug={app.slug} />
        <div>
          <h3>{app.name}</h3>
          <p className="ch247-market-card__cat">
            {app.category?.name ?? 'Application'}
            {app.featured ? <span className="ch247-badge ch247-badge--active">Featured</span> : null}
          </p>
        </div>
      </div>
      <p className="ch247-market-card__desc">{app.description}</p>
      <p className="ch247-market-card__req">
        {app.requirements.minCpu} CPU · {formatMemory(app.requirements.minMemoryMb)} RAM ·{' '}
        {formatStorage(app.requirements.minStorageMb)} storage
        {app.requirements.gpu ? ' · GPU' : ''}
      </p>
      <p className="ch247-market-card__meta">
        {app.stableVersion ? `v${app.stableVersion}` : 'No stable version yet'} · {app.installCount} install
        {app.installCount === 1 ? '' : 's'}
      </p>
      <div className="ch247-market-card__actions">
        <a className="ch247-btn ch247-btn--primary" href={`/apps/${app.slug}`}>
          View &amp; install
        </a>
      </div>
    </div>
  );
}
