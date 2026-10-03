import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { toolsApi, type HistoryEntry } from '../lib/tools-api';

export default function ToolsHistoryPage() {
  usePageMeta('Tool history', 'Every Tools Center run your account has made, with statuses and summaries.');
  const [params, setParams] = useSearchParams();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const toolFilter = params.get('tool') ?? '';

  const load = useCallback(() => {
    setLoading(true);
    toolsApi
      .history({ limit: 100, ...(toolFilter ? { tool: toolFilter } : {}) })
      .then((result) => {
        setEntries(result.entries);
        setTotal(result.total);
        setError(null);
      })
      .catch((loadError: Error) => setError(loadError.message))
      .finally(() => setLoading(false));
  }, [toolFilter]);

  useEffect(load, [load]);

  async function clearAll() {
    if (!window.confirm('Delete your entire tool history? Saved reports are not affected.')) return;
    try {
      await toolsApi.clearHistory();
      load();
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : 'The history could not be cleared.');
    }
  }

  return (
    <div className="tools-center">
      <nav className="tools-breadcrumb" aria-label="Breadcrumb">
        <Link to="/tools">Tools Center</Link>
        <span aria-current="page">History</span>
      </nav>
      <h1>Tool history</h1>
      <p className="tools-muted">
        {total} recorded {total === 1 ? 'run' : 'runs'} for this account. History is per-account and never shown to other customers;
        administrators see the counts and errors, not the contents of your inputs beyond the recorded target.
      </p>

      <div className="tools-toolbar tools-toolbar--compact">
        <label className="tools-search">
          <span className="sr-only">Filter by tool</span>
          <input
            type="text"
            value={toolFilter}
            placeholder="Filter by tool slug (e.g. dns-lookup)"
            onChange={(event) => setParams(event.target.value ? { tool: event.target.value } : {})}
          />
        </label>
        <button type="button" className="ch247-button ch247-button--ghost" onClick={clearAll}>Clear history</button>
        <button type="button" className="ch247-button ch247-button--ghost" onClick={load}>Refresh</button>
      </div>

      {error ? <div className="tools-notice tools-notice--error" role="alert">{error}</div> : null}
      {loading ? <p className="tools-loading">Loading…</p> : null}
      {!loading && entries.length === 0 ? <p className="tools-empty">No runs recorded yet. Open a tool and run it — the result is logged here automatically.</p> : null}

      {entries.length > 0 ? (
        <div className="tools-table-wrap">
          <table className="tools-table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Tool</th>
                <th scope="col">Target</th>
                <th scope="col">Status</th>
                <th scope="col">Summary</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.created_at).toLocaleString()}</td>
                  <td><Link to={`/tools/${entry.tool_slug}`}>{entry.tool_slug}</Link></td>
                  <td className="tools-cell--mono">{entry.target ?? '—'}</td>
                  <td><span className={`tools-badge tools-badge--${String(entry.status).toLowerCase()}`}>{entry.status}</span></td>
                  <td className="tools-cell--summary">{JSON.stringify(entry.summary ?? {})}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
