import { useCallback, useEffect, useState } from 'react';
import { usePageMeta } from '../lib/usePageMeta';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import {
  fetchCollectionRuns,
  fetchTraceEvents,
  fetchTraceSummary,
  fetchTraceSources,
  triggerCollection,
  updateTraceSource,
  type DeliveryStatus,
  type TraceCollectionRun,
  type TraceEvent,
  type TraceSource,
  type TraceSummary,
} from '../lib/email-trace-api';
import InfrastructureNav from '../components/InfrastructureNav';
import './email-trace.css';

/**
 * Admin Email Trace Centre (`/admin/email-trace`).
 *
 * This page is the operator's view of the *collector*, not only of the mail: source capability,
 * checkpoints, collection runs and their failures. The one thing it deliberately cannot do is
 * anything with a queued message — collection is read-only, and the "Collect now" action only asks a
 * server for the next slice of its log.
 */

const STATUS_TONE: Record<DeliveryStatus, string> = {
  ACCEPTED: 'neutral',
  QUEUED: 'neutral',
  PROCESSING: 'neutral',
  DEFERRED: 'warn',
  DELIVERED: 'ok',
  BOUNCED: 'bad',
  REJECTED: 'bad',
  FAILED: 'bad',
  UNKNOWN: 'neutral',
};

const RUN_TONE: Record<string, string> = {
  ok: 'ok',
  partial: 'warn',
  failed: 'bad',
  skipped: 'neutral',
  running: 'neutral',
};

function Badge({ tone, children }: { tone: string; children: string }) {
  return <span className={`et-status et-status--${tone}`}>{children}</span>;
}

function formatTimestamp(value: string | null) {
  return value ? new Date(value).toLocaleString() : '—';
}

export default function AdminEmailTracePage() {
  usePageMeta('Email trace', 'Admin — collection health and trace events');

  const [sources, setSources] = useState<TraceSource[] | null>(null);
  const [sourcesError, setSourcesError] = useState('');
  const [healthNote, setHealthNote] = useState('');
  const [runs, setRuns] = useState<TraceCollectionRun[] | null>(null);
  const [runsError, setRunsError] = useState('');
  const [events, setEvents] = useState<TraceEvent[] | null>(null);
  const [eventsError, setEventsError] = useState('');
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<TraceSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionNote, setActionNote] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [domainFilter, setDomainFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const pageSize = 25;

  const loadSources = useCallback(() => {
    let cancelled = false;
    setSourcesError('');
    fetchTraceSources()
      .then((response) => {
        if (cancelled) return;
        setSources(response.sources);
        setHealthNote(response.note);
      })
      .catch((err: Error) => !cancelled && setSourcesError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  const loadRuns = useCallback(() => {
    let cancelled = false;
    setRunsError('');
    fetchCollectionRuns({ limit: 25 })
      .then((response) => !cancelled && setRuns(response.runs))
      .catch((err: Error) => !cancelled && setRunsError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  const loadEvents = useCallback(() => {
    let cancelled = false;
    setEventsError('');
    Promise.all([
      fetchTraceEvents(
        { status: statusFilter || undefined, domain: domainFilter.trim() || undefined, limit: pageSize, offset },
        { admin: true }
      ),
      fetchTraceSummary('24h', { admin: true }),
    ])
      .then(([list, summaryResponse]) => {
        if (cancelled) return;
        setEvents(list.events);
        setTotal(list.total);
        setSummary(summaryResponse);
      })
      .catch((err: Error) => !cancelled && setEventsError(err.message));
    return () => {
      cancelled = true;
    };
  }, [statusFilter, domainFilter, offset]);

  useEffect(() => loadSources(), [loadSources]);
  useEffect(() => loadRuns(), [loadRuns]);
  useEffect(() => loadEvents(), [loadEvents]);

  const toggleSource = async (source: TraceSource) => {
    setBusy(source.id);
    setActionError('');
    setActionNote('');
    try {
      await updateTraceSource(source.id, { collectionEnabled: !source.collectionEnabled });
      setActionNote(
        source.collectionEnabled
          ? 'Collection disabled. Existing trace events are kept until the retention window expires.'
          : 'Collection enabled. The next sweep will read the next slice of the message log.'
      );
      loadSources();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const collect = async (serverId?: string) => {
    setBusy(serverId ?? 'all');
    setActionError('');
    setActionNote('');
    try {
      const response = await triggerCollection(serverId ? { serverId } : { all: true });
      const failures = response.results.filter((result) => result.status !== 'ok');
      const collected = response.results.reduce((sum, result) => sum + result.collected, 0);
      setActionNote(
        `${response.collected} source(s) collected, ${collected} new event(s).` +
          (failures.length > 0
            ? ` ${failures.length} did not succeed: ${failures
                .map((result) => `${result.serverId.slice(0, 8)} ${result.status}${result.reason ? ` (${result.reason})` : ''}`)
                .join(', ')}.`
            : '')
      );
      loadSources();
      loadRuns();
      loadEvents();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="ch247-stack">
      <InfrastructureNav active="email-trace" />
      <div className="ch247-card">
        <h1>Email trace</h1>
        <p className="ch247-page__hint">
          Collects read-only evidence from mail servers: the Exim message log and the queue listing. It never edits
          mail configuration, restarts a service, deletes or forces a queued message, and never stores message
          bodies, subjects or credentials. Collection is opt-in per server.
        </p>
        <div className="ch247-inline-actions">
          <button type="button" className="ch247-btn" disabled={busy !== null} onClick={() => collect()}>
            {busy === 'all' ? 'Collecting…' : 'Collect all enabled'}
          </button>
          <button
            type="button"
            className="ch247-btn ch247-button--small"
            disabled={busy !== null}
            onClick={() => {
              loadSources();
              loadRuns();
              loadEvents();
            }}
          >
            Refresh
          </button>
        </div>
        {actionError && <CatalogErrorBanner message={actionError} />}
        {actionNote && <p className="ch247-page__hint">{actionNote}</p>}

        {summary && (
          <p className="ch247-page__hint">
            Last 24 hours: {summary.total} event(s) across all tenants — {summary.byStatus.DELIVERED} delivered,{' '}
            {summary.byStatus.DEFERRED} deferred, {summary.byStatus.BOUNCED} bounced, {summary.byStatus.UNKNOWN}{' '}
            unknown.
          </p>
        )}
      </div>

      <div className="ch247-card">
        <h2>Mail servers</h2>
        {healthNote && <p className="ch247-page__hint">{healthNote}</p>}
        {sourcesError && <CatalogErrorBanner message={sourcesError} />}
        {sources === null && !sourcesError && <CatalogLoadingBanner label="Loading trace sources…" />}
        {sources !== null && sources.length === 0 && (
          <p>
            No trace source is configured yet. A source is created the first time collection is requested for a
            server, and stays disabled until you enable it here.
          </p>
        )}
        {sources !== null && sources.length > 0 && (
          <table className="ch247-table">
            <thead>
              <tr>
                <th>Server</th>
                <th>Collection</th>
                <th>Status</th>
                <th>Capability</th>
                <th>Checkpoint</th>
                <th>Last success</th>
                <th>Last error</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => (
                <tr key={source.id}>
                  <td>
                    <code>{source.serverId.slice(0, 8)}</code>
                    <div className="ch247-page__hint">{source.providerType}</div>
                  </td>
                  <td>{source.collectionEnabled ? 'Enabled' : 'Disabled'}</td>
                  <td>
                    <Badge tone={source.status === 'ok' ? 'ok' : source.status === 'error' ? 'bad' : 'warn'}>
                      {source.status}
                    </Badge>
                  </td>
                  <td>
                    <div className="ch247-page__hint">
                      log: {String((source.capability as { mainlog?: string }).mainlog ?? 'unknown')}
                      <br />
                      queue: {String((source.capability as { queue?: string }).queue ?? 'unknown')}
                    </div>
                  </td>
                  <td>{typeof (source.checkpoint as { offset?: number }).offset === 'number' ? `${(source.checkpoint as { offset?: number }).offset} B` : '—'}</td>
                  <td>{formatTimestamp(source.lastSuccessAt)}</td>
                  <td>
                    {source.lastErrorCode ? (
                      <span title={source.lastErrorMessage ?? ''}>{source.lastErrorCode}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <div className="ch247-inline-actions">
                      <button
                        type="button"
                        className="ch247-btn ch247-button--small"
                        disabled={busy !== null}
                        onClick={() => toggleSource(source)}
                      >
                        {source.collectionEnabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        type="button"
                        className="ch247-btn ch247-button--small"
                        disabled={busy !== null}
                        onClick={() => collect(source.serverId)}
                      >
                        {busy === source.serverId ? 'Collecting…' : 'Collect now'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="ch247-card">
        <h2>Recent collection runs</h2>
        {runsError && <CatalogErrorBanner message={runsError} />}
        {runs === null && !runsError && <CatalogLoadingBanner label="Loading collection runs…" />}
        {runs !== null && runs.length === 0 && <p>No collection has run yet.</p>}
        {runs !== null && runs.length > 0 && (
          <table className="ch247-table">
            <thead>
              <tr>
                <th>Started</th>
                <th>Server</th>
                <th>Status</th>
                <th>Seen</th>
                <th>Stored</th>
                <th>Rejected</th>
                <th>Queue</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>{formatTimestamp(run.startedAt)}</td>
                  <td>
                    <code>{run.serverId.slice(0, 8)}</code>
                  </td>
                  <td>
                    <Badge tone={RUN_TONE[run.status] ?? 'neutral'}>{run.status}</Badge>
                  </td>
                  <td>{run.recordsSeen}</td>
                  <td>{run.recordsCollected}</td>
                  <td>{run.recordsRejected}</td>
                  <td>{run.queueCount === null ? '—' : run.queueCount}</td>
                  <td>{run.errorClass ? `${run.errorClass}${run.errorMessage ? `: ${run.errorMessage}` : ''}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="ch247-card">
        <h2>Trace events (all tenants)</h2>
        <p className="ch247-page__hint">
          Unattributed events are shown here and nowhere else: mail the platform could not tie to a customer is
          visible to staff only.
        </p>
        <div className="ch247-market-controls">
          <input
            placeholder="Domain"
            aria-label="Filter by domain"
            value={domainFilter}
            onChange={(event) => {
              setOffset(0);
              setDomainFilter(event.target.value);
            }}
          />
          <input
            placeholder="Status (e.g. BOUNCED)"
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(event) => {
              setOffset(0);
              setStatusFilter(event.target.value.toUpperCase());
            }}
          />
        </div>
        {eventsError && <CatalogErrorBanner message={eventsError} />}
        {events === null && !eventsError && <CatalogLoadingBanner label="Loading trace events…" />}
        {events !== null && events.length === 0 && <p>No events matched.</p>}
        {events !== null && events.length > 0 && (
          <>
            <table className="ch247-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Status</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Customer</th>
                  <th>Message id</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>{formatTimestamp(event.occurredAt)}</td>
                    <td>
                      <Badge tone={STATUS_TONE[event.status]}>{event.statusLabel}</Badge>
                    </td>
                    <td>{event.sender}</td>
                    <td>{event.recipient}</td>
                    <td>
                      {event.customerId ? (
                        <code>{event.customerId.slice(0, 8)}</code>
                      ) : (
                        <span className="ch247-page__hint">unattributed</span>
                      )}
                    </td>
                    <td>
                      <code>{event.traceId}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="ch247-actions">
              <button
                type="button"
                className="ch247-btn"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - pageSize))}
              >
                Newer
              </button>
              <span className="ch247-page__hint">
                Showing {offset + 1}–{Math.min(offset + pageSize, total)} of {total}
              </span>
              <button
                type="button"
                className="ch247-btn"
                disabled={offset + pageSize >= total}
                onClick={() => setOffset(offset + pageSize)}
              >
                Older
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
