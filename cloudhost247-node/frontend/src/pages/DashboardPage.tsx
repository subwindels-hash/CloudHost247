import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { listMyDomains, listMyServices, listMyTickets } from '../lib/account-api';
import type { CustomerDomain, CustomerService, TicketSummary } from '../lib/account-types';
import { fetchMyInstallations, type MyInstallation } from '../lib/marketplace-api';
import { usePageMeta } from '../lib/usePageMeta';
import StatusBadge from '../components/StatusBadge';

/**
 * Counts for the platform services the customer has bought or can start. Deliberately a union with
 * 'error' rather than a number: a service whose API call failed shows "unavailable" — the dashboard
 * never displays a zero that would read as "you have nothing" when the truth is "we could not ask".
 */
type PlatformCount = number | 'error';

interface PlatformSummary {
  sites: PlatformCount;
  stores: PlatformCount;
  aiProjects: PlatformCount;
  logoProjects: PlatformCount;
  campaigns: PlatformCount;
  expertRequests: PlatformCount;
  conversations: PlatformCount;
  cartItems: PlatformCount;
}

/** Runs one of the platform list endpoints and returns how many rows it holds, or 'error'. */
function countFrom<T>(path: string, pick: (response: T) => unknown[]): Promise<PlatformCount> {
  return apiFetch<T>(path)
    .then((response) => pick(response).length)
    .catch(() => 'error' as const);
}

const platformTiles: Array<{
  key: keyof PlatformSummary;
  label: string;
  to: string;
  hint: string;
  empty: string;
}> = [
  { key: 'sites', label: 'Websites', to: '/websites/builder', hint: 'Builder sites you own', empty: 'Start a site in the Website Builder' },
  { key: 'aiProjects', label: 'AI website drafts', to: '/websites/ai-builder', hint: 'Generated from a description', empty: 'Generate a site from a prompt' },
  { key: 'stores', label: 'Online stores', to: '/websites/store', hint: 'Physical, digital and service products', empty: 'Open your first store' },
  { key: 'logoProjects', label: 'Logo projects', to: '/marketing/logo-maker', hint: 'Vector marks you can export', empty: 'Design a logo' },
  { key: 'campaigns', label: 'Marketing campaigns', to: '/marketing', hint: 'Managed campaigns and reports', empty: 'Request a managed campaign' },
  { key: 'expertRequests', label: 'Expert requests', to: '/websites/experts', hint: 'Design and build work you ordered', empty: 'Hire a specialist' },
  { key: 'conversations', label: 'Inbox conversations', to: '/marketing/inbox', hint: 'Messages from you and your sites', empty: 'Nothing waiting for you' },
  { key: 'cartItems', label: 'Cart', to: '/cart', hint: 'Items waiting for checkout', empty: 'Your cart is empty' },
];

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
  const [platform, setPlatform] = useState<PlatformSummary | null>(null);
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

    // Each platform service is asked independently, so one slow or failing endpoint never blanks
    // the whole dashboard — the affected tile says "unavailable" and the rest stay real.
    void Promise.all([
      countFrom<{ sites: unknown[] }>('/api/v1/builder/sites', (r) => r.sites),
      countFrom<{ stores: unknown[] }>('/api/v1/store/stores', (r) => r.stores),
      countFrom<{ projects: unknown[] }>('/api/v1/ai-builder/projects', (r) => r.projects),
      countFrom<{ projects: unknown[] }>('/api/v1/logo-maker/projects', (r) => r.projects),
      countFrom<{ campaigns: unknown[] }>('/api/v1/marketing-services/campaigns', (r) => r.campaigns),
      countFrom<{ requests: unknown[] }>('/api/v1/experts/requests', (r) => r.requests),
      countFrom<{ conversations: unknown[] }>('/api/v1/inbox/my-conversations', (r) => r.conversations),
      apiFetch<{ cart: { itemCount: number } | null }>('/api/v1/cart')
        .then((r) => r.cart?.itemCount ?? 0)
        .catch(() => 'error' as const),
    ]).then(([sites, stores, aiProjects, logoProjects, campaigns, expertRequests, conversations, cartItems]) => {
      if (cancelled) return;
      setPlatform({ sites, stores, aiProjects, logoProjects, campaigns, expertRequests, conversations, cartItems });
    });

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
        <h2>Your platform services</h2>
        <p className="ch247-page__hint">
          Everything here is part of your CLOUDHOST247 account. Counts are read live from each
          service; a tile that says “unavailable” could not be reached just now.
        </p>
        <ul className="ch247-service-grid">
          {platformTiles.map((tile) => {
            const value = platform ? platform[tile.key] : undefined;
            const count = typeof value === 'number' ? value : null;
            return (
              <li key={tile.key} className="ch247-service-tile">
                <Link to={tile.to} className="ch247-service-tile__link">
                  <span className="ch247-service-tile__label">{tile.label}</span>
                  <span className="ch247-service-tile__count">
                    {value === undefined ? '…' : value === 'error' ? 'unavailable' : count === 0 ? 'None yet' : `${count}`}
                  </span>
                </Link>
                <span className="ch247-service-tile__hint">{count === 0 ? tile.empty : tile.hint}</span>
              </li>
            );
          })}
        </ul>
        <p className="ch247-page__hint">
          Need something built for you? <Link to="/websites/experts">Hire an expert</Link> or start
          from the <Link to="/websites/templates">template gallery</Link>.
        </p>
      </div>
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
