import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { marketplaceApi, appsApi, describeError } from '../lib/api.js';
import { formatMoney } from '../lib/format.js';

/**
 * App marketplace — browse the admin-managed catalogue and install.
 *
 * Installing creates the installation and its order: free apps deploy immediately, paid apps deploy
 * automatically once the invoice settles. The screen reports which of the two happened, and never
 * claims a deployment that was only queued.
 */
export default function MarketplacePage() {
  const [categories, setCategories] = useState(null);
  const [apps, setApps] = useState(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState(null);
  const [installForm, setInstallForm] = useState({ name: '', domain: '', backupEnabled: false });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (searchTerm, categorySlug) => {
    setError('');
    try {
      const [c, a] = await Promise.all([
        marketplaceApi.categories(),
        marketplaceApi.apps({ search: searchTerm || undefined, category: categorySlug || undefined }),
      ]);
      setCategories(c.categories ?? []);
      setApps(a.apps ?? []);
    } catch (e) {
      setApps([]);
      setError(describeError(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runSearch = async (e) => {
    e.preventDefault();
    await load(search, category);
  };

  const install = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const res = await appsApi.install({
        applicationId: selected.id,
        ...(installForm.name.trim() ? { name: installForm.name.trim() } : {}),
        ...(installForm.domain.trim() ? { domain: installForm.domain.trim() } : {}),
        backupEnabled: !!installForm.backupEnabled,
      });
      setNotice(
        res.paymentRequired
          ? `${res.message} Invoice ${res.invoiceNumber} (${formatMoney(res.totalAmount, res.currency)}) is waiting in Billing.`
          : `${res.message} Follow progress under My Apps.`,
      );
      setSelected(null);
      setInstallForm({ name: '', domain: '', backupEnabled: false });
    } catch (e2) {
      setError(describeError(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Marketplace</h1>
          <p className="muted">Applications you can install onto your hosting services.</p>
        </div>
        <Link className="btn btn-primary" to="/apps">My apps</Link>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      <form className="card" onSubmit={runSearch}>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="app-search">Search</label>
            <input id="app-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or description" />
          </div>
          <div className="field">
            <label htmlFor="app-category">Category</label>
            <select id="app-category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {(categories ?? []).map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <button className="btn btn-primary" type="submit">Apply filters</button>
      </form>

      {selected && (
        <form className="card" onSubmit={install}>
          <h2>Install {selected.name}</h2>
          <p className="muted">{selected.description}</p>
          <p className="muted">
            {selected.free ? 'Free — deployment is queued as soon as you install.' : `Price: ${formatMoney(selected.priceCents / 100)} — deployment starts after the invoice settles.`}
          </p>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="inst-name">Instance name</label>
              <input id="inst-name" value={installForm.name} onChange={(e) => setInstallForm((f) => ({ ...f, name: e.target.value }))} placeholder={selected.name} />
            </div>
            <div className="field">
              <label htmlFor="inst-domain">Domain (optional)</label>
              <input id="inst-domain" value={installForm.domain} onChange={(e) => setInstallForm((f) => ({ ...f, domain: e.target.value }))} placeholder="app.example.com" />
            </div>
          </div>
          <div className="row row-wrap">
            <label>
              <input type="checkbox" checked={installForm.backupEnabled} onChange={(e) => setInstallForm((f) => ({ ...f, backupEnabled: e.target.checked }))} />
              {' '}Enable backups
            </label>
          </div>
          <div className="row row-wrap" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Installing…' : 'Install'}</button>
            <button className="btn btn-ghost" type="button" onClick={() => setSelected(null)}>Cancel</button>
          </div>
        </form>
      )}

      <section className="card">
        <h2>Applications</h2>
        {apps === null ? (
          <p className="muted">Loading applications…</p>
        ) : apps.length === 0 ? (
          <p className="muted">No applications match. Try clearing the filters.</p>
        ) : (
          <ul className="list">
            {apps.map((app) => (
              <li key={app.id} className="stack">
                <div className="row row-wrap">
                  <strong>{app.name}</strong>
                  <span className="muted">{app.free ? 'Free' : formatMoney(app.priceCents / 100)}</span>
                  {app.version && <span className="muted">v{app.version}</span>}
                </div>
                <p className="muted">{app.description}</p>
                <div className="row row-wrap">
                  <button className="btn btn-primary" type="button" onClick={() => setSelected(app)}>Install</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
