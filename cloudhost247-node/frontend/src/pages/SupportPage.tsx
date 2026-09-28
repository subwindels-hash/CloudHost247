import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { useApiResource } from '../lib/useApiResource';
import { createMyTicket } from '../lib/account-api';
import type { TicketSummary } from '../lib/account-types';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import StatusBadge from '../components/StatusBadge';

interface TicketsResponse {
  tickets: TicketSummary[];
}

/**
 * Real, API-backed support ticket list + "open a new ticket" form (Phase 4). This is plain
 * account-to-staff messaging with no billing/provisioning meaning — see docs/API_CUSTOMER_APP.md.
 */
export default function SupportPage() {
  usePageMeta('Support', 'Your CloudHost247 support tickets.');
  const [refreshKey, setRefreshKey] = useState(0);
  const tickets = useApiResource<TicketsResponse>(`/api/v1/account/tickets?refresh=${refreshKey}`);

  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [submitting, setSubmitting] = useState(false);
  const [formMessage, setFormMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormMessage(null);
    try {
      await createMyTicket({ subject, message, priority });
      setSubject('');
      setMessage('');
      setPriority('normal');
      setFormMessage({ kind: 'ok', text: 'Your ticket has been opened.' });
      setRefreshKey((n) => n + 1);
    } catch (err) {
      setFormMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not open ticket.' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <h1>Support</h1>
        <p className="ch247-page__hint">Open a new support ticket, or reply to an existing one below.</p>

        <form className="ch247-form ch247-form--wide" onSubmit={onSubmit}>
          <label>
            <span className="ch247-field-label">Subject</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={255} />
          </label>
          <label>
            <span className="ch247-field-label">Priority</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </label>
          <label>
            <span className="ch247-field-label">Message</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
              maxLength={10000}
              rows={4}
            />
          </label>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Opening ticket…' : 'Open ticket'}
          </button>
        </form>
        {formMessage && (
          <p className={formMessage.kind === 'ok' ? 'ch247-status-ok' : 'ch247-status-error'}>{formMessage.text}</p>
        )}
      </div>

      <div className="ch247-card">
        <h2>Your tickets</h2>

        {tickets.status === 'loading' && <CatalogLoadingBanner label="Loading your tickets…" />}
        {tickets.status === 'error' && <CatalogErrorBanner message={tickets.message} />}

        {tickets.status === 'success' && tickets.data.tickets.length === 0 && (
          <p className="ch247-page__hint">You haven&apos;t opened any support tickets yet.</p>
        )}

        {tickets.status === 'success' && tickets.data.tickets.length > 0 && (
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
                {tickets.data.tickets.map((ticket) => (
                  <tr key={ticket.id}>
                    <td>{ticket.subject}</td>
                    <td>
                      <StatusBadge status={ticket.status} />
                    </td>
                    <td>{ticket.priority}</td>
                    <td>{new Date(ticket.updatedAt).toLocaleString()}</td>
                    <td>
                      <Link to={`/support/${ticket.id}`}>View →</Link>
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
