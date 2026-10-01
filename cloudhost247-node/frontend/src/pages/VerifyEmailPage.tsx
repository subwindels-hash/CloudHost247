import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { usePageMeta } from '../lib/usePageMeta';

/** The verification request stays user-initiated: opening a mail-scanner URL cannot consume the
 * one-time credential before the customer consciously confirms it. */
export default function VerifyEmailPage() {
  usePageMeta('Verify your email', 'Confirm ownership of your CloudHost247 email address.');
  const location = useLocation();
  const navigate = useNavigate();
  const token = useMemo(() => new URLSearchParams(location.search).get('token') ?? '', [location.search]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function verify() {
    setSubmitting(true);
    setMessage(null);
    try {
      const result = await apiFetch<{ message: string }>('/api/auth/email-verification/confirm', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      // Remove the one-time bearer credential from browser history after it is consumed.
      navigate('/login', { replace: true, state: { recoveryMessage: result.message } });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not verify this email address.' });
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div className="ch247-card">
        <h1>Verification link unavailable</h1>
        <p className="ch247-status-error">This verification link is missing its token. Log in to request a new link.</p>
        <Link to="/login">Go to login</Link>
      </div>
    );
  }

  return (
    <div className="ch247-card">
      <h1>Verify your email address</h1>
      <p>Confirm that you want to verify this email address for your CloudHost247 account.</p>
      <button type="button" onClick={verify} disabled={submitting}>
        {submitting ? 'Verifying…' : 'Verify email address'}
      </button>
      {message && <p className={message.kind === 'ok' ? 'ch247-status-ok' : 'ch247-status-error'}>{message.text}</p>}
      <p><Link to="/login">Back to login</Link></p>
    </div>
  );
}
