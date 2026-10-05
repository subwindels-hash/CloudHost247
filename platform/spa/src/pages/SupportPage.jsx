import React, { useEffect, useState } from 'react';
import { accountApi, describeError } from '../lib/api.js';

export default function SupportPage() {
  const [tickets, setTickets] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const load = async () => {
    try {
      const data = await accountApi.tickets();
      setTickets(data.tickets);
    } catch (err) {
      setError(describeError(err));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openTicket = async (id) => {
    try {
      setError('');
      const data = await accountApi.ticket(id);
      setSelected(data);
    } catch (err) {
      setError(describeError(err));
    }
  };

  const createTicket = async (event) => {
    event.preventDefault();
    setError('');
    setNote('');
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await accountApi.createTicket({
        subject: data.subject,
        body: data.body,
        department: data.department,
        priority: data.priority,
      });
      setNote('Ticket opened. Our team will reply shortly.');
      event.currentTarget.reset();
      await load();
    } catch (err) {
      setError(describeError(err));
    }
  };

  const reply = async (event) => {
    event.preventDefault();
    setError('');
    const body = event.currentTarget.message.value.trim();
    if (!body) return;
    try {
      await accountApi.reply(selected.ticket.id, body);
      await openTicket(selected.ticket.id);
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Support</h1><p className="muted">Open a ticket or continue an existing conversation.</p></div>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {note && <div className="alert alert-success" role="status">{note}</div>}

      <div className="grid-2">
        <section className="card">
          <h2>Your tickets</h2>
          {tickets === null ? <p className="muted">Loading…</p>
            : tickets.length === 0 ? <p className="muted">No tickets yet.</p>
            : (
              <ul className="list">
                {tickets.map((t) => (
                  <li key={t.id}>
                    <button type="button" className="linklike" onClick={() => openTicket(t.id)}>{t.subject}</button>
                    <span className={`status status-${t.status}`}>{t.status}</span>
                  </li>
                ))}
              </ul>
            )}
        </section>

        <section className="card">
          <h2>New ticket</h2>
          <form onSubmit={createTicket}>
            <div className="field">
              <label htmlFor="subject">Subject</label>
              <input id="subject" name="subject" required minLength="3" maxLength="200" />
            </div>
            <div className="field">
              <label htmlFor="department">Department</label>
              <select id="department" name="department">
                <option value="general">General</option>
                <option value="billing">Billing</option>
                <option value="technical">Technical</option>
                <option value="abuse">Abuse</option>
                <option value="domain">Domain</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="body">How can we help?</label>
              <textarea id="body" name="body" rows="4" required maxLength="20000" />
            </div>
            <button className="btn btn-primary" type="submit">Open ticket</button>
          </form>
        </section>
      </div>

      {selected && (
        <section className="card">
          <h2>{selected.ticket.subject}</h2>
          <div className="thread">
            {selected.messages.map((m) => (
              <div key={m.id} className={`msg ${m.authorRole === 'customer' ? 'msg-customer' : 'msg-staff'}`}>
                <p>{m.body}</p>
                <span className="muted">{new Date(m.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
          {selected.ticket.status !== 'closed' && (
            <form onSubmit={reply} className="msg-reply">
              <textarea name="message" rows="3" placeholder="Reply…" required maxLength="20000" />
              <button className="btn btn-primary" type="submit">Send reply</button>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
