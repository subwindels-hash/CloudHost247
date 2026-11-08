import { FormEvent, useId, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AuthFrame from '../components/AuthFrame';
import { apiFetch } from '../lib/api';
import { trackMarketing } from '../lib/marketing';
import { setSession, type StoredUser } from '../lib/auth';
import { usePageMeta } from '../lib/usePageMeta';
import { authLink, safeReturnTo } from '../lib/return-to';

interface AuthResponse {
  marketingEvent?: { eventName: string; eventId: string; customData: Record<string, unknown> } | null;
  user: StoredUser;
  token: string;
  emailVerification: { queued: boolean };
  securityPin?: { set: boolean; nextRotationAt: string | null };
}

interface UsernameAvailability {
  available: boolean;
  username: string;
  reason: string | null;
  suggestions: string[];
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
    title: 'Your username and Customer ID',
    body: 'Your username is how you sign in and how support finds you. Every account also gets a permanent nine-digit Customer ID.',
  },
  {
    title: 'Your Security PIN',
    body: 'A four-digit Security PIN rotates every 24 hours. It is never shown in the app until you confirm a code sent to your verified email address.',
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
  const [username, setUsername] = useState('');
  const [usernameCheck, setUsernameCheck] = useState<UsernameAvailability | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const idea = (params.get('idea') ?? '').trim().slice(0, 300);
  const returnTo = safeReturnTo(params.get('next')) ?? (idea ? `/websites/ai-builder?idea=${encodeURIComponent(idea)}` : null);
  const idPrefix = useId();

  /**
   * Asks the server whether the name is free. The server is the only authority (format, reserved
   * words and uniqueness all live in one place there); this is purely an early, friendly warning,
   * and registration re-checks everything.
   */
  async function checkUsername(next: string) {
    const value = next.trim();
    if (value.length < 3) {
      setUsernameCheck(null);
      return;
    }
    setCheckingUsername(true);
    try {
      const res = await apiFetch<UsernameAvailability>(
        `/api/v1/account/username/availability?username=${encodeURIComponent(value)}`
      );
      setUsernameCheck(res);
    } catch {
      // A failed availability probe must never block registration — the server validates again.
      setUsernameCheck(null);
    } finally {
      setCheckingUsername(false);
    }
  }

  function validate() {
    const errors: Record<string, string> = {};
    if (fullName.trim().length < 2) {
      errors.fullName = 'Enter the name that should appear on the account.';
    }
    // Optional: leaving it blank lets the server derive one from the email address.
    if (username.trim() && usernameCheck && !usernameCheck.available) {
      errors.username = usernameCheck.reason ?? 'That username is not available.';
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
        body: JSON.stringify({
          fullName: fullName.trim(),
          email: email.trim(),
          password,
          ...(username.trim() ? { username: username.trim() } : {}),
        }),
      });
      setSession(res.token, res.user);
      if (res.marketingEvent) trackMarketing(res.marketingEvent.eventName, res.marketingEvent.customData, res.marketingEvent.eventId);
      setMessage({
        kind: 'ok',
        text: res.emailVerification.queued
          ? `Account created for ${res.user.email}. A verification email request has been queued.`
          : `Account created for ${res.user.email}.`,
      });
      // Keep task context when registration was started from a service; otherwise show verification.
      navigate(returnTo ?? '/account');
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
          <label className="ch247-field-label" htmlFor={`${idPrefix}-username`}>
            Username <span className="ch247-field-optional">(optional)</span>
          </label>
          <input
            id={`${idPrefix}-username`}
            name="username"
            placeholder="Username"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setUsernameCheck(null);
            }}
            onBlur={(e) => void checkUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            minLength={3}
            maxLength={32}
            aria-invalid={Boolean(fieldErrors.username) || usernameCheck?.available === false}
            aria-describedby={`${idPrefix}-username-hint${fieldErrors.username ? ` ${idPrefix}-username-error` : ''}`}
          />
          <span
            className={usernameCheck && !usernameCheck.available ? 'ch247-field-error' : 'ch247-field-hint'}
            id={`${idPrefix}-username-hint`}
            role="status"
          >
            {checkingUsername
              ? 'Checking availability…'
              : usernameCheck?.available
                ? `"${usernameCheck.username}" is available.`
                : usernameCheck && !usernameCheck.available
                  ? (usernameCheck.reason ?? 'That username is not available.')
                  : username.trim()
                    ? '3–32 characters, starting with a letter. Letters, numbers, dots, underscores and hyphens.'
                    : 'Leave blank and we will create one from your email address. You can change it later.'}
          </span>
          {usernameCheck && !usernameCheck.available && usernameCheck.suggestions.length > 0 && (
            <span className="ch247-field-hint">
              Try{' '}
              {usernameCheck.suggestions.map((suggestion, index) => (
                <button
                  key={suggestion}
                  type="button"
                  className="ch247-link-button"
                  onClick={() => {
                    setUsername(suggestion);
                    setUsernameCheck(null);
                  }}
                >
                  {index > 0 ? ', ' : ''}
                  {suggestion}
                </button>
              ))}
              .
            </span>
          )}
          {fieldErrors.username && (
            <span className="ch247-field-error" id={`${idPrefix}-username-error`}>{fieldErrors.username}</span>
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
        <Link to={authLink('/login', returnTo)}>Log in</Link>
      </div>
    </AuthFrame>
  );
}
