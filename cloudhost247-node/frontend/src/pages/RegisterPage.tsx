import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { setSession, type StoredUser } from '../lib/auth';
import { usePageMeta } from '../lib/usePageMeta';

interface AuthResponse {
  user: StoredUser;
  token: string;
  emailVerification: { queued: boolean };
}

export default function RegisterPage() {
  usePageMeta('Create your account', 'Create a CloudHost247 account.');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await apiFetch<AuthResponse>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ fullName, email, password }),
      });
      setSession(res.token, res.user);
      setMessage({
        kind: 'ok',
        text: res.emailVerification.queued
          ? `Account created for ${res.user.email}. A verification email request has been queued.`
          : `Account created for ${res.user.email}.`,
      });
      // The account page makes the pending verification state and resend action immediately visible.
      navigate('/account');
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Registration failed' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="ch247-card">
      <h1>Create your account</h1>
      <form className="ch247-form" onSubmit={onSubmit}>
        <input placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        <input
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          placeholder="Password (min 10 characters)"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={10}
          required
        />
        <button type="submit" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Register'}
        </button>
      </form>
      {message && <p className={message.kind === 'ok' ? 'ch247-status-ok' : 'ch247-status-error'}>{message.text}</p>}
    </div>
  );
}
