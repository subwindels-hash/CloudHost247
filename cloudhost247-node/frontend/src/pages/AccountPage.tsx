import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { clearSession } from '../lib/auth';
import { usePageMeta } from '../lib/usePageMeta';

interface MeResponse {
  user: { id: string; email: string; fullName: string; role: string; status: string };
}

/**
 * Minimal account/profile view. Shows real, server-verified identity only (via /api/auth/me) —
 * no profile editing, password change, or 2FA yet (those are explicitly out of scope for this
 * phase; see docs/NODE_PLATFORM_STATUS.md). Also provides a working, real "log out" action here
 * (in addition to the one in the header) since this is the page most likely to be the place a
 * visitor looks for it.
 */
export default function AccountPage() {
  usePageMeta('Account', 'Your CloudHost247 account details.');
  const [me, setMe] = useState<MeResponse['user'] | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    apiFetch<MeResponse>('/api/auth/me')
      .then((res) => {
        if (!cancelled) setMe(res.user);
      })
      .catch(() => {
        if (!cancelled) navigate('/login', { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Fall through — always clear the local session below even if the network call failed.
    } finally {
      clearSession();
      navigate('/');
    }
  }

  if (!me) {
    return (
      <div className="ch247-card">
        <p>Loading your account…</p>
      </div>
    );
  }

  return (
    <div className="ch247-card">
      <h1>Account</h1>
      <dl className="ch247-definition-list">
        <dt>Full name</dt>
        <dd>{me.fullName}</dd>
        <dt>Email</dt>
        <dd>{me.email}</dd>
        <dt>Role</dt>
        <dd>{me.role}</dd>
        <dt>Status</dt>
        <dd>{me.status}</dd>
      </dl>
      <p className="ch247-placeholder-notice">
        Editing your profile, changing your password, and two-factor authentication aren't
        available on this platform yet.
      </p>
      <button type="button" className="ch247-button ch247-button--outline" onClick={handleLogout} disabled={loggingOut}>
        {loggingOut ? 'Logging out…' : 'Log out of this device'}
      </button>
    </div>
  );
}
