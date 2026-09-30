import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  forceRotateCustomerSecurityNumber,
  getCustomerSecurityNumberStatus,
  requireSecurityNumberReinitialization,
  switchToCustomerAccount,
} from '../lib/account-api';
import { getStoredUser, getToken, setSession, setSupportOrigin } from '../lib/auth';
import type { PublicUser, SecurityNumberStatus } from '../lib/account-types';

/**
 * Staff-side identity panel for one customer: Security Number oversight and "switch to this
 * account" (support mode).
 *
 * What an administrator can see here is deliberately limited to *lifecycle metadata* — when the
 * Security Number was issued, which version it is, when it expires. The value itself is not in
 * the API response and does not exist in recoverable form anywhere: only a bcrypt hash is stored.
 * Forcing a rotation issues a new number that only the customer can retrieve.
 */
export default function AdminCustomerIdentityPanel({
  customer,
  isSuperAdmin,
}: {
  customer: PublicUser;
  isSuperAdmin: boolean;
}) {
  const [status, setStatus] = useState<SecurityNumberStatus | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const navigate = useNavigate();

  const load = useCallback(() => {
    getCustomerSecurityNumberStatus(customer.id)
      .then((res) => setStatus(res.securityNumber))
      .catch(() => setStatus(null));
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
        actions, and records everything you do.
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
