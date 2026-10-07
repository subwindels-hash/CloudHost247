import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import {
  toolsApi,
  type ToolSummary,
  type ToolsDashboard,
} from '../lib/tools-api';
import { toolsHost } from '../lib/tools-runtime';
import ToolSeo from '../components/tools/ToolSeo';

const LABELS: Record<string, string> = {
  ACTIVE: 'Available',
  DISABLED: 'Disabled',
  MAINTENANCE: 'Maintenance',
  CONFIGURATION_REQUIRED: 'Needs setup',
  SERVICE_UNAVAILABLE: 'Unavailable here',
};
const CURATED = [
  'dns-lookup',
  'dns-propagation',
  'my-ip',
  'ssl-checker',
  'json-tools',
  'subnet-calculator',
];
export default function ToolsCenterPage() {
  const [params, setParams] = useSearchParams();
  const route = useParams();
  const category = route.category ?? params.get('category');
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [categories, setCategories] = useState<
    Array<{ slug: string; label: string }>
  >([]);
  const [dashboard, setDashboard] = useState<ToolsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [revision, setRevision] = useState(0);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  /** Set when the server reports that operator policy could not be read (database unreachable). */
  const [degraded, setDegraded] = useState<string | null>(null);
  const categoryLabel = categories.find(
    (item) => item.slug === category
  )?.label;
  const title = categoryLabel ? `${categoryLabel} Tools` : 'CloudHost247 Tools';
  const description =
    'Powerful DNS, domain, IP, network, security, email and developer tools for websites, servers and infrastructure.';
  usePageMeta(title, description);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDegraded(null);
    Promise.all([toolsApi.catalog(), toolsApi.dashboard().catch(() => null)])
      .then(([catalog, board]) => {
        if (cancelled) return;
        setTools(catalog.tools);
        setCategories(catalog.discoveryCategories ?? catalog.categories);
        setDashboard(board);
        setFavorites(new Set(board?.favorites?.map((tool) => tool.slug) ?? []));
        // The server tells us when operator policy could not be read (the platform database is
        // unreachable). The catalogue is still real and complete, so it is shown — with the reason
        // stated once, here, instead of the tools silently looking broken.
        const reason = catalog.degraded ? (catalog.degradedReason ?? 'Tool settings could not be read.') : null;
        setDegraded(reason);
        // In the degraded state every tool is unavailable by definition, so the default filter
        // would hide the entire catalogue and leave the banner explaining an empty page. Show the
        // tools with their reasons instead — that is the useful answer to "where did the tools go?".
        if (reason) setShowUnavailable(true);
      })
      .catch((reason: Error) => {
        if (!cancelled) {
          setError(reason.message);
          setTools([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [revision]);
  const available = useMemo(
    () =>
      tools.filter(
        (tool) =>
          tool.status === 'ACTIVE' &&
          tool.visibility !== 'admin' &&
          !tool.slug.startsWith('tool-') &&
          (!toolsHost().embedded || tool.visibility !== 'customer')
      ),
    [tools]
  );
  const filtered = useMemo(
    () =>
      tools.filter((tool) => {
        if (
          tool.visibility === 'admin' ||
          tool.slug.startsWith('tool-') ||
          (toolsHost().embedded && tool.visibility === 'customer')
        )
          return false;
        if (!showUnavailable && tool.status !== 'ACTIVE') return false;
        if (
          category &&
          tool.category !== category &&
          !tool.discoveryCategories?.includes(category)
        )
          return false;
        return [tool.name, tool.summary, tool.slug, ...(tool.keywords ?? [])]
          .join(' ')
          .toLowerCase()
          .includes(search.trim().toLowerCase());
      }),
    [tools, category, search, showUnavailable]
  );
  const popular = (dashboard?.popular ?? []).filter((tool) =>
    available.some((entry) => entry.slug === tool.slug)
  );
  const picks = popular.length
    ? popular
    : CURATED.map((slug) =>
        available.find((tool) => tool.slug === slug)
      ).filter((tool): tool is ToolSummary => Boolean(tool));
  let recentSlugs: string[] = [];
  try {
    const stored = JSON.parse(
      localStorage.getItem('ch247_recent_tools') ?? '[]'
    );
    if (Array.isArray(stored))
      recentSlugs = stored.filter((x) => typeof x === 'string').slice(0, 8);
  } catch {
    /* Private browsing can disable local storage. */
  }
  const recent = (
    dashboard?.recent?.length
      ? dashboard.recent
      : recentSlugs
          .map((slug) => available.find((tool) => tool.slug === slug))
          .filter((tool): tool is ToolSummary => Boolean(tool))
  ).filter((tool) => available.some((entry) => entry.slug === tool.slug));
  async function favorite(tool: ToolSummary) {
    try {
      if (favorites.has(tool.slug)) await toolsApi.removeFavorite(tool.slug);
      else await toolsApi.addFavorite(tool.slug);
      setFavorites((current) => {
        const next = new Set(current);
        next.has(tool.slug) ? next.delete(tool.slug) : next.add(tool.slug);
        return next;
      });
    } catch {
      setNotice(
        'Favorites could not be updated. Please sign in to the platform and try again.'
      );
    }
  }
  return (
    <div className="tools-center">
      <ToolSeo
        title={`${title} | CloudHost247`}
        description={description}
        path={
          category && route.category ? `/tools/category/${category}` : '/tools'
        }
      />
      <header className="tools-hero">
        <p className="tools-eyebrow">THE INFRASTRUCTURE TOOLKIT</p>
        <h1>{title}</h1>
        <p>{description}</p>
        <label className="tools-search">
          <span className="sr-only">Search tools</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10" cy="10" r="6" />
            <path d="m15 15 6 6" />
          </svg>
          <input
            type="search"
            maxLength={100}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find a tool — DNS, IP, SSL, JSON…"
          />
        </label>
        <div className="tools-hero__actions">
          <span>Live diagnostics. Clear results. No guesswork.</span>
          {!toolsHost().embedded && (
            <Link to="/tools/history">Your tool history →</Link>
          )}
        </div>
      </header>
      <nav className="tools-chips" aria-label="Tool categories">
        <Link
          className={`tools-chip${!category ? ' is-active' : ''}`}
          to="/tools"
          onClick={() => setParams({})}
        >
          All tools
        </Link>
        {categories.map((item) => (
          <Link
            key={item.slug}
            className={`tools-chip${category === item.slug ? ' is-active' : ''}`}
            to={`/tools/category/${item.slug}`}
            aria-current={category === item.slug ? 'page' : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {notice && (
        <p role="status" className="tools-notice">
          {notice}
        </p>
      )}
      {!category && !search && picks.length > 0 && (
        <section className="tools-highlights" aria-labelledby="tools-popular">
          <div>
            <p className="tools-eyebrow">A GOOD PLACE TO START</p>
            <h2 id="tools-popular">
              {popular.length
                ? 'Popular this fortnight'
                : 'Selected essentials'}
            </h2>
            <p>
              {popular.length
                ? 'Based on recorded tool executions.'
                : 'A curated selection of available tools — not usage rankings.'}
            </p>
          </div>
          <ul>
            {picks.map((tool) => (
              <li key={tool.slug}>
                <Link to={tool.path}>
                  {tool.name} <span aria-hidden="true">↗</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!search && recent.length > 0 && (
        <section aria-labelledby="tools-recent">
          <h2 id="tools-recent">Recently used</h2>
          <p className="tools-muted">
            Only tool names are remembered on this browser, never inputs or
            results.
          </p>
          <div className="tools-chips">
            {recent.map((tool) => (
              <Link className="tools-chip" key={tool.slug} to={tool.path}>
                {tool.name}
              </Link>
            ))}
          </div>
        </section>
      )}
      <section aria-labelledby="tools-directory">
        <div className="tools-directory-heading">
          <div>
            <p className="tools-eyebrow">EXPLORE THE TOOLKIT</p>
            <h2 id="tools-directory">
              {categoryLabel ?? 'Find the right tool'}
            </h2>
          </div>
          <label className="tools-toggle">
            <input
              type="checkbox"
              checked={showUnavailable}
              onChange={(event) => setShowUnavailable(event.target.checked)}
            />{' '}
            Show unavailable tools
          </label>
        </div>
        {loading && (
          <p role="status" className="tools-loading">
            Loading the tool catalogue…
          </p>
        )}
        {/* The catalogue itself loaded, but the server could not read operator policy. Every tool
            below is shown as unavailable with this reason attached, so the page explains the state
            once instead of looking randomly broken. */}
        {!loading && degraded && (
          <div role="alert" className="tools-notice tools-notice--warning">
            <p>{degraded}</p>
            <button
              type="button"
              onClick={() => setRevision((value) => value + 1)}
            >
              Try again
            </button>
          </div>
        )}
        {error && (
          <div role="alert" className="tools-notice tools-notice--error">
            <p>Tools are temporarily unavailable. {error}</p>
            <button
              type="button"
              onClick={() => setRevision((value) => value + 1)}
            >
              Try again
            </button>
          </div>
        )}
        {!loading && !error && (
          <p role="status" className="tools-muted">
            {filtered.length} matching{' '}
            {filtered.length === 1 ? 'tool' : 'tools'}
          </p>
        )}
        {!loading && !error && filtered.length === 0 && (
          <p className="tools-empty">
            No tool matches “{search}”. Try a different word or category.
          </p>
        )}
        <div className="tools-grid">
          {!loading &&
            !error &&
            filtered.map((tool) => (
              <article
                key={tool.slug}
                className={`tools-card tools-card--${tool.status.toLowerCase()}`}
              >
                <span className="tools-card-icon" aria-hidden="true">
                  {(
                    {
                      dns: '◎',
                      ip: '⊙',
                      network: '⌘',
                      developer: '⌗',
                      security: '◇',
                      domain: '◎',
                      webmaster: '↗',
                    } as Record<string, string>
                  )[tool.category] ?? '＋'}
                </span>
                <div className="tools-card__head">
                  <h3>
                    <Link to={tool.path}>{tool.name}</Link>
                  </h3>
                  {dashboard?.signedIn && !toolsHost().embedded && (
                    <button
                      type="button"
                      className="tools-fav"
                      aria-label={`Favorite ${tool.name}`}
                      aria-pressed={favorites.has(tool.slug)}
                      onClick={() => void favorite(tool)}
                    >
                      ★
                    </button>
                  )}
                </div>
                <p>{tool.summary}</p>
                <div className="tools-card__meta">
                  <span
                    className={`tools-badge tools-badge--${tool.status.toLowerCase()}`}
                  >
                    {LABELS[tool.status]}
                  </span>
                  {tool.authRequired && (
                    <span className="tools-badge">Sign-in required</span>
                  )}
                </div>
                {tool.status !== 'ACTIVE' && (
                  <p className="tools-card__status">{tool.statusMessage}</p>
                )}
                <Link className="tools-card-link" to={tool.path}>
                  Open tool <span aria-hidden="true">↗</span>
                  <span className="sr-only">: {tool.name}</span>
                </Link>
              </article>
            ))}
        </div>
      </section>
      {!toolsHost().embedded && (
        <nav className="tools-portal-links" aria-label="Your tools workspace">
          <Link to="/tools/favorites">Favorites</Link>
          <Link to="/tools/reports">Saved reports</Link>
          <Link to="/tools/monitors">Monitoring</Link>
          <Link to="/tools/document">Document tools (MRZ)</Link>
        </nav>
      )}
      <aside className="tools-notice">
        <h2>Know what your result means</h2>
        <p>
          Lookups reflect the configured resolver, registry or connection at the
          time of the check. Cached results are labelled. A timeout or missing
          provider is reported as an error, never as a made-up answer.
        </p>
      </aside>
    </div>
  );
}
