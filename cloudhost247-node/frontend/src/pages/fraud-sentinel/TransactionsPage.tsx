/**
 * Transaction ledger — every event Fraud Sentinel projected for one account.
 *
 * This is the bridge between a score and the platform's own records: each row names the source table
 * and the source row id it came from, so a reviewer can go from "this is why the score is what it is"
 * to the authoritative payment, order or audit row in one step.
 *
 * It is a PROJECTION. It is never the system of record for a payment or an order, it is pruned on its
 * own retention horizon while the source rows are not, and nothing here can be edited — there is no
 * write endpoint for it anywhere in the module.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import FSLayout from '../../components/fraud-sentinel/FSLayout';
import {
  AccountSearch,
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
import type { AdvisoryOnly, EventRow } from '../../lib/fraud-sentinel-api';

interface LedgerPage {
  items: EventRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  advisory: AdvisoryOnly;
}

export default function TransactionsPage() {
  const { id } = useParams<{ id: string }>();
  return id ? <Ledger customerId={id} /> : <Picker />;
}

function Picker() {
  return (
    <FSLayout
      title="Transaction Ledger"
      hint="Every recorded payment, order, account and administrative event the module projected for one account, newest first."
    >
      <AccountSearch
        linkPrefix="/admin/fraud-sentinel/transactions"
        note="The ledger is a projection of platform rows, not a copy of them: the authoritative payment, invoice or order still lives where it was written, and this screen links back to it by table and row id."
      />
    </FSLayout>
  );
}

function Ledger({ customerId }: { customerId: string }) {
  const meta = useFsMeta();
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('');
  const limit = 50;

  const { state } = useFsData<LedgerPage>(`/customers/${customerId}/events`, {
    page,
    limit,
    category: category || undefined,
  });

  return (
    <FSLayout
      title="Transaction Ledger"
      hint="Read-only projection of recorded activity. Nothing on this screen can be edited, and reading it takes no action on the account."
      actions={
        <div className="ch247-inline-actions">
          <Link to="/admin/fraud-sentinel/transactions">← Choose another account</Link>
          <Link to={`/admin/fraud-sentinel/customers/${customerId}`}>Risk profile →</Link>
        </div>
      }
    >
      <div className="ch247-stack">
        <FsLoad state={meta}>
          {(vocabulary) => (
            <div className="ch247-inline-actions">
              <select
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All categories</option>
                {vocabulary.categories.map((value) => (
                  <option key={value} value={value}>{humanize(value)}</option>
                ))}
              </select>
              <span className="ch247-page__hint">account <code>{customerId}</code></span>
            </div>
          )}
        </FsLoad>

        <FsLoad state={state}>
          {(data) => (
            <>
              <AdvisoryNotice advisory={data.advisory} compact />
              <FsTable<EventRow>
                columns={[
                  { header: 'When', render: (event) => <span className="ch247-page__hint">{formatDateTime(event.occurred_at)}</span> },
                  { header: 'Category', render: (event) => humanize(event.category) },
                  {
                    header: 'Source row',
                    render: (event) => (
                      <code>
                        {event.source_table}
                        {event.source_id ? ` · ${event.source_id}` : ''}
                      </code>
                    ),
                  },
                  { header: 'Event', render: (event) => <code>{event.source_event_type}</code> },
                  {
                    header: 'Subject',
                    render: (event) => (
                      <span>
                        <FsBadge value={event.subject_type} />{' '}
                        {event.subject_id ? <code>{event.subject_id}</code> : null}
                        {event.channel ? ` · ${event.channel}` : ''}
                      </span>
                    ),
                  },
                  {
                    header: 'Amount',
                    render: (event) => (event.amount ? `${event.amount} ${event.currency ?? ''}` : '—'),
                  },
                  {
                    header: 'IP',
                    render: (event) =>
                      event.ip_address ? (
                        <code>
                          {event.ip_address}
                          {event.ip_country_code ? ` (${event.ip_country_code})` : ''}
                        </code>
                      ) : (
                        '—'
                      ),
                  },
                  {
                    header: 'Links',
                    render: (event) => (
                      <span className="ch247-page__hint">
                        {[
                          event.order_id ? `order ${event.order_id}` : null,
                          event.invoice_id ? `invoice ${event.invoice_id}` : null,
                          event.payment_id ? `payment ${event.payment_id}` : null,
                          event.service_id ? `service ${event.service_id}` : null,
                        ]
                          .filter((value): value is string => value !== null)
                          .join(' · ') || '—'}
                      </span>
                    ),
                  },
                  {
                    header: 'Evidence payload',
                    render: (event) => {
                      // The server replaces a payload that failed the outbound secret check with
                      // {withheld:true, reason}. Say so rather than showing an empty cell.
                      const withheld = (event.evidence as { withheld?: boolean; reason?: string }).withheld;
                      if (withheld) {
                        return (
                          <span className="ch247-page__hint" style={{ color: '#a33' }}>
                            withheld by the secret-redaction check
                          </span>
                        );
                      }
                      const keys = Object.keys(event.evidence ?? {});
                      return keys.length === 0 ? (
                        <span className="ch247-page__hint">—</span>
                      ) : (
                        <details>
                          <summary className="ch247-page__hint">{keys.length} field(s)</summary>
                          <pre style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>
                            {JSON.stringify(event.evidence, null, 2)}
                          </pre>
                        </details>
                      );
                    },
                  },
                ]}
                rows={data.items}
                empty="No event has been projected for this account. Ingestion runs on its own schedule and only projects rows inside the lookback window."
                keyOf={(event) => event.id}
              />
              <Paginator page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
              <p className="ch247-page__hint">
                Events are retained for their own horizon (<code>fraud_sentinel.retention_event_days</code>) and then
                pruned; the payments, invoices and orders they were projected from are not touched by this module at all.
              </p>
            </>
          )}
        </FsLoad>
      </div>
    </FSLayout>
  );
}
