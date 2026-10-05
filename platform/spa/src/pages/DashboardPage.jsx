import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { accountApi, authApi, billingApi } from '../lib/api.js';
import { useAuth } from '../lib/useAuth.jsx';
import { formatDate, formatMoney, invoiceBalance } from '../lib/format.js';

function Stat({ label, value, hint }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {hint ? <span className="stat-label small">{hint}</span> : null}
    </div>
  );
}

const inDays = (iso, days) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return t >= Date.now() && t <= Date.now() + days * 86400000;
};

export default function DashboardPage() {
  const { user } = useAuth();
  const [services, setServices] = useState(null);
  const [domains, setDomains] = useState(null);
  const [tickets, setTickets] = useState(null);
  const [invoices, setInvoices] = useState(null);
  const [subscriptions, setSubscriptions] = useState(null);
  const [mfa, setMfa] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [s, d, t, inv, subs, m] = await Promise.allSettled([
        accountApi.services(),
        accountApi.domains(),
        accountApi.tickets(),
        billingApi.invoices(),
        billingApi.subscriptions(),
        authApi.mfaStatus(),
      ]);
      if (!alive) return;
      setServices(s.status === 'fulfilled' ? s.value.services : []);
      setDomains(d.status === 'fulfilled' ? d.value.domains : []);
      setTickets(t.status === 'fulfilled' ? t.value.tickets : []);
      setInvoices(inv.status === 'fulfilled' ? inv.value.invoices : []);
      setSubscriptions(subs.status === 'fulfilled' ? subs.value.subscriptions : []);
      setMfa(m.status === 'fulfilled' ? m.value : null);
    })();
    return () => { alive = false; };
  }, []);

  const openTickets = tickets?.filter((t) => t.status !== 'closed') ?? [];
  const unpaid = (invoices ?? []).filter((i) => invoiceBalance(i) > 0);
  const balance = unpaid.reduce((sum, i) => sum + invoiceBalance(i), 0);
  const renewals = (services ?? []).filter((s) => inDays(s.nextDueDate, 30));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p className="muted">
            Welcome back, {user?.fullName}. Customer ID <code>{user?.customerId ?? '—'}</code>
          </p>
        </div>
        {mfa && (
          <span className={`pill ${mfa.enabled ? 'pill-ok' : 'pill-warn'}`}>
            {mfa.enabled ? 'Two-factor on' : 'Two-factor off'}
          </span>
        )}
      </div>

      <div className="stats">
        <Stat label="Active services" value={services === null ? '…' : services.filter((s) => s.status === 'active').length} hint={services === null ? '' : `${services.length} total`} />
        <Stat label="Domains" value={domains?.length ?? '…'} />
        <Stat label="Open tickets" value={tickets === null ? '…' : openTickets.length} />
        <Stat label="Account balance" value={invoices === null ? '…' : formatMoney(balance)} hint={unpaid.length ? `${unpaid.length} unpaid invoice${unpaid.length > 1 ? 's' : ''}` : 'No unpaid invoices'} />
        <Stat label="Renewals (30 days)" value={services === null ? '…' : renewals.length} />
        <Stat label="Subscriptions" value={subscriptions?.length ?? '…'} />
      </div>

      <div className="grid-2">
        <section className="card">
          <h2>Your services</h2>
          {services === null ? <p className="muted">Loading…</p>
            : services.length === 0 ? <p className="muted">No services yet. <a href="/app/catalog">Browse products</a>.</p>
            : (
              <ul className="list">
                {services.slice(0, 6).map((s) => (
                  <li key={s.id}>
                    <span>
                      {s.label ?? s.package ?? s.domain ?? 'Service'}
                      {s.nextDueDate ? <span className="muted small"> · next due {formatDate(s.nextDueDate)}</span> : null}
                    </span>
                    <span className="row row-wrap" style={{ width: 'auto' }}>
                      <span className={`status status-${s.status}`}>{s.status}</span>
                      <Link className="linklike" to="/services">Manage</Link>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          <div className="row row-wrap">
            <Link className="btn btn-ghost" to="/services">View details</Link>
            <Link className="btn btn-primary" to="/catalog">Add a service</Link>
          </div>
        </section>

        <section className="card">
          <h2>Your domains</h2>
          {domains === null ? <p className="muted">Loading…</p>
            : domains.length === 0 ? <p className="muted">No domains yet. <Link to="/catalog">Register one</Link>.</p>
            : (
              <ul className="list">
                {domains.slice(0, 6).map((d) => (
                  <li key={d.id}>
                    <span>
                      {d.domain}
                      <span className="muted small">
                        {d.expiresAt ? ` · expires ${formatDate(d.expiresAt)}` : ''}
                        {` · auto-renew ${d.autoRenew ? 'on' : 'off'}`}
                      </span>
                    </span>
                    <span className={`status status-${d.status}`}>{d.status}</span>
                  </li>
                ))}
              </ul>
            )}
          <Link className="btn btn-ghost" to="/services">DNS &amp; nameservers</Link>
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <h2>Billing</h2>
          {invoices === null ? <p className="muted">Loading…</p>
            : invoices.length === 0 ? <p className="muted">No invoices yet.</p>
            : (
              <ul className="list">
                {invoices.slice(0, 5).map((i) => {
                  const bal = invoiceBalance(i);
                  return (
                    <li key={i.id}>
                      <span>
                        <Link to={`/billing/${encodeURIComponent(i.id)}`}>Invoice {i.number ?? i.id.slice(0, 8)}</Link>
                        <span className="muted small"> · {formatDate(i.issuedAt ?? i.createdAt)}</span>
                      </span>
                      <span>{bal > 0 ? formatMoney(bal, i.currency) : 'Paid'}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          <Link className="btn btn-ghost" to="/billing">Invoices &amp; payment methods</Link>
        </section>

        <section className="card">
          <h2>Support</h2>
          {tickets === null ? <p className="muted">Loading…</p>
            : openTickets.length === 0 ? <p className="muted">No open tickets.</p>
            : (
              <ul className="list">
                {openTickets.slice(0, 5).map((t) => (
                  <li key={t.id}>
                    <span>{t.subject}</span>
                    <span className={`status status-${t.status}`}>{t.status}</span>
                  </li>
                ))}
              </ul>
            )}
          <div className="row row-wrap">
            <Link className="btn btn-primary" to="/support">Open a ticket</Link>
            <a className="btn btn-ghost" href="/knowledgebase">Knowledgebase</a>
          </div>
        </section>
      </div>
    </div>
  );
}
