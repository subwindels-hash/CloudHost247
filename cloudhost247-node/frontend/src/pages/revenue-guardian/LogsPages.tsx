/**
 * Activity log (spec §39) and communication log (spec §40). Communication status is honest:
 * "queued" means queued; the notification pipeline's real delivery state is shown alongside.
 */
import { useState } from 'react';
import RGLayout from '../../components/revenue-guardian/RGLayout';
import {
  formatDateTime,
  Paginator,
  RgBadge,
  RgLoad,
  RgTable,
  useRgData,
} from '../../components/revenue-guardian/rg-widgets';
import type { Paginated } from '../../lib/revenue-guardian-api';

interface ActivityRow {
  id: string;
  event_type: string;
  description: string;
  actor_email: string | null;
  actor_type: string;
  customer_email: string | null;
  case_number: string | null;
  created_at: string;
}

export function ActivityLogPage() {
  const [page, setPage] = useState(1);
  const [eventType, setEventType] = useState('');
  const { state } = useRgData<Paginated<ActivityRow>>('/activities', { page, limit: 50, eventType: eventType || undefined });
  return (
    <RGLayout title="Activity Log" hint="Append-only record of every recovery action, by staff and by automation.">
      <div className="ch247-inline-actions" style={{ marginBottom: '0.75rem' }}>
        <select value={eventType} onChange={(e) => { setEventType(e.target.value); setPage(1); }}>
          <option value="">All events</option>
          {['case_created', 'status_changed', 'note_added', 'follow_up_created', 'follow_up_completed', 'promise_created', 'promise_fulfilled', 'promise_broken', 'assignment_changed', 'escalation', 'invoice_recovered', 'partial_recovery', 'reconciliation_anomaly'].map((t) => (
            <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>
      <RgLoad state={state}>
        {(data) => (
          <>
            <RgTable
              empty="No activity yet."
              columns={[
                { header: 'When', render: (a: ActivityRow) => formatDateTime(a.created_at) },
                { header: 'Event', render: (a) => a.event_type.replace(/_/g, ' ') },
                { header: 'Customer', render: (a) => a.customer_email ?? '—' },
                { header: 'Case', render: (a) => a.case_number ?? '—' },
                { header: 'Actor', render: (a) => a.actor_email ?? a.actor_type },
                { header: 'Description', render: (a) => a.description },
              ]}
              rows={data.items}
            />
            <Paginator page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        )}
      </RgLoad>
    </RGLayout>
  );
}

interface CommRow {
  id: string;
  channel: string;
  recipient: string;
  template_key: string;
  subject: string;
  status: string;
  failure_reason: string | null;
  outbox_status: string | null;
  outbox_error: string | null;
  customer_email: string | null;
  case_number: string | null;
  created_at: string;
}

export function EmailLogsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [channel, setChannel] = useState('');
  const { state } = useRgData<Paginated<CommRow>>('/email-logs', {
    page,
    limit: 50,
    status: status || undefined,
    channel: channel || undefined,
  });
  return (
    <RGLayout title="Communication Log" hint="Every queued email/WhatsApp with its true state. 'queued' never means delivered — the pipeline column shows the real delivery outcome.">
      <div className="ch247-inline-actions" style={{ marginBottom: '0.75rem' }}>
        <select value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1); }}>
          <option value="">All channels</option>
          <option value="email">Email</option>
          <option value="whatsapp">WhatsApp</option>
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Any status</option>
          {['queued', 'sent', 'delivered', 'failed', 'configuration_required', 'suppressed'].map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>
      <RgLoad state={state}>
        {(data) => (
          <>
            <RgTable
              empty="No communications logged yet."
              columns={[
                { header: 'When', render: (m: CommRow) => formatDateTime(m.created_at) },
                { header: 'Channel', render: (m) => m.channel },
                { header: 'Customer', render: (m) => m.customer_email ?? '—' },
                { header: 'To', render: (m) => m.recipient },
                { header: 'Template', render: (m) => m.template_key },
                { header: 'Subject', render: (m) => m.subject },
                { header: 'Case', render: (m) => m.case_number ?? '—' },
                { header: 'Module status', render: (m) => <RgBadge value={m.status} /> },
                { header: 'Pipeline delivery', render: (m) => (m.outbox_status ? <RgBadge value={m.outbox_status === 'DELIVERED' ? 'completed' : m.outbox_status === 'PENDING' ? 'pending' : 'failed'} /> : '—') },
                { header: 'Error', render: (m) => m.failure_reason ?? m.outbox_error ?? '—' },
              ]}
              rows={data.items}
            />
            <Paginator page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        )}
      </RgLoad>
    </RGLayout>
  );
}
