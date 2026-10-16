import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, describeError } from '../lib/api.js';
import { formatDate, humanizeStatus, statusClass } from '../lib/format.js';

const POLICY_FIELDS = [
  { key: 'rotationHours', label: 'Rotation window (hours)', min: 1, max: 8760 },
  { key: 'maxVerificationAttempts', label: 'Max verification attempts', min: 1, max: 100 },
  { key: 'attemptWindowSeconds', label: 'Attempt window (seconds)', min: 10, max: 86400 },
  { key: 'revealTtlSeconds', label: 'Reveal TTL (seconds)', min: 10, max: 3600 },
  { key: 'supportSessionMinutes', label: 'Support session (minutes)', min: 1, max: 240 },
];

/**
 * Security-number policy and per-user oversight. Admins never see the number or its hash — this
 * screen renders lifecycle metadata only (initialized, version, created/expires) and says so.
 * Force-rotate issues a new value the customer retrieves through their own step-up reveal; the
 * plaintext is discarded server-side. Require re-initialization and policy writes are super-admin
 * only — the server's refusal is shown verbatim for lower roles.
 */
export default function AdminSecurityNumberPage() {
  const [policy, setPolicy] = useState(null);
  const [draft, setDraft] = useState(null);
  const [users, setUsers] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [status, setStatus] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [polRes, userRes] = await Promise.all([adminApi.snPolicy(), adminApi.users()]);
      setPolicy(polRes.policy);
      setDraft(null);
      setUsers(userRes.users ?? []);
    } catch (e) {
      setError(describeError(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openUser = async (userId) => {
    setSelectedId(userId);
    setStatus(null);
    setError(''); setNotice('');
    if (!userId) return;
    try {
      const res = await adminApi.userSecurityNumber(userId);
      setStatus(res.securityNumber);
    } catch (e) {
      setError(describeError(e));
    }
  };

  const run = async (fn, message) => {
    setError(''); setNotice('');
    try {
      await fn();
      setNotice(message);
      if (selectedId) {
        const res = await adminApi.userSecurityNumber(selectedId);
        setStatus(res.securityNumber);
      }
      await load();
    } catch (e) {
      setError(describeError(e));
    }
  };

  const savePolicy = (event) => {
    event.preventDefault();
    return run(async () => {
      await adminApi.updateSnPolicy(draft ?? {});
      setDraft(null);
    }, 'Policy updated.');
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Security numbers</h1>
          <p className="muted">Policy and lifecycle oversight. The number and its hash are never shown to staff — customers retrieve their own value through a step-up reveal.</p>
        </div>
      </div>

      {notice && <div className="alert alert-success" role="status">{notice}</div>}
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {policy && (
        <section className="card">
          <h2>Policy</h2>
          <form className="nested-form" onSubmit={savePolicy}>
            <div className="form-row">
              {POLICY_FIELDS.map((field) => (
                <label key={field.key}>
                  <span>{field.label}</span>
                  <input type="number" min={field.min} max={field.max}
                    value={draft?.[field.key] ?? policy[field.key] ?? ''}
                    onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })} />
                </label>
              ))}
            </div>
            <div className="checks">
              <label>
                <input type="checkbox" checked={draft?.allowManualRotation ?? policy.allowManualRotation ?? false}
                  onChange={(e) => setDraft({ ...draft, allowManualRotation: e.target.checked })} />
                {' '}Allow manual rotation
              </label>
              <label>
                <input type="checkbox" checked={draft?.requireStepUp ?? policy.requireStepUp ?? false}
                  onChange={(e) => setDraft({ ...draft, requireStepUp: e.target.checked })} />
                {' '}Require step-up verification
              </label>
            </div>
            <p className="muted small">Policy writes are super-admin only. At least one setting must change; the server refuses an empty update.</p>
            <button className="btn btn-primary" disabled={!draft || Object.keys(draft).length === 0}>Save policy</button>
          </form>
        </section>
      )}

      <section className="card">
        <h2>User lifecycle</h2>
        <div className="form-row">
          <label>
            <span>User</span>
            <select value={selectedId} onChange={(e) => openUser(e.target.value)}>
              <option value="">Select a user…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName ?? u.email} · {u.role}</option>
              ))}
            </select>
          </label>
        </div>
        {status && (
          <>
            <dl className="detail-list">
              <dt>Initialized</dt>
              <dd>
                <span className={statusClass(status.initialized ? 'active' : 'pending')}>
                  {status.initialized ? 'Yes' : 'No — re-initialization required'}
                </span>
              </dd>
              <dt>Requires re-initialization</dt>
              <dd>{status.requiresReinitialization ? 'Yes' : 'No'}</dd>
              <dt>Version</dt>
              <dd>{status.version}</dd>
              <dt>Created</dt>
              <dd>{formatDate(status.createdAt, { withTime: true })}</dd>
              <dt>Expires</dt>
              <dd>{formatDate(status.expiresAt, { withTime: true })}</dd>
            </dl>
            <p className="muted small">The value and its hash are never returned by this console.</p>
            <div className="actions">
              <button className="btn btn-ghost" type="button"
                onClick={() => run(() => adminApi.rotateUserSecurityNumber(selectedId), 'Security number rotated. The customer retrieves the new value through their own step-up reveal.')}>
                Force rotate
              </button>
              <button className="btn btn-ghost" type="button"
                onClick={() => run(() => adminApi.requireSnReinitialization(selectedId), 'Re-initialization required.')}>
                Require re-initialization
              </button>
            </div>
          </>
        )}
        {!status && (
          <p className="muted">Select a user to see their security-number lifecycle.</p>
        )}
      </section>
    </div>
  );
}
