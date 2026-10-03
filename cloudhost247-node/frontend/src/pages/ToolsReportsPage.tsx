import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { toolsApi, type ReportEntry } from '../lib/tools-api';

/**
 * Saved reports. Exports are downloaded through fetch() with the bearer token rather than a plain
 * link, because the export endpoint is authenticated and a bare <a href> cannot carry headers.
 */
export default function ToolsReportsPage() {
  usePageMeta('Saved reports', 'Diagnostic reports saved from Tools Center runs — export as JSON, CSV or Markdown.');
  const [reports, setReports] = useState<ReportEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    setLoading(true);
    toolsApi
      .reports()
      .then((result) => {
        setReports(result.reports);
        setError(null);
      })
      .catch((loadError: Error) => setError(loadError.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function download(report: ReportEntry, format: 'json' | 'csv' | 'markdown') {
    setBusy(report.id);
    setError(null);
    try {
      const token = localStorage.getItem('ch247_token');
      const response = await fetch(`/api/tools/reports/${report.id}/export?format=${format}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `Export failed (${response.status}).`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${report.tool_slug}-${report.target}`.replace(/[^a-z0-9._-]+/gi, '_') + `.${format === 'markdown' ? 'md' : format}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'The export failed.');
    } finally {
      setBusy(null);
    }
  }

  async function remove(report: ReportEntry) {
    if (!window.confirm(`Delete the saved report for ${report.target}?`)) return;
    try {
      await toolsApi.deleteReport(report.id);
      setReports((current) => current.filter((entry) => entry.id !== report.id));
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Could not delete that report.');
    }
  }

  return (
    <div className="tools-center">
      <nav className="tools-breadcrumb" aria-label="Breadcrumb">
        <Link to="/tools">Tools Center</Link>
        <span aria-current="page">Saved reports</span>
      </nav>
      <h1>Saved reports</h1>
      <p className="tools-muted">
        A report stores the exact tool output at the moment it was saved, so you can share it, attach it to a ticket or compare it
        with a later run. Reports are private to your account.
      </p>

      {error ? <div className="tools-notice tools-notice--error" role="alert">{error}</div> : null}
      {loading ? <p className="tools-loading">Loading…</p> : null}
      {!loading && reports.length === 0 ? (
        <p className="tools-empty">
          Nothing saved yet. Run a tool and choose “Save as report”. <Link to="/tools">Open the Tools Center</Link>.
        </p>
      ) : null}

      {reports.length > 0 ? (
        <div className="tools-table-wrap">
          <table className="tools-table">
            <thead>
              <tr>
                <th scope="col">Saved</th>
                <th scope="col">Tool</th>
                <th scope="col">Target</th>
                <th scope="col">Status</th>
                <th scope="col">Export</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.id}>
                  <td>{new Date(report.created_at).toLocaleString()}</td>
                  <td><Link to={`/tools/${report.tool_slug}`}>{report.tool_name}</Link></td>
                  <td className="tools-cell--mono">{report.target}</td>
                  <td><span className="tools-badge">{report.status}</span></td>
                  <td className="tools-row-actions">
                    <button type="button" className="ch247-button ch247-button--ghost" disabled={busy === report.id} onClick={() => void download(report, 'json')}>JSON</button>
                    <button type="button" className="ch247-button ch247-button--ghost" disabled={busy === report.id} onClick={() => void download(report, 'csv')}>CSV</button>
                    <button type="button" className="ch247-button ch247-button--ghost" disabled={busy === report.id} onClick={() => void download(report, 'markdown')}>Markdown</button>
                    <button type="button" className="ch247-button ch247-button--ghost" onClick={() => void remove(report)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
