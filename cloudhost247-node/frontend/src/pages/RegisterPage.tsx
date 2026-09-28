import { FormEvent, useState } from 'react';
import { apiFetch } from '../lib/api';

interface AuthResponse {
  user: { id: string; email: string; fullName: string; role: string };
  token: string;
}

export default function RegisterPage() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await apiFetch<AuthResponse>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ fullName, email, password }),
      });
      localStorage.setItem('ch247_token', res.token);
      setMessage({ kind: 'ok', text: `Account created for ${res.user.email}.` });
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
