import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, describeError } from '../lib/api.js';
import { formatDate, humanizeStatus, statusClass, formatMoney } from '../lib/format.js';

const TABS = [
  ['overview', 'Overview'],
  ['providers', 'Providers'],
  ['extensions', 'Extensions'],
  ['transfers', 'Transfers'],
  ['registrations', 'Registrations'],
  ['auctions', 'Auctions'],
  ['club', 'Club plans'],
  ['oversight', 'Oversight'],
];

const PROVIDER_TYPES = ['registrar', 'rdap', 'appraisal', 'auction'];

/**
 * Domain Services admin console.
 *
 * Providers are configured here with write-only credentials (never returned by any endpoint), and
 * "Test Connection" is a real authenticated call whose verdict is the only way a provider row
 * becomes `connected`. Transfers poll the registrar that holds them. Super-admin-only mutations are
 * refused by the server for other roles; the screen shows the server's reason.
 */
export default function AdminDomainServicesPage() {
  const [tab, setTab] = useState('overview');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const [overview, setOverview] = useState(null);
  const [providers, setProviders] = useState(null);
  const [installed, setInstalled] = useState([]);
  const [extensions, setExtensions] = useState(null);
  const [transfers, setTransfers] = useState(null);
  const [registrations, setRegistrations] = useState(null);
  const [auctions, setAuctions] = useState(null);
  const [club, setClub] = useState(null);
  const [appraisals, setAppraisals] = useState(null);
  const [lookups, setLookups] = useState(null);
  const [transactions, setTransactions] = useState(null);

  const [providerForm, setProviderForm] = useState({
    providerKey: '', name: '', adapterKey: '', providerType: 'registrar', apiBaseUrl: '', environment: 'production',
  });
  const [showProviderForm, setShowProviderForm] = useState(false);
  const [credsForm, setCredsForm] = useState({ providerId: '', text: '' });
  const [testResult, setTestResult] = useState(null);
  const [auctionForm, setAuctionForm] = useState({ domainName: '', minimumBid: '', bidIncrement: '', startsAt: '', endsAt: '' });
  const [showAuctionForm, setShowAuctionForm] = useState(false);
  const [clubForm, setClubForm] = useState({ name: '', billingPeriod: 'monthly', priceAmount: '', discountType: 'fixed', discountValue: '0' });
  const [showClubForm, setShowClubForm] = useState(false);

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

  const loadTab = useCallback(async (active) => {
    setError('');
    try {
      if (active === 'overview') setOverview(await adminApi.dsOverview());
      else if (active === 'providers') {
        const res = await adminApi.dsProviders();
        setProviders(res.providers ?? []);
        setInstalled(res.installedAdapters ?? []);
      } else if (active === 'extensions') setExtensions((await adminApi.dsExtensions()).extensions ?? []);
      else if (active === 'transfers') setTransfers((await adminApi.dsTransfers()).transfers ?? []);
      else if (active === 'registrations') setRegistrations((await adminApi.dsRegistrations()).registrations ?? []);
      else if (active === 'auctions') setAuctions((await adminApi.dsAuctions()).auctions ?? []);
      else if (active === 'club') setClub((await adminApi.dsClubPlans()).plans ?? []);
      else if (active === 'oversight') {
        const [a, w, t] = await Promise.all([
          adminApi.dsAppraisals(), adminApi.dsWhoisLookups(), adminApi.dsTransactions(),
        ]);
        setAppraisals(a.appraisals ?? []);
        setLookups(w.lookups ?? []);
        setTransactions(t.transactions ?? []);
      }
    } catch (e) {
      setError(describeError(e));
    }
  }, []);

  useEffect(() => { loadTab(tab); }, [tab, loadTab]);

  const providerField = (key) => (e) => setProviderForm((f) => ({ ...f, [key]: e.target.value }));

  const createProvider = async (e) => {
    e.preventDefault();
    await run(async () => {
      await adminApi.dsCreateProvider({
        providerKey: providerForm.providerKey.trim(),
        name: providerForm.name.trim(),
        adapterKey: providerForm.adapterKey.trim(),
        providerType: providerForm.providerType,
        ...(providerForm.apiBaseUrl.trim() ? { apiBaseUrl: providerForm.apiBaseUrl.trim() } : {}),
        environment: providerForm.environment,
      });
      setProviderForm({ providerKey: '', name: '', adapterKey: '', providerType: 'registrar', apiBaseUrl: '', environment: 'production' });
      setShowProviderForm(false);
      await loadTab('providers');
    }, 'Provider registered.');
  };

  const saveCredentials = async (e) => {
    e.preventDefault();
    const credentials = {};
    for (const line of credsForm.text.split('\n')) {
      const idx = line.indexOf('=');
      if (idx > 0) credentials[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    await run(async () => {
      await adminApi.dsSetProviderCredentials(credsForm.providerId, credentials);
      setCredsForm({ providerId: '', text: '' });
      await loadTab('providers');
    }, 'Credentials stored (write-only). Connection state reset — run Test Connection.');
  };

  const testProvider = (provider) => run(async () => {
    const res = await adminApi.dsTestProvider(provider.id);
    setTestResult({ name: provider.name, ...res.result });
    await loadTab('providers');
  });

  const createAuction = async (e) => {
    e.preventDefault();
    await run(async () => {
      await adminApi.dsCreateAuction({
        domainName: auctionForm.domainName.trim(),
        minimumBid: auctionForm.minimumBid || '0',
        bidIncrement: auctionForm.bidIncrement || '0',
        startsAt: new Date(auctionForm.startsAt).toISOString(),
        endsAt: new Date(auctionForm.endsAt).toISOString(),
      });
      setAuctionForm({ domainName: '', minimumBid: '', bidIncrement: '', startsAt: '', endsAt: '' });
      setShowAuctionForm(false);
      await loadTab('auctions');
    }, 'Auction created.');
  };

  const createClubPlan = async (e) => {
    e.preventDefault();
    await run(async () => {
      await adminApi.dsCreateClubPlan({
        name: clubForm.name.trim(),
        billingPeriod: clubForm.billingPeriod,
        priceAmount: clubForm.priceAmount || '0',
        discountType: clubForm.discountType,
        discountValue: clubForm.discountValue || '0',
      });
      setClubForm({ name: '', billingPeriod: 'monthly', priceAmount: '', discountType: 'fixed', discountValue: '0' });
      setShowClubForm(false);
      await loadTab('club');
    }, 'Club plan created.');
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Domain services</h1>
          <p className="muted">Registrar/registry providers, TLD extensions, registrations, transfers, auctions and club plans.</p>
        </div>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      <nav className="row row-wrap" aria-label="Domain services sections">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" className={tab === key ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <section className="card">
          <h2>Overview</h2>
          {overview === null ? <p className="muted">Loading…</p> : (
            <>
              <dl className="detail-list">
                <dt>Searches (24h)</dt><dd>{overview.searchesLast24h}</dd>
                <dt>Registrations</dt><dd>{JSON.stringify(overview.registrations)}</dd>
                <dt>Transfers</dt><dd>{JSON.stringify(overview.transfers)}</dd>
                <dt>Auctions</dt><dd>{JSON.stringify(overview.auctions)}</dd>
                <dt>Club memberships</dt><dd>{JSON.stringify(overview.club)}</dd>
              </dl>
            </>
          )}
        </section>
      )}

      {tab === 'providers' && (
        <>
          <section className="card">
            <div className="page-head" style={{ marginBottom: 0 }}>
              <h2>Providers</h2>
              <button className="btn btn-primary" type="button" onClick={() => setShowProviderForm((s) => !s)}>
                {showProviderForm ? 'Cancel' : 'Register provider'}
              </button>
            </div>
            {showProviderForm && (
              <form onSubmit={createProvider}>
                <div className="grid-2">
                  <div className="field">
                    <label htmlFor="p-key">Provider key</label>
                    <input id="p-key" value={providerForm.providerKey} onChange={providerField('providerKey')} required />
                  </div>
                  <div className="field">
                    <label htmlFor="p-name">Name</label>
                    <input id="p-name" value={providerForm.name} onChange={providerField('name')} required />
                  </div>
                  <div className="field">
                    <label htmlFor="p-adapter">Adapter key</label>
                    <input id="p-adapter" value={providerForm.adapterKey} onChange={providerField('adapterKey')} required placeholder={installed.join(', ') || 'installed adapter keys'} />
                  </div>
                  <div className="field">
                    <label htmlFor="p-type">Provider type</label>
                    <select id="p-type" value={providerForm.providerType} onChange={providerField('providerType')}>
                      {PROVIDER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="p-url">API base URL</label>
                    <input id="p-url" value={providerForm.apiBaseUrl} onChange={providerField('apiBaseUrl')} />
                  </div>
                  <div className="field">
                    <label htmlFor="p-env">Environment</label>
                    <select id="p-env" value={providerForm.environment} onChange={providerField('environment')}>
                      <option value="production">production</option>
                      <option value="sandbox">sandbox</option>
                    </select>
                  </div>
                </div>
                <button className="btn btn-primary" type="submit" disabled={busy}>Register</button>
              </form>
            )}
            {providers === null ? <p className="muted">Loading providers…</p> : providers.length === 0 ? (
              <p className="muted">No domain-service providers registered.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Provider</th>
                      <th scope="col">Adapter</th>
                      <th scope="col">Type</th>
                      <th scope="col">Status</th>
                      <th scope="col">Credentials</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {providers.map((p) => (
                      <tr key={p.id}>
                        <td><strong>{p.name}</strong><div className="muted small">{p.providerKey}</div></td>
                        <td>{p.adapterKey}</td>
                        <td>{p.providerType}</td>
                        <td>
                          <span className={statusClass(p.status)}>{humanizeStatus(p.status)}</span>
                          {p.lastError && <div className="muted small">{p.lastError}</div>}
                        </td>
                        <td>{p.hasCredentials ? 'stored (write-only)' : 'none'}</td>
                        <td>
                          <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => testProvider(p)}>
                            Test Connection
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {testResult && (
              <p className="muted" role="status">
                {testResult.name}: {testResult.status}{testResult.message ? ` — ${testResult.message}` : ''}
              </p>
            )}
          </section>

          <section className="card">
            <h2>Set credentials (write-only)</h2>
            <form onSubmit={saveCredentials}>
              <div className="field">
                <label htmlFor="c-provider">Provider</label>
                <select id="c-provider" value={credsForm.providerId} onChange={(e) => setCredsForm((f) => ({ ...f, providerId: e.target.value }))} required>
                  <option value="">Choose…</option>
                  {(providers ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="c-text">Credentials (one key=value per line)</label>
                <textarea id="c-text" rows={4} value={credsForm.text} onChange={(e) => setCredsForm((f) => ({ ...f, text: e.target.value }))} required placeholder="api_token=…" />
              </div>
              <button className="btn btn-primary" type="submit" disabled={busy}>Store credentials</button>
            </form>
          </section>
        </>
      )}

      {tab === 'extensions' && (
        <section className="card">
          <div className="page-head" style={{ marginBottom: 0 }}>
            <div>
              <h2>TLD extensions</h2>
              <p className="muted">Selling prices are the platform's own; sync records the registrar's catalogue separately.</p>
            </div>
            <button className="btn btn-primary" type="button" disabled={busy} onClick={() => run(async () => {
              const report = await adminApi.dsSyncExtensions();
              setNotice(`Synced ${report.synced} extensions (created ${report.created}, updated ${report.updated}) from ${report.providerKey ?? 'the connected registrar'}.`);
              await loadTab('extensions');
            })}>
              Sync from registrar
            </button>
          </div>
          {extensions === null ? <p className="muted">Loading extensions…</p> : extensions.length === 0 ? (
            <p className="muted">No extensions recorded.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">TLD</th>
                    <th scope="col">Register</th>
                    <th scope="col">Renew</th>
                    <th scope="col">Status</th>
                    <th scope="col">Trending</th>
                  </tr>
                </thead>
                <tbody>
                  {extensions.map((ext) => (
                    <tr key={ext.id}>
                      <td><strong>.{ext.tld}</strong></td>
                      <td>{ext.registerPriceCents != null ? formatMoney(ext.registerPriceCents / 100) : '—'}</td>
                      <td>{ext.renewPriceCents != null ? formatMoney(ext.renewPriceCents / 100) : '—'}</td>
                      <td>
                        <select
                          aria-label={`Status for .${ext.tld}`}
                          value={ext.status}
                          disabled={busy}
                          onChange={(e) => run(async () => {
                            await adminApi.dsUpdateExtension(ext.id, { status: e.target.value });
                            await loadTab('extensions');
                          }, `.${ext.tld} set to ${e.target.value}.`)}
                        >
                          {['active', 'disabled', 'unavailable'].map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td>{ext.isTrending ? 'yes' : 'no'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'transfers' && (
        <section className="card">
          <h2>Transfers</h2>
          {transfers === null ? <p className="muted">Loading transfers…</p> : transfers.length === 0 ? (
            <p className="muted">No transfers recorded.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Domain</th>
                    <th scope="col">Customer</th>
                    <th scope="col">Status</th>
                    <th scope="col">Provider status</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {transfers.map((t) => (
                    <tr key={t.id}>
                      <td><strong>{t.domain_name}</strong></td>
                      <td>{t.customer_email ?? '—'}</td>
                      <td><span className={statusClass(t.status)}>{humanizeStatus(t.status)}</span></td>
                      <td>{t.provider_status ?? '—'}</td>
                      <td>
                        <div className="row row-wrap">
                          <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => run(async () => {
                            const res = await adminApi.dsRefreshTransfer(t.id);
                            setNotice(`Poll result for ${t.domain_name}: ${res.status}${res.completed ? ' (completed)' : ''}${res.adopted ? ' (linked to customer)' : ''}.`);
                            await loadTab('transfers');
                          })}>
                            Refresh
                          </button>
                          <select
                            aria-label={`Status for ${t.domain_name}`}
                            value={t.status}
                            disabled={busy}
                            onChange={(e) => run(async () => {
                              await adminApi.dsUpdateTransfer(t.id, { status: e.target.value });
                              await loadTab('transfers');
                            }, `${t.domain_name} set to ${e.target.value}.`)}
                          >
                            {['pending', 'authorization_required', 'transfer_initiated', 'transfer_in_progress', 'pending_registry', 'completed', 'failed', 'cancelled'].map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
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

      {tab === 'registrations' && (
        <section className="card">
          <h2>Registrations</h2>
          {registrations === null ? <p className="muted">Loading registrations…</p> : registrations.length === 0 ? (
            <p className="muted">No registrations recorded.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Domain</th>
                    <th scope="col">Customer</th>
                    <th scope="col">Years</th>
                    <th scope="col">Status</th>
                    <th scope="col">Provider status</th>
                    <th scope="col">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {registrations.map((r) => (
                    <tr key={r.id}>
                      <td><strong>{r.domain_name}</strong></td>
                      <td>{r.customer_email ?? '—'}</td>
                      <td>{r.registration_years ?? '—'}</td>
                      <td><span className={statusClass(r.status)}>{humanizeStatus(r.status)}</span></td>
                      <td>{r.provider_status ?? '—'}</td>
                      <td>{formatDate(r.created_at, { withTime: true })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'auctions' && (
        <section className="card">
          <div className="page-head" style={{ marginBottom: 0 }}>
            <h2>Auctions</h2>
            <button className="btn btn-primary" type="button" onClick={() => setShowAuctionForm((s) => !s)}>
              {showAuctionForm ? 'Cancel' : 'Create auction'}
            </button>
          </div>
          {showAuctionForm && (
            <form onSubmit={createAuction}>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="a-domain">Domain</label>
                  <input id="a-domain" value={auctionForm.domainName} onChange={(e) => setAuctionForm((f) => ({ ...f, domainName: e.target.value }))} required />
                </div>
                <div className="field">
                  <label htmlFor="a-min">Minimum bid</label>
                  <input id="a-min" value={auctionForm.minimumBid} onChange={(e) => setAuctionForm((f) => ({ ...f, minimumBid: e.target.value }))} />
                </div>
                <div className="field">
                  <label htmlFor="a-inc">Bid increment</label>
                  <input id="a-inc" value={auctionForm.bidIncrement} onChange={(e) => setAuctionForm((f) => ({ ...f, bidIncrement: e.target.value }))} />
                </div>
                <div className="field">
                  <label htmlFor="a-start">Starts</label>
                  <input id="a-start" type="datetime-local" value={auctionForm.startsAt} onChange={(e) => setAuctionForm((f) => ({ ...f, startsAt: e.target.value }))} required />
                </div>
                <div className="field">
                  <label htmlFor="a-end">Ends</label>
                  <input id="a-end" type="datetime-local" value={auctionForm.endsAt} onChange={(e) => setAuctionForm((f) => ({ ...f, endsAt: e.target.value }))} required />
                </div>
              </div>
              <button className="btn btn-primary" type="submit" disabled={busy}>Create</button>
            </form>
          )}
          {auctions === null ? <p className="muted">Loading auctions…</p> : auctions.length === 0 ? (
            <p className="muted">No auctions recorded.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Domain</th>
                    <th scope="col">Status</th>
                    <th scope="col">Current bid</th>
                    <th scope="col">Ends</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {auctions.map((a) => (
                    <tr key={a.id}>
                      <td><strong>{a.domainName}</strong></td>
                      <td><span className={statusClass(a.status)}>{humanizeStatus(a.status)}</span></td>
                      <td>{a.currentBid ?? '—'}</td>
                      <td>{a.endsAt ? formatDate(a.endsAt, { withTime: true }) : '—'}</td>
                      <td>
                        <div className="row row-wrap">
                          {['open', 'close', 'cancel'].map((action) => (
                            <button key={action} className="btn btn-ghost" type="button" disabled={busy} onClick={() => run(async () => {
                              await adminApi.dsAuctionAction(a.id, action);
                              await loadTab('auctions');
                            }, `Auction ${action} requested.`)}>
                              {action}
                            </button>
                          ))}
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

      {tab === 'club' && (
        <section className="card">
          <div className="page-head" style={{ marginBottom: 0 }}>
            <h2>Club plans</h2>
            <button className="btn btn-primary" type="button" onClick={() => setShowClubForm((s) => !s)}>
              {showClubForm ? 'Cancel' : 'Create plan'}
            </button>
          </div>
          {showClubForm && (
            <form onSubmit={createClubPlan}>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="cp-name">Name</label>
                  <input id="cp-name" value={clubForm.name} onChange={(e) => setClubForm((f) => ({ ...f, name: e.target.value }))} required />
                </div>
                <div className="field">
                  <label htmlFor="cp-period">Billing period</label>
                  <select id="cp-period" value={clubForm.billingPeriod} onChange={(e) => setClubForm((f) => ({ ...f, billingPeriod: e.target.value }))}>
                    <option value="monthly">monthly</option>
                    <option value="annually">annually</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="cp-price">Price</label>
                  <input id="cp-price" value={clubForm.priceAmount} onChange={(e) => setClubForm((f) => ({ ...f, priceAmount: e.target.value }))} required placeholder="9.99" />
                </div>
                <div className="field">
                  <label htmlFor="cp-discount-type">Discount type</label>
                  <select id="cp-discount-type" value={clubForm.discountType} onChange={(e) => setClubForm((f) => ({ ...f, discountType: e.target.value }))}>
                    <option value="fixed">fixed</option>
                    <option value="percentage">percentage</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="cp-discount">Discount value</label>
                  <input id="cp-discount" value={clubForm.discountValue} onChange={(e) => setClubForm((f) => ({ ...f, discountValue: e.target.value }))} required />
                </div>
              </div>
              <button className="btn btn-primary" type="submit" disabled={busy}>Create</button>
            </form>
          )}
          {club === null ? <p className="muted">Loading club plans…</p> : club.length === 0 ? (
            <p className="muted">No club plans recorded.</p>
          ) : (
            <ul className="list">
              {club.map((plan) => (
                <li key={plan.id} className="row row-wrap">
                  <strong>{plan.name ?? plan.id}</strong>
                  <span className="muted">{plan.priceAmount != null ? formatMoney(Number(plan.priceAmount)) : '—'} · {plan.billingPeriod ?? '—'}</span>
                  <span className={statusClass(plan.status)}>{humanizeStatus(plan.status ?? 'active')}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'oversight' && (
        <>
          <section className="card">
            <h2>Appraisals</h2>
            {appraisals === null ? <p className="muted">Loading…</p> : appraisals.length === 0 ? (
              <p className="muted">No appraisals recorded.</p>
            ) : (
              <ul className="list">
                {appraisals.map((a) => (
                  <li key={a.id}>
                    <strong>{a.domain_name}</strong>
                    <span className={statusClass(a.status)}> {humanizeStatus(a.status)}</span>
                    <span className="muted">
                      {' · '}{a.estimated_value != null ? formatMoney(a.estimated_value, a.currency) : 'no estimate'}
                      {a.customer_email ? ` · ${a.customer_email}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card">
            <h2>WHOIS lookups</h2>
            {lookups === null ? <p className="muted">Loading…</p> : lookups.length === 0 ? (
              <p className="muted">No lookups recorded.</p>
            ) : (
              <ul className="list">
                {lookups.map((w) => (
                  <li key={w.id}>
                    <strong>{w.domain_name}</strong>
                    <span className={statusClass(w.status)}> {humanizeStatus(w.status)}</span>
                    <span className="muted">{' · '}{w.source ?? 'source unknown'}{w.privacy_protected ? ' · privacy protected' : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card">
            <h2>Transactions</h2>
            {transactions === null ? <p className="muted">Loading…</p> : transactions.length === 0 ? (
              <p className="muted">No transactions recorded.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Type</th>
                      <th scope="col">Amount</th>
                      <th scope="col">Customer</th>
                      <th scope="col">Status</th>
                      <th scope="col">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((t) => (
                      <tr key={t.id}>
                        <td>{t.transaction_type ?? '—'}</td>
                        <td>{formatMoney(t.amount, t.currency)}</td>
                        <td>{t.customer_email ?? '—'}</td>
                        <td><span className={statusClass(t.status)}>{humanizeStatus(t.status)}</span></td>
                        <td>{formatDate(t.created_at, { withTime: true })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
