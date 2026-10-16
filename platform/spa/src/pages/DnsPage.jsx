import React, { useCallback, useEffect, useState } from 'react';
import { dnsApi, describeError } from '../lib/api.js';
import { statusClass, humanizeStatus } from '../lib/format.js';

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA', 'PTR', 'SOA'];
const PRIORITY_TYPES = new Set(['MX', 'SRV']);
const EMPTY_RECORD = { name: '@', type: 'A', content: '', ttl: 3600, priority: '', proxied: false };

/**
 * Customer DNS management.
 *
 * Zones and records are stored on the platform as the authoritative source of truth. The screen
 * supports the full CRUD the /dns API exposes, plus the two verification tools: RFC 1035 zone
 * export and live resolver propagation checks (which report honestly when the zone is not
 * resolvable yet).
 */
export default function DnsPage() {
  const [zones, setZones] = useState(null);
  const [zone, setZone] = useState(null);
  const [records, setRecords] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [showZoneForm, setShowZoneForm] = useState(false);
  const [zoneDomain, setZoneDomain] = useState('');
  const [recordForm, setRecordForm] = useState(EMPTY_RECORD);
  const [editingId, setEditingId] = useState(null);
  const [showRecordForm, setShowRecordForm] = useState(false);
  const [zoneFile, setZoneFile] = useState('');
  const [checks, setChecks] = useState({});

  const run = async (action, message) => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const result = await action();
      if (message) setNotice(message);
      return result;
    } catch (e) {
      setError(describeError(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const loadZones = useCallback(async () => {
    setError('');
    try {
      const res = await dnsApi.zones();
      setZones(res.zones ?? []);
    } catch (e) {
      setZones([]);
      setError(describeError(e));
    }
  }, []);

  const openZone = useCallback(async (z) => {
    setError('');
    setZoneFile('');
    setChecks({});
    try {
      const res = await dnsApi.zone(z.id);
      setZone(res.zone);
      setRecords(res.records ?? []);
    } catch (e) {
      setError(describeError(e));
    }
  }, []);

  useEffect(() => { loadZones(); }, [loadZones]);

  const createZone = async (e) => {
    e.preventDefault();
    await run(async () => {
      await dnsApi.createZone(zoneDomain.trim());
      setZoneDomain('');
      setShowZoneForm(false);
      await loadZones();
    }, 'DNS zone created with CloudHost247 nameservers.');
  };

  const deleteZone = async (z) => {
    if (!window.confirm(`Delete the DNS zone ${z.domain} and all of its records?`)) return;
    await run(async () => {
      await dnsApi.deleteZone(z.id);
      if (zone?.id === z.id) { setZone(null); setRecords(null); }
      await loadZones();
    }, 'DNS zone deleted.');
  };

  const recordField = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setRecordForm((f) => ({ ...f, [key]: value }));
  };

  const submitRecord = async (e) => {
    e.preventDefault();
    const payload = {
      name: recordForm.name.trim() || '@',
      type: recordForm.type,
      content: recordForm.content.trim(),
      ttl: Number(recordForm.ttl) || 3600,
      proxied: !!recordForm.proxied,
    };
    if (PRIORITY_TYPES.has(payload.type)) payload.priority = recordForm.priority === '' ? undefined : Number(recordForm.priority);
    await run(async () => {
      if (editingId) await dnsApi.updateRecord(zone.id, editingId, payload);
      else await dnsApi.createRecord(zone.id, payload);
      setRecordForm(EMPTY_RECORD);
      setEditingId(null);
      setShowRecordForm(false);
      setZoneFile('');
      await openZone(zone);
    }, editingId ? 'DNS record updated.' : 'DNS record added.');
  };

  const startEdit = (record) => {
    setEditingId(record.id);
    setShowRecordForm(true);
    setRecordForm({
      name: record.name,
      type: record.type,
      content: record.content,
      ttl: record.ttl ?? 3600,
      priority: record.priority ?? '',
      proxied: !!record.proxied,
    });
  };

  const deleteRecord = async (record) => {
    await run(async () => {
      await dnsApi.deleteRecord(zone.id, record.id);
      setZoneFile('');
      await openZone(zone);
    }, 'DNS record deleted.');
  };

  const exportZone = async () => {
    await run(async () => {
      const res = await dnsApi.exportZone(zone.id);
      setZoneFile(res.zoneFile ?? '');
    });
  };

  const checkRecord = async (record) => {
    await run(async () => {
      const res = await dnsApi.checkRecord(zone.id, record.id);
      setChecks((c) => ({ ...c, [record.id]: res }));
    });
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>DNS management</h1>
          <p className="muted">Zones and records for domains on your account, with zone export and live propagation checks.</p>
        </div>
        {!zone && (
          <button className="btn btn-primary" type="button" onClick={() => setShowZoneForm((s) => !s)}>
            {showZoneForm ? 'Cancel' : 'Add zone'}
          </button>
        )}
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      {showZoneForm && !zone && (
        <form className="card" onSubmit={createZone}>
          <h2>Add DNS zone</h2>
          <p className="muted">The zone is created active with CloudHost247 nameservers (ns1/ns2).</p>
          <div className="field">
            <label htmlFor="zone-domain">Domain</label>
            <input
              id="zone-domain"
              value={zoneDomain}
              onChange={(e) => setZoneDomain(e.target.value)}
              placeholder="example.com"
              required
              minLength={4}
            />
          </div>
          <div className="row row-wrap" style={{ marginTop: 12 }}>
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create zone'}</button>
            <button className="btn btn-ghost" type="button" onClick={() => setShowZoneForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      {!zone && (
        <section className="card">
          <h2>Zones</h2>
          {zones === null ? (
            <p className="muted">Loading zones…</p>
          ) : zones.length === 0 ? (
            <p className="muted">No DNS zones yet. Add a zone to start managing records.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Domain</th>
                    <th scope="col">Status</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {zones.map((z) => (
                    <tr key={z.id}>
                      <td><strong>{z.domain}</strong></td>
                      <td><span className={statusClass(z.status)}>{humanizeStatus(z.status)}</span></td>
                      <td>
                        <div className="row row-wrap">
                          <button className="btn btn-ghost" type="button" onClick={() => openZone(z)} disabled={busy}>Manage records</button>
                          <button className="btn btn-ghost" type="button" onClick={() => deleteZone(z)} disabled={busy}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {zone && (
        <>
          <section className="card">
            <div className="page-head" style={{ marginBottom: 0 }}>
              <div>
                <h2>{zone.domain}</h2>
                <p className="muted">
                  <span className={statusClass(zone.status)}>{humanizeStatus(zone.status)}</span>
                  {' · '}{records === null ? 'loading records…' : `${records.length} record${records.length === 1 ? '' : 's'}`}
                </p>
              </div>
              <div className="row row-wrap">
                <button className="btn btn-ghost" type="button" onClick={() => { setZone(null); setRecords(null); setZoneFile(''); loadZones(); }}>
                  All zones
                </button>
                <button className="btn btn-ghost" type="button" onClick={exportZone} disabled={busy}>Export zone file</button>
                <button className="btn btn-primary" type="button" onClick={() => { setShowRecordForm((s) => !s); setEditingId(null); setRecordForm(EMPTY_RECORD); }}>
                  {showRecordForm && !editingId ? 'Cancel' : 'Add record'}
                </button>
              </div>
            </div>
          </section>

          {showRecordForm && (
            <form className="card" onSubmit={submitRecord}>
              <h2>{editingId ? 'Edit record' : 'Add record'}</h2>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="rec-name">Name</label>
                  <input id="rec-name" value={recordForm.name} onChange={recordField('name')} placeholder="@ for the zone apex" required />
                </div>
                <div className="field">
                  <label htmlFor="rec-type">Type</label>
                  <select id="rec-type" value={recordForm.type} onChange={recordField('type')}>
                    {RECORD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="rec-content">Content</label>
                  <input id="rec-content" value={recordForm.content} onChange={recordField('content')} required placeholder="198.51.100.25, mail.example.com, …" />
                </div>
                <div className="field">
                  <label htmlFor="rec-ttl">TTL (seconds)</label>
                  <input id="rec-ttl" type="number" min="60" max="86400" value={recordForm.ttl} onChange={recordField('ttl')} required />
                </div>
                {PRIORITY_TYPES.has(recordForm.type) && (
                  <div className="field">
                    <label htmlFor="rec-priority">Priority</label>
                    <input id="rec-priority" type="number" min="0" max="65535" value={recordForm.priority} onChange={recordField('priority')} placeholder="10" required />
                  </div>
                )}
              </div>
              <div className="row row-wrap">
                <label>
                  <input type="checkbox" checked={recordForm.proxied} onChange={recordField('proxied')} /> Proxied
                </label>
              </div>
              <div className="row row-wrap" style={{ marginTop: 16 }}>
                <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : editingId ? 'Save record' : 'Add record'}</button>
                <button className="btn btn-ghost" type="button" onClick={() => { setShowRecordForm(false); setEditingId(null); setRecordForm(EMPTY_RECORD); }}>Cancel</button>
              </div>
            </form>
          )}

          <section className="card">
            <h2>Records</h2>
            {records === null ? (
              <p className="muted">Loading records…</p>
            ) : records.length === 0 ? (
              <p className="muted">No records in this zone yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Type</th>
                      <th scope="col">Name</th>
                      <th scope="col">Content</th>
                      <th scope="col">TTL</th>
                      <th scope="col">Flags</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((record) => (
                      <tr key={record.id}>
                        <td><strong>{record.type}</strong></td>
                        <td>{record.name}</td>
                        <td>
                          <span className="mono">{record.content}</span>
                          {record.priority !== null && record.priority !== undefined && <span className="muted"> · priority {record.priority}</span>}
                        </td>
                        <td>{record.ttl}</td>
                        <td>{record.proxied ? 'proxied' : '—'}</td>
                        <td>
                          <div className="row row-wrap">
                            <button className="btn btn-ghost" type="button" onClick={() => startEdit(record)} disabled={busy}>Edit</button>
                            <button className="btn btn-ghost" type="button" onClick={() => checkRecord(record)} disabled={busy}>Check</button>
                            <button className="btn btn-ghost" type="button" onClick={() => deleteRecord(record)} disabled={busy}>Delete</button>
                          </div>
                          {checks[record.id] && (
                            <p className="muted small" role="status">
                              {checks[record.id].resolved ? (
                                checks[record.id].matches
                                  ? 'Live DNS matches this record.'
                                  : `Live answers differ: ${(checks[record.id].liveAnswers ?? []).join(', ') || 'no answers'} (propagation may still be pending).`
                              ) : (
                                `Not resolvable yet: ${checks[record.id].error ?? 'no answer from the resolver'}`
                              )}
                            </p>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {zoneFile && (
            <section className="card">
              <h2>Zone file (RFC 1035)</h2>
              <pre className="mono">{zoneFile}</pre>
            </section>
          )}
        </>
      )}
    </div>
  );
}
