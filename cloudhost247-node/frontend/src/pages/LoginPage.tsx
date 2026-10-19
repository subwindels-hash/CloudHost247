import { FormEvent, useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AuthFrame from '../components/AuthFrame';
import { apiFetch } from '../lib/api';
import { setSession, type StoredUser } from '../lib/auth';
import { usePageMeta } from '../lib/usePageMeta';

interface AuthResponse {
  user?: StoredUser;
  token?: string;
  mfaRequired?: boolean;
  mfaToken?: string;
}

interface LocationState {
  from?: string;
  recoveryMessage?: string;
}

const SIGN_IN_NOTES = [
  'Passwords are checked against the policy before the session is issued.',
  'Multi-factor challenges expire quickly; a stale code has to be requested again.',
  'Recovery links are single use and stop working once a new password is set.',
];

export default function LoginPage() {
  usePageMeta('Log in', 'Log in to your CloudHost247 account.');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as LocationState | null;
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(
    locationState?.recoveryMessage ? { kind: 'ok', text: locationState.recoveryMessage } : null
  );
  const redirectTo = locationState?.from || '/dashboard';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      if (mfaToken) {
        const res = await apiFetch<AuthResponse>('/api/auth/mfa/login/verify', {
          method: 'POST',
          body: JSON.stringify({ mfaToken, code: mfaCode }),
        });
        if (!res.token || !res.user) throw new Error('Multi-factor authentication did not complete the login');
        setSession(res.token, res.user);
        setMessage({ kind: 'ok', text: `Welcome back, ${res.user.fullName}.` });
        navigate(redirectTo, { replace: true });
        return;
      }

      const res = await apiFetch<AuthResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (res.mfaRequired && res.mfaToken) {
        // The continuation credential lives only in this component's memory. It is never saved
        // into localStorage or presented as an authenticated session.
        setMfaToken(res.mfaToken);
        setPassword('');
        setMessage({ kind: 'ok', text: 'Enter a code from your authenticator app or a recovery code to finish logging in.' });
        return;
      }
      if (!res.token || !res.user) throw new Error('Login did not return a session');
      setSession(res.token, res.user);
      setMessage({ kind: 'ok', text: `Welcome back, ${res.user.fullName}.` });
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Login failed' });
    } finally {
      setSubmitting(false);
    }
  }

  async function loginWithPasskey() {
    if (!email) { setMessage({ kind:'error', text:'Enter your email address before using a passkey.' }); return; }
    setSubmitting(true); setMessage(null);
    try {
      const start=await apiFetch<{challengeId:string;options:Parameters<typeof startAuthentication>[0]['optionsJSON']}>('/api/auth/passkeys/login/options',{method:'POST',body:JSON.stringify({email})});
      const response=await startAuthentication({optionsJSON:start.options});
      const result=await apiFetch<AuthResponse>('/api/auth/passkeys/login/verify',{method:'POST',body:JSON.stringify({challengeId:start.challengeId,response})});
      if(result.mfaRequired&&result.mfaToken){setMfaToken(result.mfaToken);setMessage({kind:'ok',text:'Passkey verified. Enter your multi-factor code to finish logging in.'});return;}
      if(!result.token||!result.user)throw new Error('Passkey login did not return a session'); setSession(result.token,result.user);navigate(redirectTo,{replace:true});
    } catch(err){setMessage({kind:'error',text:err instanceof Error?err.message:'Could not verify passkey.'});} finally {setSubmitting(false);}
  }

  function startOver() {
    setMfaToken(null);
    setMfaCode('');
    setPassword('');
    setMessage(null);
  }

  return (
    <AuthFrame
      title="Log in"
      lede="Sign in to manage services, invoices, domains and support tickets in one place."
      points={['Use the email address on the account', 'Recovery is available if you have lost the password']}
      asideTitle="Signing in safely"
      asideNotes={SIGN_IN_NOTES.map((note, index) => ({ title: `Step ${index + 1}`, body: note }))}
    >
      <form className="ch247-form ch247-form--auth" onSubmit={onSubmit} aria-describedby={message ? 'login-status' : undefined}>
        {message && (
          <p
            id="login-status"
            role={message.kind === 'error' ? 'alert' : 'status'}
            aria-live={message.kind === 'error' ? 'assertive' : 'polite'}
            className={message.kind === 'ok' ? 'ch247-status-ok' : 'ch247-status-error'}
          >
            {message.text}
          </p>
        )}
        {mfaToken ? (
          <>
            <p className="ch247-page__hint">Use the six-digit code from your authenticator, or one of your saved recovery codes.</p>
            <div className="ch247-field">
              <label className="ch247-field-label" htmlFor="login-mfa-code">Multi-factor authentication code</label>
              <input
                id="login-mfa-code"
                aria-label="Multi-factor authentication code"
                placeholder="Authenticator or recovery code"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                autoComplete="one-time-code"
                inputMode="numeric"
                required
                autoFocus
              />
            </div>
            <button type="submit" disabled={submitting}>
              {submitting ? 'Verifying…' : 'Verify and log in'}
            </button>
            <button type="button" className="ch247-button ch247-button--outline" onClick={startOver} disabled={submitting}>
              Use a different account
            </button>
          </>
        ) : (
          <>
            <div className="ch247-field">
              <label className="ch247-field-label" htmlFor="login-email">Email address</label>
              <input
                id="login-email"
                name="email"
                placeholder="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                required
              />
            </div>
            <div className="ch247-field">
              <label className="ch247-field-label" htmlFor="login-password">Password</label>
              <input
                id="login-password"
                name="password"
                placeholder="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <button type="submit" disabled={submitting}>
              {submitting ? 'Logging in…' : 'Login'}
            </button>
            {/* Deliberately unclassed: `form.ch247-form button` styles every control in this form,
                and any class here would either outrank it or be outranked by it. Left bare, this is
                styled identically to the primary Login button above it. */}
            <button type="button" onClick={loginWithPasskey} disabled={submitting}>Use a passkey</button>
          </>
        )}
      </form>
      <div className="ch247-auth__links">
        <Link to="/forgot-password">Forgot your password?</Link>
        <Link to="/register">Create an account</Link>
        <Link to="/verify-email">Resend a verification email</Link>
      </div>
    </AuthFrame>
  );
}
