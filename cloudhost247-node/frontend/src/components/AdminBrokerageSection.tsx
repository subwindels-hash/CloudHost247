import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { SectionCard, StatusChip, formatDateTime, formatPrice } from './domain-services/ui';

/**
 * Super Admin / staff broker case management (spec §15 — Broker Service).
 *
 * Backed by the /api/v1/admin/domain-brokerage API: case workflow, offer recording (new offers
 * supersede open ones server-side), staff notes vs customer messages, fee/payment recording with
 * server-computed totals, and acquisition transfer tracking. Every mutation writes broker events
 * and audit rows on the server and notifies the customer once per meaningful change.
 */

interface BrokerCaseRow {
  id: string;
  brokerage_id: string;
  domain: string;
  status: string;
  customer_email: string;
  max_budget: string;
  currency: string;
  current_offer: string | null;
  payment_status: string;
  transfer_status: string;
  created_at: string;
  updated_at: string;
}

interface BrokerOfferRow {
  id: string;
  amount: string;
  currency: string;
  sender_type: string;
  recipient_type: string;
  status: string;
  expires_at: string | null;
  created_at: string;
}

interface BrokerMessageRow {
  id: string;
  visibility: 'customer' | 'internal';
  body: string;
  author_email: string | null;
  created_at: string;
}

interface BrokerEventRow {
  event_type: string;
  result: string;
  created_at: string;
}

interface BrokerPaymentRow {
  acquisition_amount: string;
  brokerage_fee: string;
  transfer_fee: string;
  payment_fee: string;
  total_amount: string;
  currency: string;
  status: string;
  updated_at: string;
}

interface BrokerTransferRow {
  status: string;
  registrar: string | null;
  provider_reference: string | null;
  failure_reason: string | null;
  initiated_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

interface BrokerCaseDetail {
  case: BrokerCaseRow & { customer_name: string; contact_information: string; negotiation_instructions: string | null; customer_message: string | null; broker_email: string | null };
  offers: BrokerOfferRow[];
  messages: BrokerMessageRow[];
  timeline: BrokerEventRow[];
  payment: BrokerPaymentRow | null;
  transfer: BrokerTransferRow | null;
  statusLabels: Record<string, string>;
}

const STATUS_OPTIONS = [
  'request_submitted', 'under_review', 'contacting_seller', 'negotiation', 'offer_received',
  'offer_accepted', 'payment_pending', 'transfer_pending', 'completed', 'rejected', 'cancelled',
];

export default function AdminBrokerageSection() {
  const [cases, setCases] = useState<BrokerCaseRow[] | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<BrokerCaseDetail | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  const [statusForm, setStatusForm] = useState({ status: 'under_review', note: '' });
  const [offerForm, setOfferForm] = useState({ amount: '', currency: 'USD', senderType: 'seller', recipientType: 'customer' });
  const [messageForm, setMessageForm] = useState({ body: '', visibility: 'internal' as 'customer' | 'internal' });
  const [paymentForm, setPaymentForm] = useState({ acquisitionAmount: '', brokerageFee: '', transferFee: '', paymentFee: '', currency: 'USD', status: 'pending' });
  const [transferForm, setTransferForm] = useState({ status: 'initiated', registrar: '', providerReference: '', failureReason: '' });

  const loadCases = useCallback(() => {
    const params = new URLSearchParams({ limit: '50' });
    if (statusFilter) params.set('status', statusFilter);
    if (search.trim()) params.set('search', search.trim());
    apiFetch<{ cases: BrokerCaseRow[] }>(`/api/v1/admin/domain-brokerage/cases?${params.toString()}`)
      .then((r) => setCases(r.cases))
      .catch((err: Error) => { setError(err.message); setCases([]); });
  }, [statusFilter, search]);

  useEffect(() => {
    if (cases === null) loadCases();
  }, [cases, loadCases]);

  const loadDetail = useCallback((caseId: string) => {
    apiFetch<BrokerCaseDetail>(`/api/v1/admin/domain-brokerage/cases/${caseId}`)
      .then(setSelected)
      .catch((err: Error) => setError(err.message));
  }, []);

  async function runAction(key: string, action: () => Promise<unknown>, successMessage: string) {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(successMessage);
      if (selected) loadDetail(selected.case.id);
      loadCases();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The action could not be completed.');
    } finally {
      setBusy('');
    }
  }

  function numberField(value: string, fallback = 0): number {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return (
    <>
      <SectionCard title="Broker cases">
        <form
          className="ch247-dsvc-toolbar"
          onSubmit={(event) => { event.preventDefault(); setCases(null); loadCases(); }}
          role="search"
        >
          <input
            type="search"
            placeholder="Search case id or domain"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search broker cases"
          />
          <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setCases(null); }} aria-label="Filter by status" style={{ maxWidth: 200 }}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <button className="ch247-button ch247-button--outline" type="submit" disabled={busy !== ''}>Refresh</button>
        </form>

        {cases === null ? (
          <p className="ch247-page__hint">Loading broker cases…</p>
        ) : cases.length === 0 ? (
          <p className="ch247-page__hint">No broker cases match.</p>
        ) : (
          <div className="ch247-table-wrap" style={{ marginTop: '0.75rem' }}>
            <table className="ch247-table">
              <thead><tr><th>Case</th><th>Domain</th><th>Customer</th><th>Status</th><th>Offer</th><th>Payment</th><th>Transfer</th><th>Updated</th><th></th></tr></thead>
              <tbody>
                {cases.map((row) => (
                  <tr key={row.id}>
                    <td>{row.brokerage_id}</td>
                    <td style={{ wordBreak: 'break-all' }}>{row.domain}</td>
                    <td>{row.customer_email}</td>
                    <td><StatusChip status={row.status} /></td>
                    <td>{row.current_offer ? formatPrice(row.current_offer, row.currency) : '—'}</td>
                    <td>{row.payment_status.replace(/_/g, ' ')}</td>
                    <td>{row.transfer_status.replace(/_/g, ' ')}</td>
                    <td>{formatDateTime(row.updated_at)}</td>
                    <td>
                      <button
                        className="ch247-button ch247-button--small"
                        type="button"
                        onClick={() => loadDetail(row.id)}
                        aria-label={`Manage broker case ${row.brokerage_id}`}
                      >
                        Manage
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {error && <p className="ch247-banner ch247-banner--error" role="alert" style={{ marginTop: '1rem' }}>{error}</p>}
      {notice && <p className="ch247-banner ch247-banner--info" role="status" style={{ marginTop: '1rem' }}>{notice}</p>}

      {selected && (
        <>
          <SectionCard
            title={`Case ${selected.case.brokerage_id} — ${selected.case.domain}`}
            style={{ marginTop: '1rem' }}
            actions={
              <button className="ch247-button ch247-button--outline" type="button" onClick={() => setSelected(null)}>
                Close
              </button>
            }
          >
            <dl className="ch247-dsvc-facts">
              <div className="ch247-dsvc-fact"><dt>Customer</dt><dd>{selected.case.customer_name} ({selected.case.customer_email})</dd></div>
              <div className="ch247-dsvc-fact"><dt>Status</dt><dd><StatusChip status={selected.case.status} /></dd></div>
              <div className="ch247-dsvc-fact"><dt>Max budget</dt><dd>{formatPrice(selected.case.max_budget, selected.case.currency)}</dd></div>
              <div className="ch247-dsvc-fact"><dt>Assigned broker</dt><dd>{selected.case.broker_email ?? '—'}</dd></div>
              <div className="ch247-dsvc-fact"><dt>Contact</dt><dd>{selected.case.contact_information}</dd></div>
              <div className="ch247-dsvc-fact"><dt>Opened</dt><dd>{formatDateTime(selected.case.created_at)}</dd></div>
            </dl>
            {selected.case.customer_message && <p className="ch247-page__hint">Customer message: {selected.case.customer_message}</p>}
            {selected.case.negotiation_instructions && <p className="ch247-page__hint">Negotiation instructions: {selected.case.negotiation_instructions}</p>}
          </SectionCard>

          <SectionCard title="Workflow status" style={{ marginTop: '1rem' }}>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void runAction(
                  'status',
                  () => apiFetch(`/api/v1/admin/domain-brokerage/cases/${selected.case.id}/status`, {
                    method: 'PATCH',
                    body: JSON.stringify({ status: statusForm.status, note: statusForm.note || undefined }),
                  }),
                  'Case status updated.'
                );
              }}
              style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
            >
              <label>New status
                <select style={{ width: '100%' }} value={statusForm.status} onChange={(event) => setStatusForm({ ...statusForm, status: event.target.value })}>
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>{(selected.statusLabels[status]) ?? status.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </label>
              <label>Internal note (optional)
                <input style={{ width: '100%' }} value={statusForm.note} maxLength={1000} onChange={(event) => setStatusForm({ ...statusForm, note: event.target.value })} placeholder="Recorded as an internal note" />
              </label>
              <div style={{ alignSelf: 'end' }}>
                <button className="ch247-button" type="submit" disabled={busy === 'status'}>Update status</button>
              </div>
            </form>
          </SectionCard>

          <SectionCard title="Offers & negotiation" style={{ marginTop: '1rem' }}>
            {selected.offers.length > 0 && (
              <div className="ch247-table-wrap" style={{ marginBottom: '1rem' }}>
                <table className="ch247-table">
                  <thead><tr><th>Amount</th><th>From</th><th>To</th><th>Status</th><th>Recorded</th></tr></thead>
                  <tbody>
                    {selected.offers.map((offer) => (
                      <tr key={offer.id}>
                        <td>{formatPrice(offer.amount, offer.currency)}</td>
                        <td>{offer.sender_type}</td>
                        <td>{offer.recipient_type}</td>
                        <td><StatusChip status={offer.status} /></td>
                        <td>{formatDateTime(offer.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void runAction(
                  'offer',
                  () => apiFetch(`/api/v1/admin/domain-brokerage/cases/${selected.case.id}/offers`, {
                    method: 'POST',
                    body: JSON.stringify({
                      amount: numberField(offerForm.amount),
                      currency: offerForm.currency,
                      senderType: offerForm.senderType,
                      recipientType: offerForm.recipientType,
                    }),
                  }),
                  'Offer recorded and the customer notified.'
                );
              }}
              style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}
            >
              <label>Amount<input required inputMode="decimal" style={{ width: '100%' }} value={offerForm.amount} onChange={(event) => setOfferForm({ ...offerForm, amount: event.target.value })} placeholder="16000.00" /></label>
              <label>Currency<input required maxLength={3} style={{ width: '100%' }} value={offerForm.currency} onChange={(event) => setOfferForm({ ...offerForm, currency: event.target.value.toUpperCase() })} /></label>
              <label>From
                <select style={{ width: '100%' }} value={offerForm.senderType} onChange={(event) => setOfferForm({ ...offerForm, senderType: event.target.value })}>
                  <option value="seller">Seller</option>
                  <option value="broker">Broker</option>
                  <option value="provider">Provider</option>
                </select>
              </label>
              <label>To
                <select style={{ width: '100%' }} value={offerForm.recipientType} onChange={(event) => setOfferForm({ ...offerForm, recipientType: event.target.value })}>
                  <option value="customer">Customer</option>
                  <option value="seller">Seller</option>
                  <option value="broker">Broker</option>
                </select>
              </label>
              <div style={{ alignSelf: 'end' }}>
                <button className="ch247-button" type="submit" disabled={busy === 'offer' || !offerForm.amount.trim()}>Record offer</button>
              </div>
            </form>
            <p className="ch247-page__hint">Recording a new offer supersedes any still-open offer, so the customer can only ever accept the live one.</p>
          </SectionCard>

          <SectionCard title="Fees & payment" style={{ marginTop: '1rem' }}>
            {selected.payment && (
              <p className="ch247-page__hint">
                Current: acquisition {formatPrice(selected.payment.acquisition_amount, selected.payment.currency)} + broker fee{' '}
                {formatPrice(selected.payment.brokerage_fee, selected.payment.currency)} + transfer fee{' '}
                {formatPrice(selected.payment.transfer_fee, selected.payment.currency)} + payment fee{' '}
                {formatPrice(selected.payment.payment_fee, selected.payment.currency)} ={' '}
                <strong>{formatPrice(selected.payment.total_amount, selected.payment.currency)}</strong> ({selected.payment.status}).
              </p>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void runAction(
                  'payment',
                  () => apiFetch(`/api/v1/admin/domain-brokerage/cases/${selected.case.id}/payment`, {
                    method: 'PUT',
                    body: JSON.stringify({
                      acquisitionAmount: numberField(paymentForm.acquisitionAmount),
                      brokerageFee: numberField(paymentForm.brokerageFee),
                      transferFee: numberField(paymentForm.transferFee),
                      paymentFee: numberField(paymentForm.paymentFee),
                      currency: paymentForm.currency,
                      status: paymentForm.status,
                    }),
                  }),
                  'Payment record saved (total computed server-side).'
                );
              }}
              style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}
            >
              <label>Acquisition<input required inputMode="decimal" style={{ width: '100%' }} value={paymentForm.acquisitionAmount} onChange={(event) => setPaymentForm({ ...paymentForm, acquisitionAmount: event.target.value })} placeholder="16000.00" /></label>
              <label>Broker fee<input inputMode="decimal" style={{ width: '100%' }} value={paymentForm.brokerageFee} onChange={(event) => setPaymentForm({ ...paymentForm, brokerageFee: event.target.value })} placeholder="0.00" /></label>
              <label>Transfer fee<input inputMode="decimal" style={{ width: '100%' }} value={paymentForm.transferFee} onChange={(event) => setPaymentForm({ ...paymentForm, transferFee: event.target.value })} placeholder="0.00" /></label>
              <label>Payment fee<input inputMode="decimal" style={{ width: '100%' }} value={paymentForm.paymentFee} onChange={(event) => setPaymentForm({ ...paymentForm, paymentFee: event.target.value })} placeholder="0.00" /></label>
              <label>Currency<input required maxLength={3} style={{ width: '100%' }} value={paymentForm.currency} onChange={(event) => setPaymentForm({ ...paymentForm, currency: event.target.value.toUpperCase() })} /></label>
              <label>Status
                <select style={{ width: '100%' }} value={paymentForm.status} onChange={(event) => setPaymentForm({ ...paymentForm, status: event.target.value })}>
                  {['pending', 'initiated', 'authorized', 'paid', 'failed', 'refunded', 'cancelled'].map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </label>
              <div style={{ alignSelf: 'end' }}>
                <button className="ch247-button" type="submit" disabled={busy === 'payment' || !paymentForm.acquisitionAmount.trim()}>Save payment</button>
              </div>
            </form>
          </SectionCard>

          <SectionCard title="Acquisition transfer" style={{ marginTop: '1rem' }}>
            {selected.transfer && (
              <p className="ch247-page__hint">
                Current: {selected.transfer.status.replace(/_/g, ' ')}
                {selected.transfer.registrar ? ` at ${selected.transfer.registrar}` : ''}
                {selected.transfer.provider_reference ? ` (ref ${selected.transfer.provider_reference})` : ''}
                {selected.transfer.completed_at ? ` — completed ${formatDateTime(selected.transfer.completed_at)}` : ''}
                {selected.transfer.failure_reason ? ` — ${selected.transfer.failure_reason}` : ''}
              </p>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void runAction(
                  'transfer',
                  () => apiFetch(`/api/v1/admin/domain-brokerage/cases/${selected.case.id}/transfer`, {
                    method: 'PUT',
                    body: JSON.stringify({
                      status: transferForm.status,
                      registrar: transferForm.registrar || undefined,
                      providerReference: transferForm.providerReference || undefined,
                      failureReason: transferForm.failureReason || undefined,
                    }),
                  }),
                  'Transfer record saved.'
                );
              }}
              style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}
            >
              <label>Status
                <select style={{ width: '100%' }} value={transferForm.status} onChange={(event) => setTransferForm({ ...transferForm, status: event.target.value })}>
                  {['not_started', 'authorization_required', 'initiated', 'processing', 'verified', 'failed'].map((status) => (
                    <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </label>
              <label>Registrar<input style={{ width: '100%' }} value={transferForm.registrar} onChange={(event) => setTransferForm({ ...transferForm, registrar: event.target.value })} /></label>
              <label>Provider reference<input style={{ width: '100%' }} value={transferForm.providerReference} onChange={(event) => setTransferForm({ ...transferForm, providerReference: event.target.value })} /></label>
              <label>Failure reason<input style={{ width: '100%' }} value={transferForm.failureReason} onChange={(event) => setTransferForm({ ...transferForm, failureReason: event.target.value })} /></label>
              <div style={{ alignSelf: 'end' }}>
                <button className="ch247-button" type="submit" disabled={busy === 'transfer'}>Save transfer</button>
              </div>
            </form>
          </SectionCard>

          <SectionCard title="Notes & communication" style={{ marginTop: '1rem' }}>
            {selected.messages.length > 0 && (
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1rem', display: 'grid', gap: '0.5rem' }}>
                {selected.messages.map((message) => (
                  <li key={message.id} style={{ borderBottom: '1px solid var(--ch247-border, #e2e8f0)', paddingBottom: '0.5rem' }}>
                    <small>
                      <strong>{message.visibility === 'internal' ? '🔒 Internal' : '👤 Customer-visible'}</strong>
                      {message.author_email ? ` · ${message.author_email}` : ''} · {formatDateTime(message.created_at)}
                    </small>
                    <div>{message.body}</div>
                  </li>
                ))}
              </ul>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void runAction(
                  'message',
                  () => apiFetch(`/api/v1/admin/domain-brokerage/cases/${selected.case.id}/messages`, {
                    method: 'POST',
                    body: JSON.stringify({ body: messageForm.body, visibility: messageForm.visibility }),
                  }),
                  messageForm.visibility === 'customer' ? 'Message posted and the customer notified.' : 'Internal note recorded.'
                ).then(() => setMessageForm({ ...messageForm, body: '' }));
              }}
              style={{ display: 'grid', gap: '0.75rem' }}
            >
              <label>Message
                <textarea required style={{ width: '100%' }} rows={3} maxLength={10000} value={messageForm.body} onChange={(event) => setMessageForm({ ...messageForm, body: event.target.value })} />
              </label>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <input type="radio" name="msg-visibility" checked={messageForm.visibility === 'internal'} onChange={() => setMessageForm({ ...messageForm, visibility: 'internal' })} /> Internal note (staff only)
                </label>
                <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <input type="radio" name="msg-visibility" checked={messageForm.visibility === 'customer'} onChange={() => setMessageForm({ ...messageForm, visibility: 'customer' })} /> Customer message
                </label>
                <button className="ch247-button" type="submit" disabled={busy === 'message' || !messageForm.body.trim()}>Post</button>
              </div>
            </form>
          </SectionCard>

          <SectionCard title="Timeline" style={{ marginTop: '1rem' }}>
            <div className="ch247-table-wrap">
              <table className="ch247-table">
                <thead><tr><th>Event</th><th>Result</th><th>When</th></tr></thead>
                <tbody>
                  {selected.timeline.map((eventRow, index) => (
                    <tr key={index}>
                      <td>{eventRow.event_type.replace(/_/g, ' ')}</td>
                      <td>{eventRow.result}</td>
                      <td>{formatDateTime(eventRow.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </>
      )}
    </>
  );
}
