import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../../lib/usePageMeta';
import { getToken } from '../../lib/auth';
import { apiFetch } from '../../lib/api';
import { formatDateTime } from '../../components/domain-services/ui';

/**
 * Domain Broker Service — the customer-facing entry into the EXISTING brokerage module
 * (/api/v1/account/domain-brokerage). This page adds the full workflow surface: request intake,
 * case tracking, negotiation messages, and accept/reject decisions on seller offers.
 *
 * Honest limitations preserved: acquiring a registered domain is never guaranteed, and no attempt
 * is made to bypass WHOIS privacy — brokers contact sellers through legitimate channels only.
 */

interface BrokerCase {
  id: string;
  brokerage_id: string;
  domain: string;
  status: string;
  domain_status: string;
  acquisition_route: string;
  current_offer: number | null;
  currency: string;
  payment_status: string;
  transfer_status: string;
  created_at: string;
  updated_at: string;
}

interface CaseDetail {
  case: BrokerCase & { max_budget: number; negotiation_instructions: string | null; customer_message: string | null; deadline_at: string | null };
  offers: Array<{ id: string; amount: number; currency: string; sender_type: string; recipient_type: string; status: string; expires_at: string | null; created_at: string }>;
  messages: Array<{ id: string; body: string; created_at: string }>;
  timeline: Array<{ event_type: string; result: string; created_at: string }>;
  payment: { total_amount: string; acquisition_amount: string; brokerage_fee: string; status: string } | null;
  transfer: { status: string; registrar: string | null } | null;
}

const STATUS_LABELS: Record<string, string> = {
  request_submitted: 'Submitted',
  broker_assigned: 'Under Review',
  negotiation: 'Negotiating',
  offer_accepted: 'Offer Accepted',
  payment_pending: 'Payment Pending',
  transfer_in_progress: 'Transfer Pending',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export default function BrokerPage() {
  usePageMeta('Domain Broker Service', 'Our brokers negotiate the acquisition of registered domains on your behalf.');
  const token = getToken();

  const [cases, setCases] = useState<BrokerCase[] | null>(null);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [detailError, setDetailError] = useState('');

  const [domain, setDomain] = useState('');
  const [budget, setBudget] = useState('');
  const [openingOffer, setOpeningOffer] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const [newMessage, setNewMessage] = useState('');
  const [counterOffer, setCounterOffer] = useState('');

  const loadCases = useCallback(() => {
    apiFetch<{ cases: BrokerCase[] }>('/api/v1/account/domain-brokerage/cases')
      .then((response) => setCases(response.cases))
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (token) loadCases();
  }, [token, loadCases]);

  async function loadDetail(caseId: string) {
    setDetailError('');
    try {
      const response = await apiFetch<CaseDetail>(`/api/v1/account/domain-brokerage/cases/${caseId}`);
      setDetail(response);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'The case could not be loaded.');
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      await apiFetch('/api/v1/account/domain-brokerage/cases', {
        method: 'POST',
        body: JSON.stringify({
          domain: domain.trim().toLowerCase(),
          customerName: 'Account holder',
          contactInformation: 'Use my CloudHost247 account contact details',
          maxBudget: Number(budget),
          currency: 'USD',
          openingOffer: openingOffer ? Number(openingOffer) : undefined,
          message,
          termsAccepted: true,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      setNotice('Broker request submitted. A broker will review your request — note that acquisition is never guaranteed, and a registered domain is not automatically for sale.');
      setDomain('');
      setBudget('');
      setOpeningOffer('');
      setMessage('');
      loadCases();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'The request could not be submitted.');
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage() {
    if (!detail || !newMessage.trim()) return;
    try {
      await apiFetch(`/api/v1/account/domain-brokerage/cases/${detail.case.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: newMessage.trim() }),
      });
      setNewMessage('');
      await loadDetail(detail.case.id);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'The message could not be sent.');
    }
  }

  async function submitCounterOffer() {
    if (!detail || !counterOffer) return;
    try {
      await apiFetch(`/api/v1/account/domain-brokerage/cases/${detail.case.id}/offers`, {
        method: 'POST',
        body: JSON.stringify({ amount: Number(counterOffer), currency: 'USD', recipientType: 'broker' }),
      });
      setCounterOffer('');
      await loadDetail(detail.case.id);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'The offer could not be submitted.');
    }
  }

  async function decideOffer(offerId: string, action: 'accept' | 'reject') {
    if (!detail) return;
    try {
      await apiFetch(`/api/v1/account/domain-brokerage/cases/${detail.case.id}/offers/${offerId}/decision`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      await loadDetail(detail.case.id);
      loadCases();
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'The decision could not be recorded.');
    }
  }

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <h1>Domain Broker Service</h1>
          <p>Want a domain that is already registered? Our brokers approach the owner and negotiate for you.</p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page">
          <p className="ch247-page__hint">
            Workflow: you submit the domain and a confidential maximum budget → a broker reviews the request and
            contacts the seller → offers and negotiation are tracked on your case → when a seller accepts, payment and
            the domain transfer are handled through this platform. WHOIS privacy is always respected — we never try to
            uncover a protected owner.
          </p>

          {!token && <p><Link className="ch247-button" to="/login">Sign in to request a broker</Link></p>}

          {token && (
            <>
              <form className="ch247-card" onSubmit={submit} style={{ display: 'grid', gap: '0.75rem', maxWidth: 640, marginTop: '1rem' }}>
                <h2 style={{ margin: 0 }}>Request broker assistance</h2>
                <label>
                  Domain you want to acquire
                  <input style={{ width: '100%' }} required placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
                </label>
                <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                  <label>
                    Maximum budget (confidential, USD)
                    <input style={{ width: '100%' }} required type="number" min="1" step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} />
                  </label>
                  <label>
                    Opening offer (optional, USD)
                    <input style={{ width: '100%' }} type="number" min="1" step="0.01" value={openingOffer} onChange={(e) => setOpeningOffer(e.target.value)} />
                  </label>
                </div>
                <label>
                  Anything the broker should know
                  <textarea style={{ width: '100%' }} rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
                </label>
                <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                  <input type="checkbox" required style={{ marginTop: '0.3rem' }} />
                  <span>
                    I agree to the Domain Brokerage terms. Acquisition is not guaranteed — a registered domain is not
                    automatically for sale, and the seller may decline or never respond.
                  </span>
                </label>
                <button className="ch247-button" type="submit" disabled={busy}>
                  {busy ? 'Submitting…' : 'Submit broker request'}
                </button>
                {notice && <p className="ch247-banner ch247-banner--info" role="status">{notice}</p>}
              </form>

              <h2 style={{ marginTop: '2rem' }}>Your broker requests</h2>
              {error && <p className="ch247-banner ch247-banner--error" role="alert">{error}</p>}
              {cases === null && <p className="ch247-page__hint">Loading your cases…</p>}
              {cases !== null && cases.length === 0 && <p className="ch247-page__hint">You have not submitted any broker requests yet.</p>}
              {cases !== null && cases.length > 0 && (
                <div className="ch247-table-wrap">
                  <table className="ch247-table">
                    <thead>
                      <tr><th>Reference</th><th>Domain</th><th>Status</th><th>Current offer</th><th>Payment</th><th>Transfer</th><th>Updated</th><th /></tr>
                    </thead>
                    <tbody>
                      {cases.map((brokerCase) => (
                        <tr key={brokerCase.id}>
                          <td>{brokerCase.brokerage_id}</td>
                          <td style={{ wordBreak: 'break-all' }}>{brokerCase.domain}</td>
                          <td>{STATUS_LABELS[brokerCase.status] ?? brokerCase.status}</td>
                          <td>{brokerCase.current_offer ? `${brokerCase.currency} ${brokerCase.current_offer}` : '—'}</td>
                          <td>{brokerCase.payment_status}</td>
                          <td>{brokerCase.transfer_status}</td>
                          <td>{formatDateTime(brokerCase.updated_at)}</td>
                          <td>
                            <button className="ch247-button ch247-button--small" type="button" onClick={() => void loadDetail(brokerCase.id)}>
                              Open
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {detail && (
                <section className="ch247-card" style={{ marginTop: '1.5rem' }}>
                  <div className="ch247-section-heading">
                    <div>
                      <h2 style={{ margin: 0 }}>{detail.case.domain}</h2>
                      <p className="ch247-page__hint">{detail.case.brokerage_id} · {STATUS_LABELS[detail.case.status] ?? detail.case.status}</p>
                    </div>
                  </div>

                  <h3>Offers &amp; negotiation</h3>
                  {detail.offers.length === 0 && <p className="ch247-page__hint">No offers yet.</p>}
                  {detail.offers.length > 0 && (
                    <div className="ch247-table-wrap">
                      <table className="ch247-table">
                        <thead><tr><th>Amount</th><th>From</th><th>Status</th><th>Placed</th><th /></tr></thead>
                        <tbody>
                          {detail.offers.map((offer) => (
                            <tr key={offer.id}>
                              <td>{offer.currency} {offer.amount}</td>
                              <td>{offer.sender_type}</td>
                              <td>{offer.status}</td>
                              <td>{formatDateTime(offer.created_at)}</td>
                              <td>
                                {offer.sender_type !== 'customer' && offer.status === 'open' && (
                                  <>
                                    <button className="ch247-button ch247-button--small" type="button" onClick={() => void decideOffer(offer.id, 'accept')}>Accept</button>{' '}
                                    <button className="ch247-button ch247-button--small ch247-button--danger" type="button" onClick={() => void decideOffer(offer.id, 'reject')}>Reject</button>
                                  </>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="ch247-dsvc-toolbar">
                    <input
                      type="number"
                      min="1"
                      step="0.01"
                      placeholder="Your counter-offer (USD)"
                      value={counterOffer}
                      onChange={(event) => setCounterOffer(event.target.value)}
                      aria-label="Counter offer amount"
                    />
                    <button className="ch247-button ch247-button--outline" type="button" onClick={() => void submitCounterOffer()} disabled={!counterOffer}>
                      Submit counter-offer
                    </button>
                  </div>

                  <h3>Messages with your broker</h3>
                  {detail.messages.length === 0 && <p className="ch247-page__hint">No messages yet.</p>}
                  {detail.messages.map((entry) => (
                    <p key={entry.id} className="ch247-page__hint" style={{ borderTop: '1px solid var(--ch247-border)', paddingTop: '0.5rem' }}>
                      <strong>{formatDateTime(entry.created_at)}</strong><br />
                      {entry.body}
                    </p>
                  ))}
                  <div className="ch247-dsvc-toolbar">
                    <input
                      type="text"
                      placeholder="Write a message to your broker…"
                      value={newMessage}
                      onChange={(event) => setNewMessage(event.target.value)}
                      aria-label="Message to broker"
                    />
                    <button className="ch247-button ch247-button--outline" type="button" onClick={() => void sendMessage()} disabled={!newMessage.trim()}>
                      Send
                    </button>
                  </div>

                  <h3>Case timeline</h3>
                  {detail.timeline.map((entry, index) => (
                    <p key={index} className="ch247-page__hint">
                      {formatDateTime(entry.created_at)} — {entry.event_type.replace(/_/g, ' ')} ({entry.result})
                    </p>
                  ))}

                  {detail.payment && (
                    <p className="ch247-page__hint">
                      Payment: {detail.payment.status} · acquisition {detail.payment.acquisition_amount} + broker fee {detail.payment.brokerage_fee}
                    </p>
                  )}
                  {detail.transfer && (
                    <p className="ch247-page__hint">Transfer: {detail.transfer.status}{detail.transfer.registrar ? ` · ${detail.transfer.registrar}` : ''}</p>
                  )}
                  {detailError && <p className="ch247-banner ch247-banner--error" role="alert">{detailError}</p>}
                </section>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
