import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AuthFrame from '../components/AuthFrame';
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
      <AuthFrame
        title="Verification link unavailable"
        lede="The link that brought you here has no verification token, so there is nothing to confirm."
        points={['Verification links expire', 'A new link can be requested from the account page']}
      >
        <p className="ch247-status-error" role="alert">
          This verification link is missing its token. Log in to request a new link.
        </p>
        <div className="ch247-auth__links">
          <Link to="/login">Go to login</Link>
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      title="Verify your email address"
      lede="Confirm that you want to verify this email address for your CloudHost247 account."
      points={['Confirming uses the link once', 'Nothing else on the account changes']}
      asideTitle="Why we ask"
      asideNotes={[
        { title: 'Account recovery', body: 'A verified address is the one address we will use for password resets and service notices.' },
        { title: 'No automatic opens', body: 'The link is only used when you press the button, so a mail scanner cannot use it for you.' },
      ]}
    >
      {message && (
        <p role="alert" className="ch247-status-error">{message.text}</p>
      )}
      <button type="button" className="ch247-auth__submit" onClick={verify} disabled={submitting}>
        {submitting ? 'Verifying…' : 'Verify email address'}
      </button>
      <div className="ch247-auth__links">
        <Link to="/login">Back to login</Link>
      </div>
    </AuthFrame>
  );
}
