/**
 * Shared Fraud Sentinel UI building blocks (ch247 design system classes only).
 *
 * Two things here are load-bearing for the module's honesty, not just its layout:
 *
 *  * `AdvisoryNotice` renders the server's OWN advisory statement and forbidden-action list on every
 *    screen that shows a score or an alert, so no page can present a detection as an enforcement
 *    outcome — and the wording cannot drift from the backend contract, because it is not written here.
 *  * `EvidenceList` renders the `evidenceIntegrity` verdict beside the evidence. When the server
 *    withheld a description that failed its outbound secret check, the reviewer is told that a piece
 *    of evidence exists and was not returned, rather than seeing a gap they would read as "no evidence".
 *
 * Nothing in this file hardcodes a vocabulary: statuses, levels, categories, subject types, the
 * transition map and the minimum note lengths all arrive from `GET /meta` (see `useFsMeta`).
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuthState } from '../../layout/useAuthState';
import { listCustomers } from '../../lib/account-api';
import type { AdminCustomerSummary } from '../../lib/account-types';
import {
  fetchFsMeta,
  fsGet,
  fsPermissionsForRole,
  type AdvisoryOnly,
  type DataQualityFlag,
  type EvidenceIntegrity,
  type EvidenceRef,
  type FamilyContribution,
  type FsMeta,
  type FsPermission,
  type TriggeredRule,
} from '../../lib/fraud-sentinel-api';

export type LoadState<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };

/** Fetch hook with reload support, used by every Fraud Sentinel page. */
export function useFsData<T>(path: string, params: Record<string, string | number | boolean | undefined | null> = {}): {
  state: LoadState<T>;
  reload: () => void;
} {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' });
  const key = `${path}|${JSON.stringify(params)}`;
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fsGet<T>(path, params)
      .then((data) => !cancelled && setState({ status: 'ready', data }))
      .catch((err: unknown) => !cancelled && setState({ status: 'error', message: err instanceof Error ? err.message : 'Request failed' }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { state, reload };
}

/**
 * The vocabulary, fetched once per browser session and shared by every page.
 *
 * Cached at module scope because eight screens all need it and it never changes within a session; a
 * failed fetch clears the cache rather than pinning the failure, so a retry after a network blip works.
 */
let metaPromise: Promise<FsMeta> | null = null;

export function fsMetaPromise(): Promise<FsMeta> {
  if (!metaPromise) {
    metaPromise = fetchFsMeta().catch((error: unknown) => {
      metaPromise = null;
      throw error;
    });
  }
  return metaPromise;
}

export function useFsMeta(): LoadState<FsMeta> {
  const [state, setState] = useState<LoadState<FsMeta>>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    fsMetaPromise()
      .then((data) => !cancelled && setState({ status: 'ready', data }))
      .catch((err: unknown) => !cancelled && setState({ status: 'error', message: err instanceof Error ? err.message : 'Request failed' }));
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

/** The caller's module permissions, for hiding actions the server would refuse anyway. */
export function useFsPermissions(): FsPermission[] {
  const { user } = useAuthState();
  return fsPermissionsForRole(user?.role);
}

export function useFsUserId(): string | null {
  const { user } = useAuthState();
  return user?.id ?? null;
}

export function FsLoad<T>({ state, children }: { state: LoadState<T>; children: (data: T) => ReactNode }) {
  if (state.status === 'loading') return <p className="ch247-page__hint">Loading…</p>;
  if (state.status === 'error') return <p className="ch247-page__hint" role="alert">Error: {state.message}</p>;
  return <>{children(state.data)}</>;
}

/** `false_positive` → `false positive`. Presentation only; the value itself is never rewritten. */
export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  return value.replace(/_/g, ' ');
}

const BADGE_CLASSES: Record<string, string> = {
  // alert statuses
  new: 'ch247-badge',
  under_review: 'ch247-badge--warning',
  escalated: 'ch247-badge--danger',
  resolved: 'ch247-badge--active',
  false_positive: 'ch247-badge--active',
  // risk levels and rule severities
  low: 'ch247-badge--active',
  medium: 'ch247-badge--warning',
  high: 'ch247-badge--danger',
  critical: 'ch247-badge--danger',
  // assessment / run states
  active: 'ch247-badge--active',
  superseded: 'ch247-badge',
  completed: 'ch247-badge--active',
  running: 'ch247-badge--warning',
  failed: 'ch247-badge--danger',
  locked: 'ch247-badge--warning',
  unknown_job: 'ch247-badge--danger',
  // confidence and data-quality severity
  material: 'ch247-badge--danger',
  informational: 'ch247-badge',
  schedule: 'ch247-badge',
  manual: 'ch247-badge--warning',
  staff: 'ch247-badge',
  system: 'ch247-badge',
};

export function FsBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span>—</span>;
  const cls = BADGE_CLASSES[value.toLowerCase()] ?? 'ch247-badge';
  return <span className={`ch247-badge ${cls === 'ch247-badge' ? '' : cls}`.trim()}>{humanize(value)}</span>;
}

export interface FsColumn<T> {
  header: string;
  render: (row: T) => ReactNode;
}

export function FsTable<T>({ columns, rows, empty, keyOf }: { columns: FsColumn<T>[]; rows: T[]; empty: string; keyOf?: (row: T, index: number) => string }) {
  if (rows.length === 0) return <p className="ch247-page__hint">{empty}</p>;
  return (
    <div className="ch247-table-wrap">
      <table className="ch247-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.header}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={keyOf ? keyOf(row, index) : index}>
              {columns.map((column) => (
                <td key={column.header}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Paginator({ page, limit, total, onPage }: { page: number; limit: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  if (pages <= 1) return <p className="ch247-page__hint" style={{ marginTop: '0.5rem' }}>{total} row{total === 1 ? '' : 's'}</p>;
  return (
    <div className="ch247-inline-actions" style={{ marginTop: '0.5rem' }}>
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Prev</button>
      <span className="ch247-page__hint">Page {page} of {pages} ({total} rows)</span>
      <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next →</button>
    </div>
  );
}

export function MetricCard({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="ch247-card" style={{ minWidth: '11rem', flex: '1 1 11rem' }}>
      <p className="ch247-page__hint" style={{ marginBottom: '0.25rem' }}>{label}</p>
      <div style={{ fontSize: '1.35rem', fontWeight: 700 }}>{value}</div>
      {hint ? <p className="ch247-page__hint" style={{ marginTop: '0.25rem' }}>{hint}</p> : null}
    </div>
  );
}

export function MetricRow({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>{children}</div>;
}

/**
 * The advisory contract, in the server's own words, on every screen that shows a score.
 *
 * Rendered from the payload rather than from a string in this repository so the UI cannot drift from
 * `ADVISORY_ONLY` in src/fraud-sentinel/types/index.ts.
 */
export function AdvisoryNotice({ advisory, compact = false }: { advisory: AdvisoryOnly; compact?: boolean }) {
  if (!advisory) return null;
  return (
    <div className="ch247-card" style={{ borderLeft: '4px solid #b58900', background: '#fffdf5' }}>
      <p style={{ marginBottom: '0.35rem' }}>
        <strong>Advisory only.</strong> {advisory.statement}
      </p>
      {compact ? null : (
        <p className="ch247-page__hint">
          This module never performs: {advisory.forbiddenActions.map(humanize).join(', ')}.
        </p>
      )}
    </div>
  );
}

/** Says out loud when the server withheld evidence, so a gap is never read as "nothing recorded". */
export function EvidenceIntegrityNotice({ integrity }: { integrity: EvidenceIntegrity | undefined }) {
  if (!integrity || integrity.ok) return null;
  return (
    <p className="ch247-page__hint" role="status" style={{ color: '#a33' }}>
      {integrity.withheld.length} evidence description{integrity.withheld.length === 1 ? '' : 's'} withheld by the
      outbound secret check ({integrity.withheld.join(', ')}). The underlying rows still exist; only the text that
      failed the check was not returned.
    </p>
  );
}

export function EvidenceList({ evidence, integrity }: { evidence: EvidenceRef[]; integrity?: EvidenceIntegrity }) {
  return (
    <div className="ch247-stack">
      <EvidenceIntegrityNotice integrity={integrity} />
      <FsTable<EvidenceRef>
        columns={[
          { header: 'Source row', render: (ref) => <code>{ref.table}{ref.id ? ` · ${ref.id}` : ''}</code> },
          { header: 'Recorded at', render: (ref) => formatDateTime(ref.occurredAt) },
          { header: 'What was recorded', render: (ref) => <span style={{ whiteSpace: 'pre-wrap' }}>{ref.description}</span> },
        ]}
        rows={evidence}
        empty="No evidence was recorded for this finding."
        keyOf={(ref, index) => `${ref.table}:${ref.id ?? index}`}
      />
    </div>
  );
}

/** The score derivation: which rules fired, what each was worth, and what the family cap did to it. */
export function TriggeredRulesTable({ rules }: { rules: TriggeredRule[] }) {
  return (
    <FsTable<TriggeredRule>
      columns={[
        { header: 'Rule', render: (rule) => <span><code>{rule.code}</code> <span className="ch247-page__hint">v{rule.version}</span></span> },
        { header: 'Severity', render: (rule) => <FsBadge value={rule.severity} /> },
        { header: 'Family', render: (rule) => rule.family },
        {
          header: 'Points',
          render: (rule) =>
            rule.cappedWeight === rule.weight ? (
              <span>+{rule.cappedWeight}</span>
            ) : (
              <span>+{rule.cappedWeight} <span className="ch247-page__hint">of {rule.weight} (family cap)</span></span>
            ),
        },
        { header: 'Confidence', render: (rule) => <FsBadge value={rule.confidence} /> },
        { header: 'Why it fired', render: (rule) => <span style={{ whiteSpace: 'pre-wrap' }}>{rule.reason}</span> },
        { header: 'Evidence', render: (rule) => `${rule.evidence.length} row${rule.evidence.length === 1 ? '' : 's'}` },
      ]}
      rows={rules}
      empty="No detection rule triggered for this subject inside the lookback window."
      keyOf={(rule) => `${rule.code}@${rule.version}`}
    />
  );
}

export function FamilyContributions({ contributions }: { contributions: FamilyContribution[] }) {
  if (contributions.length === 0) return <p className="ch247-page__hint">No family contributed to this score.</p>;
  return (
    <FsTable<FamilyContribution>
      columns={[
        { header: 'Scoring family', render: (entry) => humanize(entry.family) },
        { header: 'Raw weight', render: (entry) => entry.raw },
        { header: 'Credited', render: (entry) => entry.capped },
        { header: 'Cap', render: (entry) => entry.cap },
        {
          header: 'Effect',
          render: (entry) =>
            entry.raw > entry.capped ? (
              <span className="ch247-page__hint">capped — {entry.raw - entry.capped} point(s) not credited</span>
            ) : (
              <span className="ch247-page__hint">within cap</span>
            ),
        },
      ]}
      rows={contributions}
      empty="No family contributed to this score."
      keyOf={(entry) => entry.family}
    />
  );
}

export function DataQualityFlags({ flags }: { flags: DataQualityFlag[] }) {
  if (flags.length === 0) {
    return <p className="ch247-page__hint">No data-quality gaps were recorded for this assessment.</p>;
  }
  return (
    <FsTable<DataQualityFlag>
      columns={[
        { header: 'Gap', render: (flag) => <span><FsBadge value={flag.severity} /> <code>{flag.code}</code></span> },
        { header: 'What it means for this score', render: (flag) => <span style={{ whiteSpace: 'pre-wrap' }}>{flag.detail}</span> },
      ]}
      rows={flags}
      empty="No data-quality gaps were recorded for this assessment."
      keyOf={(flag) => flag.code}
    />
  );
}

/** A 0–100 score bar. Pure CSS: the module ships no charting dependency. */
export function ScoreMeter({ score, level }: { score: number; level: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(score)));
  const colour = pct >= 75 ? '#c0392b' : pct >= 50 ? '#d35400' : pct >= 25 ? '#b58900' : 'var(--ch-silver-ink)';
  return (
    <div style={{ minWidth: '12rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
        <strong style={{ fontSize: '1.35rem' }}>{pct}</strong>
        <span className="ch247-page__hint">/ 100</span>
        <FsBadge value={level} />
      </div>
      <div style={{ height: '0.5rem', background: '#e8ecf3', borderRadius: 4, overflow: 'hidden', marginTop: '0.25rem' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: colour }} />
      </div>
    </div>
  );
}

export function Recommendations({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="ch247-page__hint">No recommendations were recorded.</p>;
  return (
    <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
      {items.map((item) => {
        // Each line is "[RULE_CODE] text"; the boundary line is "[BOUNDARY] text".
        const match = /^\[([A-Z_]+)\]\s*(.*)$/.exec(item);
        const code = match?.[1] ?? null;
        const text = match?.[2] ?? item;
        return (
          <li key={item} style={{ marginBottom: '0.3rem' }}>
            {code ? <code style={{ marginRight: '0.4rem' }}>{code}</code> : null}
            <span style={{ whiteSpace: 'pre-wrap' }}>{text}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function KeyValue({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <div className="ch247-table-wrap">
      <table className="ch247-table">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th style={{ whiteSpace: 'nowrap' }}>{label}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Account search, shared by the customer risk and transaction ledger screens.
 *
 * It reads the platform's own admin customer directory rather than a Fraud Sentinel endpoint, because
 * the module deliberately keeps no copy of the account list: it projects *activity* into
 * `fraud_sentinel_events` and reads `users` only to name a subject. A staff account is listed too,
 * since the administrative-activity rules take the actor's account as their subject.
 */
export function AccountSearch({
  linkPrefix,
  note,
}: {
  /** Where a chosen account goes, e.g. `/admin/fraud-sentinel/customers`. */
  linkPrefix: string;
  note?: string;
}) {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [rows, setRows] = useState<AdminCustomerSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run() {
    setBusy(true);
    setError('');
    try {
      const result = await listCustomers({ search: search || undefined, role: role || undefined });
      setRows(result.customers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ch247-stack">
      <form
        className="ch247-inline-actions"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <input
          placeholder="Search by name, email, phone or Customer ID"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          style={{ flex: '1 1 240px', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
        />
        <select value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="">Any role</option>
          <option value="customer">Customer</option>
          <option value="admin">Admin</option>
          <option value="super_admin">Super admin</option>
        </select>
        <button type="submit" disabled={busy}>{busy ? 'Searching…' : 'Search accounts'}</button>
      </form>
      {error ? <p className="ch247-page__hint" role="alert" style={{ color: '#a33' }}>{error}</p> : null}
      {note ? <p className="ch247-page__hint">{note}</p> : null}
      {rows ? (
        <div className="ch247-table-wrap">
          <table className="ch247-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Role</th>
                <th>Status</th>
                <th>Registered</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((person) => (
                <tr key={person.id}>
                  <td>
                    <Link to={`${linkPrefix}/${person.id}`}>{person.fullName || person.email}</Link>
                    <span className="ch247-page__hint"> · {person.email}</span>
                  </td>
                  <td>{person.role}</td>
                  <td><FsBadge value={person.status} /></td>
                  <td className="ch247-page__hint">{formatDate(person.createdAt)}</td>
                  <td><Link to={`${linkPrefix}/${person.id}`}>Open →</Link></td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr><td colSpan={5} className="ch247-page__hint">No account matched that search.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 16);
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return String(value).slice(0, 10);
}

/** A short relative label for lists: "3 h ago". Falls back to the absolute timestamp. */
export function timeAgo(value: string | null | undefined): string {
  if (!value) return '—';
  const at = new Date(value).getTime();
  if (!Number.isFinite(at)) return String(value);
  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 60) return `${Math.max(1, seconds)} s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return formatDate(value);
}
