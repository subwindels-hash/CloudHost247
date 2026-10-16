import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, describeError } from '../lib/api.js';
import { humanizeStatus, statusClass } from '../lib/format.js';

/**
 * Admin server templates (availability). A template is one backend-enforced plan, provider,
 * region, OS version, architecture and server-type tuple. Templates are created disabled; the
 * server refuses `ACTIVE` on create and only enables a template whose references are all active
 * and whose exact combination has a verified active provider image — the refusal names the
 * missing promise and is rendered verbatim. The adapter capability panel reports which server
 * actions the provider really supports; unsupported actions are never offered to customers.
 */
export default function AdminAvailabilityPage() {
  const [rows, setRows] = useState(null);
  const [plans, setPlans] = useState([]);
  const [providers, setProviders] = useState([]);
  const [regions, setRegions] = useState([]);
  const [versions, setVersions] = useState([]);
  const [adapters, setAdapters] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    planId: '', providerId: '', regionId: '', operatingSystemVersionId: '',
    architecture: 'x86_64', serverType: 'VPS', cpuCores: '2', memoryMb: '4096',
    storageMb: '80000', bandwidthGb: '2000', providerServerType: '',
  });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [cfgRes, providerRes, osRes, adapterRes, productRes] = await Promise.all([
        adminApi.adminConfigurations(), adminApi.providers(),
        adminApi.adminOperatingSystems(), adminApi.providerAdapters(), adminApi.catalogProducts(),
      ]);
      // Plan ids live on catalog products: pull each product's plans for the picker.
      const productIds = (productRes.products ?? []).map((p) => p.id);
      const details = await Promise.all(productIds.map((id) => adminApi.catalogProduct(id)));
      const allPlans = details.flatMap((d) => (d.plans ?? []).map((p) => ({
        id: p.id, name: p.name ?? p.id, productName: d.product?.name ?? '',
      })));
      const allVersions = [];
      for (const os of osRes.operatingSystems ?? []) {
        const res = await adminApi.osVersions(os.id);
        for (const ver of res.versions ?? []) {
          allVersions.push({ ...ver, osName: os.name });
        }
      }
      setRows(cfgRes.configurations ?? []);
      setProviders(providerRes.providers ?? []);
      setRegions((await adminApi.regions()).regions ?? []);
      setVersions(allVersions);
      setPlans(allPlans);
      setAdapters(adapterRes.adapters ?? []);
      setForm((current) => ({
        ...current,
        planId: current.planId || allPlans[0]?.id || '',
        providerId: current.providerId || (providerRes.providers ?? [])[0]?.id || '',
        operatingSystemVersionId: current.operatingSystemVersionId || allVersions[0]?.id || '',
      }));
    } catch (e) {
      setRows([]);
      setError(describeError(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const name = (list, id) => list.find((x) => x.id === id)?.name ?? id ?? '—';
  const versionLabel = (id) => {
    const ver = versions.find((v) => v.id === id);
    return ver ? `${ver.osName} ${ver.displayName ?? ver.version}` : id;
  };

  const selectedAdapter = adapters.find(
    (profile) => profile.adapter === providers.find((p) => p.id === form.providerId)?.type,
  ) ?? null;

  const run = async (fn, message) => {
    setError(''); setNotice('');
    try {
      await fn();
      setNotice(message);
      await load();
    } catch (e) {
      setError(describeError(e));
    }
  };

  const create = (event) => {
    event.preventDefault();
    return run(async () => {
      await adminApi.createConfiguration({
        planId: form.planId, providerId: form.providerId, regionId: form.regionId,
        operatingSystemVersionId: form.operatingSystemVersionId,
        architecture: form.architecture, serverType: form.serverType,
        status: 'DISABLED',
        metadata: {
          cpuCores: Number(form.cpuCores), memoryMb: Number(form.memoryMb),
          storageMb: Number(form.storageMb), bandwidthGb: Number(form.bandwidthGb),
          providerServerType: form.providerServerType,
        },
      });
      setShowForm(false);
    }, 'Template created disabled. Enable it only after a matching verified provider image exists.');
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Server templates</h1>
          <p className="muted">One plan, provider, location, OS version, architecture and server-type tuple, with the resources the customer gets. Ordering only offers ACTIVE templates that have a matching verified provider image.</p>
        </div>
        <button className="btn btn-primary" type="button" onClick={() => setShowForm((v) => !v)}>Add template</button>
      </div>

      {notice && <div className="alert alert-success" role="status">{notice}</div>}
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {showForm && (
        <form className="card nested-form" onSubmit={create}>
          <h2>Exact deployable combination</h2>
          <div className="form-row">
            <label><span>Plan</span>
              <select required value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })}>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.productName} — {p.name}</option>)}
              </select></label>
            <label><span>Provider</span>
              <select required value={form.providerId} onChange={(e) => setForm({ ...form, providerId: e.target.value, regionId: '' })}>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></label>
            <label><span>Region</span>
              <select required value={form.regionId} onChange={(e) => setForm({ ...form, regionId: e.target.value })}>
                <option value="">Select…</option>
                {regions.filter((r) => r.providerId === form.providerId).map((r) => (
                  <option key={r.id} value={r.id}>{r.name} · {r.code}</option>
                ))}
              </select></label>
          </div>
          <div className="form-row">
            <label><span>OS version</span>
              <select required value={form.operatingSystemVersionId}
                onChange={(e) => setForm({ ...form, operatingSystemVersionId: e.target.value })}>
                {versions.map((v) => <option key={v.id} value={v.id}>{v.osName} {v.displayName ?? v.version}</option>)}
              </select></label>
            <label><span>Architecture</span>
              <select value={form.architecture} onChange={(e) => setForm({ ...form, architecture: e.target.value })}>
                <option>x86_64</option><option>arm64</option>
              </select></label>
            <label><span>Server type</span>
              <select value={form.serverType} onChange={(e) => setForm({ ...form, serverType: e.target.value })}>
                <option>VPS</option><option>CLOUD</option><option>DEDICATED</option>
              </select></label>
            <label><span>Provider server type</span>
              <input required value={form.providerServerType}
                onChange={(e) => setForm({ ...form, providerServerType: e.target.value })}
                placeholder="e.g. cx22" /></label>
          </div>
          <div className="form-row">
            <label><span>vCPU</span>
              <input required type="number" min="1" value={form.cpuCores}
                onChange={(e) => setForm({ ...form, cpuCores: e.target.value })} /></label>
            <label><span>Memory MB</span>
              <input required type="number" min="256" value={form.memoryMb}
                onChange={(e) => setForm({ ...form, memoryMb: e.target.value })} /></label>
            <label><span>Storage MB</span>
              <input required type="number" min="1024" value={form.storageMb}
                onChange={(e) => setForm({ ...form, storageMb: e.target.value })} /></label>
            <label><span>Bandwidth GB</span>
              <input type="number" min="0" value={form.bandwidthGb}
                onChange={(e) => setForm({ ...form, bandwidthGb: e.target.value })} /></label>
          </div>
          {selectedAdapter ? (
            <p className="muted small">
              {selectedAdapter.label ?? selectedAdapter.adapter} supports:{' '}
              {Object.entries(selectedAdapter.capabilities ?? {}).filter(([, on]) => on).map(([c]) => c).join(', ') || 'power actions only'}.
              Unsupported actions are not offered to customers.
            </p>
          ) : (
            <p className="muted small">Select a provider to see which server actions its adapter supports.</p>
          )}
          <button className="btn btn-primary">Create disabled</button>
        </form>
      )}

      <section className="card">
        <h2>Templates</h2>
        {rows === null ? (
          <p className="muted">Loading server templates…</p>
        ) : rows.length === 0 ? (
          <p className="muted">No server templates configured.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Plan</th>
                  <th scope="col">Provider / region</th>
                  <th scope="col">OS version</th>
                  <th scope="col">Type / arch</th>
                  <th scope="col">Resources</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td><strong>{name(plans, row.planId)}</strong></td>
                    <td>{name(providers, row.providerId)}<div className="muted small">{name(regions, row.regionId)}</div></td>
                    <td>{versionLabel(row.operatingSystemVersionId)}</td>
                    <td>{row.serverType} · {row.architecture}</td>
                    <td>
                      {row.metadata?.cpuCores ?? '—'} vCPU · {row.metadata?.memoryMb ?? '—'} MB
                      <div className="muted small">{row.metadata?.providerServerType ?? 'provider type missing'}</div>
                    </td>
                    <td><span className={statusClass(row.status)}>{humanizeStatus(row.status)}</span></td>
                    <td>
                      <div className="actions">
                        {String(row.status).toUpperCase() !== 'ACTIVE' && (
                          <button className="btn btn-ghost" type="button"
                            onClick={() => run(() => adminApi.updateConfiguration(row.id, { status: 'ACTIVE' }), 'Template enabled.')}>Enable</button>
                        )}
                        {String(row.status).toUpperCase() === 'ACTIVE' && (
                          <button className="btn btn-ghost" type="button"
                            onClick={() => run(() => adminApi.updateConfiguration(row.id, { status: 'DISABLED' }), 'Template disabled.')}>Disable</button>
                        )}
                        <button className="btn btn-ghost" type="button"
                          onClick={() => run(() => adminApi.updateConfiguration(row.id, { status: 'ARCHIVED' }), 'Template archived.')}>Archive</button>
                      </div>
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
