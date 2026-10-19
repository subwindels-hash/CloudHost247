import { FormEvent, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthFrame from '../components/AuthFrame';
import { apiFetch } from '../lib/api';
import { setSession, type StoredUser } from '../lib/auth';
import { usePageMeta } from '../lib/usePageMeta';

interface AuthResponse {
  user: StoredUser;
  token: string;
  emailVerification: { queued: boolean };
}

const MIN_PASSWORD_LENGTH = 10;

const REGISTER_POINTS = [
  'One account for hosting, cloud, domains and support',
  'Email verification is sent as soon as the account exists',
  'No card details are needed to create an account',
];

const REGISTER_NOTES = [
  {
    title: 'What happens next',
    body: 'You are signed in immediately and asked to verify the email address before ordering.',
  },
  {
    title: 'Account security',
    body: 'Choose a unique password. Multi-factor authentication and passkeys can be added from the account page.',
  },
  {
    title: 'Data and privacy',
    body: 'Account data is handled under the privacy policy and the acceptable use policy linked below.',
  },
];

export default function RegisterPage() {
  usePageMeta('Create your account', 'Create a CloudHost247 account.');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const navigate = useNavigate();
  const idPrefix = useId();

  function validate() {
    const errors: Record<string, string> = {};
    if (fullName.trim().length < 2) {
      errors.fullName = 'Enter the name that should appear on the account.';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = 'Enter a valid email address, for example name@example.com.';
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (confirmPassword !== password) {
      errors.confirmPassword = 'The two passwords do not match.';
    }
    if (!acceptedTerms) {
      errors.acceptedTerms = 'Accept the terms of service and privacy policy to continue.';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!validate()) {
      setMessage({ kind: 'error', text: 'Check the highlighted fields and try again.' });
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch<AuthResponse>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ fullName: fullName.trim(), email: email.trim(), password }),
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
    <AuthFrame
      title="Create your account"
      lede="Open a CloudHost247 account to order hosting, register domains and manage billing in one place."
      points={REGISTER_POINTS}
      asideTitle="Before you start"
      asideNotes={REGISTER_NOTES}
    >
      <form
        className="ch247-form ch247-form--auth"
        onSubmit={onSubmit}
        noValidate
        aria-describedby={message ? `${idPrefix}-status` : undefined}
      >
        {message && (
          <p
            id={`${idPrefix}-status`}
            role={message.kind === 'error' ? 'alert' : 'status'}
            aria-live={message.kind === 'error' ? 'assertive' : 'polite'}
            className={message.kind === 'ok' ? 'ch247-status-ok' : 'ch247-status-error'}
          >
            {message.text}
          </p>
        )}

        <div className="ch247-field">
          <label className="ch247-field-label" htmlFor={`${idPrefix}-name`}>Full name</label>
          <input
            id={`${idPrefix}-name`}
            name="fullName"
            placeholder="Full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
            aria-invalid={Boolean(fieldErrors.fullName)}
            aria-describedby={fieldErrors.fullName ? `${idPrefix}-name-error` : undefined}
            required
          />
          {fieldErrors.fullName && (
            <span className="ch247-field-error" id={`${idPrefix}-name-error`}>{fieldErrors.fullName}</span>
          )}
        </div>

        <div className="ch247-field">
          <label className="ch247-field-label" htmlFor={`${idPrefix}-email`}>Email address</label>
          <input
            id={`${idPrefix}-email`}
            name="email"
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? `${idPrefix}-email-error` : undefined}
            required
          />
          {fieldErrors.email && (
            <span className="ch247-field-error" id={`${idPrefix}-email-error`}>{fieldErrors.email}</span>
          )}
        </div>

        <div className="ch247-field">
          <label className="ch247-field-label" htmlFor={`${idPrefix}-password`}>Password</label>
          <input
            id={`${idPrefix}-password`}
            name="password"
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={fieldErrors.password ? `${idPrefix}-password-error` : `${idPrefix}-password-hint`}
            required
          />
          <span className="ch247-field-hint" id={`${idPrefix}-password-hint`}>
            At least {MIN_PASSWORD_LENGTH} characters. A passphrase is easier to remember than a short password.
          </span>
          {fieldErrors.password && (
            <span className="ch247-field-error" id={`${idPrefix}-password-error`}>{fieldErrors.password}</span>
          )}
        </div>

        <div className="ch247-field">
          <label className="ch247-field-label" htmlFor={`${idPrefix}-confirm`}>Confirm password</label>
          <input
            id={`${idPrefix}-confirm`}
            name="confirmPassword"
            placeholder="Confirm password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            aria-invalid={Boolean(fieldErrors.confirmPassword)}
            aria-describedby={fieldErrors.confirmPassword ? `${idPrefix}-confirm-error` : undefined}
            required
          />
          {fieldErrors.confirmPassword && (
            <span className="ch247-field-error" id={`${idPrefix}-confirm-error`}>{fieldErrors.confirmPassword}</span>
          )}
        </div>

        <div className="ch247-field ch247-field--check">
          <label className="ch247-check" htmlFor={`${idPrefix}-terms`}>
            <input
              id={`${idPrefix}-terms`}
              name="acceptTerms"
              type="checkbox"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              aria-invalid={Boolean(fieldErrors.acceptedTerms)}
              aria-describedby={fieldErrors.acceptedTerms ? `${idPrefix}-terms-error` : undefined}
              required
            />
            <span>
              I accept the <Link to="/legal/terms" target="_blank" rel="noreferrer">terms of service</Link> and the{' '}
              <Link to="/legal/privacy-policy" target="_blank" rel="noreferrer">privacy policy</Link>.
            </span>
          </label>
          {fieldErrors.acceptedTerms && (
            <span className="ch247-field-error" id={`${idPrefix}-terms-error`}>{fieldErrors.acceptedTerms}</span>
          )}
        </div>

        <button type="submit" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Register'}
        </button>
      </form>

      <div className="ch247-auth__links">
        <span>Already have an account?</span>
        <Link to="/login">Log in</Link>
      </div>
    </AuthFrame>
  );
}
