import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import InfrastructureNav from '../components/InfrastructureNav';
import StatusBadge from '../components/StatusBadge';
import { usePageMeta } from '../lib/usePageMeta';

interface License {
  id: string;
  customerId: string;
  customerEmail?: string;
  customerName?: string;
  controlPanelId: string;
  panelName?: string;
  panelSlug?: string;
  licenseKey: string;
  licenseType: string;
  provider: string;
  status: string;
  activatedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export default function AdminLicensesPage() {
  usePageMeta('Licenses Manager', 'Admin — Manage commercial control panel licenses and activations.');
  const [licenses, setLicenses] = useState<License[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState('');

  async function load() {
    try {
      const query = filter ? `?status=${filter}` : '';
      const data = await apiFetch<{ licenses: License[] }>(`/api/v1/licenses${query}`);
      setLicenses(data.licenses);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load licenses');
    }
  }

  useEffect(() => {
    void load();
  }, [filter]);

  async function handleActivate(id: string) {
    setBusy(`act:${id}`);
    try {
      await apiFetch(`/api/v1/licenses/${id}/activate`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to activate license');
    } finally {
      setBusy('');
    }
  }

  async function handleRenew(id: string) {
    setBusy(`ren:${id}`);
    try {
      const newExpiry = new Date(Date.now() + 365 * 86400 * 1000).toISOString();
      await apiFetch(`/api/v1/licenses/${id}/renew`, {
        method: 'POST',
        body: JSON.stringify({ expiresAt: newExpiry }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to renew license');
    } finally {
      setBusy('');
    }
  }

  async function handleCancel(id: string) {
    setBusy(`can:${id}`);
    try {
      await apiFetch(`/api/v1/licenses/${id}/cancel`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel license');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="ch247-stack">
      <section className="ch247-card ch247-section-heading">
        <div>
          <span className="ch247-eyebrow">Admin · Infrastructure</span>
          <h1>Control Panel Licenses</h1>
          <p className="ch247-page__hint">
            Active commercial licenses for cPanel, Plesk, DirectAdmin, Webuzo, Cloudron, and FASTPANEL.
          </p>
        </div>
        <label className="ch247-field">
          Status
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="PENDING">PENDING</option>
            <option value="EXPIRED">EXPIRED</option>
            <option value="SUSPENDED">SUSPENDED</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
        </label>
      </section>

      <InfrastructureNav active="licenses" />

      {error && <div className="ch247-banner ch247-banner--error">{error}</div>}

      {!licenses && !error && <div className="ch247-loading">Loading licenses…</div>}

      {licenses && licenses.length === 0 && (
        <div className="ch247-card ch247-empty">
          <p>No licenses match the selected criteria.</p>
        </div>
      )}

      {licenses && licenses.length > 0 && (
        <section className="ch247-card">
          <div className="ch247-table-wrap">
            <table className="ch247-table">
              <thead>
                <tr>
                  <th>Panel / Type</th>
                  <th>Customer</th>
                  <th>License Key</th>
                  <th>Provider</th>
                  <th>Status</th>
                  <th>Expires</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {licenses.map((lic) => (
                  <tr key={lic.id}>
                    <td>
                      <strong>{lic.panelName ?? lic.controlPanelId.slice(0, 8)}</strong>
                      <div className="ch247-text-muted" style={{ fontSize: '0.85rem' }}>
                        {lic.licenseType}
                      </div>
                    </td>
                    <td>
                      <div>{lic.customerEmail ?? lic.customerId.slice(0, 8)}</div>
                      {lic.customerName && (
                        <small className="ch247-text-muted">{lic.customerName}</small>
                      )}
                    </td>
                    <td>
                      <code>{lic.licenseKey}</code>
                    </td>
                    <td>
                      <span className="ch247-tag">{lic.provider}</span>
                    </td>
                    <td>
                      <StatusBadge status={lic.status} />
                    </td>
                    <td>
                      {lic.expiresAt
                        ? new Date(lic.expiresAt).toLocaleDateString()
                        : 'Never (Perpetual)'}
                    </td>
                    <td>
                      <div className="ch247-actions">
                        {lic.status !== 'ACTIVE' && (
                          <button
                            type="button"
                            className="ch247-btn ch247-btn--sm"
                            disabled={busy !== ''}
                            onClick={() => void handleActivate(lic.id)}
                          >
                            Activate
                          </button>
                        )}
                        <button
                          type="button"
                          className="ch247-btn ch247-btn--sm"
                          disabled={busy !== ''}
                          onClick={() => void handleRenew(lic.id)}
                        >
                          Renew +1Y
                        </button>
                        {lic.status === 'ACTIVE' && (
                          <button
                            type="button"
                            className="ch247-btn ch247-btn--sm ch247-btn--danger"
                            disabled={busy !== ''}
                            onClick={() => void handleCancel(lic.id)}
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
