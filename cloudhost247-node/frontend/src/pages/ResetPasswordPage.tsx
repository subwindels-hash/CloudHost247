import { FormEvent, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { usePageMeta } from '../lib/usePageMeta';

export default function ResetPasswordPage() {
  usePageMeta('Choose a new password', 'Set a new CloudHost247 password using your secure reset link.');
  const location = useLocation();
  const navigate = useNavigate();
  const token = useMemo(() => new URLSearchParams(location.search).get('token') ?? '', [location.search]);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setMessage({ kind: 'error', text: 'The passwords do not match.' });
      return;
    }
    setSubmitting(true);
    setMessage(null);
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
      <div className="ch247-card">
        <h1>Reset link unavailable</h1>
        <p className="ch247-status-error">This reset link is missing its token. Request a new password reset link to continue.</p>
        <Link to="/forgot-password">Request a reset link</Link>
      </div>
    );
  }

  return (
    <div className="ch247-card">
      <h1>Choose a new password</h1>
      <form className="ch247-form" onSubmit={onSubmit}>
        <input
          aria-label="New password"
          placeholder="New password (min 10 characters)"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          minLength={10}
          required
        />
        <input
          aria-label="Confirm new password"
          placeholder="Confirm new password"
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          autoComplete="new-password"
          minLength={10}
          required
        />
        <button type="submit" disabled={submitting}>{submitting ? 'Resetting…' : 'Reset password'}</button>
      </form>
      {message && <p className={message.kind === 'ok' ? 'ch247-status-ok' : 'ch247-status-error'}>{message.text}</p>}
    </div>
  );
}
