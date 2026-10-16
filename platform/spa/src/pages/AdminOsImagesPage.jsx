import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, describeError } from '../lib/api.js';
import { humanizeStatus, statusClass } from '../lib/format.js';

/**
 * Admin provider image mappings. A mapping pairs a private provider image identifier with a
 * customer-facing OS; Test asks the provider for real and records the verdict on the row — a
 * refusal is shown as the reason, never as an error screen. Active mappings must be disabled
 * before deletion (the server's guard, rendered verbatim). The stale-verification panel lists
 * rows whose provider check is missing or old; Re-check re-stamps what the API re-validates.
 */
export default function AdminOsImagesPage() {
  const [images, setImages] = useState(null);
  const [stale, setStale] = useState(null);
  const [systems, setSystems] = useState([]);
  const [regions, setRegions] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ osId: '', providerImageId: '', regionId: '' });
  const [verdicts, setVerdicts] = useState({});
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [imgRes, osRes, regRes, verRes] = await Promise.all([
        adminApi.adminOsImages(), adminApi.adminOperatingSystems(),
        adminApi.regions(), adminApi.osImageVerifications(),
      ]);
      setImages(imgRes.images ?? []);
      setSystems(osRes.operatingSystems ?? []);
      setRegions(regRes.regions ?? []);
      setStale(verRes.images ?? []);
    } catch (e) {
      setImages([]);
      setError(describeError(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const osName = (osId) => systems.find((o) => o.id === osId)?.name ?? osId;
  const regionName = (regionId) => {
    if (!regionId) return 'All regions';
    return regions.find((r) => r.id === regionId)?.name ?? regionId;
  };

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
      await adminApi.createOsImage({
        osId: form.osId, providerImageId: form.providerImageId,
        regionId: form.regionId || undefined,
      });
      setShowForm(false);
      setForm({ osId: '', providerImageId: '', regionId: '' });
    }, 'Image mapping created.');
  };

  const test = async (image) => {
    setError(''); setNotice('');
    try {
      const res = await adminApi.testOsImage(image.id);
      setVerdicts((v) => ({
        ...v,
        [image.id]: res.verified
          ? { ok: true, text: `Provider confirmed image "${res.providerImage?.id ?? image.providerImageId}".` }
          : { ok: false, text: res.reason ?? 'The provider did not confirm this image.' },
      }));
      await load();
    } catch (e) {
      setVerdicts((v) => ({ ...v, [image.id]: { ok: false, text: describeError(e) } }));
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Provider image mappings</h1>
          <p className="muted">Private provider identifiers map to customer-facing OS versions. Test asks the provider for real; an unverified mapping is never promised to an order.</p>
        </div>
        <div className="actions">
          <button className="btn btn-ghost" type="button"
            onClick={() => run(async () => {
              const res = await adminApi.revalidateOsImages({ staleAfterDays: 0, limit: 200 });
              return res;
            }, 'Stale mappings re-checked.')}
            title="POST /api/v1/admin/os-images/revalidate">Re-check enabled mappings</button>
          <button className="btn btn-primary" type="button" onClick={() => setShowForm((v) => !v)}>Add image mapping</button>
        </div>
      </div>

      {notice && <div className="alert alert-success" role="status">{notice}</div>}
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {showForm && (
        <form className="card nested-form" onSubmit={create}>
          <h2>New image mapping</h2>
          <div className="form-row">
            <label><span>Operating system</span>
              <select required value={form.osId} onChange={(e) => setForm({ ...form, osId: e.target.value })}>
                <option value="">Select…</option>
                {systems.map((os) => <option key={os.id} value={os.id}>{os.name}</option>)}
              </select></label>
            <label><span>Provider image ID</span>
              <input required value={form.providerImageId}
                onChange={(e) => setForm({ ...form, providerImageId: e.target.value })} /></label>
            <label><span>Region</span>
              <select value={form.regionId} onChange={(e) => setForm({ ...form, regionId: e.target.value })}>
                <option value="">All provider regions</option>
                {regions.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.code}</option>)}
              </select></label>
          </div>
          <p className="muted small">A mapping without a region cannot be tested — the provider to verify against would be unknown.</p>
          <button className="btn btn-primary">Create mapping</button>
        </form>
      )}

      <section className="card">
        <h2>Mappings</h2>
        {images === null ? (
          <p className="muted">Loading image mappings…</p>
        ) : images.length === 0 ? (
          <p className="muted">No image mappings configured.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Operating system</th>
                  <th scope="col">Region</th>
                  <th scope="col">Provider image ID</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {images.map((image) => {
                  const verdict = verdicts[image.id];
                  return (
                    <tr key={image.id}>
                      <td><strong>{osName(image.osId)}</strong></td>
                      <td>{regionName(image.regionId)}</td>
                      <td className="mono">{image.providerImageId ?? '—'}</td>
                      <td>
                        <span className={statusClass(image.active ? 'active' : 'disabled')}>
                          {image.active ? 'Enabled' : 'Disabled'}
                        </span>
                        <div className="muted small">
                          {image.verificationError
                            ? `unverified: ${image.verificationError}`
                            : image.verifiedAt
                              ? `verified ${new Date(image.verifiedAt).toLocaleDateString()}`
                              : 'not tested'}
                        </div>
                        {verdict && (
                          <div className={verdict.ok ? 'muted small' : 'small'} role="note">{verdict.text}</div>
                        )}
                      </td>
                      <td>
                        <div className="actions">
                          <button className="btn btn-ghost" type="button" onClick={() => test(image)}>Test</button>
                          {image.active ? (
                            <button className="btn btn-ghost" type="button"
                              onClick={() => run(() => adminApi.updateOsImage(image.id, { active: false, status: 'disabled' }), 'Mapping disabled.')}>Disable</button>
                          ) : (
                            <button className="btn btn-ghost" type="button"
                              onClick={() => run(() => adminApi.updateOsImage(image.id, { active: true, status: 'active' }), 'Mapping enabled.')}>Enable</button>
                          )}
                          <button className="btn btn-ghost" type="button"
                            onClick={() => run(() => adminApi.deleteOsImage(image.id), 'Mapping deleted.')}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Stale or missing verification</h2>
        {stale === null ? (
          <p className="muted">Loading verification state…</p>
        ) : stale.length === 0 ? (
          <p className="muted">Every mapping has a recent provider verification.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Provider image ID</th>
                  <th scope="col">Last verified</th>
                  <th scope="col">Last verdict</th>
                </tr>
              </thead>
              <tbody>
                {stale.map((s) => (
                  <tr key={s.id}>
                    <td className="mono">{s.providerImageId ?? '—'}</td>
                    <td>{s.verifiedAt ? new Date(s.verifiedAt).toLocaleString() : 'Never'}</td>
                    <td>{s.verificationError ?? 'Not tested'}</td>
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
