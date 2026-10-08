import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, describeError } from '../lib/api.js';

const EMPTY = { name: '', hostname: '', ipAddress: '', serverType: 'VPS', provider: '', region: '', cpuCores: 1, memoryMb: 1024, storageMb: 20480, dockerEnabled: false, kubernetesEnabled: false, cpanelEnabled: false, agentUrl: '', whmUrl: '', whmUser: '' };

export default function AdminServersPage() {
  const [servers, setServers] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { const res = await adminApi.servers(); setServers(res.servers ?? []); }, []);
  useEffect(() => { load().catch((e) => setError(describeError(e))); }, [load]);
  const field = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const run = async (action, message) => { setError(''); setNotice(''); setBusy(true); try { await action(); setNotice(message); } catch (e) { setError(describeError(e)); } finally { setBusy(false); } };
  const create = (e) => { e.preventDefault(); const payload = { ...form, cpuCores: Number(form.cpuCores), memoryMb: Number(form.memoryMb), storageMb: Number(form.storageMb) }; run(async () => { const res = await adminApi.createServer(payload); setShowForm(false); setForm(EMPTY); await load(); setSelected(res.server); }, 'Server registered.'); };
  const updateStatus = (server, status) => run(async () => { const res = await adminApi.updateServer(server.id, { status }); setSelected(res.server); await load(); }, 'Server status updated.');

  return <div className="page">
    <div className="page-head"><div><h1>Servers</h1><p className="muted">Register and manage infrastructure targets used by provisioning and deployment workers. Secrets are write-only.</p></div><button className="btn btn-primary" type="button" onClick={() => { setShowForm(true); setSelected(null); }}>Register server</button></div>
    {error && <div className="alert alert-error" role="alert">{error}</div>}{notice && <div className="alert alert-success" role="status">{notice}</div>}
    {showForm && <form className="card" onSubmit={create}><h2>Register server</h2><div className="grid-2">
      <div className="field"><label htmlFor="s-name">Name</label><input id="s-name" value={form.name} onChange={field('name')} required /></div><div className="field"><label htmlFor="s-host">Hostname</label><input id="s-host" value={form.hostname} onChange={field('hostname')} required /></div>
      <div className="field"><label htmlFor="s-ip">IP address</label><input id="s-ip" value={form.ipAddress} onChange={field('ipAddress')} /></div><div className="field"><label htmlFor="s-type">Server type</label><select id="s-type" value={form.serverType} onChange={field('serverType')}><option>VPS</option><option>DEDICATED</option><option>CPANEL</option><option>KUBERNETES</option><option>SHARED</option></select></div>
      <div className="field"><label htmlFor="s-provider">Provider</label><input id="s-provider" value={form.provider} onChange={field('provider')} /></div><div className="field"><label htmlFor="s-region">Region</label><input id="s-region" value={form.region} onChange={field('region')} /></div>
      <div className="field"><label htmlFor="s-cpu">CPU cores</label><input id="s-cpu" type="number" min="1" value={form.cpuCores} onChange={field('cpuCores')} required /></div><div className="field"><label htmlFor="s-memory">Memory MB</label><input id="s-memory" type="number" min="256" value={form.memoryMb} onChange={field('memoryMb')} required /></div>
      <div className="field"><label htmlFor="s-storage">Storage MB</label><input id="s-storage" type="number" min="1024" value={form.storageMb} onChange={field('storageMb')} required /></div><div className="field"><label htmlFor="s-agent">Agent URL</label><input id="s-agent" type="url" value={form.agentUrl} onChange={field('agentUrl')} placeholder="https://host.example/agent" /></div>
    </div><div className="row row-wrap"><label><input type="checkbox" checked={form.dockerEnabled} onChange={field('dockerEnabled')} /> Docker</label><label><input type="checkbox" checked={form.kubernetesEnabled} onChange={field('kubernetesEnabled')} /> Kubernetes</label><label><input type="checkbox" checked={form.cpanelEnabled} onChange={field('cpanelEnabled')} /> cPanel</label></div><div className="row row-wrap" style={{ marginTop: 16 }}><button className="btn btn-primary" disabled={busy}>{busy ? 'Registering…' : 'Register server'}</button><button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button></div></form>}
    <div className="card"><div className="table-wrap"><table className="table"><thead><tr><th>Name</th><th>Type</th><th>Provider</th><th>Resources</th><th>Status</th><th>Actions</th></tr></thead><tbody>{servers === null ? <tr><td colSpan="6" className="muted">Loading…</td></tr> : servers.length === 0 ? <tr><td colSpan="6" className="muted">No infrastructure servers registered.</td></tr> : servers.map((s) => <tr key={s.id}><td><button className="linklike" type="button" onClick={() => setSelected(s)}><strong>{s.name}</strong></button><div className="muted small">{s.hostname}{s.ipAddress ? ` · ${s.ipAddress}` : ''}</div></td><td>{s.serverType}</td><td>{s.provider || '—'}{s.region ? ` / ${s.region}` : ''}</td><td>{s.cpuCores} CPU · {s.memoryMb} MB · {s.storageMb} MB</td><td><span className="status status-pending">{s.status}</span></td><td><select aria-label={`Change status for ${s.name}`} value={s.status} onChange={(e) => updateStatus(s, e.target.value)} disabled={busy}><option value={s.status}>{s.status}</option><option value="active">active</option><option value="maintenance">maintenance</option><option value="retired">retired</option></select></td></tr>)}</tbody></table></div></div>
    {selected && <div className="card"><h2>{selected.name}</h2><p className="muted">{selected.hostname} · {selected.serverType} · {selected.provider || 'provider not specified'}</p><dl className="detail-list"><dt>Capabilities</dt><dd>{[selected.dockerEnabled && 'Docker', selected.kubernetesEnabled && 'Kubernetes', selected.cpanelEnabled && 'cPanel'].filter(Boolean).join(', ') || 'None recorded'}</dd><dt>Agent</dt><dd>{selected.agentId ? 'Registered' : 'Not configured'}</dd><dt>Ownership</dt><dd>{selected.userId ? 'Customer-owned' : 'Platform target'}</dd></dl></div>}
  </div>;
}
