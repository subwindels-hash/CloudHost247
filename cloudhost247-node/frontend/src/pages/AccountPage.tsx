import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import {
  changeMySecurityNumber,
  changePassword,
  getMyAccount,
  getMySecurityNumberStatus,
  removeMyProfileImage,
  revealMySecurityNumber,
  updateMyAccount,
  uploadMyProfileImage,
} from '../lib/account-api';
import type { AccountProfile, SecurityNumberStatus } from '../lib/account-types';
import { clearSession, getSupportOrigin, setSession, type StoredUser } from '../lib/auth';
import { usePageMeta } from '../lib/usePageMeta';

interface MeResponse {
  user: { id: string; email: string; fullName: string; role: string; status: string; emailVerified: boolean };
}

/**
 * Account/profile view. Alongside the original Phase 4 actions (name + password), this page now
 * surfaces the customer's permanent Customer ID, their rotating Security Number, the editable
 * contact/address fields, and their profile image.
 *
 * Security Number handling here mirrors the backend contract exactly:
 *   - the page only ever *reads status* (initialized/version/expiry). The value is not part of
 *     the account payload, is never written to localStorage or any cached user object, and is
 *     only ever held in component state for the few seconds after an explicit, password-confirmed
 *     reveal — after which it is cleared from state automatically.
 *   - a wrong password or a wrong current Security Number produces a visible error and never
 *     logs the customer out (the same regression guard as the password form below).
 */
export default function AccountPage() {
  usePageMeta('Account', 'Your CloudHost247 account details.');
  const [me, setMe] = useState<MeResponse['user'] | null>(null);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const navigate = useNavigate();
  const inSupportMode = getSupportOrigin() !== null;

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [city, setCity] = useState('');
  const [stateRegion, setStateRegion] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('');
  const [profileSubmitting, setProfileSubmitting] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [verificationSubmitting, setVerificationSubmitting] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const [securityStatus, setSecurityStatus] = useState<SecurityNumberStatus | null>(null);
  const [revealPassword, setRevealPassword] = useState('');
  const [revealedNumber, setRevealedNumber] = useState<string | null>(null);
  const [securityMessage, setSecurityMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [securityBusy, setSecurityBusy] = useState(false);
  const [currentSecurityNumber, setCurrentSecurityNumber] = useState('');
  const [newSecurityNumber, setNewSecurityNumber] = useState('');

  const [imageMessage, setImageMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [hasImage, setHasImage] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<MeResponse>('/api/auth/me')
      .then((res) => {
        if (cancelled) return;
        setMe(res.user);
        setFullName(res.user.fullName ?? '');
      })
      .catch(() => {
        if (!cancelled) navigate('/login', { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    let cancelled = false;
    getMyAccount()
      .then((res) => {
        if (cancelled || !res.user) return;
        setProfile(res.user);
        setFullName(res.user.fullName ?? '');
        setPhone(res.user.phone ?? '');
        setAddressLine1(res.user.addressLine1 ?? '');
        setCity(res.user.city ?? '');
        setStateRegion(res.user.state ?? '');
        setPostalCode(res.user.postalCode ?? '');
        setCountry(res.user.country ?? '');
        setHasImage(Boolean(res.user.hasProfileImage));
      })
      .catch(() => {
        /* Non-fatal: the header/identity block above still renders from /api/auth/me. */
      });

    getMySecurityNumberStatus()
      .then((res) => {
        if (!cancelled && res.securityNumber) setSecurityStatus(res.securityNumber);
      })
      .catch(() => {
        /* Non-fatal — the panel shows its unavailable state. */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // The avatar route is authenticated (it must be — it serves one specific customer's bytes), so
  // it cannot be loaded by pointing an <img src> at it: browsers do not attach the bearer token.
  // The image is fetched with the token and rendered from an object URL instead, which is also
  // revoked on unmount so the blob is not leaked.
  useEffect(() => {
    if (!hasImage) {
      setImageUrl(null);
      return;
    }
    let revoked = false;
    let url: string | null = null;
    const token = localStorage.getItem('ch247_token');
    fetch('/api/v1/account/profile-image', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error('unavailable'))))
      .then((blob) => {
        if (revoked) return;
        url = URL.createObjectURL(blob);
        setImageUrl(url);
      })
      .catch(() => setImageUrl(null));
    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [hasImage, imageMessage]);

  // A revealed Security Number is wiped from memory when its display window elapses, so it is
  // not left sitting on screen (or in a React tree) indefinitely.
  useEffect(() => {
    if (!revealedNumber) return;
    const timer = setTimeout(() => setRevealedNumber(null), 120_000);
    return () => clearTimeout(timer);
  }, [revealedNumber]);

  async function resendVerification() {
    setVerificationSubmitting(true);
    setVerificationMessage(null);
    try {
      const result = await apiFetch<{ message: string; queued: boolean; alreadyVerified: boolean }>('/api/auth/email-verification/resend', {
        method: 'POST',
      });
      if (result.alreadyVerified) {
        setMe((current) => (current ? { ...current, emailVerified: true } : current));
        const stored = JSON.parse(localStorage.getItem('ch247_user') ?? 'null') as StoredUser | null;
        const token = localStorage.getItem('ch247_token');
        if (stored && token) setSession(token, { ...stored, emailVerified: true });
      }
      setVerificationMessage({ kind: 'ok', text: result.message });
    } catch (err) {
      setVerificationMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not request a verification email.' });
    } finally {
      setVerificationSubmitting(false);
    }
  }

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
      const res = await updateMyAccount({
        fullName,
        phone: phone || null,
        addressLine1: addressLine1 || null,
        city: city || null,
        state: stateRegion || null,
        postalCode: postalCode || null,
        country: country || null,
      });
      if (res.user) {
        setProfile(res.user);
        setMe((prev) => (prev ? { ...prev, fullName: res.user.fullName } : prev));
        const stored = JSON.parse(localStorage.getItem('ch247_user') ?? 'null') as StoredUser | null;
        const token = localStorage.getItem('ch247_token');
        if (stored && token) {
          setSession(token, { ...stored, fullName: res.user.fullName });
        }
      }
      setProfileMessage({ kind: 'ok', text: 'Your name has been updated.' });
    } catch (err) {
      setProfileMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not update your details.' });
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
        text: 'Your password has been changed. For your security, sign in again before continuing.',
      });
    } catch (err) {
      setPasswordMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not change your password.' });
    } finally {
      setPasswordSubmitting(false);
    }
  }

  async function onReveal(e: FormEvent) {
    e.preventDefault();
    setSecurityBusy(true);
    setSecurityMessage(null);
    try {
      const res = await revealMySecurityNumber(revealPassword);
      setRevealPassword('');
      setRevealedNumber(res.securityNumber.value);
      setSecurityMessage({
        kind: 'ok',
        text: 'A new Security Number has been issued. Write it down — it cannot be shown again later.',
      });
      const status = await getMySecurityNumberStatus();
      setSecurityStatus(status.securityNumber);
    } catch (err) {
      setSecurityMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Could not show your Security Number.',
      });
    } finally {
      setSecurityBusy(false);
    }
  }

  async function onChangeSecurityNumber(e: FormEvent) {
    e.preventDefault();
    setSecurityBusy(true);
    setSecurityMessage(null);
    try {
      await changeMySecurityNumber(currentSecurityNumber, newSecurityNumber);
      setCurrentSecurityNumber('');
      setNewSecurityNumber('');
      setRevealedNumber(null);
      const status = await getMySecurityNumberStatus();
      setSecurityStatus(status.securityNumber);
      setSecurityMessage({ kind: 'ok', text: 'Your Security Number has been changed and is valid for a new period.' });
    } catch (err) {
      setSecurityMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Could not change your Security Number.',
      });
    } finally {
      setSecurityBusy(false);
    }
  }

  async function onPickImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageBusy(true);
    setImageMessage(null);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Could not read that file'));
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(file);
      });
      // The server re-validates type, magic bytes, extension and size — this is convenience only.
      await uploadMyProfileImage({ data, contentType: file.type, fileName: file.name });
      setHasImage(true);
      setImageMessage({ kind: 'ok', text: 'Your profile picture has been updated.' });
    } catch (err) {
      setImageMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not upload that image.' });
    } finally {
      setImageBusy(false);
      e.target.value = '';
    }
  }

  async function onRemoveImage() {
    setImageBusy(true);
    setImageMessage(null);
    try {
      await removeMyProfileImage();
      setHasImage(false);
      setImageMessage({ kind: 'ok', text: 'Your profile picture has been removed.' });
    } catch (err) {
      setImageMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not remove your picture.' });
    } finally {
      setImageBusy(false);
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
          <dt>Customer ID</dt>
          <dd data-testid="customer-id">{profile?.customerId ?? '—'}</dd>
          <dt>Email</dt>
          <dd>{me.email}</dd>
          <dt>Email verification</dt>
          <dd>{me.emailVerified ? 'Verified' : 'Not verified'}</dd>
          <dt>Role</dt>
          <dd>{me.role}</dd>
          <dt>Status</dt>
          <dd>{me.status}</dd>
        </dl>
        <p className="ch247-page__hint">
          Quote your Customer ID when you contact support or ask about an invoice. It never changes
          and it is not a password — never use it to prove who you are.
        </p>
        {!me.emailVerified && (
          <div className="ch247-placeholder-notice">
            <p>Verify this email address to confirm that CloudHost247 can contact you about your account.</p>
            <button type="button" className="ch247-button ch247-button--outline" onClick={resendVerification} disabled={verificationSubmitting}>
              {verificationSubmitting ? 'Requesting…' : 'Send a verification link'}
            </button>
            {verificationMessage && (
              <p className={verificationMessage.kind === 'ok' ? 'ch247-status-ok' : 'ch247-status-error'}>{verificationMessage.text}</p>
            )}
          </div>
        )}
        <p className="ch247-placeholder-notice">
          Changing your email, two-factor authentication, and single sign-on aren&apos;t available
          on this platform yet.
        </p>
        <button type="button" className="ch247-button ch247-button--outline" onClick={handleLogout} disabled={loggingOut}>
          {loggingOut ? 'Logging out…' : 'Log out of this device'}
        </button>
      </div>

      <div className="ch247-card">
        <h2>Security Number</h2>
        {securityStatus ? (
          <>
            <dl className="ch247-definition-list">
              <dt>Status</dt>
              <dd>{securityStatus.initialized ? (securityStatus.expired ? 'Expired' : 'Active') : 'Not set up yet'}</dd>
              <dt>Rotates every</dt>
              <dd>{securityStatus.rotationHours} hours</dd>
              <dt>Expires</dt>
              <dd>{securityStatus.expiresAt ? new Date(securityStatus.expiresAt).toLocaleString() : '—'}</dd>
            </dl>
            <p className="ch247-page__hint">
              Your Security Number is a four-digit code that changes automatically every{' '}
              {securityStatus.rotationHours} hours. We only ever store a one-way hash of it, so
              nobody — including our staff — can look it up. Administrators can see when it was
              issued and force it to change, never what it is.
            </p>
          </>
        ) : (
          <p className="ch247-page__hint">Security Number details are unavailable right now.</p>
        )}

        {revealedNumber && (
          <p>
            <span className="ch247-security-number" data-testid="revealed-security-number">
              {revealedNumber}
            </span>
          </p>
        )}

        {inSupportMode ? (
          <p className="ch247-status-error">
            Security Number access is blocked while an administrator is signed in to this account.
          </p>
        ) : (
          <>
            <form className="ch247-form ch247-form--wide" onSubmit={onReveal}>
              <label>
                <span className="ch247-field-label">Confirm your password to see a new Security Number</span>
                <input
                  type="password"
                  value={revealPassword}
                  onChange={(e) => setRevealPassword(e.target.value)}
                  required
                />
              </label>
              <button type="submit" disabled={securityBusy}>
                {securityBusy ? 'Working…' : 'Show my Security Number'}
              </button>
            </form>

            <form className="ch247-form ch247-form--wide" onSubmit={onChangeSecurityNumber}>
              <label>
                <span className="ch247-field-label">Current Security Number</span>
                <input
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  value={currentSecurityNumber}
                  onChange={(e) => setCurrentSecurityNumber(e.target.value)}
                  required
                />
              </label>
              <label>
                <span className="ch247-field-label">New Security Number (4 digits)</span>
                <input
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  value={newSecurityNumber}
                  onChange={(e) => setNewSecurityNumber(e.target.value)}
                  required
                />
              </label>
              <button type="submit" disabled={securityBusy}>
                {securityBusy ? 'Working…' : 'Change Security Number'}
              </button>
            </form>
          </>
        )}
        {securityMessage && (
          <p className={securityMessage.kind === 'ok' ? 'ch247-status-ok' : 'ch247-status-error'}>
            {securityMessage.text}
          </p>
        )}
      </div>

      <div className="ch247-card">
        <h2>Profile</h2>
        <form className="ch247-form ch247-form--wide" onSubmit={onSaveProfile}>
          <label>
            <span className="ch247-field-label">Full name</span>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required maxLength={255} />
          </label>
          <label>
            <span className="ch247-field-label">Phone</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={32} />
          </label>
          <label>
            <span className="ch247-field-label">Address</span>
            <input value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} maxLength={255} />
          </label>
          <label>
            <span className="ch247-field-label">City</span>
            <input value={city} onChange={(e) => setCity(e.target.value)} maxLength={120} />
          </label>
          <label>
            <span className="ch247-field-label">State / region</span>
            <input value={stateRegion} onChange={(e) => setStateRegion(e.target.value)} maxLength={120} />
          </label>
          <label>
            <span className="ch247-field-label">Postal code</span>
            <input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} maxLength={32} />
          </label>
          <label>
            <span className="ch247-field-label">Country</span>
            <input value={country} onChange={(e) => setCountry(e.target.value)} maxLength={64} />
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
        <h2>Profile picture</h2>
        {hasImage && imageUrl && <img className="ch247-avatar" alt="Your profile" src={imageUrl} />}
        <p className="ch247-page__hint">PNG, JPEG, WebP or GIF, up to 2 MB. SVG files are not accepted.</p>
        <div className="ch247-inline-actions">
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={onPickImage} disabled={imageBusy} />
          {hasImage && (
            <button type="button" className="ch247-button ch247-button--outline" onClick={onRemoveImage} disabled={imageBusy}>
              Remove picture
            </button>
          )}
        </div>
        {imageMessage && (
          <p className={imageMessage.kind === 'ok' ? 'ch247-status-ok' : 'ch247-status-error'}>{imageMessage.text}</p>
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
