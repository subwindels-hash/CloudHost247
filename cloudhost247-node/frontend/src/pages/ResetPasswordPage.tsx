import { FormEvent, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AuthFrame from '../components/AuthFrame';
import { apiFetch } from '../lib/api';
import { usePageMeta } from '../lib/usePageMeta';

const MIN_PASSWORD_LENGTH = 10;

export default function ResetPasswordPage() {
  usePageMeta('Choose a new password', 'Set a new CloudHost247 password using your secure reset link.');
  const location = useLocation();
  const navigate = useNavigate();
  const token = useMemo(() => new URLSearchParams(location.search).get('token') ?? '', [location.search]);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);

    const errors: Record<string, string> = {};
    if (password.length < MIN_PASSWORD_LENGTH) {
      errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (confirmPassword !== password) {
      errors.confirmPassword = 'The passwords do not match.';
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const result = await apiFetch<{ message: string }>('/api/auth/password-reset/confirm', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      // Replace the token-bearing URL immediately; the login page presents the success notice.
      navigate('/login', { replace: true, state: { recoveryMessage: result.message } });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not reset your password.' });
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <AuthFrame
        title="Reset link unavailable"
        lede="This reset link is missing its token, so it cannot be used."
      >
        <p className="ch247-status-error" role="alert">
          This reset link is missing its token. Request a new password reset link to continue.
        </p>
        <div className="ch247-auth__links">
          <Link to="/forgot-password">Request a reset link</Link>
          <Link to="/login">Back to login</Link>
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      title="Choose a new password"
      lede="Pick a password you have not used before on any other service. The reset link stops working once this completes."
      asideTitle="Password guidance"
      asideNotes={[
        { title: 'Longer beats complex', body: 'A passphrase of four unrelated words is stronger than a short password with symbols.' },
        { title: 'Unique to this account', body: 'Reusing a password from another site puts this account at risk if that site is breached.' },
      ]}
    >
      <form className="ch247-form ch247-form--auth" onSubmit={onSubmit} noValidate>
        {message && (
          <p role="alert" className="ch247-status-error">{message.text}</p>
        )}

        <div className="ch247-field">
          <label className="ch247-field-label" htmlFor="reset-password">New password</label>
          <input
            id="reset-password"
            name="password"
            aria-label="New password"
            placeholder="New password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={fieldErrors.password ? 'reset-password-error' : 'reset-password-hint'}
            required
          />
          <span className="ch247-field-hint" id="reset-password-hint">
            At least {MIN_PASSWORD_LENGTH} characters.
          </span>
          {fieldErrors.password && (
            <span className="ch247-field-error" id="reset-password-error">{fieldErrors.password}</span>
          )}
        </div>

        <div className="ch247-field">
          <label className="ch247-field-label" htmlFor="reset-confirm">Confirm new password</label>
          <input
            id="reset-confirm"
            name="confirmPassword"
            aria-label="Confirm new password"
            placeholder="Confirm new password"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            aria-invalid={Boolean(fieldErrors.confirmPassword)}
            aria-describedby={fieldErrors.confirmPassword ? 'reset-confirm-error' : undefined}
            required
          />
          {fieldErrors.confirmPassword && (
            <span className="ch247-field-error" id="reset-confirm-error">{fieldErrors.confirmPassword}</span>
          )}
        </div>

        <button type="submit" disabled={submitting}>{submitting ? 'Resetting…' : 'Reset password'}</button>
      </form>

      <div className="ch247-auth__links">
        <Link to="/login">Back to login</Link>
      </div>
    </AuthFrame>
  );
}
