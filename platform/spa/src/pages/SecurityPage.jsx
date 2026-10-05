import React, { useEffect, useState } from 'react';
import { authApi, describeError } from '../lib/api.js';

export default function SecurityPage() {
  const [status, setStatus] = useState(null);
  const [enrolment, setEnrolment] = useState(null);
  const [recovery, setRecovery] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    authApi.mfaStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

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
              <p className="muted">Scan or paste this secret into your authenticator app, then enter the code.</p>
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
