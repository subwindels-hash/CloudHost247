import type { MarketplaceApp } from '../lib/marketplace-api';
import PlatformLogo from './PlatformLogo';

/** The marketplace and platform catalogue use the same code-rendered logo registry. */
export default function AppTile({ name, slug, size = 44 }: { name: string; slug: string; size?: number }) {
  return (
    <span className="ch247-app-tile" style={{ width: size, height: size }}>
      <PlatformLogo slug={slug} name={name} className="ch247-app-tile__mark" />
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
