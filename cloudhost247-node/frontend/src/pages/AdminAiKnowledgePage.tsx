import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useAuthState } from '../layout/useAuthState';
import { usePageMeta } from '../lib/usePageMeta';
import '../ai-support.css';

/**
 * Admin knowledge control centre.
 *
 * This page answers one question for the operator: *what does the assistant know, and what does it
 * not?* Everything it shows is measured from the index — counts per category, failures with their
 * reason, documents that have not synced recently, the questions customers asked that produced no
 * grounded answer, and the answers customers rated poorly.
 *
 * Two deliberate constraints:
 *   • The index is a projection of the published website. There is no "teach the assistant" field
 *     here, because the fix for a wrong answer is to fix the page it came from and reindex. Adding a
 *     free-text override would create a second source of truth, and the second one always rots.
 *   • Mutations are admin-only and audited server side; the UI hides them for staff but does not rely
 *     on hiding for security.
 */

type Overview = {
  trust?: { healthy: number; unavailable: number; stale: number; conflicting: number; sources: Array<{ id: string; authority: number; approval: string; freshness: string }>; conflicts: Array<{ sourceIds: string[]; status: string }> };
  humanEscalations?: number;
  overview: {
    totals: Record<string, number>;
    byKind: Array<{ source_kind: string; total: number; indexed: number; failed: number; skipped: number }>;
    lastRun: Record<string, unknown> | null;
    failed: number;
    stale: number;
    chunks: number;
  };
  drift: { changed: string[]; missing: string[]; unexpected: string[] };
  groups: Record<string, { total: number; indexed: number }>;
  exclusions: Array<{ pattern: string; reason: string; created_at: string }>;
  failures: Array<{ source_key: string; url: string; title: string; source_kind: string; failure_count: number; sync_note: string | null; last_error_at: string | null }>;
  runs: Array<{ id: string; trigger: string; status: string; discovered: number; indexed: number; unchanged: number; skipped: number; excluded: number; removed: number; failed: number; duration_ms: number; started_at: string }>;
  engine: { phrasing: string; modelConfigured: boolean; modelReason: string | null; embedding: string };
};

type Source = {
  id: string;
  source_key: string;
  url: string;
  title: string;
  source_kind: string;
  surface: string | null;
  sync_status: string;
  sync_note: string | null;
  failure_count: number;
  last_synced_at: string | null;
  chunk_count: number;
  word_count: number;
};

type Gaps = {
  lowConfidence: Array<{ id: string; conversation_id: string; question: string | null; created_at: string }>;
  unanswered: Array<{ id: string; question: string; question_key: string; occurrences: number; last_asked_at: string; resolved: boolean }>;
  disliked: Array<{ id: string; message_id: string; rating: string; reason: string | null; comment: string | null; answer_body: string; intent: string | null; created_at: string }>;
  feedback: Array<{ rating: string; reason: string | null; total: string }>;
  coverage: { answers: string; grounded: string; ungrounded: string };
};

const CATEGORY_LABELS: Record<string, string> = {
  pages: 'Website pages',
  products: 'Catalogue products',
  services: 'Services',
  articles: 'Docs & articles',
  faqs: 'FAQs',
  legal: 'Legal & policy',
  tools: 'Tools',
  announcements: 'Announcements',
};

const STATUS_STYLES: Record<string, string> = {
  indexed: 'var(--ch-green)',
  unchanged: 'var(--ch-green)',
  skipped: '#8a6410',
  excluded: '#8a6410',
  failed: '#b42318',
  pending: '#475569',
};

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export default function AdminAiKnowledgePage() {
  usePageMeta('AI Knowledge', 'Manage the website knowledge index behind the AI support assistant.');
  const { user } = useAuthState();
  const canMutate = ['admin', 'super_admin'].includes(String(user?.role ?? ''));

  const [overview, setOverview] = useState<Overview | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [gaps, setGaps] = useState<Gaps | null>(null);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ source_id: string; title: string; url: string | null; kind: string | null; rank: number }>>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [exclusion, setExclusion] = useState({ pattern: '', reason: '' });

  const load = useCallback(async () => {
    setError('');
    try {
      const query = statusFilter ? `?status=${statusFilter}&limit=300` : '?limit=300';
      const [summary, list, gapReport] = await Promise.all([
        apiFetch<Overview>('/api/v1/admin/ai-support/knowledge/overview'),
        apiFetch<{ sources: Source[] }>(`/api/v1/admin/ai-support/knowledge/sources${query}`),
        apiFetch<Gaps>('/api/v1/admin/ai-support/knowledge/gaps?limit=25'),
      ]);
      setOverview(summary);
      setSources(list.sources);
      setGaps(gapReport);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the knowledge index');
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function reindex(keys?: string[]) {
    setBusy(true);
    setNotice('');
    setError('');
    try {
      const data = await apiFetch<{ result: { status: string; indexed: number; unchanged: number; excluded: number; removed: number; failed: number } }>(
        '/api/v1/admin/ai-support/knowledge/reindex',
        { method: 'POST', body: JSON.stringify(keys && keys.length ? { keys } : {}) }
      );
      setNotice(
        `Reindex ${data.result.status}: ${data.result.indexed} indexed, ${data.result.unchanged} unchanged, `
        + `${data.result.excluded} excluded, ${data.result.removed} removed, ${data.result.failed} failed.`
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Reindex failed');
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    setBusy(true);
    try {
      const data = await apiFetch<{ result: { attempted: number; recovered: number } }>(
        '/api/v1/admin/ai-support/knowledge/retry',
        { method: 'POST', body: JSON.stringify({ limit: 50 }) }
      );
      setNotice(`Retried ${data.result.attempted} source(s); ${data.result.recovered} recovered.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Retry failed');
    } finally {
      setBusy(false);
    }
  }

  async function runSearch() {
    if (search.trim().length < 2) return;
    try {
      const data = await apiFetch<{ results: Array<{ source_id: string; title: string; url: string | null; kind: string | null; rank: number }> }>(
        `/api/v1/admin/ai-support/knowledge/search?q=${encodeURIComponent(search.trim())}`
      );
      setSearchResults(data.results);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Search failed');
    }
  }

  async function addExclusion() {
    if (!exclusion.pattern.trim() || !exclusion.reason.trim()) return;
    try {
      await apiFetch('/api/v1/admin/ai-support/knowledge/exclusions', {
        method: 'POST',
        body: JSON.stringify(exclusion),
      });
      setExclusion({ pattern: '', reason: '' });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the exclusion');
    }
  }

  async function resolveGap(questionKey: string) {
    try {
      await apiFetch(`/api/v1/admin/ai-support/knowledge/gaps/${encodeURIComponent(questionKey)}`, {
        method: 'PATCH',
        body: JSON.stringify({ resolved: true }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the gap');
    }
  }

  const totals = useMemo(() => overview?.overview.totals ?? {}, [overview]);
  const engine = overview?.engine;

  return (
    <div className="ch247-ai-admin ch247-knowledge-centre">
      <div className="ch247-admin-heading">
        <div>
          <h1>AI Knowledge</h1>
          <p className="ch247-muted">
            Every page, tool, policy, document, FAQ and product page the assistant can answer from.
            The index is generated from the published website — to change an answer, change the page and reindex.
          </p>
        </div>
        {canMutate && (
          <div className="ch247-admin-actions">
            <button type="button" onClick={() => void reindex()} disabled={busy}>Reindex everything</button>
            <button type="button" onClick={() => void retry()} disabled={busy}>Retry failures</button>
          </div>
        )}
      </div>

      {error && <p className="ch247-status-error" role="alert">{error}</p>}
      {notice && <p className="ch247-status-success" role="status">{notice}</p>}

      {overview?.trust && <section aria-label="Source trust health">
        <h2>Source trust health</h2>
        <p>Healthy synchronization: {overview.trust.healthy} · Unavailable: {overview.trust.unavailable} · Stale / historical / changed revision: {overview.trust.stale} · Conflicting: {overview.trust.conflicting} · Human escalations (all-time events): {overview.humanEscalations ?? 0}</p>
        <p className="ch247-muted">Healthy synchronization is not human approval. Conflict checks cover reviewer-normalized claims, not arbitrary prose.</p>
        <details><summary>Source authority and freshness inventory</summary>
          <table><thead><tr><th>Source ID</th><th>Authority tier</th><th>Approval</th><th>Freshness</th></tr></thead>
            <tbody>{overview.trust.sources.map(source => <tr key={source.id}><td>{source.id}</td><td>{source.authority}</td><td>{source.approval}</td><td>{source.freshness}</td></tr>)}</tbody></table>
        </details>
        {overview.trust.conflicts.map((conflict, index) => <p key={index}>{conflict.status}: {conflict.sourceIds.join(', ')}</p>)}
      </section>}
      {overview && (
        <section className="ch247-kb-tiles" aria-label="Index totals">
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
            const group = overview.groups[key];
            return (
              <div key={key} className="ch247-kb-tile">
                <strong>{group?.indexed ?? 0}</strong>
                <span>{label}</span>
                <small>{group ? `${group.indexed} of ${group.total} indexed` : 'none discovered'}</small>
              </div>
            );
          })}
          <div className="ch247-kb-tile">
            <strong>{overview.overview.chunks}</strong>
            <span>Retrievable passages</span>
            <small>chunk-level index</small>
          </div>
          <div className="ch247-kb-tile ch247-kb-tile--warn">
            <strong>{overview.overview.failed}</strong>
            <span>Failed sources</span>
            <small>{overview.overview.stale} not synced in 7 days</small>
          </div>
          <div className="ch247-kb-tile">
            <strong>{overview.drift.missing.length}</strong>
            <span>Withdrawn pages</span>
            <small>{overview.drift.changed.length} changed since last sync</small>
          </div>
        </section>
      )}

      {engine && (
        <section className="ch247-kb-engine" aria-label="Answer engine">
          <h2>Answer engine</h2>
          <p>
            <strong>Phrasing:</strong> {engine.phrasing}
            {engine.modelConfigured ? ' — a configured model rewrites grounded evidence, and its output is validated against that evidence before it is used.' : ` — ${engine.modelReason ?? 'no model provider is configured'}. Answers are composed deterministically from retrieved evidence, prices are read live from the catalogue, and links are resolved against the site's route registry.`}
          </p>
          <p><strong>Retrieval:</strong> {engine.embedding}</p>
        </section>
      )}

      <section aria-label="Search the index" className="ch247-kb-search">
        <h2>Searchable index</h2>
        <div className="ch247-kb-search-row">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void runSearch(); }}
            placeholder="Search indexed content, e.g. VPS, cPanel, refund"
            aria-label="Search indexed content"
          />
          <button type="button" onClick={() => void runSearch()} disabled={search.trim().length < 2}>Search</button>
        </div>
        {searchResults.length > 0 && (
          <ul className="ch247-kb-results">
            {searchResults.map((result) => (
              <li key={result.source_id}>
                <span>{result.title}</span>
                {result.url && <code>{result.url}</code>}
                <small>{result.kind ?? 'unknown'}</small>
              </li>
            ))}
          </ul>
        )}
      </section>

      {gaps && (
        <section aria-label="Coverage gaps">
          <h2>Questions the assistant could not answer</h2>
          <p className="ch247-muted">
            {gaps.coverage.answers} assistant answers recorded, {gaps.coverage.grounded} grounded in site content.
            A gap is recorded when no published page answered the question — publishing that page and reindexing closes it.
          </p>
          {gaps.unanswered.length === 0 ? (
            <p className="ch247-muted">No open documentation gaps recorded. This does not imply every question was answered; outages and human escalations are recorded separately.</p>
          ) : (
            <table className="ch247-table">
              <thead>
                <tr><th scope="col">Question</th><th scope="col">Asked</th><th scope="col">Last asked</th><th scope="col">Action</th></tr>
              </thead>
              <tbody>
                {gaps.unanswered.map((gap) => (
                  <tr key={gap.id}>
                    <td>{gap.question}</td>
                    <td>{gap.occurrences}×</td>
                    <td>{formatDate(gap.last_asked_at)}</td>
                    <td>
                      {canMutate
                        ? <button type="button" onClick={() => void resolveGap(gap.question_key)}>Mark covered</button>
                        : <span className="ch247-muted">admin only</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {gaps.disliked.length > 0 && (
            <>
              <h3>Answers rated not helpful</h3>
              <table className="ch247-table">
                <thead><tr><th scope="col">Answer</th><th scope="col">Intent</th><th scope="col">Reason</th><th scope="col">When</th></tr></thead>
                <tbody>
                  {gaps.disliked.map((item) => (
                    <tr key={item.id}>
                      <td>{item.answer_body.slice(0, 180)}…</td>
                      <td>{item.intent ?? '—'}</td>
                      <td>{item.reason ?? '—'}</td>
                      <td>{formatDate(item.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}

      <section aria-label="Sources">
        <h2>Sources</h2>
        <div className="ch247-admin-filters">
          <label className="ch247-field-label">
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">All</option>
              <option value="indexed">Indexed</option>
              <option value="skipped">Skipped</option>
              <option value="excluded">Excluded</option>
              <option value="failed">Failed</option>
              <option value="pending">Pending</option>
            </select>
          </label>
        </div>
        <table className="ch247-table">
          <thead>
            <tr>
              <th scope="col">Page</th><th scope="col">Kind</th><th scope="col">Status</th>
              <th scope="col">Passages</th><th scope="col">Last synced</th><th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => (
              <tr key={source.id}>
                <td>
                  <strong>{source.title}</strong>
                  <code>{source.url}</code>
                  {source.sync_note && <small className="ch247-muted"> {source.sync_note}</small>}
                </td>
                <td>{source.source_kind}</td>
                <td><span style={{ color: STATUS_STYLES[source.sync_status] ?? '#475569', fontWeight: 600 }}>{source.sync_status}</span></td>
                <td>{source.chunk_count}</td>
                <td>{formatDate(source.last_synced_at)}</td>
                <td>
                  {canMutate
                    ? <button type="button" onClick={() => void reindex([source.source_key])} disabled={busy}>Reindex</button>
                    : <span className="ch247-muted">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {overview && (
        <section aria-label="Exclusions">
          <h2>Exclusions</h2>
          <p className="ch247-muted">Patterns that keep a path out of the index, with the reason recorded for audit.</p>
          {overview.exclusions.length === 0 && <p className="ch247-muted">No administrator exclusions.</p>}
          {overview.exclusions.length > 0 && (
            <table className="ch247-table">
              <thead><tr><th scope="col">Pattern</th><th scope="col">Reason</th><th scope="col">Added</th></tr></thead>
              <tbody>
                {overview.exclusions.map((item) => (
                  <tr key={item.pattern}><td><code>{item.pattern}</code></td><td>{item.reason}</td><td>{formatDate(item.created_at)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          {canMutate && (
            <div className="ch247-kb-search-row">
              <input value={exclusion.pattern} onChange={(event) => setExclusion({ ...exclusion, pattern: event.target.value })} placeholder="/path/prefix" aria-label="Exclusion pattern" />
              <input value={exclusion.reason} onChange={(event) => setExclusion({ ...exclusion, reason: event.target.value })} placeholder="Why this is excluded" aria-label="Exclusion reason" />
              <button type="button" onClick={() => void addExclusion()} disabled={!exclusion.pattern.trim() || !exclusion.reason.trim()}>Add exclusion</button>
            </div>
          )}
        </section>
      )}

      {overview && overview.runs.length > 0 && (
        <section aria-label="Sync runs">
          <h2>Recent sync runs</h2>
          <table className="ch247-table">
            <thead><tr><th scope="col">Started</th><th scope="col">Trigger</th><th scope="col">Status</th><th scope="col">Indexed</th><th scope="col">Changed</th><th scope="col">Removed</th><th scope="col">Failed</th><th scope="col">Duration</th></tr></thead>
            <tbody>
              {overview.runs.map((run) => (
                <tr key={run.id}>
                  <td>{formatDate(run.started_at)}</td>
                  <td>{run.trigger}</td>
                  <td><span style={{ color: run.status === 'succeeded' ? 'var(--ch-green)' : run.status === 'partial' ? '#8a6410' : '#b42318', fontWeight: 600 }}>{run.status}</span></td>
                  <td>{run.indexed}</td>
                  <td>{run.discovered}</td>
                  <td>{run.removed}</td>
                  <td>{run.failed}</td>
                  <td>{Math.round(run.duration_ms / 100) / 10}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {overview && overview.failures.length > 0 && (
        <section aria-label="Failures">
          <h2>Failures</h2>
          <table className="ch247-table">
            <thead><tr><th scope="col">Source</th><th scope="col">Kind</th><th scope="col">Attempts</th><th scope="col">Note</th><th scope="col">Last attempt</th></tr></thead>
            <tbody>
              {overview.failures.map((failure) => (
                <tr key={failure.source_key}>
                  <td><strong>{failure.title}</strong><code>{failure.url}</code></td>
                  <td>{failure.source_kind}</td>
                  <td>{failure.failure_count}</td>
                  <td>{failure.sync_note ?? '—'}</td>
                  <td>{formatDate(failure.last_error_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <p className="ch247-muted">
        Indexed sources: {totals.indexed ?? 0} · excluded/skipped: {(totals.excluded ?? 0) + (totals.skipped ?? 0)} · failed: {totals.failed ?? 0}
      </p>
    </div>
  );
}
