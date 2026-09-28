import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { getMyTicket, replyToMyTicket } from '../lib/account-api';
import { ApiRequestError } from '../lib/api';
import type { TicketDetail } from '../lib/account-types';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import StatusBadge from '../components/StatusBadge';
import TicketThread from '../components/TicketThread';

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'success'; ticket: TicketDetail };

/**
 * A single support ticket's thread + reply box, for the customer who owns it. A ticket id that
 * doesn't exist, or belongs to a different customer, returns 404 from the API (see
 * docs/API_CUSTOMER_APP.md "Ownership isolation & 404-not-403") — this page shows that as an
 * honest "not found" message, never a fabricated ticket.
 */
export default function SupportTicketPage() {
  const { id = '' } = useParams();
  usePageMeta('Support ticket', 'View and reply to your CloudHost247 support ticket.');
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [reply, setReply] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const load = useCallback(() => {
    setState({ status: 'loading' });
    getMyTicket(id)
      .then((res) => setState({ status: 'success', ticket: res.ticket }))
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setReplyError(null);
    try {
      const res = await replyToMyTicket(id, reply);
      setState({ status: 'success', ticket: res.ticket });
      setReply('');
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : 'Could not send your reply.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <p>
          <Link to="/support">← Back to Support</Link>
        </p>

        {state.status === 'loading' && <CatalogLoadingBanner label="Loading ticket…" />}
        {state.status === 'error' && <CatalogErrorBanner message={state.message} />}

        {state.status === 'success' && (
          <>
            <h1>{state.ticket.subject}</h1>
            <p className="ch247-inline-actions">
              <StatusBadge status={state.ticket.status} />
              <span className="ch247-page__hint">Priority: {state.ticket.priority}</span>
            </p>

            <TicketThread messages={state.ticket.messages} />

            {state.ticket.status !== 'closed' ? (
              <form className="ch247-form ch247-form--wide" onSubmit={onSubmit}>
                <label>
                  <span className="ch247-field-label">Reply</span>
                  <textarea value={reply} onChange={(e) => setReply(e.target.value)} required maxLength={10000} rows={4} />
                </label>
                <button type="submit" disabled={submitting}>
                  {submitting ? 'Sending…' : 'Send reply'}
                </button>
              </form>
            ) : (
              <form className="ch247-form ch247-form--wide" onSubmit={onSubmit}>
                <p className="ch247-page__hint">
                  This ticket is closed. Sending a reply will reopen it for staff to review.
                </p>
                <label>
                  <span className="ch247-field-label">Reply</span>
                  <textarea value={reply} onChange={(e) => setReply(e.target.value)} required maxLength={10000} rows={4} />
                </label>
                <button type="submit" disabled={submitting}>
                  {submitting ? 'Sending…' : 'Reopen with reply'}
                </button>
              </form>
            )}
            {replyError && <p className="ch247-status-error">{replyError}</p>}
          </>
        )}
      </div>
    </div>
  );
}

