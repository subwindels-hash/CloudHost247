import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { getTicketForStaff, replyToTicketAsStaff, setTicketStatus } from '../lib/account-api';
import { ApiRequestError } from '../lib/api';
import type { AdminCustomerSummary, TicketDetail, TicketStatus } from '../lib/account-types';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import StatusBadge from '../components/StatusBadge';
import TicketThread from '../components/TicketThread';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; ticket: TicketDetail; customer: AdminCustomerSummary | null };

const STATUS_OPTIONS: TicketStatus[] = ['open', 'pending_customer', 'pending_staff', 'closed'];

/** Staff (admin + super_admin) view of a single ticket: full thread, reply, and direct status
 * control — see docs/API_CUSTOMER_APP.md. Unlike the customer's own ticket view, staff can see and
 * act on any ticket, not just their own (there is no ownership restriction on this surface — that
 * is the entire point of it). */
export default function AdminTicketDetailPage() {
  const { id = '' } = useParams();
  usePageMeta('Manage ticket', 'View and reply to a CloudHost247 support ticket.');
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [reply, setReply] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    setState({ status: 'loading' });
    getTicketForStaff(id)
      .then((res) => setState({ status: 'success', ticket: res.ticket, customer: res.customer }))
      .catch((err: unknown) =>
        setState({
          status: 'error',
          message:
            err instanceof ApiRequestError && err.status === 404
              ? 'No ticket was found with that id.'
              : err instanceof Error
                ? err.message
                : 'Something went wrong loading this ticket.',
        })
      );
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function onReply(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await replyToTicketAsStaff(id, reply);
      setState((prev) => (prev.status === 'success' ? { ...prev, ticket: res.ticket } : prev));
      setReply('');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not send reply.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onChangeStatus(status: TicketStatus) {
    setMessage(null);
    try {
      await setTicketStatus(id, status);
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not change ticket status.');
    }
  }

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <p>
          <Link to="/admin/tickets">← Back to Tickets</Link>
        </p>

        {state.status === 'loading' && <CatalogLoadingBanner label="Loading ticket…" />}
        {state.status === 'error' && <CatalogErrorBanner message={state.message} />}

        {state.status === 'success' && (
          <>
            <h1>{state.ticket.subject}</h1>
            <p className="ch247-page__hint">
              From{' '}
              {state.customer ? (
                <Link to={`/admin/customers/${state.customer.id}`}>
                  {state.customer.fullName} ({state.customer.email})
                </Link>
              ) : (
                'a customer account that no longer exists'
              )}
            </p>
            <div className="ch247-inline-actions">
              <StatusBadge status={state.ticket.status} />
              <span className="ch247-page__hint">Priority: {state.ticket.priority}</span>
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) onChangeStatus(e.target.value as TicketStatus);
                  e.target.value = '';
                }}
                style={{ padding: '0.35rem 0.5rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
              >
                <option value="" disabled>
                  Set status…
                </option>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>

            <TicketThread messages={state.ticket.messages} />

            <form className="ch247-form ch247-form--wide" onSubmit={onReply}>
              <label>
                <span className="ch247-field-label">Reply as support</span>
                <textarea value={reply} onChange={(e) => setReply(e.target.value)} required maxLength={10000} rows={4} />
              </label>
              <button type="submit" disabled={submitting}>
                {submitting ? 'Sending…' : 'Send reply'}
              </button>
            </form>
            {message && <p className="ch247-status-error">{message}</p>}
          </>
        )}
      </div>
    </div>
  );
}
