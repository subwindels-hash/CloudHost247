import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { listAllTickets } from '../lib/account-api';
import { ApiRequestError } from '../lib/api';
import type { TicketStatus, TicketSummary } from '../lib/account-types';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import StatusBadge from '../components/StatusBadge';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; tickets: TicketSummary[]; total: number };

const STATUS_OPTIONS: { value: TicketStatus | ''; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'pending_staff', label: 'Pending staff' },
  { value: 'pending_customer', label: 'Pending customer' },
  { value: 'closed', label: 'Closed' },
];

/** Staff (admin + super_admin) view of every customer's support tickets — see
 * docs/API_CUSTOMER_APP.md "Authorization model". */
export default function AdminTicketsPage() {
  usePageMeta('Manage tickets', 'CloudHost247 support ticket management.');
  const [statusFilter, setStatusFilter] = useState<TicketStatus | ''>('');
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    listAllTickets(statusFilter ? { status: statusFilter } : {})
      .then((res) => {
        if (!cancelled) setState({ status: 'success', tickets: res.tickets, total: res.total });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message:
              err instanceof ApiRequestError && err.status === 403
                ? 'Your account does not have permission to manage support tickets.'
                : err instanceof Error
                  ? err.message
                  : 'Something went wrong loading tickets.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [statusFilter]);

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <p>
          <Link to="/admin">← Back to Customers</Link>
        </p>
        <h1>Support tickets</h1>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as TicketStatus | '')}
          style={{ padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {state.status === 'loading' && <CatalogLoadingBanner label="Loading tickets…" />}
        {state.status === 'error' && <CatalogErrorBanner message={state.message} />}

        {state.status === 'success' && state.tickets.length === 0 && (
          <p className="ch247-page__hint">No tickets match this filter.</p>
        )}

        {state.status === 'success' && state.tickets.length > 0 && (
          <div className="ch247-table-wrap">
            <table className="ch247-table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.tickets.map((ticket) => (
                  <tr key={ticket.id}>
                    <td>{ticket.subject}</td>
                    <td>
                      <StatusBadge status={ticket.status} />
                    </td>
                    <td>{ticket.priority}</td>
                    <td>{new Date(ticket.updatedAt).toLocaleString()}</td>
                    <td>
                      <Link to={`/admin/tickets/${ticket.id}`}>View →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
