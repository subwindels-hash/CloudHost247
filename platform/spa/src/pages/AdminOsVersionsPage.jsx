import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, describeError } from '../lib/api.js';
import { formatDate, humanizeStatus, statusClass } from '../lib/format.js';

/**
 * Admin OS registry and version lifecycle. EOL and archived versions stay visible on existing
 * servers but are excluded from new deployments; a version can only be activated while its
 * operating system is active (the server enforces this and the refusal is shown verbatim).
 * Version rows carry the mapping counts the API computes: provider image count, active image
 * count and the number of regions with an active image.
 */
export default function AdminOsVersionsPage() {
  const [systems, setSystems] = useState(null);
  const [selected, setSelected] = useState(null);
  const [versions, setVersions] = useState(null);
  const [showOsForm, setShowOsForm] = useState(false);
  const [showVerForm, setShowVerForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [osForm, setOsForm] = useState({ name: '', slug: '', vendor: '', description: '' });
  const [verForm, setVerForm] = useState({
    version: '', displayName: '', releaseName: '', x86: true, arm: false, isLts: false,
    releaseDate: '', endOfLifeDate: '',
  });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await adminApi.adminOperatingSystems();
      setSystems(res.operatingSystems ?? []);
    } catch (e) {
      setSystems([]);
      setError(describeError(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const open = async (os) => {
    setError(''); setNotice(''); setSelected(os); setVersions(null);
    try {
      const res = await adminApi.osVersions(os.id);
      setVersions(res.versions ?? []);
    } catch (e) {
      setVersions([]);
      setError(describeError(e));
    }
  };

  const run = async (fn, message) => {
    setError(''); setNotice('');
    try {
      await fn();
      setNotice(message);
      if (selected) await open(selected);
      await load();
    } catch (e) {
      setError(describeError(e));
    }
  };

  const saveOs = (event) => {
    event.preventDefault();
    return run(async () => {
      const body = {
        name: osForm.name, slug: osForm.slug,
        vendor: osForm.vendor || null, description: osForm.description || null,
      };
      await adminApi.createOperatingSystem(body);
      setShowOsForm(false);
      setOsForm({ name: '', slug: '', vendor: '', description: '' });
    }, 'Operating system created.');
  };

  const saveVersion = (event) => {
    event.preventDefault();
    return run(async () => {
      const body = {
        displayName: verForm.displayName,
        releaseName: verForm.releaseName || null,
        architectureSupport: [verForm.x86 && 'x86_64', verForm.arm && 'arm64'].filter(Boolean),
        isLts: verForm.isLts,
        releaseDate: verForm.releaseDate || null,
        endOfLifeDate: verForm.endOfLifeDate || null,
      };
      if (editing) {
        await adminApi.updateOsVersion(editing.id, body);
      } else {
        await adminApi.createOsVersion(selected.id, { ...body, version: verForm.version, status: 'DISABLED' });
      }
      setShowVerForm(false); setEditing(null);
      setVerForm({ version: '', displayName: '', releaseName: '', x86: true, arm: false, isLts: false, releaseDate: '', endOfLifeDate: '' });
    }, editing ? 'Version updated.' : 'Version created disabled.');
  };

  const patchVersion = (version, patch, message) =>
    run(() => adminApi.updateOsVersion(version.id, patch), message);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Operating systems</h1>
          <p className="muted">OS registry and version lifecycle. EOL and archived versions remain visible on existing servers but are excluded from new deployments.</p>
        </div>
        <div className="actions">
          <button className="btn btn-primary" type="button" onClick={() => { setShowOsForm((v) => !v); setShowVerForm(false); }}>Add operating system</button>
        </div>
      </div>

      {notice && <div className="alert alert-success" role="status">{notice}</div>}
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {showOsForm && (
        <form className="card nested-form" onSubmit={saveOs}>
          <h2>New operating system</h2>
          <div className="form-row">
            <label><span>Name</span>
              <input required value={osForm.name} onChange={(e) => setOsForm({ ...osForm, name: e.target.value })} /></label>
            <label><span>Slug</span>
              <input required value={osForm.slug} onChange={(e) => setOsForm({ ...osForm, slug: e.target.value })} /></label>
            <label><span>Vendor</span>
              <input value={osForm.vendor} onChange={(e) => setOsForm({ ...osForm, vendor: e.target.value })} /></label>
          </div>
          <label><span>Description</span>
            <textarea rows="2" value={osForm.description} onChange={(e) => setOsForm({ ...osForm, description: e.target.value })} /></label>
          <button className="btn btn-primary">Create</button>
        </form>
      )}

      <section className="card">
        <h2>Registry</h2>
        {systems === null ? (
          <p className="muted">Loading operating systems…</p>
        ) : systems.length === 0 ? (
          <p className="muted">No operating systems registered.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Vendor</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {systems.map((os) => (
                  <tr key={os.id}>
                    <td><strong>{os.name}</strong><div className="muted small">{os.slug}</div></td>
                    <td>{os.vendor ?? '—'}</td>
                    <td><span className={statusClass(os.status)}>{humanizeStatus(os.status)}</span></td>
                    <td>
                      <div className="actions">
                        <button className="btn btn-ghost" type="button" onClick={() => open(os)}>Versions</button>
                        {String(os.status).toUpperCase() !== 'ACTIVE' && (
                          <button className="btn btn-ghost" type="button"
                            onClick={() => run(() => adminApi.updateOperatingSystem(os.id, { status: 'ACTIVE' }), 'Operating system activated.')}>Activate</button>
                        )}
                        {String(os.status).toUpperCase() === 'ACTIVE' && (
                          <button className="btn btn-ghost" type="button"
                            onClick={() => run(() => adminApi.updateOperatingSystem(os.id, { status: 'ARCHIVED' }), 'Operating system archived.')}>Archive</button>
                        )}
                        <button className="btn btn-ghost" type="button"
                          onClick={() => run(() => adminApi.deleteOperatingSystem(os.id), 'Operating system deleted.')}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && (
        <section className="card">
          <div className="page-head">
            <h2>{selected.name} versions</h2>
            <button className="btn btn-primary" type="button"
              onClick={() => { setShowVerForm((v) => !v); setEditing(null); }}>Add version</button>
          </div>

          {showVerForm && (
            <form className="nested-form" onSubmit={saveVersion}>
              <h3>{editing ? `Edit ${editing.displayName ?? editing.version}` : 'New version (created disabled)'}</h3>
              <div className="form-row">
                <label><span>Version</span>
                  <input required disabled={Boolean(editing)} value={verForm.version}
                    onChange={(e) => setVerForm({ ...verForm, version: e.target.value })} /></label>
                <label><span>Display name</span>
                  <input required value={verForm.displayName}
                    onChange={(e) => setVerForm({ ...verForm, displayName: e.target.value })} /></label>
                <label><span>Release name</span>
                  <input value={verForm.releaseName}
                    onChange={(e) => setVerForm({ ...verForm, releaseName: e.target.value })} /></label>
              </div>
              <div className="form-row">
                <label><span>Release date</span>
                  <input type="date" value={verForm.releaseDate}
                    onChange={(e) => setVerForm({ ...verForm, releaseDate: e.target.value })} /></label>
                <label><span>End of life</span>
                  <input type="date" value={verForm.endOfLifeDate}
                    onChange={(e) => setVerForm({ ...verForm, endOfLifeDate: e.target.value })} /></label>
              </div>
              <div className="checks">
                <label><input type="checkbox" checked={verForm.x86}
                  onChange={(e) => setVerForm({ ...verForm, x86: e.target.checked })} /> x86_64</label>
                <label><input type="checkbox" checked={verForm.arm}
                  onChange={(e) => setVerForm({ ...verForm, arm: e.target.checked })} /> arm64</label>
                <label><input type="checkbox" checked={verForm.isLts}
                  onChange={(e) => setVerForm({ ...verForm, isLts: e.target.checked })} /> LTS</label>
              </div>
              <button className="btn btn-primary">{editing ? 'Save changes' : 'Create disabled'}</button>
            </form>
          )}

          {versions === null ? (
            <p className="muted">Loading versions…</p>
          ) : versions.length === 0 ? (
            <p className="muted">No versions for this operating system.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Version</th>
                    <th scope="col">Status</th>
                    <th scope="col">Architectures</th>
                    <th scope="col">Mappings / regions</th>
                    <th scope="col">Lifecycle</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((ver) => (
                    <tr key={ver.id}>
                      <td>
                        <strong>{ver.displayName ?? ver.version}</strong>
                        <div className="muted small">
                          {ver.releaseName ?? ver.version}
                          {ver.isLts ? ' · LTS' : ''}{ver.isRecommended ? ' · Recommended' : ''}{ver.isDefault ? ' · Default' : ''}
                        </div>
                      </td>
                      <td><span className={statusClass(ver.status)}>{humanizeStatus(ver.status)}</span></td>
                      <td>{(ver.architectureSupport ?? []).join(' · ') || '—'}</td>
                      <td>
                        <strong>{ver.active_image_count}</strong> active / {ver.provider_image_count} total
                        <div className="muted small">{ver.available_region_count} available region{ver.available_region_count === 1 ? '' : 's'}</div>
                      </td>
                      <td>{formatDate(ver.releaseDate)} → {ver.endOfLifeDate ? formatDate(ver.endOfLifeDate) : 'Not set'}</td>
                      <td>
                        <div className="actions">
                          <button className="btn btn-ghost" type="button"
                            onClick={() => {
                              setEditing(ver); setShowVerForm(true);
                              setVerForm({
                                version: ver.version, displayName: ver.displayName ?? '', releaseName: ver.releaseName ?? '',
                                x86: (ver.architectureSupport ?? []).includes('x86_64'),
                                arm: (ver.architectureSupport ?? []).includes('arm64'),
                                isLts: Boolean(ver.isLts), releaseDate: ver.releaseDate ?? '', endOfLifeDate: ver.endOfLifeDate ?? '',
                              });
                            }}>Edit</button>
                          {String(ver.status).toUpperCase() !== 'ACTIVE' && (
                            <button className="btn btn-ghost" type="button"
                              onClick={() => patchVersion(ver, { status: 'ACTIVE' }, 'Version activated.')}>Activate</button>
                          )}
                          <button className="btn btn-ghost" type="button"
                            onClick={() => patchVersion(ver, { isRecommended: !ver.isRecommended }, 'Recommendation updated.')}>
                            {ver.isRecommended ? 'Unrecommend' : 'Recommend'}
                          </button>
                          <button className="btn btn-ghost" type="button"
                            onClick={() => patchVersion(ver, { isDefault: true }, 'Default version set.')}>Make default</button>
                          <button className="btn btn-ghost" type="button"
                            onClick={() => patchVersion(ver, { status: 'ARCHIVED' }, 'Version retired.')}>Retire</button>
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
    </div>
  );
}
