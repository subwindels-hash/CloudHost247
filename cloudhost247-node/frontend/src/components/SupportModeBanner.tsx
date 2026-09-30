import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { endSupportSession } from '../lib/account-api';
import {
  clearSupportOrigin,
  getSupportOrigin,
  setSession,
  subscribeToAuthChanges,
  type SupportOrigin,
} from '../lib/auth';
import type { SupportSessionContext } from '../lib/account-types';

/**
 * Persistent, unmissable indicator shown for the entire duration of an administrator's support
 * session inside a customer account (spec §37).
 *
 * It is rendered from the application shell, not from individual pages, so it cannot be escaped
 * by navigating somewhere else, and the "in support mode" fact is taken from the *server*
 * (/api/auth/me reports the delegated session it re-validated) rather than from local state that
 * a stale tab could get wrong.
 */
export default function SupportModeBanner() {
  const [origin, setOrigin] = useState<SupportOrigin | null>(() => getSupportOrigin());
  const [session, setSessionContext] = useState<SupportSessionContext | null>(null);
  const [ending, setEnding] = useState(false);
  const navigate = useNavigate();

  const refresh = useCallback(() => {
    const stored = getSupportOrigin();
    setOrigin(stored);
    if (!stored) {
      setSessionContext(null);
      return;
    }
    apiFetch<{ supportSession: SupportSessionContext | null }>('/api/auth/me')
      .then((res) => setSessionContext(res.supportSession))
      .catch(() => setSessionContext(null));
  }, []);

  useEffect(() => {
    refresh();
    return subscribeToAuthChanges(refresh);
  }, [refresh]);

  async function exitSupportMode() {
    if (!origin) return;
    setEnding(true);
    try {
      // Ends the session server-side first: that alone invalidates the delegated token, so even
      // if restoring the admin session below failed, the impersonation is already over.
      await endSupportSession(origin.sessionId);
    } catch {
      // Already ended or expired — continue restoring the administrator's own session.
    } finally {
      setSession(origin.token, origin.user);
      clearSupportOrigin();
      setEnding(false);
      navigate('/admin');
    }
  }

  if (!origin || !session) return null;

  return (
    <div className="ch247-support-banner" role="alert" aria-live="assertive" data-testid="support-mode-banner">
      <strong>Support mode.</strong> You are signed in as{' '}
      <strong>{origin.targetName}</strong>
      {origin.targetCustomerId ? ` (Customer ID ${origin.targetCustomerId})` : ''} on behalf of your administrator
      account. Sensitive actions — password changes, Security Number access, account deletion — are
      blocked, and everything you do here is audited. Session ends{' '}
      {new Date(session.expiresAt).toLocaleTimeString()}.
      <button type="button" className="ch247-button ch247-button--outline" onClick={exitSupportMode} disabled={ending}>
        {ending ? 'Exiting…' : 'Exit support mode'}
      </button>
    </div>
  );
}
