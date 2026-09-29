import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { listMyDomains, listMyServices, listMyTickets } from '../lib/account-api';
import type { CustomerDomain, CustomerService, TicketSummary } from '../lib/account-types';
import { fetchMyInstallations, type MyInstallation } from '../lib/marketplace-api';
import { usePageMeta } from '../lib/usePageMeta';
import StatusBadge from '../components/StatusBadge';

interface MeResponse {
  user: { id: string; email: string; fullName: string; role: string };
}

/**
 * The authenticated application shell's landing page. This route is wrapped in <RequireAuth />
 * (see App.tsx), so a signed-out visitor never reaches this component at all — they're redirected
 * to /login first.
 *
 * Phase 4: services, domains, and support tickets are now real, API-backed summaries (see
 * docs/API_CUSTOMER_APP.md) rather than placeholders. Billing/invoices remain an honest "not
 * available yet" notice — this platform has no payment/billing system, and Phase 4 explicitly
 * does not add one (see the non-goals list in docs/API_CUSTOMER_APP.md).
 */
export default function DashboardPage() {
  usePageMeta('Dashboard', 'Your CloudHost247 account overview.');
  const [me, setMe] = useState<MeResponse['user'] | null>(null);
  const [services, setServices] = useState<CustomerService[] | 'loading' | 'error'>('loading');
  const [domains, setDomains] = useState<CustomerDomain[] | 'loading' | 'error'>('loading');
  const [tickets, setTickets] = useState<TicketSummary[] | 'loading' | 'error'>('loading');
  const [installations, setInstallations] = useState<MyInstallation[] | 'loading' | 'error'>('loading');
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    apiFetch<MeResponse>('/api/auth/me')
      .then((res) => {
        if (!cancelled) setMe(res.user);
      })
      .catch(() => {
        // apiFetch already cleared any stale/invalid local session on a 401 (see lib/api.ts) —
        // send the visitor straight to login instead of showing a dead-end error state on a page
        // they can no longer use.
        if (!cancelled) navigate('/login', { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    let cancelled = false;
    listMyServices()
      .then((res) => !cancelled && setServices(res.services))
      .catch(() => !cancelled && setServices('error'));
    listMyDomains()
      .then((res) => !cancelled && setDomains(res.domains))
      .catch(() => !cancelled && setDomains('error'));
    listMyTickets()
      .then((res) => !cancelled && setTickets(res.tickets))
      .catch(() => !cancelled && setTickets('error'));
    fetchMyInstallations()
      .then((res) => !cancelled && setInstallations(res.installations))
      .catch(() => !cancelled && setInstallations('error'));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!me) {
    return (
      <div className="ch247-card">
        <p>Loading your account…</p>
      </div>
    );
  }

  const openTicketCount = Array.isArray(tickets) ? tickets.filter((t) => t.status !== 'closed').length : null;

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <h1>Welcome back, {me.fullName}</h1>
        <p>
          Signed in as <strong>{me.email}</strong> — role: {me.role}
        </p>
      </div>

      <div className="ch247-card">
        <h2>Hosting services</h2>
        {services === 'loading' && <p className="ch247-page__hint">Loading…</p>}
        {services === 'error' && <p className="ch247-status-error">Couldn&apos;t load your services right now.</p>}
        {Array.isArray(services) && services.length === 0 && (
          <p className="ch247-page__hint">No services have been added to your account yet.</p>
        )}
        {Array.isArray(services) && services.length > 0 && (
          <ul className="ch247-thread" style={{ margin: 0 }}>
            {services.slice(0, 3).map((service) => (
              <li key={service.id} className="ch247-inline-actions">
                <span>{service.label}</span>
                <StatusBadge status={service.status} />
              </li>
            ))}
          </ul>
        )}
        <p className="ch247-page__hint">
          <Link to="/services">View all services →</Link>
        </p>
      </div>

      <div className="ch247-card">
        <h2>My applications</h2>
        {installations === 'loading' && <p className="ch247-page__hint">Loading…</p>}
        {installations === 'error' && <p className="ch247-status-error">Couldn&apos;t load your applications right now.</p>}
        {Array.isArray(installations) && installations.length === 0 && (
          <p className="ch247-page__hint">
            No applications installed yet — browse the <Link to="/apps">App Marketplace</Link> to deploy your first one.
          </p>
        )}
        {Array.isArray(installations) && installations.length > 0 && (
          <ul className="ch247-thread" style={{ margin: 0 }}>
            {installations.slice(0, 4).map((installation) => (
              <li key={installation.id} className="ch247-inline-actions">
                <span>
                  {installation.application?.name ?? 'Application'} —{' '}
                  <Link to={`/dashboard/apps/${installation.id}`}>{installation.name}</Link>
                </span>
                <StatusBadge status={installation.status} />
              </li>
            ))}
          </ul>
        )}
        <p className="ch247-page__hint">
          <Link to="/dashboard/apps">View all applications →</Link>
        </p>
      </div>

      <div className="ch247-card">
        <h2>Billing &amp; invoices</h2>
        <p className="ch247-page__hint">
          Orders, invoices, and payment history live under Billing.
        </p>
        <p className="ch247-page__hint">
          <Link to="/billing">Go to Billing →</Link>
        </p>
      </div>

      <div className="ch247-card">
        <h2>Domains</h2>
        {domains === 'loading' && <p className="ch247-page__hint">Loading…</p>}
        {domains === 'error' && <p className="ch247-status-error">Couldn&apos;t load your domains right now.</p>}
        {Array.isArray(domains) && domains.length === 0 && (
          <p className="ch247-page__hint">No domains have been added to your account yet.</p>
        )}
        {Array.isArray(domains) && domains.length > 0 && (
          <ul className="ch247-thread" style={{ margin: 0 }}>
            {domains.slice(0, 3).map((domain) => (
              <li key={domain.id} className="ch247-inline-actions">
                <span>{domain.domainName}</span>
                <StatusBadge status={domain.status} />
              </li>
            ))}
          </ul>
        )}
        <p className="ch247-page__hint">
          <Link to="/account/domains">View all domains →</Link>
        </p>
      </div>

      <div className="ch247-card">
        <h2>Support</h2>
        {tickets === 'error' && <p className="ch247-status-error">Couldn&apos;t load your tickets right now.</p>}
        {typeof openTicketCount === 'number' && (
          <p>
            {openTicketCount === 0
              ? 'You have no open support tickets.'
              : `You have ${openTicketCount} open support ${openTicketCount === 1 ? 'ticket' : 'tickets'}.`}
          </p>
        )}
        <p className="ch247-page__hint">
          <Link to="/support">Go to Support →</Link>
        </p>
      </div>
    </div>
  );
}
