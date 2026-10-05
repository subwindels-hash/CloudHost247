import React, { useEffect, useState } from 'react';
import { authApi, describeError } from '../lib/api.js';
// The WebAuthn ceremony helper is shared with the public site, so both frontends marshal the
// base64url <-> ArrayBuffer boundary through exactly one implementation.
import { createPasskey, isPasskeySupported } from '../../../public/assets/js/webauthn.js';

export default function SecurityPage() {
  const [status, setStatus] = useState(null);
  const [enrolment, setEnrolment] = useState(null);
  const [recovery, setRecovery] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [passkeys, setPasskeys] = useState(null);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [addingPasskey, setAddingPasskey] = useState(false);

  const loadPasskeys = () => authApi.passkeys()
    .then((data) => setPasskeys(data.passkeys))
    .catch(() => setPasskeys([]));

  useEffect(() => {
    authApi.mfaStatus().then(setStatus).catch(() => setStatus(null));
    setPasskeySupported(isPasskeySupported());
    loadPasskeys();
  }, []);

  const addPasskey = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    setAddingPasskey(true);
    try {
      // The server re-checks the password; the client only sends it and does not gate on it.
      const options = await authApi.passkeyRegisterOptions(data.password);
      const response = await createPasskey(options.options);
      const created = await authApi.passkeyRegisterVerify(
        options.challengeId, response, data.name?.trim() || 'Passkey',
      );
      setMessage(`"${created.passkey.name}" registered. You can now sign in with this device.`);
      form.reset();
      await loadPasskeys();
    } catch (err) {
      if (err?.name === 'NotAllowedError') {
        setError('The passkey ceremony was cancelled, or the device refused it.');
      } else {
        setError(describeError(err));
      }
    } finally {
      setAddingPasskey(false);
    }
  };

  const renamePasskey = async (event, id, currentName) => {
    event.preventDefault();
    setError('');
    setMessage('');
    const name = event.currentTarget.name.value.trim();
    if (!name || name === currentName) return;
    try {
      await authApi.passkeyRename(id, name);
      setMessage('Passkey renamed.');
      await loadPasskeys();
    } catch (err) {
      setError(describeError(err));
    }
  };

  const removePasskey = async (event, id) => {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      await authApi.passkeyRemove(id, event.currentTarget.password.value);
      setMessage('Passkey removed.');
      await loadPasskeys();
    } catch (err) {
      setError(describeError(err));
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (data.newPassword !== data.confirm) {
      setError('The new passwords do not match.');
      return;
    }
    try {
      await authApi.changePassword(data.currentPassword, data.newPassword);
      setMessage('Password changed. You stay signed in on this device only.');
      event.currentTarget.reset();
    } catch (err) {
      setError(describeError(err));
    }
  };

  const startEnrol = async () => {
    setError('');
    try {
      const data = await authApi.mfaEnroll();
      setEnrolment(data);
    } catch (err) {
      setError(describeError(err));
    }
  };

  const confirmEnrol = async (event) => {
    event.preventDefault();
    setError('');
    const code = event.currentTarget.code.value.trim();
    try {
      const data = await authApi.mfaConfirm(code);
      setRecovery(data.recoveryCodes);
      setEnrolment(null);
      setStatus((s) => ({ ...s, enabled: true }));
    } catch (err) {
      setError(describeError(err));
    }
  };

  const disable = async (event) => {
    event.preventDefault();
    setError('');
    const password = event.currentTarget.password.value;
    try {
      await authApi.mfaDisable(password);
      setStatus((s) => ({ ...s, enabled: false }));
      setMessage('Two-factor authentication disabled.');
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Security</h1><p className="muted">Password and two-factor authentication.</p></div>
        {status && (
          <span className={`pill ${status.enabled ? 'pill-ok' : 'pill-warn'}`}>
            {status.enabled ? 'Two-factor on' : 'Two-factor off'}
          </span>
        )}
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {message && <div className="alert alert-success" role="status">{message}</div>}

      <div className="grid-2">
        <section className="card">
          <h2>Change password</h2>
          <form onSubmit={changePassword}>
            <div className="field">
              <label htmlFor="current">Current password</label>
              <input id="current" name="currentPassword" type="password" autoComplete="current-password" required />
            </div>
            <div className="field">
              <label htmlFor="new">New password</label>
              <input id="new" name="newPassword" type="password" autoComplete="new-password" minLength="12" required />
            </div>
            <div className="field">
              <label htmlFor="confirm">Confirm new password</label>
              <input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
            </div>
            <button className="btn btn-primary" type="submit">Update password</button>
          </form>
        </section>

        <section className="card">
          <h2>Two-factor authentication</h2>
          {status?.enabled ? (
            <>
              <p className="muted">
                Two-factor is enabled. {status.recoveryCodesRemaining} recovery codes remain.
              </p>
              <form onSubmit={disable}>
                <div className="field">
                  <label htmlFor="password">Password (to disable)</label>
                  <input id="password" name="password" type="password" autoComplete="current-password" required />
                </div>
                <button className="btn btn-ghost" type="submit">Disable two-factor</button>
              </form>
            </>
          ) : enrolment ? (
            <>
              <p className="muted">
                Scan this code with your authenticator app, or paste the secret if you cannot scan.
              </p>
              {enrolment.qrPngDataUri ? (
                <img
                  src={enrolment.qrPngDataUri}
                  alt="Two-factor enrolment QR code"
                  width={192}
                  height={192}
                  style={{ imageRendering: 'pixelated', display: 'block', margin: '8px 0' }}
                />
              ) : (
                <p className="muted">
                  This server did not return a QR image. Paste the secret below, or add the account
                  link manually: <span className="code">{enrolment.otpauthUri}</span>
                </p>
              )}
              <p className="code">{enrolment.secret}</p>
              <form onSubmit={confirmEnrol}>
                <div className="field">
                  <label htmlFor="code">Code</label>
                  <input id="code" name="code" inputMode="numeric" maxLength="6" required />
                </div>
                <button className="btn btn-primary" type="submit">Confirm and enable</button>
              </form>
            </>
          ) : (
            <>
              <p className="muted">Protect your account with a code from an authenticator app.</p>
              <button className="btn btn-primary" type="button" onClick={startEnrol}>Set up two-factor</button>
            </>
          )}
        </section>
      </div>

      <section className="card">
        <h2>Passkeys</h2>
        {!passkeySupported ? (
          <p className="muted">
            This browser or device cannot use passkeys. Open this page on a device with a platform
            authenticator (Face ID, Touch ID, Windows Hello, or a hardware security key).
          </p>
        ) : (
          <>
            <p className="muted">
              Sign in without typing your password. A passkey stays on your device and never leaves it —
              the server only ever stores its public half.
            </p>

            {passkeys === null ? (
              <p className="muted">Loading passkeys…</p>
            ) : passkeys.length === 0 ? (
              <p className="muted">No passkeys yet.</p>
            ) : (
              <ul className="list">
                {passkeys.map((passkey) => (
                  <li key={passkey.id} className="list-row">
                    <form onSubmit={(event) => renamePasskey(event, passkey.id, passkey.name)}>
                      <input name="name" defaultValue={passkey.name} aria-label="Passkey name" maxLength="64" />
                      <button className="btn btn-ghost" type="submit">Rename</button>
                    </form>
                    <p className="muted" style={{ margin: '4px 0 8px' }}>
                      Added {new Date(passkey.createdAt).toLocaleDateString()}
                      {passkey.lastUsedAt ? ` · last used ${new Date(passkey.lastUsedAt).toLocaleDateString()}` : ' · never used'}
                    </p>
                    <form onSubmit={(event) => removePasskey(event, passkey.id)}>
                      <div className="field">
                        <label htmlFor={`pw-${passkey.id}`}>Password (to remove)</label>
                        <input id={`pw-${passkey.id}`} name="password" type="password" autoComplete="current-password" required />
                      </div>
                      <button className="btn btn-ghost" type="submit">Remove</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}

            <form onSubmit={addPasskey}>
              <div className="field">
                <label htmlFor="passkey-name">Device name</label>
                <input id="passkey-name" name="name" placeholder="Work laptop" maxLength="64" />
              </div>
              <div className="field">
                <label htmlFor="passkey-password">Current password</label>
                <input id="passkey-password" name="password" type="password" autoComplete="current-password" required />
              </div>
              <button className="btn btn-primary" type="submit" disabled={addingPasskey}>
                {addingPasskey ? 'Waiting for your device…' : 'Add a passkey'}
              </button>
            </form>
          </>
        )}
      </section>

      {recovery && (
        <section className="card">
          <h2>Recovery codes — save these now</h2>
          <p className="muted">Each code works once, if you ever lose your authenticator.</p>
          <ul className="recovery">
            {recovery.map((code) => <li key={code}><code>{code}</code></li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
