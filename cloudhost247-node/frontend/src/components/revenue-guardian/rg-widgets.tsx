/**
 * Shared Revenue Guardian UI building blocks (ch247 design system classes only).
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { rgGet, type CurrencyAmount } from '../../lib/revenue-guardian-api';

export type LoadState<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };

/** Fetch hook with reload support used by every Revenue Guardian page. */
export function useRgData<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): {
  state: LoadState<T>;
  reload: () => void;
} {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' });
  const key = `${path}|${JSON.stringify(params)}`;
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    rgGet<T>(path, params)
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

export function RgLoad<T>({ state, children }: { state: LoadState<T>; children: (data: T) => ReactNode }) {
  if (state.status === 'loading') return <p className="ch247-page__hint">Loading…</p>;
  if (state.status === 'error') return <p className="ch247-page__hint" role="alert">Error: {state.message}</p>;
  return <>{children(state.data)}</>;
}

/** Per-currency money list — currencies are always shown separately, never summed. */
export function MoneyList({ amounts, emptyLabel = '0.00' }: { amounts: CurrencyAmount[]; emptyLabel?: string }) {
  if (!amounts || amounts.length === 0) return <span>{emptyLabel}</span>;
  return (
    <span>
      {amounts.map((a) => (
        <span key={a.currency} style={{ display: 'block' }}>
          {a.amount} {a.currency}
        </span>
      ))}
    </span>
  );
}

export function MetricCard({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="ch247-card" style={{ minWidth: '12rem', flex: '1 1 12rem' }}>
      <p className="ch247-page__hint" style={{ marginBottom: '0.25rem' }}>{label}</p>
      <div style={{ fontSize: '1.35rem', fontWeight: 700 }}>{value}</div>
      {hint ? <p className="ch247-page__hint" style={{ marginTop: '0.25rem' }}>{hint}</p> : null}
    </div>
  );
}

export function MetricRow({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>{children}</div>;
}

const BADGE_CLASSES: Record<string, string> = {
  // statuses
  new: 'ch247-badge',
  pending: 'ch247-badge',
  in_progress: 'ch247-badge',
  contacted: 'ch247-badge--active',
  recovered: 'ch247-badge--active',
  fulfilled: 'ch247-badge--active',
  completed: 'ch247-badge--active',
  healthy: 'ch247-badge--active',
  partially_recovered: 'ch247-badge--warning',
  partially_fulfilled: 'ch247-badge--warning',
  awaiting_customer: 'ch247-badge--warning',
  payment_promised: 'ch247-badge--warning',
  payment_pending: 'ch247-badge--warning',
  snoozed: 'ch247-badge--warning',
  watch: 'ch247-badge--warning',
  escalated: 'ch247-badge--danger',
  disputed: 'ch247-badge--danger',
  broken: 'ch247-badge--danger',
  written_off: 'ch247-badge--danger',
  overdue: 'ch247-badge--danger',
  failed: 'ch247-badge--danger',
  at_risk: 'ch247-badge--danger',
  critical: 'ch247-badge--danger',
  // risk levels
  low: 'ch247-badge--active',
  medium: 'ch247-badge--warning',
  high: 'ch247-badge--danger',
  urgent: 'ch247-badge--danger',
  normal: 'ch247-badge',
};

export function RgBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span>—</span>;
  const key = value.toLowerCase();
  const cls = BADGE_CLASSES[key] ?? 'ch247-badge';
  return <span className={`ch247-badge ${cls === 'ch247-badge' ? '' : cls}`.trim()}>{value.replace(/_/g, ' ')}</span>;
}

export interface RgColumn<T> {
  header: string;
  render: (row: T) => ReactNode;
}

export function RgTable<T>({ columns, rows, empty }: { columns: RgColumn<T>[]; rows: T[]; empty: string }) {
  if (rows.length === 0) return <p className="ch247-page__hint">{empty}</p>;
  return (
    <div className="ch247-table-wrap">
      <table className="ch247-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.header}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.header}>{c.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Paginator({
  page,
  limit,
  total,
  onPage,
}: {
  page: number;
  limit: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  return (
    <div className="ch247-inline-actions" style={{ marginTop: '0.5rem' }}>
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Prev</button>
      <span className="ch247-page__hint">Page {page} of {pages} ({total} rows)</span>
      <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next →</button>
    </div>
  );
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toISOString().replace('T', ' ').slice(0, 16);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return String(value).slice(0, 10);
}
