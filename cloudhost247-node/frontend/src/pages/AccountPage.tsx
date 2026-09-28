import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { changePassword, updateProfile } from '../lib/account-api';
import { clearSession, setSession, type StoredUser } from '../lib/auth';
import { usePageMeta } from '../lib/usePageMeta';

interface MeResponse {
  user: { id: string; email: string; fullName: string; role: string; status: string };
}

/**
 * Account/profile view (Phase 4): real, server-verified identity (via /api/auth/me), plus two
 * real self-service actions — editing the full name and changing the password. Email change,
 * 2FA, and SSO remain explicitly out of scope for this phase (see docs/API_CUSTOMER_APP.md).
 *
 * A successful password change invalidates every *other* session for this account (see
 * src/lib/require-auth.ts on the backend) but deliberately does not invalidate the one making the
 * change — the server returns 204 with no new token, so this page keeps using the same token it
 * already has, exactly like the backend contract intends ("a freshly-issued token keeps working").
 */
export default function AccountPage() {
  usePageMeta('Account', 'Your CloudHost247 account details.');
  const [me, setMe] = useState<MeResponse['user'] | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [profileSubmitting, setProfileSubmitting] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<MeResponse>('/api/auth/me')
      .then((res) => {
        if (!cancelled) {
          setMe(res.user);
          setFullName(res.user.fullName);
        }
      })
      .catch(() => {
        if (!cancelled) navigate('/login', { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Fall through — always clear the local session below even if the network call failed.
    } finally {
      clearSession();
      navigate('/');
    }
  }

  async function onSaveProfile(e: FormEvent) {
    e.preventDefault();
    setProfileSubmitting(true);
    setProfileMessage(null);
    try {
      const res = await updateProfile(fullName);
      setMe((prev) => (prev ? { ...prev, fullName: res.user.fullName } : prev));
      // Keep the header's cached name in sync without forcing a re-login.
      const stored = JSON.parse(localStorage.getItem('ch247_user') ?? 'null') as StoredUser | null;
      const token = localStorage.getItem('ch247_token');
      if (stored && token) {
        setSession(token, { ...stored, fullName: res.user.fullName });
      }
      setProfileMessage({ kind: 'ok', text: 'Your name has been updated.' });
    } catch (err) {
      setProfileMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not update your name.' });
    } finally {
      setProfileSubmitting(false);
    }
  }

  async function onChangePassword(e: FormEvent) {
    e.preventDefault();
    setPasswordSubmitting(true);
    setPasswordMessage(null);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setPasswordMessage({
        kind: 'ok',
        text: 'Your password has been changed. Any other signed-in devices will need to log in again.',
      });
    } catch (err) {
      setPasswordMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not change your password.' });
    } finally {
      setPasswordSubmitting(false);
    }
  }

  if (!me) {
    return (
      <div className="ch247-card">
        <p>Loading your account…</p>
      </div>
    );
  }

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <h1>Account</h1>
        <dl className="ch247-definition-list">
          <dt>Email</dt>
          <dd>{me.email}</dd>
          <dt>Role</dt>
          <dd>{me.role}</dd>
          <dt>Status</dt>
          <dd>{me.status}</dd>
        </dl>
        <p className="ch247-placeholder-notice">
          Changing your email, two-factor authentication, and single sign-on aren&apos;t available
          on this platform yet.
        </p>
        <button type="button" className="ch247-button ch247-button--outline" onClick={handleLogout} disabled={loggingOut}>
          {loggingOut ? 'Logging out…' : 'Log out of this device'}
        </button>
      </div>

      <div className="ch247-card">
        <h2>Profile</h2>
        <form className="ch247-form ch247-form--wide" onSubmit={onSaveProfile}>
          <label>
            <span className="ch247-field-label">Full name</span>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required maxLength={255} />
          </label>
          <button type="submit" disabled={profileSubmitting}>
            {profileSubmitting ? 'Saving…' : 'Save name'}
          </button>
        </form>
        {profileMessage && (
          <p className={profileMessage.kind === 'ok' ? 'ch247-status-ok' : 'ch247-status-error'}>{profileMessage.text}</p>
        )}
      </div>

      <div className="ch247-card">
        <h2>Change password</h2>
        <form className="ch247-form ch247-form--wide" onSubmit={onChangePassword}>
          <label>
            <span className="ch247-field-label">Current password</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </label>
          <label>
            <span className="ch247-field-label">New password (min 10 characters)</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={10}
              required
            />
          </label>
          <button type="submit" disabled={passwordSubmitting}>
            {passwordSubmitting ? 'Changing…' : 'Change password'}
          </button>
        </form>
        {passwordMessage && (
          <p className={passwordMessage.kind === 'ok' ? 'ch247-status-ok' : 'ch247-status-error'}>{passwordMessage.text}</p>
        )}
      </div>
    </div>
  );
}
