import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { SectionCard, StatusChip, formatDateTime, formatPrice } from './domain-services/ui';

/**
 * Super Admin / staff activity oversight for Domain Services (spec §15): registrations,
 * appraisals, WHOIS/RDAP lookups and the domain transaction ledger — all read-only views of the
 * real tables, scoped through the staff-gated admin endpoints.
 */

interface AdminRegistrationRow {
  id: string;
  domain_name: string;
  registration_years: number;
  status: string;
  provider_reference: string | null;
  error_code: string | null;
  customer_email: string;
  invoice_number: string | null;
  invoice_status: string | null;
  created_at: string;
}

interface AdminAppraisalRow {
  id: string;
  domain_name: string;
  status: string;
  estimated_value: string | null;
  currency: string | null;
  confidence: string | null;
  error_code: string | null;
  customer_email: string;
  created_at: string;
}

interface AdminWhoisRow {
  id: string;
  domain_name: string;
  source: string;
  status: string;
  privacy_protected: boolean;
  customer_email: string | null;
  created_at: string;
}

interface AdminTransactionRow {
  id: string;
  transaction_type: string;
  status: string;
  amount: string;
  currency: string;
  provider_reference: string | null;
  error_code: string | null;
  customer_email: string;
  invoice_number: string | null;
  created_at: string;
}

export default function AdminDomainActivitySection() {
  const [registrations, setRegistrations] = useState<AdminRegistrationRow[] | null>(null);
  const [appraisals, setAppraisals] = useState<AdminAppraisalRow[] | null>(null);
  const [lookups, setLookups] = useState<AdminWhoisRow[] | null>(null);
  const [transactions, setTransactions] = useState<AdminTransactionRow[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    apiFetch<{ registrations: AdminRegistrationRow[] }>('/api/v1/admin/domain-services/registrations')
      .then((r) => setRegistrations(r.registrations ?? []))
      .catch((err: Error) => { setError(err.message); setRegistrations([]); });
    apiFetch<{ appraisals: AdminAppraisalRow[] }>('/api/v1/admin/domain-services/appraisals')
      .then((r) => setAppraisals(r.appraisals ?? []))
      .catch(() => setAppraisals([]));
    apiFetch<{ lookups: AdminWhoisRow[] }>('/api/v1/admin/domain-services/whois-lookups')
      .then((r) => setLookups(r.lookups ?? []))
      .catch(() => setLookups([]));
    apiFetch<{ transactions: AdminTransactionRow[] }>('/api/v1/admin/domain-services/transactions')
      .then((r) => setTransactions(r.transactions ?? []))
      .catch(() => setTransactions([]));
  }, []);

  useEffect(() => {
    if (registrations === null) load();
  }, [registrations, load]);

  return (
    <>
      {error && <p className="ch247-banner ch247-banner--error" role="alert">{error}</p>}

      <SectionCard title="Registrations (latest 100)" actions={<button className="ch247-button ch247-button--outline" type="button" onClick={load}>Refresh</button>}>
        {registrations === null ? (
          <p className="ch247-page__hint">Loading registrations…</p>
        ) : registrations.length === 0 ? (
          <p className="ch247-page__hint">No registrations yet.</p>
        ) : (
          <div className="ch247-table-wrap">
            <table className="ch247-table">
              <thead><tr><th>Domain</th><th>Customer</th><th>Term</th><th>Status</th><th>Invoice</th><th>Provider ref</th><th>Requested</th></tr></thead>
              <tbody>
                {registrations.map((row) => (
                  <tr key={row.id}>
                    <td style={{ wordBreak: 'break-all' }}>{row.domain_name}</td>
                    <td>{row.customer_email}</td>
                    <td>{row.registration_years}y</td>
                    <td><StatusChip status={row.status} />{row.error_code ? <small style={{ display: 'block' }}>{row.error_code}</small> : null}</td>
                    <td>{row.invoice_number ?? '—'}{row.invoice_status ? ` (${row.invoice_status})` : ''}</td>
                    <td>{row.provider_reference ?? '—'}</td>
                    <td>{formatDateTime(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Appraisals (latest 100)" style={{ marginTop: '1rem' }}>
        {appraisals === null ? (
          <p className="ch247-page__hint">Loading appraisals…</p>
        ) : appraisals.length === 0 ? (
          <p className="ch247-page__hint">No appraisals yet.</p>
        ) : (
          <div className="ch247-table-wrap">
            <table className="ch247-table">
              <thead><tr><th>Domain</th><th>Customer</th><th>Status</th><th>Estimate</th><th>Confidence</th><th>Requested</th></tr></thead>
              <tbody>
                {appraisals.map((row) => (
                  <tr key={row.id}>
                    <td style={{ wordBreak: 'break-all' }}>{row.domain_name}</td>
                    <td>{row.customer_email}</td>
                    <td><StatusChip status={row.status} />{row.error_code ? <small style={{ display: 'block' }}>{row.error_code}</small> : null}</td>
                    <td>{row.estimated_value ? formatPrice(row.estimated_value, row.currency ?? 'USD') : '—'}</td>
                    <td>{row.confidence ?? '—'}</td>
                    <td>{formatDateTime(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="WHOIS / RDAP lookups (latest 100)" style={{ marginTop: '1rem' }}>
        {lookups === null ? (
          <p className="ch247-page__hint">Loading lookups…</p>
        ) : lookups.length === 0 ? (
          <p className="ch247-page__hint">No lookups yet.</p>
        ) : (
          <div className="ch247-table-wrap">
            <table className="ch247-table">
              <thead><tr><th>Domain</th><th>Customer</th><th>Source</th><th>Status</th><th>Privacy</th><th>When</th></tr></thead>
              <tbody>
                {lookups.map((row) => (
                  <tr key={row.id}>
                    <td style={{ wordBreak: 'break-all' }}>{row.domain_name}</td>
                    <td>{row.customer_email ?? 'Anonymous'}</td>
                    <td>{row.source.toUpperCase()}</td>
                    <td>{row.status.replace(/_/g, ' ')}</td>
                    <td>{row.privacy_protected ? 'Protected' : '—'}</td>
                    <td>{formatDateTime(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Domain transactions (latest 100)" style={{ marginTop: '1rem' }}>
        {transactions === null ? (
          <p className="ch247-page__hint">Loading transactions…</p>
        ) : transactions.length === 0 ? (
          <p className="ch247-page__hint">No domain transactions yet.</p>
        ) : (
          <div className="ch247-table-wrap">
            <table className="ch247-table">
              <thead><tr><th>Type</th><th>Customer</th><th>Amount</th><th>Status</th><th>Invoice</th><th>Provider ref</th><th>When</th></tr></thead>
              <tbody>
                {transactions.map((row) => (
                  <tr key={row.id}>
                    <td>{row.transaction_type.replace(/_/g, ' ')}</td>
                    <td>{row.customer_email}</td>
                    <td>{formatPrice(row.amount, row.currency)}</td>
                    <td><StatusChip status={row.status} />{row.error_code ? <small style={{ display: 'block' }}>{row.error_code}</small> : null}</td>
                    <td>{row.invoice_number ?? '—'}</td>
                    <td>{row.provider_reference ?? '—'}</td>
                    <td>{formatDateTime(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  );
}
