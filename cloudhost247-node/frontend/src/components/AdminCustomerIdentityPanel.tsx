import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  forceRotateCustomerSecurityNumber,
  getCustomerSecurityNumberStatus,
  getCustomerSecurityPinStatus,
  requireSecurityNumberReinitialization,
  rotateCustomerSecurityPin,
  switchToCustomerAccount,
} from '../lib/account-api';
import { getStoredUser, getToken, setSession, setSupportOrigin } from '../lib/auth';
import type { PublicUser, SecurityNumberStatus, SecurityPinStatus } from '../lib/account-types';

/**
 * Staff-side identity panel for one customer: Security Number oversight and "switch to this
 * account" (support mode).
 *
 * What an administrator can see here is deliberately limited to *lifecycle metadata* — when the
 * Security Number was issued, which version it is, when it expires. The value itself is not in
 * the API response and does not exist in recoverable form anywhere: only a bcrypt hash is stored.
 * Forcing a rotation issues a new number that only the customer can retrieve.
 *
 * The same rule governs the rotating Security PIN, and it is enforced by the API rather than by
 * this component: `/admin/users/:id/security-pin` returns lifecycle metadata, and its rotate
 * endpoint re-seals a new PIN for the customer without returning it. So there is nothing here for
 * an administrator to read even if they wanted to, and the support-mode switch below cannot be
 * used as a side door either — the PIN endpoints refuse a delegated session outright.
 */
export default function AdminCustomerIdentityPanel({
  customer,
  isSuperAdmin,
}: {
  customer: PublicUser;
  isSuperAdmin: boolean;
}) {
  const [status, setStatus] = useState<SecurityNumberStatus | null>(null);
  const [pinStatus, setPinStatus] = useState<SecurityPinStatus | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const navigate = useNavigate();

  const load = useCallback(() => {
    getCustomerSecurityNumberStatus(customer.id)
      .then((res) => setStatus(res.securityNumber))
      .catch(() => setStatus(null));
    getCustomerSecurityPinStatus(customer.id)
      .then((res) => setPinStatus(res.securityPin))
      .catch(() => setPinStatus(null));
  }, [customer.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(action: () => Promise<{ securityNumber: SecurityNumberStatus }>, okText: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await action();
      setStatus(res.securityNumber);
      setMessage({ kind: 'ok', text: okText });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'That action could not be completed.' });
    } finally {
      setBusy(false);
    }
  }

  async function rotatePin() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await rotateCustomerSecurityPin(customer.id);
      setPinStatus(res.securityPin);
      setMessage({
        kind: 'ok',
        text: 'A new Security PIN has been issued. The customer must verify their email to see it — it was not shown to you.',
      });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'The PIN could not be rotated.' });
    } finally {
      setBusy(false);
    }
  }

  async function onSwitch(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const adminToken = getToken();
      const adminUser = getStoredUser();
      const res = await switchToCustomerAccount(customer.id, reason);
      if (adminToken && adminUser) {
        // Park the administrator's own session so "Exit support mode" restores it in one click.
        setSupportOrigin({
          token: adminToken,
          user: adminUser,
          sessionId: res.supportSession.id,
          targetName: res.supportSession.targetFullName,
          targetCustomerId: res.supportSession.targetCustomerId,
          expiresAt: res.supportSession.expiresAt,
        });
      }
      setSession(res.token, {
        id: res.supportSession.targetUserId,
        email: res.supportSession.targetEmail,
        fullName: res.supportSession.targetFullName,
        role: 'customer',
      });
      navigate('/dashboard');
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not start a support session.' });
      setBusy(false);
    }
  }

  return (
    <div className="ch247-card">
      <h2>Identity &amp; security</h2>
      <dl className="ch247-definition-list">
        <dt>Customer ID</dt>
        <dd data-testid="admin-customer-id">{customer.customerId ?? '—'}</dd>
        <dt>Username</dt>
        <dd data-testid="admin-username">{customer.username ?? '—'}</dd>
        <dt>Security Number</dt>
        <dd>
          {status
            ? status.initialized
              ? `${status.expired ? 'Expired' : 'Active'} · version ${status.version}`
              : 'Awaiting re-initialization'
            : 'Unavailable'}
        </dd>
        <dt>Expires</dt>
        <dd>{status?.expiresAt ? new Date(status.expiresAt).toLocaleString() : '—'}</dd>
        <dt>Security PIN</dt>
        <dd data-testid="admin-security-pin">
          {pinStatus
            ? `•••• · version ${pinStatus.version} · rotates every ${pinStatus.rotationHours}h`
            : 'Unavailable'}
        </dd>
        <dt>PIN next rotation</dt>
        <dd>{pinStatus?.nextRotationAt ? new Date(pinStatus.nextRotationAt).toLocaleString() : '—'}</dd>
      </dl>
      <p className="ch247-page__hint">
        The Security Number itself is never visible to staff — we store only a one-way hash. If a
        customer cannot access theirs, force a rotation and ask them to view the new one from their
        own account page.
      </p>

      <div className="ch247-inline-actions">
        <button
          type="button"
          className="ch247-button ch247-button--outline ch247-button--small"
          disabled={busy}
          onClick={() => run(() => forceRotateCustomerSecurityNumber(customer.id), 'A new Security Number has been issued.')}
        >
          Force rotation
        </button>
        <button
          type="button"
          className="ch247-button ch247-button--outline ch247-button--small"
          disabled={busy}
          onClick={rotatePin}
        >
          Rotate Security PIN
        </button>
        {isSuperAdmin && (
          <button
            type="button"
            className="ch247-button ch247-button--danger ch247-button--small"
            disabled={busy}
            onClick={() =>
              run(
                () => requireSecurityNumberReinitialization(customer.id),
                'The customer must set up a new Security Number.'
              )
            }
          >
            Require re-initialization
          </button>
        )}
      </div>

      <h3>Support mode</h3>
      <p className="ch247-page__hint">
        Signing in to this account never uses or reveals the customer&apos;s password or Security
        Number. It creates a separate, time-limited session that stays attached to your admin
        identity, shows the customer-facing screens exactly as they see them, blocks sensitive
        actions, and records everything you do. In particular, the customer&apos;s Security PIN stays
        locked while you are signed in as them.
      </p>
      <form className="ch247-form ch247-form--wide" onSubmit={onSwitch}>
        <label>
          <span className="ch247-field-label">Reason (recorded in the audit log)</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={255} />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? 'Working…' : 'Switch to this account'}
        </button>
      </form>

      {message && <p className={message.kind === 'ok' ? 'ch247-status-ok' : 'ch247-status-error'}>{message.text}</p>}
    </div>
  );
}
