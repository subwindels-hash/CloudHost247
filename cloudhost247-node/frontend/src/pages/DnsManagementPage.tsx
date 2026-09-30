import { useEffect, useState } from 'react';
import {
  fetchDnsZones,
  fetchDnsZone,
  createDnsZone,
  deleteDnsZone,
  createDnsRecord,
  deleteDnsRecord,
  type DnsZone,
  type DnsRecord,
  type DnsRecordType,
} from '../lib/dns-api';
import StatusBadge from '../components/StatusBadge';
import { usePageMeta } from '../lib/usePageMeta';

export default function DnsManagementPage() {
  usePageMeta('DNS Management', 'Manage authoritative DNS zones and records for your CloudHost247 infrastructure.');
  const [zones, setZones] = useState<DnsZone[] | null>(null);
  const [selectedZone, setSelectedZone] = useState<DnsZone | null>(null);
  const [records, setRecords] = useState<DnsRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showAddZone, setShowAddZone] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [busy, setBusy] = useState(false);

  // New Record Form State
  const [recordForm, setRecordForm] = useState<{
    name: string;
    type: DnsRecordType;
    content: string;
    ttl: number;
    priority: string;
  }>({
    name: '@',
    type: 'A',
    content: '',
    ttl: 3600,
    priority: '10',
  });

  function reloadZones() {
    fetchDnsZones()
      .then(({ zones: rows }) => {
        setZones(rows);
        if (selectedZone) {
          const fresh = rows.find((z) => z.id === selectedZone.id);
          if (fresh) loadZoneRecords(fresh);
          else {
            setSelectedZone(null);
            setRecords([]);
          }
        }
      })
      .catch((err) => setError(err.message));
  }

  function loadZoneRecords(zone: DnsZone) {
    setSelectedZone(zone);
    setError(null);
    fetchDnsZone(zone.id)
      .then(({ records: rows }) => setRecords(rows))
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    reloadZones();
  }, []);

  async function handleCreateZone(e: React.FormEvent) {
    e.preventDefault();
    if (!newDomain.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { zone } = await createDnsZone(newDomain.trim());
      setMessage(`DNS zone '${zone.domain_name}' created successfully.`);
      setNewDomain('');
      setShowAddZone(false);
      reloadZones();
      loadZoneRecords(zone);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteZone(zoneId: string, domainName: string) {
    if (!window.confirm(`Are you sure you want to delete the DNS zone for '${domainName}'? All records will be permanently erased.`)) return;
    setBusy(true);
    try {
      await deleteDnsZone(zoneId);
      setMessage(`Zone '${domainName}' deleted.`);
      if (selectedZone?.id === zoneId) {
        setSelectedZone(null);
        setRecords([]);
      }
      reloadZones();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddRecord(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedZone) return;
    setBusy(true);
    setError(null);
    try {
      await createDnsRecord(selectedZone.id, {
        name: recordForm.name,
        type: recordForm.type,
        content: recordForm.content,
        ttl: Number(recordForm.ttl),
        priority: recordForm.type === 'MX' ? Number(recordForm.priority) : null,
      });
      setMessage(`DNS ${recordForm.type} record for '${recordForm.name}' added.`);
      setRecordForm({ name: '@', type: 'A', content: '', ttl: 3600, priority: '10' });
      loadZoneRecords(selectedZone);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteRecord(recordId: string) {
    if (!selectedZone) return;
    setBusy(true);
    try {
      await deleteDnsRecord(selectedZone.id, recordId);
      setMessage('Record deleted.');
      loadZoneRecords(selectedZone);
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
          <span className="ch247-eyebrow">Networking & Routing</span>
          <h1>DNS Management & Zones</h1>
          <p className="ch247-page__subtitle">
            Configure authoritative DNS records (A, AAAA, CNAME, TXT, MX, NS) and point your domains to CloudHost247 VPS and control panels.
          </p>
        </div>
        <button
          className="ch247-btn ch247-btn--primary"
          onClick={() => setShowAddZone(!showAddZone)}
        >
          {showAddZone ? 'Cancel' : '+ Add DNS Zone'}
        </button>
      </header>

      {error && <div className="ch247-banner ch247-banner--error">{error}</div>}
      {message && <div className="ch247-banner ch247-banner--info">{message}</div>}

      {showAddZone && (
        <form className="ch247-card ch247-form" onSubmit={handleCreateZone}>
          <h2>Create New DNS Zone</h2>
          <p className="ch247-page__hint">
            Enter your root domain name (e.g. <code>example.com</code>). You will be assigned CloudHost247 authoritative nameservers.
          </p>
          <div className="ch247-form-grid">
            <label className="ch247-field">
              <span>Domain Name</span>
              <input
                required
                placeholder="example.com"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
              />
            </label>
          </div>
          <div className="ch247-actions">
            <button type="submit" className="ch247-btn ch247-btn--primary" disabled={busy}>
              {busy ? 'Creating...' : 'Create Zone'}
            </button>
            <button type="button" className="ch247-btn" onClick={() => setShowAddZone(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="ch247-server-layout">
        {/* Zones List */}
        <section className="ch247-card">
          <h2>Your DNS Zones</h2>
          {!zones && <div className="ch247-loading">Loading DNS zones...</div>}
          {zones && zones.length === 0 && (
            <div className="ch247-empty">
              <p>No active DNS zones found.</p>
            </div>
          )}
          {zones && zones.length > 0 && (
            <ul className="ch247-zone-list" style={{ listStyle: 'none', padding: 0, margin: '1rem 0' }}>
              {zones.map((zone) => (
                <li
                  key={zone.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '0.85rem 1rem',
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    marginBottom: '0.5rem',
                    background: selectedZone?.id === zone.id ? '#e9f1ff' : '#fff',
                    cursor: 'pointer',
                  }}
                  onClick={() => loadZoneRecords(zone)}
                >
                  <div>
                    <strong style={{ fontSize: '1rem', color: '#0f172a' }}>{zone.domain_name}</strong>
                    <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                      Nameservers: {zone.nameservers.join(', ')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <StatusBadge status={zone.status} />
                    <button
                      className="ch247-btn ch247-btn--danger ch247-btn--sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteZone(zone.id, zone.domain_name);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Selected Zone Records Management */}
        {selectedZone && (
          <section className="ch247-card">
            <div className="ch247-section-heading">
              <div>
                <span className="ch247-eyebrow">Zone Records</span>
                <h2>{selectedZone.domain_name}</h2>
              </div>
            </div>

            <div style={{ margin: '1rem 0', background: '#f8fafc', padding: '0.85rem', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 600 }}>AUTHORITATIVE NAMESERVERS</span>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.35rem', fontFamily: 'monospace', fontSize: '0.9rem' }}>
                {selectedZone.nameservers.map((ns) => (
                  <span key={ns} className="ch247-pill ch247-pill--lg">{ns}</span>
                ))}
              </div>
            </div>

            {/* Add Record Form */}
            <form className="ch247-card ch247-form" style={{ marginTop: '1rem' }} onSubmit={handleAddRecord}>
              <h3>+ Add Record</h3>
              <div className="ch247-form-grid">
                <label className="ch247-field">
                  <span>Name (@ or subdomain)</span>
                  <input
                    required
                    value={recordForm.name}
                    onChange={(e) => setRecordForm({ ...recordForm, name: e.target.value })}
                    placeholder="@ or www"
                  />
                </label>
                <label className="ch247-field">
                  <span>Type</span>
                  <select
                    value={recordForm.type}
                    onChange={(e) => setRecordForm({ ...recordForm, type: e.target.value as DnsRecordType })}
                  >
                    <option value="A">A (IPv4)</option>
                    <option value="AAAA">AAAA (IPv6)</option>
                    <option value="CNAME">CNAME (Alias)</option>
                    <option value="TXT">TXT (Text)</option>
                    <option value="MX">MX (Mail)</option>
                    <option value="NS">NS (Nameserver)</option>
                    <option value="CAA">CAA</option>
                  </select>
                </label>
                <label className="ch247-field">
                  <span>Value / Target</span>
                  <input
                    required
                    value={recordForm.content}
                    onChange={(e) => setRecordForm({ ...recordForm, content: e.target.value })}
                    placeholder="198.51.100.1 or target.com"
                  />
                </label>
                {recordForm.type === 'MX' && (
                  <label className="ch247-field">
                    <span>Priority</span>
                    <input
                      type="number"
                      value={recordForm.priority}
                      onChange={(e) => setRecordForm({ ...recordForm, priority: e.target.value })}
                    />
                  </label>
                )}
                <label className="ch247-field">
                  <span>TTL (Seconds)</span>
                  <input
                    type="number"
                    value={recordForm.ttl}
                    onChange={(e) => setRecordForm({ ...recordForm, ttl: Number(e.target.value) })}
                  />
                </label>
              </div>
              <div className="ch247-actions">
                <button type="submit" className="ch247-btn ch247-btn--primary" disabled={busy}>
                  Save Record
                </button>
              </div>
            </form>

            {/* Records Table */}
            <div className="ch247-table-wrap" style={{ marginTop: '1.5rem' }}>
              <table className="ch247-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Name</th>
                    <th>Value</th>
                    <th>TTL</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id}>
                      <td><span className="ch247-badge">{r.type}</span></td>
                      <td><strong>{r.name}</strong></td>
                      <td><code style={{ fontSize: '0.82rem' }}>{r.content}</code></td>
                      <td><small>{r.ttl}s</small></td>
                      <td>
                        <button
                          className="ch247-btn ch247-btn--sm ch247-btn--danger"
                          disabled={busy}
                          onClick={() => handleDeleteRecord(r.id)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
