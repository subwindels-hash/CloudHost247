import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { toolsApi, type ToolStatus, type ToolSummary, type ToolsDashboard } from '../lib/tools-api';

const STATUS_LABEL: Record<ToolStatus, string> = {
  ACTIVE: 'Available',
  DISABLED: 'Disabled',
  MAINTENANCE: 'Maintenance',
  CONFIGURATION_REQUIRED: 'Needs setup',
  SERVICE_UNAVAILABLE: 'Unavailable here',
};

/** Catalogue paths can contain a literal parameter (the Domain Health Center uses /domains/:domain/health);
 * those entries are linked through their tool page, which asks for the missing value. */
function toolHref(tool: ToolSummary): string {
  return tool.path.includes(':') ? `/tools/${tool.slug}` : tool.path;
}

export default function ToolsCenterPage() {
  usePageMeta('Tools Center', 'DNS, IP, network, developer, webmaster and security tools with real resolver data — built into CloudHost247.');
  const [params, setParams] = useSearchParams();
  const [dashboard, setDashboard] = useState<ToolsDashboard | null>(null);
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [categories, setCategories] = useState<Array<{ slug: string; label: string; toolCount: number }>>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  const activeCategory = params.get('category');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([toolsApi.catalog(activeCategory ?? undefined), toolsApi.dashboard()])
      .then(([catalog, board]) => {
        if (cancelled) return;
        setTools(catalog.tools);
        setCategories(catalog.categories);
        setDashboard(board);
        setFavorites(new Set(board.favorites.map((tool) => tool.slug)));
        setError(null);
      })
      .catch((loadError: Error) => {
        if (!cancelled) setError(loadError.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeCategory]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle.length === 0) return tools;
    return tools.filter((tool) =>
      [tool.name, tool.summary, tool.slug, ...(tool.keywords ?? [])].join(' ').toLowerCase().includes(needle)
    );
  }, [search, tools]);

  async function toggleFavorite(tool: ToolSummary) {
    const isFavorite = favorites.has(tool.slug);
    try {
      if (isFavorite) {
        await toolsApi.removeFavorite(tool.slug);
        setFavorites((current) => {
          const next = new Set(current);
          next.delete(tool.slug);
          return next;
        });
      } else {
        await toolsApi.addFavorite(tool.slug);
        setFavorites((current) => new Set(current).add(tool.slug));
      }
    } catch {
      // Favourites are a convenience; a failure must not disturb the page.
    }
  }

  return (
    <div className="tools-center">
      <header className="tools-hero">
        <h1>Tools Center</h1>
        <p>
          DNS, IP, network, developer, webmaster, security, domain and productivity tools that run on CloudHost247 itself.
          Every answer comes from a real query, connection or handshake — a tool that cannot run says so instead of guessing.
        </p>
        <div className="tools-hero__actions">
          <Link className="ch247-button ch247-button--ghost" to="/tools/history">My history</Link>
          <Link className="ch247-button ch247-button--ghost" to="/tools/favorites">Favorites</Link>
          <Link className="ch247-button ch247-button--ghost" to="/tools/reports">Saved reports</Link>
          <Link className="ch247-button ch247-button--ghost" to="/tools/monitors">Monitoring</Link>
          {/* Document Tools (ePassport MRZ calculator/validator/parser) is its own module with its
              own pages and API; the centre links to it instead of re-implementing it. */}
          <Link className="ch247-button ch247-button--ghost" to="/tools/document">Document tools (MRZ)</Link>
        </div>
      </header>

      {dashboard && !dashboard.masterEnabled ? (
        <div className="tools-notice tools-notice--warning" role="status">
          The Tools Center is currently disabled by an administrator. Existing saved reports and monitors remain visible.
        </div>
      ) : null}

      <div className="tools-toolbar">
        <label className="tools-search">
          <span className="sr-only">Search tools</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search 60+ tools — try “dmarc”, “subnet”, “ssl”…"
          />
        </label>
        <div className="tools-chips" role="tablist" aria-label="Tool categories">
          <button
            type="button"
            role="tab"
            aria-selected={activeCategory === null}
            className={`tools-chip${activeCategory === null ? ' is-active' : ''}`}
            onClick={() => setParams({})}
          >
            All tools
          </button>
          {categories.map((category) => (
            <button
              key={category.slug}
              type="button"
              role="tab"
              aria-selected={activeCategory === category.slug}
              className={`tools-chip${activeCategory === category.slug ? ' is-active' : ''}`}
              onClick={() => setParams({ category: category.slug })}
            >
              {category.label} <span className="tools-chip__count">{category.toolCount}</span>
            </button>
          ))}
        </div>
      </div>

      {dashboard && (dashboard.popular.length > 0 || dashboard.recent.length > 0) ? (
        <div className="tools-highlights">
          {dashboard.popular.length > 0 ? (
            <section aria-labelledby="tools-popular">
              <h2 id="tools-popular">Popular this fortnight</h2>
              <ul>
                {dashboard.popular.map((tool) => (
                  <li key={tool.slug}>
                    <Link to={toolHref(tool)}>{tool.name}</Link>
                    {typeof tool.runs === 'number' ? <span className="tools-highlights__runs">{tool.runs} runs</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {dashboard.recent.length > 0 ? (
            <section aria-labelledby="tools-recent">
              <h2 id="tools-recent">Recently used by you</h2>
              <ul>
                {dashboard.recent.map((tool) => (
                  <li key={tool.slug}>
                    <Link to={toolHref(tool)}>{tool.name}</Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      {error ? <div className="tools-notice tools-notice--error" role="alert">{error}</div> : null}
      {loading ? <p className="tools-loading">Loading the tool catalogue…</p> : null}

      {!loading && filtered.length === 0 ? (
        <p className="tools-empty">No tool matches “{search}”. Try a different word, or clear the category filter.</p>
      ) : null}

      <div className="tools-grid">
        {filtered.map((tool) => (
          <article key={tool.slug} className={`tools-card tools-card--${tool.status.toLowerCase()}`}>
            <div className="tools-card__head">
              <h3>
                <Link to={toolHref(tool)}>{tool.name}</Link>
              </h3>
              <button
                type="button"
                className={`tools-fav${favorites.has(tool.slug) ? ' is-active' : ''}`}
                aria-pressed={favorites.has(tool.slug)}
                title={favorites.has(tool.slug) ? 'Remove from favorites' : 'Add to favorites'}
                onClick={() => void toggleFavorite(tool)}
              >
                ★<span className="sr-only"> favorite</span>
              </button>
            </div>
            <p>{tool.summary}</p>
            <div className="tools-card__meta">
              <span className={`tools-badge tools-badge--${tool.status.toLowerCase()}`}>{STATUS_LABEL[tool.status]}</span>
              {tool.authRequired ? <span className="tools-badge tools-badge--auth">Sign-in required</span> : <span className="tools-badge">No sign-in needed</span>}
              {tool.providerKind ? <span className="tools-badge tools-badge--provider">{tool.providerKind} provider</span> : null}
            </div>
            {tool.status !== 'ACTIVE' && tool.statusMessage ? <p className="tools-card__status">{tool.statusMessage}</p> : null}
          </article>
        ))}
      </div>

      {dashboard ? (
        <section className="tools-status-summary" aria-labelledby="tools-status">
          <h2 id="tools-status">Tool status at a glance</h2>
          <ul>
            {Object.entries(dashboard.statusSummary).map(([status, count]) => (
              <li key={status}>
                <span className={`tools-badge tools-badge--${status.toLowerCase()}`}>{STATUS_LABEL[status as ToolStatus] ?? status}</span> {count}
              </li>
            ))}
          </ul>
          <p className="tools-muted">
            “Needs setup” means an administrator has not configured the external provider that feature requires — the tool
            will tell you exactly that instead of returning an empty result.
          </p>
        </section>
      ) : null}
    </div>
  );
}
