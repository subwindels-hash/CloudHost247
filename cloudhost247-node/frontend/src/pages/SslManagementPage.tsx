import { useEffect, useState } from 'react';
import {
  fetchSslCertificates,
  requestSslCertificate,
  deleteSslCertificate,
  type SslCertificate,
} from '../lib/ssl-firewall-api';
import StatusBadge from '../components/StatusBadge';
import { usePageMeta } from '../lib/usePageMeta';

export default function SslManagementPage() {
  usePageMeta('SSL Certificates', 'Automated Let’s Encrypt and custom SSL certificate lifecycle.');
  const [certificates, setCertificates] = useState<SslCertificate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    domainName: '',
    sans: '',
    issuer: 'LETS_ENCRYPT',
    challengeType: 'HTTP_01',
    autoRenew: true,
  });

  function reload() {
    fetchSslCertificates()
      .then(({ certificates: rows }) => setCertificates(rows))
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.domainName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const sansArray = form.sans
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      const { certificate } = await requestSslCertificate({
        domainName: form.domainName.trim().toLowerCase(),
        sans: sansArray,
        issuer: form.issuer,
        challengeType: form.challengeType,
        autoRenew: form.autoRenew,
      });

      setMessage(`SSL Certificate requested for '${certificate.domain_name}'. Automated ACME validation in progress.`);
      setShowModal(false);
      setForm({ domainName: '', sans: '', issuer: 'LETS_ENCRYPT', challengeType: 'HTTP_01', autoRenew: true });
      reload();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string, domain: string) {
    if (!window.confirm(`Revoke / delete certificate for '${domain}'?`)) return;
    setBusy(true);
    try {
      await deleteSslCertificate(id);
      setMessage(`Certificate for '${domain}' removed.`);
      reload();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ch247-page">
      <header className="ch247-page__head">
        <div>
          <span className="ch247-eyebrow">Security & Encryption</span>
          <h1>SSL / TLS Certificates</h1>
          <p className="ch247-page__subtitle">
            Manage automated Let’s Encrypt certificates, custom SSL uploads, and automated 90-day renewal pipelines.
          </p>
        </div>
        <button className="ch247-btn ch247-btn--primary" onClick={() => setShowModal(!showModal)}>
          {showModal ? 'Cancel' : '+ Request SSL Certificate'}
        </button>
      </header>

      {error && <div className="ch247-banner ch247-banner--error">{error}</div>}
      {message && <div className="ch247-banner ch247-banner--info">{message}</div>}

      {showModal && (
        <form className="ch247-card ch247-form" onSubmit={handleSubmit}>
          <h2>Request New SSL Certificate</h2>
          <p className="ch247-page__hint">
            Certificates are automatically issued via ACME challenge verification.
          </p>
          <div className="ch247-form-grid">
            <label className="ch247-field">
              <span>Primary Domain Name</span>
              <input
                required
                placeholder="example.com"
                value={form.domainName}
                onChange={(e) => setForm({ ...form, domainName: e.target.value })}
              />
            </label>
            <label className="ch247-field">
              <span>Alternative Names (SANs - comma separated)</span>
              <input
                placeholder="www.example.com, api.example.com"
                value={form.sans}
                onChange={(e) => setForm({ ...form, sans: e.target.value })}
              />
            </label>
            <label className="ch247-field">
              <span>Issuer Authority</span>
              <select value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })}>
                <option value="LETS_ENCRYPT">Let’s Encrypt (Free / 90 Days)</option>
                <option value="ZERO_SSL">ZeroSSL</option>
                <option value="SELF_SIGNED">Self-Signed (Development)</option>
              </select>
            </label>
            <label className="ch247-field">
              <span>Challenge Method</span>
              <select value={form.challengeType} onChange={(e) => setForm({ ...form, challengeType: e.target.value })}>
                <option value="HTTP_01">HTTP-01 (Webroot / Traefik)</option>
                <option value="DNS_01">DNS-01 (TXT Record / Wildcard)</option>
              </select>
            </label>
          </div>

          <div className="ch247-checkbox-row">
            <label>
              <input
                type="checkbox"
                checked={form.autoRenew}
                onChange={(e) => setForm({ ...form, autoRenew: e.target.checked })}
              />
              Enable Automated Renewal (30 days prior to expiry)
            </label>
          </div>

          <div className="ch247-actions">
            <button type="submit" className="ch247-btn ch247-btn--primary" disabled={busy}>
              {busy ? 'Requesting...' : 'Issue Certificate'}
            </button>
            <button type="button" className="ch247-btn" onClick={() => setShowModal(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <section className="ch247-card">
        <h2>Your Certificates</h2>
        {!certificates && <div className="ch247-loading">Loading SSL certificates...</div>}
        {certificates && certificates.length === 0 && (
          <div className="ch247-empty">
            <p>No active SSL certificates found.</p>
          </div>
        )}
        {certificates && certificates.length > 0 && (
          <div className="ch247-table-wrap">
            <table className="ch247-table">
              <thead>
                <tr>
                  <th>Domain Name</th>
                  <th>Issuer</th>
                  <th>Challenge</th>
                  <th>Status</th>
                  <th>Auto-Renew</th>
                  <th>Expires</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {certificates.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.domain_name}</strong>
                      {c.sans.length > 0 && (
                        <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                          + {c.sans.join(', ')}
                        </div>
                      )}
                    </td>
                    <td><span className="ch247-badge">{c.issuer.replace(/_/g, ' ')}</span></td>
                    <td><span className="ch247-pill">{c.challenge_type}</span></td>
                    <td><StatusBadge status={c.status} /></td>
                    <td>{c.auto_renew ? '✓ Yes' : 'No'}</td>
                    <td>
                      <small>{c.expires_at ? new Date(c.expires_at).toLocaleDateString() : 'Pending'}</small>
                    </td>
                    <td>
                      <button
                        className="ch247-btn ch247-btn--sm ch247-btn--danger"
                        disabled={busy}
                        onClick={() => handleDelete(c.id, c.domain_name)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
