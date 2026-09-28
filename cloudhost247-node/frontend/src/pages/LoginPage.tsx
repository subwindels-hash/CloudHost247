import { FormEvent, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { setSession, type StoredUser } from '../lib/auth';
import { usePageMeta } from '../lib/usePageMeta';

interface AuthResponse {
  user: StoredUser;
  token: string;
}

interface LocationState {
  from?: string;
}

export default function LoginPage() {
  usePageMeta('Log in', 'Log in to your CloudHost247 account.');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as LocationState | null)?.from || '/dashboard';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await apiFetch<AuthResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setSession(res.token, res.user);
      setMessage({ kind: 'ok', text: `Welcome back, ${res.user.fullName}.` });
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Login failed' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="ch247-card">
      <h1>Log in</h1>
      <form className="ch247-form" onSubmit={onSubmit}>
        <input
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="submit" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Login'}
        </button>
      </form>
      {message && <p className={message.kind === 'ok' ? 'ch247-status-ok' : 'ch247-status-error'}>{message.text}</p>}
    </div>
  );
}
