import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { usePageMeta } from '../lib/usePageMeta';

interface MeResponse {
  user: { id: string; email: string; fullName: string; role: string };
}

/**
 * The authenticated application shell's landing page. This route is wrapped in <RequireAuth />
 * (see App.tsx), so a signed-out visitor never reaches this component at all — they're redirected
 * to /login first. What's rendered here is real, server-verified account identity (via
 * /api/auth/me) plus honest "not built yet" notices for every feature area that doesn't have real
 * data behind it yet. Nothing on this page is fabricated: no invoices, balances, hosting services,
 * orders, or provisioning records exist in this system yet, so none are shown.
 */
export default function DashboardPage() {
  usePageMeta('Dashboard', 'Your CloudHost247 account overview.');
  const [me, setMe] = useState<MeResponse['user'] | null>(null);
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

  if (!me) {
    return (
      <div className="ch247-card">
        <p>Loading your account…</p>
      </div>
    );
  }

  return (
    <div>
      <section className="ch247-card">
        <h1>Welcome back, {me.fullName}</h1>
        <p>
          Signed in as <strong>{me.email}</strong> — role: {me.role}
        </p>
      </section>

      <section className="ch247-card">
        <h2>Hosting services</h2>
        <p className="ch247-placeholder-notice">
          Service provisioning hasn't been migrated to this platform yet, so no services are listed
          here. Your existing hosting continues to run unaffected, managed through the current
          client area, until this feature ships on this platform.
        </p>
      </section>

      <section className="ch247-card">
        <h2>Billing &amp; invoices</h2>
        <p className="ch247-placeholder-notice">
          Billing and invoicing haven't been migrated to this platform yet — this app has no
          connection to real billing data, so no balance, invoice, or payment history is shown
          here rather than an invented one. Use the current client area for billing.
        </p>
      </section>

      <section className="ch247-card">
        <h2>Domains</h2>
        <p className="ch247-placeholder-notice">
          Domain management hasn't been migrated to this platform yet. See{' '}
          <Link to="/account/domains">My Domains</Link> for the current status of this feature.
        </p>
      </section>
    </div>
  );
}
