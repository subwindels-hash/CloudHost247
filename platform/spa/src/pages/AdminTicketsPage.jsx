import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi, describeError } from '../lib/api.js';
import { formatDate, humanizeStatus, statusClass } from '../lib/format.js';

const STATUSES = ['open', 'pending_customer', 'pending_staff', 'closed'];
const PAGE_SIZE = 25;

/**
 * The ticket queue.
 *
 * The status filter is the server's (`?status=`), so paging is over the filtered set and the total
 * is the filtered total. The URL is the source of truth for the filter, which is what lets the
 * dashboard's count tiles deep-link straight into a queue.
 */
export default function AdminTicketsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const offset = Number.parseInt(params.get('offset') ?? '0', 10) || 0;

  const [tickets, setTickets] = useState(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await adminApi.tickets({ status: status || undefined, limit: PAGE_SIZE, offset });
      setTickets(data.tickets);
      setTotal(data.total);
    } catch (err) {
      setError(describeError(err));
      setTickets([]);
    }
  }, [status, offset]);

  useEffect(() => { load(); }, [load]);

  const setStatus = (value) => {
    const next = new URLSearchParams();
    if (value) next.set('status', value);
    setParams(next);
  };
  const setOffset = (value) => {
    const next = new URLSearchParams(params);
    if (value > 0) next.set('offset', String(value)); else next.delete('offset');
    setParams(next);
  };

  const shownFrom = total === 0 ? 0 : offset + 1;
  const shownTo = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Ticket queue</h1>
          <p className="muted">Replies are sent as your staff account; the customer sees them in their support page.</p>
        </div>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <section className="card">
        <div className="tabs" role="tablist" aria-label="Ticket status">
          <button type="button" className={status === '' ? 'active' : ''} onClick={() => setStatus('')}>Any</button>
          {STATUSES.map((s) => (
            <button key={s} type="button" className={status === s ? 'active' : ''} onClick={() => setStatus(s)}>
              {humanizeStatus(s)}
            </button>
          ))}
        </div>

        {tickets === null ? <p className="muted">Loading tickets…</p> : tickets.length === 0 ? (
          <p className="muted">No tickets in this view.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Reference</th>
                    <th scope="col">Subject</th>
                    <th scope="col">Priority</th>
                    <th scope="col">Status</th>
                    <th scope="col">Last reply</th>
                    <th scope="col">Opened</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((ticket) => (
                    <tr key={ticket.id}>
                      <td><Link to={`/admin/tickets/${encodeURIComponent(ticket.id)}`}>{ticket.reference ?? ticket.id}</Link></td>
                      <td>{ticket.subject}</td>
                      <td>{ticket.priority ?? '—'}</td>
                      <td><span className={statusClass(ticket.status)}>{humanizeStatus(ticket.status)}</span></td>
                      <td>{formatDate(ticket.lastReplyAt, { withTime: true })}</td>
                      <td>{formatDate(ticket.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row row-wrap" style={{ marginTop: 12 }}>
              <button type="button" className="btn btn-ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
              <span className="muted">Showing {shownFrom}–{shownTo} of {total}</span>
              <button type="button" className="btn btn-ghost" disabled={shownTo >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
