import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { toolsApi, type ToolSummary } from '../lib/tools-api';

export default function ToolsFavoritesPage() {
  usePageMeta('Favorite tools', 'Your pinned Tools Center shortcuts.');
  const [favorites, setFavorites] = useState<ToolSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    toolsApi
      .favorites()
      .then((result) => {
        setFavorites(result.favorites);
        setError(null);
      })
      .catch((loadError: Error) => setError(loadError.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function remove(slug: string) {
    try {
      await toolsApi.removeFavorite(slug);
      setFavorites((current) => current.filter((tool) => tool.slug !== slug));
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Could not remove that favorite.');
    }
  }

  return (
    <div className="tools-center">
      <nav className="tools-breadcrumb" aria-label="Breadcrumb">
        <Link to="/tools">Tools Center</Link>
        <span aria-current="page">Favorites</span>
      </nav>
      <h1>Favorite tools</h1>
      <p className="tools-muted">Star any tool from the Tools Center to pin it here for one-click access.</p>

      {error ? <div className="tools-notice tools-notice--error" role="alert">{error}</div> : null}
      {loading ? <p className="tools-loading">Loading…</p> : null}
      {!loading && favorites.length === 0 ? (
        <p className="tools-empty">
          No favorites yet. <Link to="/tools">Browse the Tools Center</Link> and press the ★ on a tool card.
        </p>
      ) : null}

      <div className="tools-grid">
        {favorites.map((tool) => (
          <article key={tool.slug} className="tools-card">
            <div className="tools-card__head">
              <h3><Link to={tool.path.includes(':') ? `/tools/${tool.slug}` : tool.path}>{tool.name}</Link></h3>
              <button type="button" className="tools-fav is-active" aria-pressed title="Remove from favorites" onClick={() => void remove(tool.slug)}>
                ★<span className="sr-only"> remove favorite</span>
              </button>
            </div>
            <p>{tool.summary}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
