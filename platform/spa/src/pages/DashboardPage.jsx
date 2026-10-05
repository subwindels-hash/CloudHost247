import React, { useEffect, useState } from 'react';
import { accountApi, authApi } from '../lib/api.js';
import { useAuth } from '../lib/useAuth.jsx';

function Stat({ label, value }) {
  return (
    <div className="stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [services, setServices] = useState(null);
  const [domains, setDomains] = useState(null);
  const [tickets, setTickets] = useState(null);
  const [mfa, setMfa] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [s, d, t, m] = await Promise.allSettled([
        accountApi.services(),
        accountApi.domains(),
        accountApi.tickets(),
        authApi.mfaStatus(),
      ]);
      if (!alive) return;
      setServices(s.status === 'fulfilled' ? s.value.services : []);
      setDomains(d.status === 'fulfilled' ? d.value.domains : []);
      setTickets(t.status === 'fulfilled' ? t.value.tickets : []);
      setMfa(m.status === 'fulfilled' ? m.value : null);
    })();
    return () => {
      alive = false;
    };
  }, []);

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
        <Stat label="Services" value={services?.length ?? '…'} />
        <Stat label="Domains" value={domains?.length ?? '…'} />
        <Stat label="Open tickets" value={tickets?.filter((t) => t.status !== 'closed').length ?? '…'} />
      </div>

      <div className="grid-2">
        <section className="card">
          <h2>Your services</h2>
          {services === null ? <p className="muted">Loading…</p>
            : services.length === 0 ? <p className="muted">No services yet. <a href="/app/catalog">Browse products</a>.</p>
            : (
              <ul className="list">
                {services.map((s) => (
                  <li key={s.id}>
                    <span>{s.label ?? s.package ?? s.domain ?? 'Service'}</span>
                    <span className={`status status-${s.status}`}>{s.status}</span>
                  </li>
                ))}
              </ul>
            )}
        </section>

        <section className="card">
          <h2>Your domains</h2>
          {domains === null ? <p className="muted">Loading…</p>
            : domains.length === 0 ? <p className="muted">No domains yet.</p>
            : (
              <ul className="list">
                {domains.map((d) => (
                  <li key={d.id}>
                    <span>{d.domain}</span>
                    <span className={`status status-${d.status}`}>{d.status}</span>
                  </li>
                ))}
              </ul>
            )}
        </section>
      </div>

      <section className="card">
        <h2>Recent tickets</h2>
        {tickets === null ? <p className="muted">Loading…</p>
          : tickets.length === 0 ? <p className="muted">No tickets yet.</p>
          : (
            <ul className="list">
              {tickets.slice(0, 5).map((t) => (
                <li key={t.id}>
                  <span>{t.subject}</span>
                  <span className={`status status-${t.status}`}>{t.status}</span>
                </li>
              ))}
            </ul>
          )}
        <a className="btn btn-primary" href="/app/support">Open support</a>
      </section>
    </div>
  );
}
