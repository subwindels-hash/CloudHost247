import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, describeError } from '../lib/api.js';
import { formatMoney, humanizeStatus, statusClass } from '../lib/format.js';

const TABS = [
  ['catalogue', 'Catalogue'],
  ['listing', 'Marketplace listing'],
  ['categories', 'Categories'],
  ['manifests', 'Manifests'],
];

// The approval-workflow transitions the server enforces (spec §47) — mirrored so the screen only
// offers a move the server will accept. An illegal attempt still gets the server's named refusal.
const APP_TRANSITIONS = {
  draft: ['validating', 'testing', 'deprecated'],
  validating: ['testing', 'draft', 'deprecated'],
  testing: ['approved', 'draft', 'deprecated'],
  approved: ['published', 'draft', 'suspended', 'deprecated'],
  published: ['suspended', 'deprecated'],
  suspended: ['approved', 'published', 'deprecated'],
  deprecated: [],
};
const VERSION_TRANSITIONS = { draft: ['published', 'deprecated'], published: ['deprecated'], deprecated: [] };
const HOSTING_TYPES = ['shared', 'cpanel', 'vps', 'dedicated', 'docker', 'kubernetes'];

const EMPTY_APP = {
  slug: '', name: '', categorySlug: '', description: '',
  minCpu: 1, minMemoryMb: 512, minStorageMb: 5120,
  supportedHostingTypes: ['docker'], featured: false, requiresAdminApproval: false,
};

/**
 * Marketplace admin: the application catalogue (with the approval workflow), the customer-facing
 * listing, categories, and manifest import.
 *
 * The workflow transitions and version rules mirror the server's own tables, and publishing an
 * application is refused until a version is published — the screen shows the server's reason
 * rather than guessing at eligibility.
 */
export default function AdminMarketplacePage() {
  const [tab, setTab] = useState('catalogue');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const [apps, setApps] = useState(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [appForm, setAppForm] = useState(EMPTY_APP);
  const [showAppForm, setShowAppForm] = useState(false);
  const [categories, setCategories] = useState(null);
  const [listing, setListing] = useState(null);
  const [catForm, setCatForm] = useState({ name: '', slug: '', description: '', sortOrder: '', active: true });
  const [showCatForm, setShowCatForm] = useState(false);
  const [manifestYaml, setManifestYaml] = useState('');
  const [manifestResult, setManifestResult] = useState(null);

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

  const loadTab = useCallback(async (active, searchTerm) => {
    setError('');
    try {
      if (active === 'catalogue') {
        const res = await adminApi.adminApps(searchTerm ? { search: searchTerm } : {});
        setApps(res.applications ?? []);
      } else if (active === 'listing') {
        setListing((await adminApi.adminMarketplaceApps()).apps ?? []);
      } else if (active === 'categories') {
        setCategories((await adminApi.adminAppCategories()).categories ?? []);
      }
    } catch (e) {
      setError(describeError(e));
    }
  }, []);

  useEffect(() => { loadTab(tab); }, [tab, loadTab]);

  const openApp = async (app) => {
    setError('');
    try {
      setSelected(await adminApi.adminApp(app.id));
    } catch (e) {
      setError(describeError(e));
    }
  };

  const appField = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setAppForm((f) => ({ ...f, [key]: value }));
  };

  const createApp = async (e) => {
    e.preventDefault();
    await run(async () => {
      await adminApi.adminCreateApp({
        slug: appForm.slug.trim(),
        name: appForm.name.trim(),
        categorySlug: appForm.categorySlug.trim(),
        description: appForm.description.trim(),
        minCpu: Number(appForm.minCpu) || 1,
        minMemoryMb: Number(appForm.minMemoryMb) || 512,
        minStorageMb: Number(appForm.minStorageMb) || 5120,
        supportedHostingTypes: appForm.supportedHostingTypes.length ? appForm.supportedHostingTypes : ['docker'],
        featured: !!appForm.featured,
        requiresAdminApproval: !!appForm.requiresAdminApproval,
      });
      setAppForm(EMPTY_APP);
      setShowAppForm(false);
      await loadTab('catalogue');
    }, 'Application created as draft.');
  };

  const setAppStatus = (app, status) => run(async () => {
    await adminApi.adminAppStatus(app.id, status);
    if (selected?.application?.id === app.id) setSelected(await adminApi.adminApp(app.id));
    await loadTab('catalogue');
  }, `Application moved to ${status}.`);

  const setVersionStatus = (appId, version, patch) => run(async () => {
    await adminApi.adminAppVersion(appId, version.id, patch);
    setSelected(await adminApi.adminApp(appId));
    await loadTab('catalogue');
  }, 'Version updated.');

  const deleteApp = (app) => {
    if (!window.confirm(`Delete application ${app.slug}? Installations block deletion — the server refuses if any exist.`)) return;
    return run(async () => {
      await adminApi.adminDeleteApp(app.id);
      setSelected(null);
      await loadTab('catalogue');
    }, `Application ${app.slug} deleted.`);
  };

  const catField = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setCatForm((f) => ({ ...f, [key]: value }));
  };

  const createCategory = async (e) => {
    e.preventDefault();
    await run(async () => {
      await adminApi.adminCreateAppCategory({
        name: catForm.name.trim(),
        slug: catForm.slug.trim(),
        ...(catForm.description.trim() ? { description: catForm.description.trim() } : {}),
        ...(catForm.sortOrder !== '' ? { sortOrder: Number(catForm.sortOrder) } : {}),
        active: !!catForm.active,
      });
      setCatForm({ name: '', slug: '', description: '', sortOrder: '', active: true });
      setShowCatForm(false);
      await loadTab('categories');
    }, 'Category created.');
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Marketplace admin</h1>
          <p className="muted">Application catalogue, customer listing, categories and manifest import.</p>
        </div>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      <nav className="row row-wrap" aria-label="Marketplace admin sections">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" className={tab === key ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === 'catalogue' && (
        <>
          <section className="card">
            <div className="page-head" style={{ marginBottom: 0 }}>
              <h2>Applications</h2>
              <button className="btn btn-primary" type="button" onClick={() => setShowAppForm((s) => !s)}>
                {showAppForm ? 'Cancel' : 'Create application'}
              </button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); loadTab('catalogue', search); }}>
              <div className="row row-wrap">
                <div className="field" style={{ flex: 1 }}>
                  <label htmlFor="app-search">Search</label>
                  <input id="app-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="name or slug" />
                </div>
                <button className="btn btn-ghost" type="submit">Search</button>
              </div>
            </form>
            {showAppForm && (
              <form onSubmit={createApp}>
                <div className="grid-2">
                  <div className="field">
                    <label htmlFor="na-slug">Slug</label>
                    <input id="na-slug" value={appForm.slug} onChange={appField('slug')} required />
                  </div>
                  <div className="field">
                    <label htmlFor="na-name">Name</label>
                    <input id="na-name" value={appForm.name} onChange={appField('name')} required />
                  </div>
                  <div className="field">
                    <label htmlFor="na-cat">Category slug</label>
                    <input id="na-cat" value={appForm.categorySlug} onChange={appField('categorySlug')} required placeholder="content-management" />
                  </div>
                  <div className="field">
                    <label htmlFor="na-desc">Description (10–500 chars)</label>
                    <input id="na-desc" value={appForm.description} onChange={appField('description')} required minLength={10} />
                  </div>
                  <div className="field">
                    <label htmlFor="na-cpu">Min CPU</label>
                    <input id="na-cpu" type="number" min="1" value={appForm.minCpu} onChange={appField('minCpu')} />
                  </div>
                  <div className="field">
                    <label htmlFor="na-mem">Min memory MB</label>
                    <input id="na-mem" type="number" min="64" value={appForm.minMemoryMb} onChange={appField('minMemoryMb')} />
                  </div>
                  <div className="field">
                    <label htmlFor="na-disk">Min storage MB</label>
                    <input id="na-disk" type="number" min="512" value={appForm.minStorageMb} onChange={appField('minStorageMb')} />
                  </div>
                </div>
                <fieldset className="field">
                  <legend>Supported hosting types</legend>
                  <div className="row row-wrap">
                    {HOSTING_TYPES.map((t) => (
                      <label key={t}>
                        <input
                          type="checkbox"
                          checked={appForm.supportedHostingTypes.includes(t)}
                          onChange={(e) => setAppForm((f) => ({
                            ...f,
                            supportedHostingTypes: e.target.checked
                              ? [...f.supportedHostingTypes, t]
                              : f.supportedHostingTypes.filter((x) => x !== t),
                          }))}
                        /> {t}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="row row-wrap">
                  <label>
                    <input type="checkbox" checked={appForm.featured} onChange={appField('featured')} /> Featured
                  </label>
                  <label>
                    <input type="checkbox" checked={appForm.requiresAdminApproval} onChange={appField('requiresAdminApproval')} /> Requires admin approval
                  </label>
                </div>
                <button className="btn btn-primary" type="submit" disabled={busy} style={{ marginTop: 12 }}>Create</button>
              </form>
            )}
            {apps === null ? (
              <p className="muted">Loading applications…</p>
            ) : apps.length === 0 ? (
              <p className="muted">No applications in the catalogue.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Application</th>
                      <th scope="col">Deployment</th>
                      <th scope="col">Status</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apps.map((app) => (
                      <tr key={app.id}>
                        <td>
                          <button className="linklike" type="button" onClick={() => openApp(app)}><strong>{app.name}</strong></button>
                          <div className="muted small">{app.slug}</div>
                        </td>
                        <td>{app.deploymentType}</td>
                        <td><span className={statusClass(app.status)}>{humanizeStatus(app.status)}</span></td>
                        <td>
                          <select
                            aria-label={`Move ${app.slug} to`}
                            value=""
                            disabled={busy}
                            onChange={(e) => e.target.value && setAppStatus(app, e.target.value)}
                          >
                            <option value="">Move to…</option>
                            {(APP_TRANSITIONS[app.status] ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
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
              <h2>{selected.application.name} ({selected.application.slug})</h2>
              <p className="muted">
                <span className={statusClass(selected.application.status)}>{humanizeStatus(selected.application.status)}</span>
                {' · '}{selected.installCount} installation(s)
                {selected.application.featured ? ' · featured' : ''}
              </p>
              <p>{selected.application.description}</p>
              <h3>Versions</h3>
              {(selected.versions ?? []).length === 0 ? (
                <p className="muted">No versions yet — publishing the application requires a published version.</p>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">Version</th>
                        <th scope="col">Status</th>
                        <th scope="col">Stable</th>
                        <th scope="col">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.versions.map((ver) => (
                        <tr key={ver.id}>
                          <td><strong>{ver.version}</strong></td>
                          <td><span className={statusClass(ver.status)}>{humanizeStatus(ver.status)}</span></td>
                          <td>{ver.isStable ? 'yes' : 'no'}</td>
                          <td>
                            <div className="row row-wrap">
                              {(VERSION_TRANSITIONS[ver.status] ?? []).map((s) => (
                                <button key={s} className="btn btn-ghost" type="button" disabled={busy}
                                  onClick={() => setVersionStatus(selected.application.id, ver, { status: s })}>
                                  {s}
                                </button>
                              ))}
                              {ver.status === 'published' && !ver.isStable && (
                                <button className="btn btn-ghost" type="button" disabled={busy}
                                  onClick={() => setVersionStatus(selected.application.id, ver, { isStable: true })}>
                                  mark stable
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="row row-wrap" style={{ marginTop: 16 }}>
                <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => deleteApp(selected.application)}>Delete application</button>
              </div>
            </section>
          )}
        </>
      )}

      {tab === 'listing' && (
        <section className="card">
          <h2>Customer-facing listing</h2>
          <p className="muted">Price and availability as the storefront reads them.</p>
          {listing === null ? (
            <p className="muted">Loading listing…</p>
          ) : listing.length === 0 ? (
            <p className="muted">No listed applications.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Application</th>
                    <th scope="col">Version</th>
                    <th scope="col">Price</th>
                    <th scope="col">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {listing.map((app) => (
                    <tr key={app.id}>
                      <td><strong>{app.name}</strong><div className="muted small">{app.slug}</div></td>
                      <td>{app.version ?? '—'}</td>
                      <td>
                        <input
                          aria-label={`Price for ${app.slug} in cents`}
                          type="number"
                          min="0"
                          defaultValue={app.priceCents}
                          disabled={busy}
                          onBlur={(e) => run(async () => {
                            await adminApi.adminUpdateMarketplaceApp(app.id, { priceCents: Number(e.target.value) });
                            await loadTab('listing');
                          }, `${app.slug} price updated.`)}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={app.active}
                          disabled={busy}
                          aria-label={`Active ${app.slug}`}
                          onChange={(e) => run(async () => {
                            await adminApi.adminUpdateMarketplaceApp(app.id, { active: e.target.checked });
                            await loadTab('listing');
                          }, `${app.slug} ${e.target.checked ? 'listed' : 'unlisted'}.`)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'categories' && (
        <section className="card">
          <div className="page-head" style={{ marginBottom: 0 }}>
            <h2>Categories</h2>
            <button className="btn btn-primary" type="button" onClick={() => setShowCatForm((s) => !s)}>
              {showCatForm ? 'Cancel' : 'Create category'}
            </button>
          </div>
          {showCatForm && (
            <form onSubmit={createCategory}>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="cat-name">Name</label>
                  <input id="cat-name" value={catForm.name} onChange={catField('name')} required />
                </div>
                <div className="field">
                  <label htmlFor="cat-slug">Slug</label>
                  <input id="cat-slug" value={catForm.slug} onChange={catField('slug')} required placeholder="content-management" />
                </div>
                <div className="field">
                  <label htmlFor="cat-desc">Description</label>
                  <input id="cat-desc" value={catForm.description} onChange={catField('description')} />
                </div>
                <div className="field">
                  <label htmlFor="cat-order">Sort order</label>
                  <input id="cat-order" type="number" min="0" max="1000" value={catForm.sortOrder} onChange={catField('sortOrder')} />
                </div>
              </div>
              <div className="row row-wrap">
                <label><input type="checkbox" checked={catForm.active} onChange={catField('active')} /> Active</label>
              </div>
              <button className="btn btn-primary" type="submit" disabled={busy} style={{ marginTop: 12 }}>Create</button>
            </form>
          )}
          {categories === null ? (
            <p className="muted">Loading categories…</p>
          ) : categories.length === 0 ? (
            <p className="muted">No categories. Seed the canonical tree from the Manifests tab.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Slug</th>
                    <th scope="col">Sort</th>
                    <th scope="col">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((cat) => (
                    <tr key={cat.id}>
                      <td><strong>{cat.name}</strong></td>
                      <td>{cat.slug}</td>
                      <td>{cat.sort_order ?? '—'}</td>
                      <td>
                        <input
                          type="checkbox"
                          checked={!!cat.active}
                          disabled={busy}
                          aria-label={`Active ${cat.slug}`}
                          onChange={(e) => run(async () => {
                            await adminApi.adminUpdateAppCategory(cat.id, { active: e.target.checked });
                            await loadTab('categories');
                          }, `${cat.slug} ${e.target.checked ? 'activated' : 'deactivated'}.`)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'manifests' && (
        <section className="card">
          <h2>Manifests</h2>
          <p className="muted">
            Import reads every manifest in the configured directory and refuses the whole import when
            any file is invalid — a partially imported catalogue is harder to reason about than none.
          </p>
          <div className="row row-wrap">
            <button className="btn btn-primary" type="button" disabled={busy} onClick={() => run(async () => {
              const res = await adminApi.adminImportManifests();
              setNotice(`Imported ${res.imported} manifest(s).`);
              await loadTab('catalogue');
            })}>
              Import on-disk catalogue
            </button>
            <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => run(async () => {
              const res = await adminApi.adminSeedCategories();
              const created = Array.isArray(res.created) ? res.created.length : res.created;
              setNotice(`Canonical categories ensured (${created} created).`);
            })}>
              Seed canonical categories
            </button>
          </div>
          <div className="field" style={{ marginTop: 16 }}>
            <label htmlFor="manifest-yaml">Validate a manifest (YAML)</label>
            <textarea id="manifest-yaml" rows={8} value={manifestYaml} onChange={(e) => setManifestYaml(e.target.value)} />
          </div>
          <button className="btn btn-ghost" type="button" disabled={busy || !manifestYaml.trim()} onClick={() => run(async () => {
            const res = await adminApi.adminValidateManifest(manifestYaml);
            setManifestResult(res);
          })}>
            Validate
          </button>
          {manifestResult && (
            <p className="muted" role="status">
              {manifestResult.valid
                ? 'Manifest is valid.'
                : `Invalid: ${(manifestResult.errors ?? []).join('; ')}`}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
