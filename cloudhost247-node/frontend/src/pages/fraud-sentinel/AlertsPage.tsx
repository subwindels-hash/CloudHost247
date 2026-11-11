/**
 * The alert queue — what needs a human look, and who is looking at it.
 *
 * The filter vocabulary (statuses, levels, categories, subject types) and the sortable columns come
 * from `GET /meta`, so this screen cannot offer a filter the API does not implement or drop one it
 * adds. The CSV export sends the same filters the list is showing; the server applies a time window
 * only when one was requested here, so the download and the table cannot disagree.
 */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import FSLayout from '../../components/fraud-sentinel/FSLayout';
import {
  AdvisoryNotice,
  FsBadge,
  FsLoad,
  FsTable,
  Paginator,
  humanize,
  timeAgo,
  useFsData,
  useFsMeta,
} from '../../components/fraud-sentinel/fs-widgets';
import {
  fsExportAlertsCsv,
  type AdvisoryOnly,
  type AlertRow,
  type FsQuery,
} from '../../lib/fraud-sentinel-api';

interface AlertsPageData {
  items: AlertRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  advisory: AdvisoryOnly;
}

export default function FSAlertsPage() {
  const [searchParams] = useSearchParams();
  const meta = useFsMeta();

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(searchParams.get('status') ?? 'open');
  const [riskLevel, setRiskLevel] = useState(searchParams.get('riskLevel') ?? '');
  const [category, setCategory] = useState(searchParams.get('category') ?? '');
  const [subjectType, setSubjectType] = useState('');
  const [ruleCode, setRuleCode] = useState(searchParams.get('ruleCode') ?? '');
  const [unassigned, setUnassigned] = useState(searchParams.get('unassigned') === 'true' ? 'true' : '');
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [days, setDays] = useState('');
  const [sortBy, setSortBy] = useState('detected_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [exportError, setExportError] = useState('');

  const filters: FsQuery = {
    status: status || undefined,
    riskLevel: riskLevel || undefined,
    category: category || undefined,
    subjectType: subjectType || undefined,
    ruleCode: ruleCode || undefined,
    unassigned: unassigned || undefined,
    search: search || undefined,
    days: days || undefined,
    sortBy,
    sortDir,
  };

  const { state } = useFsData<AlertsPageData>('/alerts', { ...filters, page, limit: 25 });

  async function exportCsv() {
    setExportError('');
    try {
      // The export carries the filters on screen and deliberately not page/limit: the server decides
      // how many rows a download may contain, so pagination is not part of the request.
      const { blob, filename } = await fsExportAlertsCsv(filters);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed');
    }
  }

  return (
    <FSLayout
      title="Alert Queue"
      hint="An alert says a rule pattern was found in recorded activity and asks for a human look. Opening, escalating or resolving one changes nothing about the customer's money, service or account."
      actions={
        <div className="ch247-inline-actions">
          <button type="button" onClick={exportCsv}>Export CSV</button>
        </div>
      }
    >
      <div className="ch247-stack">
        {exportError ? (
          <p className="ch247-page__hint" role="alert" style={{ color: '#a33' }}>{exportError}</p>
        ) : null}

        <FsLoad state={meta}>
          {(vocabulary) => (
            <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
              <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
                <option value="open">All open</option>
                <option value="">Any status</option>
                {vocabulary.statuses.map((value) => (
                  <option key={value} value={value}>{humanize(value)}</option>
                ))}
              </select>
              <select value={riskLevel} onChange={(event) => { setRiskLevel(event.target.value); setPage(1); }}>
                <option value="">Any level</option>
                {vocabulary.levels.map((value) => (
                  <option key={value} value={value}>{humanize(value)}</option>
                ))}
              </select>
              <select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}>
                <option value="">Any category</option>
                {vocabulary.categories.map((value) => (
                  <option key={value} value={value}>{humanize(value)}</option>
                ))}
              </select>
              <select value={subjectType} onChange={(event) => { setSubjectType(event.target.value); setPage(1); }}>
                <option value="">Any subject</option>
                {vocabulary.subjectTypes.map((value) => (
                  <option key={value} value={value}>{humanize(value)}</option>
                ))}
              </select>
              <select value={unassigned} onChange={(event) => { setUnassigned(event.target.value); setPage(1); }}>
                <option value="">Assigned or not</option>
                <option value="true">Unassigned only</option>
                <option value="false">Assigned only</option>
              </select>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                {vocabulary.sortColumns.map((column) => (
                  <option key={column} value={column}>Sort: {humanize(column)}</option>
                ))}
              </select>
              <select value={sortDir} onChange={(event) => setSortDir(event.target.value as 'asc' | 'desc')}>
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
              <select value={days} onChange={(event) => { setDays(event.target.value); setPage(1); }}>
                <option value="">Any time</option>
                <option value="1">Last 24 hours</option>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </select>
              <input
                placeholder="Rule code, alert title, customer or subject"
                value={ruleCode || search}
                onChange={(event) => {
                  // One box, sent as a rule-code filter when it looks like a rule code and as a
                  // free-text search otherwise: both are server-side filters on the same table.
                  const value = event.target.value;
                  if (/^[A-Z][A-Z0-9_]*$/.test(value.trim())) {
                    setRuleCode(value.trim());
                    setSearch('');
                  } else {
                    setRuleCode('');
                    setSearch(value);
                  }
                  setPage(1);
                }}
                style={{ flex: '1 1 240px', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
              />
            </div>
          )}
        </FsLoad>

        <FsLoad state={state}>
          {(data) => (
            <>
              <AdvisoryNotice advisory={data.advisory} compact />
              <FsTable<AlertRow>
                columns={[
                  {
                    header: 'Alert',
                    render: (alert) => (
                      <Link to={`/admin/fraud-sentinel/alerts/${alert.id}`}>{alert.alert_number}</Link>
                    ),
                  },
                  { header: 'Detected', render: (alert) => <span className="ch247-page__hint">{timeAgo(alert.detected_at)}</span> },
                  { header: 'Level', render: (alert) => <><FsBadge value={alert.risk_level} /> <span className="ch247-page__hint">{alert.risk_score}</span></> },
                  { header: 'Status', render: (alert) => <FsBadge value={alert.status} /> },
                  { header: 'Category', render: (alert) => humanize(alert.category) },
                  { header: 'Primary rule', render: (alert) => (alert.primary_rule_code ? <code>{alert.primary_rule_code}</code> : '—') },
                  {
                    header: 'Subject',
                    render: (alert) =>
                      alert.customer_id ? (
                        <Link to={`/admin/fraud-sentinel/customers/${alert.customer_id}`}>
                          {alert.customer_email ?? 'customer'}
                        </Link>
                      ) : (
                        <span>{alert.subject_label ?? `${humanize(alert.subject_type)} ${alert.subject_id ?? ''}`}</span>
                      ),
                  },
                  {
                    header: 'Recurrences',
                    render: (alert) =>
                      alert.recurrence_count > 1 ? (
                        <span className="ch247-badge ch247-badge--warning">{alert.recurrence_count}</span>
                      ) : (
                        <span className="ch247-page__hint">first detection</span>
                      ),
                  },
                  { header: 'Reviewer', render: (alert) => alert.reviewer_name ?? <span className="ch247-page__hint">unassigned</span> },
                ]}
                rows={data.items}
                empty="No alert matches the current filters. That is a result, not a gap: nothing in the recorded activity matched a detection rule."
                keyOf={(alert) => alert.id}
              />
              <Paginator page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
            </>
          )}
        </FsLoad>
      </div>
    </FSLayout>
  );
}
