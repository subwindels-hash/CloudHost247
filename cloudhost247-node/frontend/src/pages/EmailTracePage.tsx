import { useCallback, useEffect, useState } from 'react';
import { usePageMeta } from '../lib/usePageMeta';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import {
  fetchDomainDiagnostics,
  fetchTraceDetail,
  fetchTraceEvents,
  fetchTraceHealth,
  fetchTraceQueue,
  fetchTraceSummary,
  type DeliveryStatus,
  type TraceDetail,
  type TraceEvent,
  type TraceHealth,
  type TraceQueue,
  type TraceSummary,
  type DomainDiagnostics,
} from '../lib/email-trace-api';
import './email-trace.css';

/**
 * Customer Email Trace Centre (`/account/email-trace`).
 *
 * Three rules are visible in this page rather than buried in a comment:
 *
 *  1. Nothing here computes a status. Every label and explanation comes from the API, so the UI
 *     cannot drift into claiming more than the logs support.
 *  2. Empty is explained. When no trace data exists the page says *why* (collection not enabled for
 *     the mail server) instead of showing an empty table that looks like "you sent no email".
 *  3. The page never implies inbox placement or "read" receipts, and the queue panel is explicitly
 *     a snapshot of the last collection rather than a live number.
 */

const STATUS_ORDER: DeliveryStatus[] = [
  'ACCEPTED',
  'QUEUED',
  'PROCESSING',
  'DEFERRED',
  'DELIVERED',
  'BOUNCED',
  'REJECTED',
  'FAILED',
  'UNKNOWN',
];

const STATUS_TONE: Record<DeliveryStatus, 'ok' | 'warn' | 'bad' | 'neutral'> = {
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

const WINDOWS = ['24h', '7d', '30d', '90d'] as const;

const DIAGNOSTIC_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'neutral'> = {
  PASS: 'ok',
  WARNING: 'warn',
  ERROR: 'bad',
  NOT_FOUND: 'bad',
  NOT_CHECKED: 'neutral',
  UNKNOWN: 'neutral',
};

/** The customer's own domains, used only to address the diagnostics endpoint by id. */
async function apiFetchDomains(): Promise<Array<{ id: string; domain_name: string }>> {
  const { apiFetch } = await import('../lib/api');
  const response = await apiFetch<{ domains: Array<{ id: string; domain_name: string }> }>('/api/v1/account/domains');
  return response.domains;
}

function StatusBadge({ status, label }: { status: DeliveryStatus; label: string }) {
  return <span className={`et-status et-status--${STATUS_TONE[status]}`}>{label}</span>;
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString();
}

export default function EmailTracePage() {
  usePageMeta('Email trace', 'Track what happened to your outgoing mail');

  const [window, setWindow] = useState<(typeof WINDOWS)[number]>('24h');
  const [summary, setSummary] = useState<TraceSummary | null>(null);
  const [events, setEvents] = useState<TraceEvent[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [domainFilter, setDomainFilter] = useState('');
  const [messageIdFilter, setMessageIdFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<TraceDetail | null>(null);
  const [detailError, setDetailError] = useState('');
  const [queue, setQueue] = useState<TraceQueue | null>(null);
  const [health, setHealth] = useState<TraceHealth | null>(null);
  const [domains, setDomains] = useState<Array<{ id: string; domain_name: string }>>([]);
  const [authDomainId, setAuthDomainId] = useState('');
  const [includeBanner, setIncludeBanner] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DomainDiagnostics | null>(null);
  const [authError, setAuthError] = useState('');
  const [authRunning, setAuthRunning] = useState(false);
  const pageSize = 25;

  const load = useCallback(() => {
    let cancelled = false;
    setError('');
    Promise.all([
      fetchTraceSummary(window),
      fetchTraceEvents({
        status: statusFilter || undefined,
        domain: domainFilter.trim() || undefined,
        messageId: messageIdFilter.trim() || undefined,
        limit: pageSize,
        offset,
      }),
    ])
      .then(([summaryResponse, listResponse]) => {
        if (cancelled) return;
        setSummary(summaryResponse);
        setEvents(listResponse.events);
        setTotal(listResponse.total);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [window, statusFilter, domainFilter, messageIdFilter, offset]);

  useEffect(() => load(), [load]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchTraceQueue(), fetchTraceHealth()])
      .then(([queueResponse, healthResponse]) => {
        if (cancelled) return;
        setQueue(queueResponse);
        setHealth({
          sources: healthResponse.sources,
          summary: (healthResponse as unknown as TraceHealth).summary ?? { ok: 0, degraded: 0, error: 0, disabled: 0 },
          note: healthResponse.note,
        });
      })
      .catch(() => {
        // The queue and health panels are secondary: a failure there must not blank the trace list.
        if (!cancelled) {
          setQueue(null);
          setHealth(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiFetchDomains()
      .then((list) => {
        if (cancelled) return;
        setDomains(list);
        if (list.length > 0) setAuthDomainId((current) => current || list[0]!.id);
      })
      .catch(() => {
        // Diagnostics are optional: without a domain list the panel explains itself below.
        if (!cancelled) setDomains([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openTrace = (traceId: string) => {
    setDetailError('');
    setSelected(null);
    fetchTraceDetail(traceId)
      .then(setSelected)
      .catch((err: Error) => setDetailError(err.message));
  };

  const runAuthChecks = async () => {
    if (!authDomainId) return;
    setAuthRunning(true);
    setAuthError('');
    setDiagnostics(null);
    try {
      // One endpoint, one vocabulary. The server decides what each check means — including "this
      // check could not run" — so this page never has to reinterpret a tool's own result shape.
      setDiagnostics(await fetchDomainDiagnostics(authDomainId, { banner: includeBanner }));
    } catch (err) {
      setAuthError((err as Error).message);
    } finally {
      setAuthRunning(false);
    }
  };

  const hasAnyCollection = (health?.sources ?? []).some((source) => source.collectionEnabled);

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <h1>Email trace</h1>
        <p className="ch247-page__hint">
          What our mail servers recorded about messages from your domains. Statuses come from SMTP replies in the
          mail log: they show whether the receiving server accepted a message, not whether it landed in an inbox or
          was read.
        </p>

        <div className="et-window-row">
          {WINDOWS.map((option) => (
            <button
              key={option}
              type="button"
              className={`et-window ${window === option ? 'et-window--active' : ''}`}
              onClick={() => {
                setWindow(option);
                setOffset(0);
              }}
            >
              Last {option}
            </button>
          ))}
        </div>

        {summary && (
          <div className="et-summary" role="list" aria-label="Message status counts">
            {STATUS_ORDER.map((status) => (
              <div className="et-summary__item" role="listitem" key={status}>
                <span className="et-summary__count">{summary.byStatus[status] ?? 0}</span>
                <span className="et-summary__label">{status.charAt(0) + status.slice(1).toLowerCase()}</span>
              </div>
            ))}
          </div>
        )}
        {summary && <p className="ch247-page__hint">{summary.evidenceNote}</p>}
      </div>

      <div className="ch247-card">
        <h2>Messages</h2>
        <div className="ch247-market-controls">
          <select
            value={statusFilter}
            aria-label="Filter by status"
            onChange={(event) => {
              setOffset(0);
              setStatusFilter(event.target.value);
            }}
          >
            <option value="">All statuses</option>
            {STATUS_ORDER.map((status) => (
              <option key={status} value={status}>
                {status.charAt(0) + status.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
          <input
            placeholder="Domain (e.g. example.com)"
            aria-label="Filter by domain"
            value={domainFilter}
            onChange={(event) => {
              setOffset(0);
              setDomainFilter(event.target.value);
            }}
          />
          <input
            placeholder="Message id"
            aria-label="Filter by message id"
            value={messageIdFilter}
            onChange={(event) => {
              setOffset(0);
              setMessageIdFilter(event.target.value);
            }}
          />
        </div>

        {error && <CatalogErrorBanner message={error} />}
        {events === null && !error && <CatalogLoadingBanner label="Loading trace events…" />}

        {events !== null && events.length === 0 && (
          <div className="et-empty">
            <p>
              {hasAnyCollection
                ? 'No messages matched. Try a wider window.'
                : 'No trace data has been collected for your domains yet.'}
            </p>
            {!hasAnyCollection && (
              <p className="ch247-page__hint">
                Trace collection is opt-in per mail server: it only starts once an administrator enables it for the
                server that carries your domain. Nothing is being recorded until then — an empty list here does not
                mean you have not sent mail.
              </p>
            )}
          </div>
        )}

        {events !== null && events.length > 0 && (
          <>
            <table className="ch247-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Status</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Reply</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>{formatTimestamp(event.occurredAt)}</td>
                    <td>
                      <StatusBadge status={event.status} label={event.statusLabel} />
                    </td>
                    <td>{event.sender}</td>
                    <td>{event.recipient}</td>
                    <td>{event.smtpResponseCode ? `${event.smtpResponseCode}` : '—'}</td>
                    <td>
                      <button type="button" className="ch247-btn ch247-button--small" onClick={() => openTrace(event.traceId)}>
                        Details
                      </button>
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

      {(detailError || selected) && (
        <div className="ch247-card">
          <h2>Message detail</h2>
          {detailError && <CatalogErrorBanner message={detailError} />}
          {selected && (
            <>
              <p className="et-trace-head">
                <strong>{selected.sender}</strong> → <strong>{selected.recipient}</strong>{' '}
                <span className="ch247-page__hint">id {selected.traceId}</span>
              </p>
              <p>
                <StatusBadge status={selected.latestStatus} label={selected.statusDetail.label} />{' '}
                {selected.statusDetail.explanation}
              </p>
              <ol className="et-timeline">
                {selected.events.map((event) => (
                  <li key={event.id}>
                    <span className="et-timeline__when">{formatTimestamp(event.occurredAt)}</span>{' '}
                    <StatusBadge status={event.status} label={event.statusLabel} />{' '}
                    <span className="et-timeline__type">{event.eventType.replace(/_/g, ' ')}</span>
                    {event.remoteHostname && <span className="ch247-page__hint"> via {event.remoteHostname}</span>}
                    {event.smtpResponseCode && (
                      <div className="et-timeline__reply">
                        {event.smtpResponseCode}
                        {event.smtpResponseText ? ` — ${event.smtpResponseText}` : ''}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              <p className="ch247-page__hint">{selected.evidenceNote}</p>
              <button type="button" className="ch247-btn ch247-button--small" onClick={() => setSelected(null)}>
                Close
              </button>
            </>
          )}
        </div>
      )}

      <div className="ch247-card">
        <h2>Mail queue</h2>
        {queue === null && <p className="ch247-page__hint">Queue information is not available.</p>}
        {queue !== null && (
          <>
            <p className="ch247-page__hint">{queue.note}</p>
            {queue.servers.length === 0 && <p>No queue snapshot has been taken for your mail servers yet.</p>}
            {queue.servers.length > 0 && (
              <table className="ch247-table">
                <thead>
                  <tr>
                    <th>Observed</th>
                    <th>Queued</th>
                    <th>Deferred</th>
                    <th>Oldest</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.servers.map((entry) => (
                    <tr key={entry.serverId}>
                      <td>{formatTimestamp(entry.observedAt)}</td>
                      <td>{entry.queueCount}</td>
                      <td>{entry.deferred}</td>
                      <td>{entry.oldestSeconds === null ? '—' : `${Math.round(entry.oldestSeconds / 3600)}h`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      <div className="ch247-card">
        <h2>Mail diagnostics for a domain</h2>
        <p className="ch247-page__hint">
          Checks the public SPF, DKIM, DMARC, MX and reverse-DNS records for one of your domains. The SMTP banner
          check is optional because it opens a connection to your mail host. A check that cannot run is shown as
          “Not checked” — never as a pass.
        </p>
        <div className="ch247-market-controls">
          <select
            aria-label="Domain to check"
            value={authDomainId}
            onChange={(event) => {
              setAuthDomainId(event.target.value);
              setDiagnostics(null);
            }}
          >
            {domains.length === 0 && <option value="">No domains on this account</option>}
            {domains.map((domain) => (
              <option key={domain.id} value={domain.id}>
                {domain.domain_name}
              </option>
            ))}
          </select>
          <label className="et-checkbox">
            <input type="checkbox" checked={includeBanner} onChange={(event) => setIncludeBanner(event.target.checked)} />
            Also read the SMTP banner
          </label>
          <button type="button" className="ch247-btn" onClick={runAuthChecks} disabled={authRunning || !authDomainId}>
            {authRunning ? 'Checking…' : 'Run checks'}
          </button>
        </div>
        {authError && <CatalogErrorBanner message={authError} />}
        {diagnostics && (
          <>
            <table className="ch247-table">
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Result</th>
                  <th>What was found</th>
                </tr>
              </thead>
              <tbody>
                {diagnostics.checks.map((check) => (
                  <tr key={check.id}>
                    <td>{check.label}</td>
                    <td>
                      <span className={`et-status et-status--${DIAGNOSTIC_TONE[check.status]}`}>
                        {check.status === 'NOT_CHECKED' ? 'Not checked' : check.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td>
                      <div>{check.summary}</div>
                      {check.detail.length > 0 && (
                        <div className="ch247-page__hint">
                          {check.detail.map((line) => (
                            <div key={line}>{line}</div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="ch247-page__hint">{diagnostics.caveat}</p>
            {diagnostics.notes.map((note) => (
              <p className="ch247-page__hint" key={note}>
                {note}
              </p>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
