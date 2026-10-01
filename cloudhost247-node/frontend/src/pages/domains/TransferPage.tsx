import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../../lib/usePageMeta';
import { getToken } from '../../lib/auth';
import { apiFetch } from '../../lib/api';
import { formatDateTime } from '../../components/domain-services/ui';

/**
 * Domain transfer page: start a transfer with the EPP/auth code, then track its lifecycle.
 * Auth codes are sent once and encrypted server-side; they are never displayed again.
 */

interface TransferRow {
  id: string;
  domain_name: string;
  current_registrar: string | null;
  status: string;
  statusLabel: string;
  provider_status: string | null;
  initiated_at: string | null;
  completed_at: string | null;
  created_at: string;
  invoice_id?: string | null;
  invoice_number?: string | null;
  invoice_status?: string | null;
  error_code?: string | null;
  error_message?: string | null;
}

export default function TransferPage() {
  usePageMeta('Transfer Domains', 'Move your domains to CloudHost247.');
  const token = getToken();

  const [domainName, setDomainName] = useState('');
  const [currentRegistrar, setCurrentRegistrar] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [contactEnabled, setContactEnabled] = useState(false);
  const [contact, setContact] = useState({ firstName: '', lastName: '', email: '', phone: '', addressLine1: '', city: '', state: '', postalCode: '', countryCode: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ transferId: string; invoiceId: string | null; invoiceNumber: string | null; amount: string; currency: string } | null>(null);

  const [history, setHistory] = useState<TransferRow[] | null>(null);
  const [historyError, setHistoryError] = useState('');

  async function loadHistory() {
    if (!token) return;
    try {
      const response = await apiFetch<{ transfers: TransferRow[] }>('/api/v1/domain-services/transfers');
      setHistory(response.transfers);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Transfer history could not be loaded.');
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch<{
        transferId: string;
        orderId: string | null;
        invoiceId: string | null;
        invoiceNumber: string | null;
        amount: string;
        currency: string;
      }>('/api/v1/domain-services/transfers', {
        method: 'POST',
        body: JSON.stringify({
          domainName,
          currentRegistrar: currentRegistrar || null,
          authCode,
          authorizationConfirmed: authorized,
          contact: contactEnabled
            ? {
                firstName: contact.firstName,
                lastName: contact.lastName,
                email: contact.email,
                phone: contact.phone,
                addressLine1: contact.addressLine1,
                city: contact.city,
                state: contact.state || null,
                postalCode: contact.postalCode || null,
                countryCode: contact.countryCode.toUpperCase(),
              }
            : null,
        }),
      });
      setCreated(response);
      setDomainName('');
      setAuthCode('');
      setAuthorized(false);
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The transfer could not be started right now.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <h1>Transfer Domain Names</h1>
          <p>Bring your domains to CloudHost247. Unlock the domain at your current registrar, then enter the EPP code.</p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page">
          {!token && (
            <p>
              <Link className="ch247-button" to="/login">Sign in to start a transfer</Link>
            </p>
          )}

          {token && !created && (
            <form className="ch247-card" onSubmit={onSubmit} style={{ display: 'grid', gap: '0.75rem', maxWidth: 640 }}>
              <label>
                Domain to transfer
                <input style={{ width: '100%' }} required placeholder="example.com" value={domainName} onChange={(e) => setDomainName(e.target.value)} />
              </label>
              <label>
                Current registrar (optional)
                <input style={{ width: '100%' }} placeholder="e.g. GoDaddy" value={currentRegistrar} onChange={(e) => setCurrentRegistrar(e.target.value)} />
              </label>
              <label>
                EPP / authorization code
                <input style={{ width: '100%' }} required placeholder="From your current registrar" value={authCode} onChange={(e) => setAuthCode(e.target.value)} autoComplete="off" />
              </label>

              <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                <input type="checkbox" checked={contactEnabled} onChange={(e) => setContactEnabled(e.target.checked)} style={{ marginTop: '0.3rem' }} />
                <span>
                  Provide registrant contact information (required by some registries)
                </span>
              </label>

              {contactEnabled && (
                <div style={{ display: 'grid', gap: '0.6rem', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                  <label>First name<input style={{ width: '100%' }} required={contactEnabled} value={contact.firstName} onChange={(e) => setContact({ ...contact, firstName: e.target.value })} /></label>
                  <label>Last name<input style={{ width: '100%' }} required={contactEnabled} value={contact.lastName} onChange={(e) => setContact({ ...contact, lastName: e.target.value })} /></label>
                  <label>Email<input style={{ width: '100%' }} type="email" required={contactEnabled} value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} /></label>
                  <label>Phone<input style={{ width: '100%' }} required={contactEnabled} value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} /></label>
                  <label>Address<input style={{ width: '100%' }} required={contactEnabled} value={contact.addressLine1} onChange={(e) => setContact({ ...contact, addressLine1: e.target.value })} /></label>
                  <label>City<input style={{ width: '100%' }} required={contactEnabled} value={contact.city} onChange={(e) => setContact({ ...contact, city: e.target.value })} /></label>
                  <label>State / Region<input style={{ width: '100%' }} value={contact.state} onChange={(e) => setContact({ ...contact, state: e.target.value })} /></label>
                  <label>Postal code<input style={{ width: '100%' }} value={contact.postalCode} onChange={(e) => setContact({ ...contact, postalCode: e.target.value })} /></label>
                  <label>Country (2 letters)<input style={{ width: '100%' }} required={contactEnabled} maxLength={2} value={contact.countryCode} onChange={(e) => setContact({ ...contact, countryCode: e.target.value })} /></label>
                </div>
              )}

              <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                <input type="checkbox" checked={authorized} required onChange={(e) => setAuthorized(e.target.checked)} style={{ marginTop: '0.3rem' }} />
                <span>
                  I confirm I am the domain owner (or authorized by the owner) and I request this transfer.
                </span>
              </label>

              <button className="ch247-button" type="submit" disabled={busy || !authorized}>
                {busy ? 'Starting transfer…' : 'Start transfer'}
              </button>
              {error && <p className="ch247-banner ch247-banner--error" role="alert">{error}</p>}
            </form>
          )}

          {created && (
            <div className="ch247-card">
              <h2>Transfer started</h2>
              <p className="ch247-banner ch247-banner--info">
                Your transfer request has been recorded{created.invoiceId ? ' and an invoice for the transfer fee was issued' : ''}.
                {created.invoiceId ? ` Pay invoice ${created.invoiceNumber} to release the transfer to the registrar.` : ' Our system will submit it to the registrar.'}
              </p>
              {created.invoiceId && (
                <p><Link className="ch247-button" to={`/invoices/${created.invoiceId}`}>Pay invoice {created.invoiceNumber}</Link></p>
              )}
              <p className="ch247-page__hint">Reference: {created.transferId}</p>
            </div>
          )}

          {token && (
            <section className="ch247-card" style={{ marginTop: '1.5rem' }}>
              <h2>Your transfers</h2>
              <button className="ch247-button ch247-button--outline" type="button" onClick={() => void loadHistory()}>Load transfer history</button>
              {historyError && <p className="ch247-banner ch247-banner--error" role="alert">{historyError}</p>}
              {history === null ? (
                <p className="ch247-page__hint">Your transfer history will appear here once loaded.</p>
              ) : history.length === 0 ? (
                <p className="ch247-page__hint">You have not started any transfers yet.</p>
              ) : (
                <div className="ch247-table-wrap">
                  <table className="ch247-table">
                    <thead>
                      <tr>
                        <th>Domain</th>
                        <th>Status</th>
                        <th>From</th>
                        <th>Started</th>
                        <th>Updated</th>
                        <th>Invoice</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((transfer) => (
                        <tr key={transfer.id}>
                          <td>{transfer.domain_name}</td>
                          <td>{transfer.statusLabel}</td>
                          <td>{transfer.current_registrar ?? '—'}</td>
                          <td>{formatDateTime(transfer.created_at)}</td>
                          <td>
                            {formatDateTime(transfer.completed_at ?? transfer.initiated_at ?? transfer.created_at)}
                            {transfer.error_message && (
                              <><br /><small>We could not complete this transfer — our team will follow up.</small></>
                            )}
                          </td>
                          <td>
                            {transfer.invoice_id && transfer.invoice_status !== 'paid' ? (
                              <Link to={`/invoices/${transfer.invoice_id}`}>Pay {transfer.invoice_number}</Link>
                            ) : (
                              transfer.invoice_number ?? '—'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
