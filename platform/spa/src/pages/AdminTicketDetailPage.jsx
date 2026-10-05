import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminApi, describeError } from '../lib/api.js';
import { formatDate, humanizeStatus, statusClass } from '../lib/format.js';

const STATUSES = ['open', 'pending_customer', 'pending_staff', 'closed'];

/**
 * One ticket, staff side: the conversation, the reply box and the status control.
 *
 * Closing is a status change here, so the page keeps the two actions explicit — "Reply and set
 * status" on the form, and a separate status selector — rather than guessing intent. The customer
 * card links into the customer page so an agent can jump from a complaint to the account.
 */
export default function AdminTicketDetailPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [reply, setReply] = useState('');
  const [replyStatus, setReplyStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await adminApi.ticket(id));
    } catch (err) {
      setError(describeError(err));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const send = async (event) => {
    event.preventDefault();
    setError('');
    setBusy('reply');
    try {
      await adminApi.replyToTicket(id, reply);
      setReply('');
      if (replyStatus) await adminApi.setTicketStatus(id, replyStatus);
      setReplyStatus('');
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy('');
    }
  };

  const changeStatus = async (status) => {
    setError('');
    setBusy('status');
    try {
      await adminApi.setTicketStatus(id, status);
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy('');
    }
  };

  if (data === null) {
    return (
      <div className="page">
        {error
          ? <div className="alert alert-error" role="alert">{error}</div>
          : <p className="muted">Loading ticket…</p>}
        <Link className="linklike" to="/admin/tickets">Back to the queue</Link>
      </div>
    );
  }

  const { ticket, customer } = data;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{ticket.subject}</h1>
          <p className="muted">
            {ticket.reference ?? ticket.id} · {ticket.department ?? 'general'} · opened {formatDate(ticket.createdAt, { withTime: true })}
          </p>
        </div>
        <div className="row">
          <span className={statusClass(ticket.status)}>{humanizeStatus(ticket.status)}</span>
        </div>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <div className="grid-2">
        <section className="card">
          <h2>Customer</h2>
          {customer ? (
            <>
              <p>{customer.fullName}<br /><span className="muted">{customer.email}</span></p>
              <Link className="linklike" to={`/admin/customers/${encodeURIComponent(customer.id)}`}>Open the customer account</Link>
            </>
          ) : <p className="muted">The account this ticket belongs to no longer exists.</p>}
        </section>

        <section className="card">
          <h2>Status</h2>
          <div className="field">
            <label htmlFor="ticket-status">Queue</label>
            <select
              id="ticket-status"
              value={ticket.status}
              disabled={busy === 'status'}
              onChange={(event) => changeStatus(event.target.value)}
            >
              {STATUSES.map((s) => <option key={s} value={s}>{humanizeStatus(s)}</option>)}
            </select>
          </div>
          <p className="muted">
            {ticket.closedAt
              ? `Closed ${formatDate(ticket.closedAt, { withTime: true })}.`
              : 'Closing a ticket stamps the closed time; replying reopens nothing on its own.'}
          </p>
        </section>
      </div>

      <section className="card">
        <h2>Conversation</h2>
        {ticket.messages.length === 0 ? <p className="muted">No messages yet.</p> : (
          <ul className="list messages">
            {ticket.messages.map((message) => (
              <li key={message.id} className={message.isOwn ? 'is-own' : ''}>
                <div>
                  <strong>{message.isOwn ? 'You' : humanizeStatus(message.authorRole)}</strong>
                  <span className="muted"> · {formatDate(message.createdAt, { withTime: true })}</span>
                </div>
                <p>{message.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Reply</h2>
        <form onSubmit={send}>
          <div className="field">
            <label htmlFor="reply">Message to the customer</label>
            <textarea id="reply" value={reply} onChange={(e) => setReply(e.target.value)} rows={5} required maxLength={10000} />
          </div>
          <div className="row row-wrap">
            <div className="field">
              <label htmlFor="reply-status">Set status after sending (optional)</label>
              <select id="reply-status" value={replyStatus} onChange={(e) => setReplyStatus(e.target.value)}>
                <option value="">Leave as {humanizeStatus(ticket.status)}</option>
                {STATUSES.map((s) => <option key={s} value={s}>{humanizeStatus(s)}</option>)}
              </select>
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy === 'reply'}>
              {busy === 'reply' ? 'Sending…' : 'Send reply'}
            </button>
          </div>
        </form>
      </section>

      <Link className="linklike" to="/admin/tickets">Back to the queue</Link>
    </div>
  );
}
