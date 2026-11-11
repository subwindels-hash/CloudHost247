/**
 * Investigation ledger — who did what to which alert, and every false-positive report on file.
 *
 * Two lists, both append-only in the database and both read-only here: the timeline of reviewer
 * actions (including the rows the scheduler itself wrote, marked as `system`), and the
 * false-positive reports that feed the rule feedback table on the Rule Catalogue screen.
 *
 * This is the accountability surface of the module. It records attention and conclusions; it records
 * no action taken against a customer, because the module takes none.
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
  formatDateTime,
  humanize,
  useFsData,
  useFsMeta,
} from '../../components/fraud-sentinel/fs-widgets';
import type { FalsePositiveRow, InvestigationRow, Paginated } from '../../lib/fraud-sentinel-api';

export default function InvestigationsPage() {
  const meta = useFsMeta();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<'timeline' | 'false-positives'>(
    searchParams.get('tab') === 'false-positives' ? 'false-positives' : 'timeline'
  );

  return (
    <FSLayout
      title="Investigation Ledger"
      hint="Every reviewer action and every false-positive report, newest first. Append-only: a conclusion can be superseded by a later entry but never edited away."
      actions={
        <div className="ch247-inline-actions">
          <button type="button" disabled={tab === 'timeline'} onClick={() => setTab('timeline')}>
            Reviewer timeline
          </button>
          <button type="button" disabled={tab === 'false-positives'} onClick={() => setTab('false-positives')}>
            False positives
          </button>
        </div>
      }
    >
      <div className="ch247-stack">
        <FsLoad state={meta}>{(vocabulary) => <AdvisoryNotice advisory={vocabulary.advisory} compact />}</FsLoad>
        {tab === 'timeline' ? <Timeline /> : <FalsePositives />}
      </div>
    </FSLayout>
  );
}

/* -------------------------------------------------------------------------- */
/* Reviewer timeline                                                           */
/* -------------------------------------------------------------------------- */

function Timeline() {
  const meta = useFsMeta();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [actorId, setActorId] = useState('');
  const [alertId, setAlertId] = useState('');
  const [days, setDays] = useState('');
  const limit = 50;

  const { state } = useFsData<Paginated<InvestigationRow>>('/investigations', {
    page,
    limit,
    action: action || undefined,
    actorId: actorId.trim() || undefined,
    alertId: alertId.trim() || undefined,
    days: days || undefined,
  });

  return (
    <>
      <FsLoad state={meta}>
        {(vocabulary) => (
          <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
            <select value={action} onChange={(event) => { setAction(event.target.value); setPage(1); }}>
              <option value="">Any action</option>
              {vocabulary.investigationActions.map((value) => (
                <option key={value} value={value}>{humanize(value)}</option>
              ))}
            </select>
            <select value={days} onChange={(event) => { setDays(event.target.value); setPage(1); }}>
              <option value="">Any time</option>
              <option value="1">Last 24 hours</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
            <input
              placeholder="Alert id"
              value={alertId}
              onChange={(event) => { setAlertId(event.target.value); setPage(1); }}
              style={{ flex: '1 1 180px', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
            />
            <input
              placeholder="Actor account id"
              value={actorId}
              onChange={(event) => { setActorId(event.target.value); setPage(1); }}
              style={{ flex: '1 1 180px', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
            />
          </div>
        )}
      </FsLoad>

      <FsLoad state={state}>
        {(data) => (
          <>
            <FsTable<InvestigationRow>
              columns={[
                { header: 'When', render: (row) => <span className="ch247-page__hint">{formatDateTime(row.created_at)}</span> },
                { header: 'Action', render: (row) => <code>{row.action}</code> },
                {
                  header: 'By',
                  render: (row) => (
                    <span>
                      {row.actor_name ?? row.actor_id ?? <span className="ch247-page__hint">{row.actor_type}</span>}{' '}
                      <FsBadge value={row.actor_type} />
                    </span>
                  ),
                },
                {
                  header: 'Status change',
                  render: (row) =>
                    row.from_status && row.to_status ? (
                      <span>{humanize(row.from_status)} → {humanize(row.to_status)}</span>
                    ) : (
                      <span className="ch247-page__hint">—</span>
                    ),
                },
                { header: 'Alert', render: (row) => <Link to={`/admin/fraud-sentinel/alerts/${row.alert_id}`}>open →</Link> },
                { header: 'Note', render: (row) => <span style={{ whiteSpace: 'pre-wrap' }}>{row.note ?? ''}</span> },
                {
                  header: 'Metadata',
                  render: (row) => {
                    const keys = Object.keys(row.metadata ?? {});
                    if (keys.length === 0) return <span className="ch247-page__hint">—</span>;
                    return (
                      <details>
                        <summary className="ch247-page__hint">{keys.length} field(s)</summary>
                        <pre style={{ margin: '0.25rem 0 0', fontSize: '0.72rem', whiteSpace: 'pre-wrap' }}>
                          {JSON.stringify(row.metadata, null, 2)}
                        </pre>
                      </details>
                    );
                  },
                },
              ]}
              rows={data.items}
              empty="Nothing recorded yet. The scheduler's own passes appear here too, marked as system."
              keyOf={(row) => row.id}
            />
            <Paginator page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        )}
      </FsLoad>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* False positives                                                             */
/* -------------------------------------------------------------------------- */

function FalsePositives() {
  const meta = useFsMeta();
  const [page, setPage] = useState(1);
  const [reasonCategory, setReasonCategory] = useState('');
  const [ruleCode, setRuleCode] = useState('');
  const [days, setDays] = useState('');
  const limit = 50;

  const { state } = useFsData<Paginated<FalsePositiveRow>>('/false-positives', {
    page,
    limit,
    reasonCategory: reasonCategory || undefined,
    ruleCode: ruleCode.trim() || undefined,
    days: days || undefined,
  });

  return (
    <>
      <FsLoad state={meta}>
        {(vocabulary) => (
          <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
            <select value={reasonCategory} onChange={(event) => { setReasonCategory(event.target.value); setPage(1); }}>
              <option value="">Any reason</option>
              {vocabulary.falsePositiveReasons.map((value) => (
                <option key={value} value={value}>{humanize(value)}</option>
              ))}
            </select>
            <select value={days} onChange={(event) => { setDays(event.target.value); setPage(1); }}>
              <option value="">Any time</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="365">Last year</option>
            </select>
            <input
              placeholder="Rule code"
              value={ruleCode}
              onChange={(event) => { setRuleCode(event.target.value); setPage(1); }}
              style={{ flex: '1 1 200px', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
            />
          </div>
        )}
      </FsLoad>

      <p className="ch247-page__hint">
        One report per alert, enforced by the database. Reporting a false positive moves the alert to
        that status and records the reviewer's reasoning — it does not disable the rule, and it does not
        delete the alert. The aggregate view is on the{' '}
        <Link to="/admin/fraud-sentinel/rules">Rule Catalogue</Link> screen.
      </p>

      <FsLoad state={state}>
        {(data) => (
          <>
            <FsTable<FalsePositiveRow>
              columns={[
                { header: 'Reported', render: (row) => <span className="ch247-page__hint">{formatDateTime(row.created_at)}</span> },
                { header: 'Alert', render: (row) => <Link to={`/admin/fraud-sentinel/alerts/${row.alert_id}`}>open →</Link> },
                { header: 'Reason', render: (row) => humanize(row.reason_category) },
                { header: 'Reported by', render: (row) => row.reported_by_name ?? row.reported_by ?? <span className="ch247-page__hint">unknown</span> },
                {
                  header: 'Rules named',
                  render: (row) =>
                    row.rule_codes.length > 0 ? row.rule_codes.map((code) => <code key={code}>{code} </code>) : <span className="ch247-page__hint">none named</span>,
                },
                { header: 'Explanation', render: (row) => <span style={{ whiteSpace: 'pre-wrap' }}>{row.explanation}</span> },
              ]}
              rows={data.items}
              empty="No false-positive report in this window."
              keyOf={(row) => row.id}
            />
            <Paginator page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        )}
      </FsLoad>
    </>
  );
}
