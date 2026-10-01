import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
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
  user: { id: string; email: string; fullName: string; role: string; status: string; emailVerified: boolean; mfaEnabled?: boolean };
}

interface MfaStatusResponse {
  mfa: { enabled: boolean; recoveryCodesRemaining: number };
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

  const [mfaStatus, setMfaStatus] = useState<MfaStatusResponse['mfa'] | null>(null);
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaMessage, setMfaMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [mfaPassword, setMfaPassword] = useState('');
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [mfaDisablePassword, setMfaDisablePassword] = useState('');
  const [mfaDisableCode, setMfaDisableCode] = useState('');
  const [passkeys, setPasskeys] = useState<Array<{ id: string; name: string; device_type: string; backed_up: boolean; created_at: string }>>([]);
  const [passkeyPassword, setPasskeyPassword] = useState('');
  const [passkeyName, setPasskeyName] = useState('This device');
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyMessage, setPasskeyMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

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

    apiFetch<MfaStatusResponse>('/api/auth/mfa/status')
      .then((res) => { if (!cancelled) setMfaStatus(res.mfa); })
      .catch(() => { /* Non-fatal — MFA controls report their unavailable state below. */ });
    apiFetch<{ passkeys: Array<{ id: string; name: string; device_type: string; backed_up: boolean; created_at: string }> }>('/api/auth/passkeys')
      .then((res) => { if (!cancelled) setPasskeys(res.passkeys); })
      .catch(() => { /* Non-fatal — passkey controls report their unavailable state below. */ });

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

  async function addPasskey(e: FormEvent) {
    e.preventDefault(); setPasskeyBusy(true); setPasskeyMessage(null);
    try {
      const started = await apiFetch<{ challengeId: string; options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>('/api/auth/passkeys/register/options', { method:'POST', body:JSON.stringify({ password:passkeyPassword }) });
      const response = await startRegistration({ optionsJSON: started.options });
      const finished = await apiFetch<{ passkey: { id:string; name:string; device_type:string; backed_up:boolean; created_at:string } }>('/api/auth/passkeys/register/verify', { method:'POST', body:JSON.stringify({ challengeId:started.challengeId, name:passkeyName, response }) });
      setPasskeys((current) => [finished.passkey, ...current]); setPasskeyPassword(''); setPasskeyMessage({kind:'ok',text:'Passkey added.'});
    } catch (err) { setPasskeyMessage({kind:'error',text:err instanceof Error ? err.message : 'Could not add passkey.'}); }
    finally { setPasskeyBusy(false); }
  }

  async function removePasskey(id: string) {
    const password = window.prompt('Enter your current password to remove this passkey.');
    if (!password) return;
    setPasskeyBusy(true); setPasskeyMessage(null);
    try { await apiFetch(`/api/auth/passkeys/${id}`, { method:'DELETE', body:JSON.stringify({ password }) }); setPasskeys((current) => current.filter((item) => item.id !== id)); setPasskeyMessage({kind:'ok',text:'Passkey removed.'}); }
    catch (err) { setPasskeyMessage({kind:'error',text:err instanceof Error ? err.message : 'Could not remove passkey.'}); }
    finally { setPasskeyBusy(false); }
  }

  async function beginMfaEnrollment(e: FormEvent) {
    e.preventDefault();
    setMfaBusy(true);
    setMfaMessage(null);
    try {
      const result = await apiFetch<{ secret: string; otpauthUrl: string }>('/api/auth/mfa/totp/enroll', {
        method: 'POST',
        body: JSON.stringify({ password: mfaPassword }),
      });
      setMfaPassword('');
      setMfaSetup(result);
      setRecoveryCodes(null);
      setMfaMessage({ kind: 'ok', text: 'Add the secret to your authenticator app, then enter its current six-digit code to confirm.' });
    } catch (err) {
      setMfaMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not start multi-factor enrollment.' });
    } finally {
      setMfaBusy(false);
    }
  }

  async function confirmMfaEnrollment(e: FormEvent) {
    e.preventDefault();
    setMfaBusy(true);
    setMfaMessage(null);
    try {
      const result = await apiFetch<{ recoveryCodes: string[] }>('/api/auth/mfa/totp/confirm', {
        method: 'POST',
        body: JSON.stringify({ code: mfaCode }),
      });
      setMfaCode('');
      setMfaSetup(null);
      setRecoveryCodes(result.recoveryCodes);
      setMfaStatus({ enabled: true, recoveryCodesRemaining: result.recoveryCodes.length });
      setMe((current) => (current ? { ...current, mfaEnabled: true } : current));
      setMfaMessage({ kind: 'ok', text: 'Multi-factor authentication is enabled. Save every recovery code now; they will not be shown again.' });
    } catch (err) {
      setMfaMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not confirm multi-factor authentication.' });
    } finally {
      setMfaBusy(false);
    }
  }

  async function disableMfa(e: FormEvent) {
    e.preventDefault();
    setMfaBusy(true);
    setMfaMessage(null);
    try {
      const result = await apiFetch<{ message: string }>('/api/auth/mfa/disable', {
        method: 'POST',
        body: JSON.stringify({ password: mfaDisablePassword, code: mfaDisableCode }),
      });
      setMfaDisablePassword('');
      setMfaDisableCode('');
      setMfaSetup(null);
      setRecoveryCodes(null);
      setMfaStatus({ enabled: false, recoveryCodesRemaining: 0 });
      setMe((current) => (current ? { ...current, mfaEnabled: false } : current));
      setMfaMessage({ kind: 'ok', text: result.message });
    } catch (err) {
      setMfaMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not disable multi-factor authentication.' });
    } finally {
      setMfaBusy(false);
    }
  }

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
        <h2>Passkeys</h2>
        <p className="ch247-page__hint">Register a device passkey now. Passkey sign-in is not activated yet, so your password and MFA remain the login path.</p>
        {inSupportMode ? <p className="ch247-status-error">Passkey changes are blocked in support mode.</p> : (
          <form className="ch247-form ch247-form--wide" onSubmit={addPasskey}>
            <label><span className="ch247-field-label">Passkey name</span><input value={passkeyName} onChange={(e) => setPasskeyName(e.target.value)} maxLength={80} required /></label>
            <label><span className="ch247-field-label">Confirm your password</span><input type="password" value={passkeyPassword} onChange={(e) => setPasskeyPassword(e.target.value)} autoComplete="current-password" required /></label>
            <button type="submit" disabled={passkeyBusy}>{passkeyBusy ? 'Working…' : 'Add passkey'}</button>
          </form>
        )}
        {passkeys.length > 0 && <ul>{passkeys.map((passkey) => <li key={passkey.id}><strong>{passkey.name}</strong> — {passkey.device_type === 'multiDevice' ? 'synced passkey' : 'device passkey'} <button type="button" className="ch247-button ch247-button--outline" onClick={() => removePasskey(passkey.id)} disabled={passkeyBusy || inSupportMode}>Remove</button></li>)}</ul>}
        {passkeyMessage && <p className={passkeyMessage.kind === 'ok' ? 'ch247-status-ok' : 'ch247-status-error'}>{passkeyMessage.text}</p>}
      </div>

      <div className="ch247-card">
        <h2>Multi-factor authentication</h2>
        {mfaStatus ? (
          <p className="ch247-page__hint">
            {mfaStatus.enabled
              ? `Enabled with an authenticator app. ${mfaStatus.recoveryCodesRemaining} recovery code${mfaStatus.recoveryCodesRemaining === 1 ? '' : 's'} remaining.`
              : 'Not enabled. An authenticator app adds a second check when you log in.'}
          </p>
        ) : (
          <p className="ch247-page__hint">Multi-factor status is unavailable right now.</p>
        )}

        {inSupportMode ? (
          <p className="ch247-status-error">Multi-factor settings are blocked while an administrator is signed in to this account.</p>
        ) : mfaStatus?.enabled ? (
          <form className="ch247-form ch247-form--wide" onSubmit={disableMfa}>
            <label>
              <span className="ch247-field-label">Current password</span>
              <input type="password" value={mfaDisablePassword} onChange={(e) => setMfaDisablePassword(e.target.value)} autoComplete="current-password" required />
            </label>
            <label>
              <span className="ch247-field-label">Authenticator or recovery code</span>
              <input value={mfaDisableCode} onChange={(e) => setMfaDisableCode(e.target.value)} autoComplete="one-time-code" required />
            </label>
            <button type="submit" className="ch247-button ch247-button--outline" disabled={mfaBusy}>
              {mfaBusy ? 'Working…' : 'Disable multi-factor authentication'}
            </button>
          </form>
        ) : mfaSetup ? (
          <>
            <p className="ch247-page__hint">
              Add this setup key to your authenticator app. You may also paste the provisioning URI into a compatible app.
            </p>
            <p><code>{mfaSetup.secret}</code></p>
            <details>
              <summary>Show provisioning URI</summary>
              <p className="ch247-page__hint" style={{ overflowWrap: 'anywhere' }}>{mfaSetup.otpauthUrl}</p>
            </details>
            <form className="ch247-form ch247-form--wide" onSubmit={confirmMfaEnrollment}>
              <label>
                <span className="ch247-field-label">Authenticator code</span>
                <input value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" required />
              </label>
              <button type="submit" disabled={mfaBusy}>{mfaBusy ? 'Confirming…' : 'Confirm and enable MFA'}</button>
            </form>
          </>
        ) : (
          <form className="ch247-form ch247-form--wide" onSubmit={beginMfaEnrollment}>
            <label>
              <span className="ch247-field-label">Confirm your password to begin setup</span>
              <input type="password" value={mfaPassword} onChange={(e) => setMfaPassword(e.target.value)} autoComplete="current-password" required />
            </label>
            <button type="submit" disabled={mfaBusy || !mfaStatus}> {mfaBusy ? 'Starting…' : 'Set up authenticator app'} </button>
          </form>
        )}

        {recoveryCodes && (
          <div className="ch247-placeholder-notice">
            <strong>Save these recovery codes now.</strong>
            <p>Each can be used once if your authenticator is unavailable. They will not be shown again.</p>
            <ul>{recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ul>
          </div>
        )}
        {mfaMessage && <p className={mfaMessage.kind === 'ok' ? 'ch247-status-ok' : 'ch247-status-error'}>{mfaMessage.text}</p>}
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
