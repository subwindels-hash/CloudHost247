import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { usePageMeta } from '../lib/usePageMeta';

/** Anonymous recovery request. The API always returns the same accepted response so this screen
 * never tells a visitor whether an email address has an active CloudHost247 account. */
export default function ForgotPasswordPage() {
  usePageMeta('Reset your password', 'Request a secure CloudHost247 password reset link.');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch<{ message: string }>('/api/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setComplete(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not process your request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="ch247-card">
      <h1>Reset your password</h1>
      {complete ? (
        <>
          <p className="ch247-status-ok">
            If an active account matches that email address, a password reset link will arrive shortly. Check your inbox
            and spam folder.
          </p>
          <p>
            <Link to="/login">Return to login</Link>
          </p>
        </>
      ) : (
        <form className="ch247-form" onSubmit={onSubmit}>
          <p className="ch247-page__hint">Enter your email address and we will send a single-use reset link if eligible.</p>
          <input
            aria-label="Email address"
            placeholder="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
          <button type="submit" disabled={submitting}>
            {submitting ? 'Requesting…' : 'Send reset link'}
          </button>
        </form>
      )}
      {error && <p className="ch247-status-error">{error}</p>}
      {!complete && (
        <p>
          <Link to="/login">Back to login</Link>
        </p>
      )}
    </div>
  );
}
