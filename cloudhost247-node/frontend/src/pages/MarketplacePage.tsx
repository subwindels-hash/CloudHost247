import { useEffect, useState } from 'react';
import { usePageMeta } from '../lib/usePageMeta';
import { fetchMarketplaceApps, fetchMarketplaceCategories, type MarketplaceApp, type MarketplaceCategory } from '../lib/marketplace-api';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import { AppCard } from '../components/AppTile';

/**
 * Public application marketplace (spec §41): search, category filter, featured/popular/recent
 * rails, all served from the real /api/v1/apps catalog — never a hardcoded app list.
 */
export default function MarketplacePage() {
  usePageMeta('App Marketplace', 'One-click install 50+ open-source applications on CloudHost247 hosting.');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<'popular' | 'recent' | 'name'>('popular');
  const [apps, setApps] = useState<MarketplaceApp[] | null>(null);
  const [categories, setCategories] = useState<MarketplaceCategory[] | null>(null);
  const [error, setError] = useState('');

  // Debounce search so typing does not hammer the API.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    fetchMarketplaceApps({ category, search: debounced, sort })
      .then((result) => {
        if (!cancelled) {
          setApps(result.apps);
          setError('');
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [category, debounced, sort]);

  useEffect(() => {
    fetchMarketplaceCategories()
      .then((result) => setCategories(result.categories))
      .catch(() => setCategories([]));
  }, []);

  const featured = (apps ?? []).filter((app) => app.featured).slice(0, 6);
  const activeCategoryName = categories?.find((c) => c.slug === category)?.name;

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <h1>App Marketplace</h1>
        <p className="ch247-page__hint">
          Deploy open-source applications to your CloudHost247 hosting in a few clicks — the
          platform handles the server, Docker networking, SSL, and backups. Every installation is
          isolated from every other customer.
        </p>

        <div className="ch247-market-controls">
          <input
            type="search"
            placeholder="Search applications…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search applications"
          />
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as 'popular' | 'recent' | 'name')}
            aria-label="Sort applications"
          >
            <option value="popular">Most popular</option>
            <option value="recent">Recently added</option>
            <option value="name">Name (A–Z)</option>
          </select>
        </div>

        {categories && categories.length > 0 && (
          <div className="ch247-market-cats" aria-label="Filter by category">
            <button type="button" className={category === '' ? 'is-active' : ''} onClick={() => setCategory('')}>
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat.slug}
                type="button"
                className={category === cat.slug ? 'is-active' : ''}
                onClick={() => setCategory(cat.slug)}
              >
                {cat.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <CatalogErrorBanner message={error} />}
      {apps === null && !error && <CatalogLoadingBanner label="Loading the catalog…" />}

      {apps !== null && featured.length > 0 && !category && !debounced && (
        <div className="ch247-market-section">
          <h2>Featured applications</h2>
          <div className="ch247-market-grid">
            {featured.map((app) => (
              <AppCard key={app.slug} app={app} />
            ))}
          </div>
        </div>
      )}

      {apps !== null && (
        <div className="ch247-market-section">
          <h2>{category ? (activeCategoryName ?? 'Applications') : 'All applications'}</h2>
          {apps.length === 0 && (
            <p className="ch247-page__hint">No applications match — try a different search or category.</p>
          )}
          <div className="ch247-market-grid">
            {apps.map((app) => (
              <AppCard key={app.slug} app={app} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
