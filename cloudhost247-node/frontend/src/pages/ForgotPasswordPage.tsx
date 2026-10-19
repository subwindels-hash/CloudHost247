import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import AuthFrame from '../components/AuthFrame';
import { apiFetch } from '../lib/api';
import { usePageMeta } from '../lib/usePageMeta';

/** Anonymous recovery request. The API always returns the same accepted response so this screen
 * never tells a visitor whether an email address has an active CloudHost247 account. */
export default function ForgotPasswordPage() {
  usePageMeta('Reset your password', 'Request a secure CloudHost247 password reset link.');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailError('Enter the email address the account was registered with.');
      return;
    }
    setEmailError('');
    setSubmitting(true);
    try {
      await apiFetch<{ message: string }>('/api/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      });
      setComplete(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not process your request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthFrame
      title="Reset your password"
      lede="Enter the email address registered on the account and we will send a single-use reset link if it is eligible."
      points={['The link expires and works once', 'Nothing changes until you choose a new password']}
      asideTitle="What happens next"
      asideNotes={[
        { title: 'Check the inbox', body: 'The link goes to the address on the account. It can take a few minutes to arrive.' },
        { title: 'Still no link?', body: 'Check the spam folder before requesting another. Only the newest link stays valid.' },
      ]}
    >
      {complete ? (
        <>
          <p className="ch247-status-ok" role="status">
            If an active account matches that email address, a password reset link will arrive shortly. Check your inbox
            and spam folder.
          </p>
          <div className="ch247-auth__links">
            <Link to="/login">Return to login</Link>
          </div>
        </>
      ) : (
        <>
          <form
            className="ch247-form ch247-form--auth"
            onSubmit={onSubmit}
            noValidate
            aria-describedby={error ? 'forgot-status' : undefined}
          >
            {error && (
              <p id="forgot-status" role="alert" className="ch247-status-error">
                {error}
              </p>
            )}
            <div className="ch247-field">
              <label className="ch247-field-label" htmlFor="forgot-email">Email address</label>
              <input
                id="forgot-email"
                name="email"
                aria-label="Email address"
                placeholder="Email"
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (emailError) setEmailError('');
                }}
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={Boolean(emailError)}
                aria-describedby={emailError ? 'forgot-email-error' : undefined}
                required
              />
              {emailError && (
                <span className="ch247-field-error" id="forgot-email-error">{emailError}</span>
              )}
            </div>
            <button type="submit" disabled={submitting}>
              {submitting ? 'Requesting…' : 'Send reset link'}
            </button>
          </form>
          <div className="ch247-auth__links">
            <Link to="/login">Back to login</Link>
          </div>
        </>
      )}
    </AuthFrame>
  );
}
