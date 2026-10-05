import React, { useEffect, useState } from 'react';
import { adminApi, describeError } from '../lib/api.js';

const FIELDS = [
  ['brandName', 'Brand name', 'text'],
  ['tagline', 'Tagline', 'text'],
  ['supportEmail', 'Support email', 'email'],
  ['salesEmail', 'Sales email', 'email'],
  ['billingEmail', 'Billing email', 'email'],
  ['phone', 'Phone', 'tel'],
  ['addressLine1', 'Address line 1', 'text'],
  ['addressLine2', 'Address line 2', 'text'],
  ['addressCity', 'City', 'text'],
  ['addressRegion', 'Region / State', 'text'],
  ['addressCountry', 'Country', 'text'],
  ['addressPostalCode', 'Postal code', 'text'],
  ['socialTwitter', 'Twitter / X URL', 'url'],
  ['socialLinkedin', 'LinkedIn URL', 'url'],
  ['socialGithub', 'GitHub URL', 'url'],
  ['socialFacebook', 'Facebook URL', 'url'],
];

export default function AdminSiteSettingsPage() {
  const [values, setValues] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    adminApi.settings()
      .then((res) => {
        const row = (res.settings ?? []).find((s) => s.key === 'site_info');
        const current = row?.value && typeof row.value === 'object' ? row.value : {};
        setValues(Object.fromEntries(FIELDS.map(([key]) => [key, typeof current[key] === 'string' ? current[key] : ''])));
      })
      .catch((err) => setError(describeError(err)));
  }, []);

  const save = async (event) => {
    event.preventDefault();
    setError(''); setNotice(''); setBusy(true);
    try {
      // Only non-empty fields are stored; the public endpoint drops anything it does not whitelist.
      const value = {};
      for (const [key] of FIELDS) {
        const v = (values[key] ?? '').trim();
        if (v) value[key] = v;
      }
      await adminApi.saveSetting('site_info', value);
      setNotice('Saved. The contact page and site header now show these details.');
      setValues(Object.fromEntries(FIELDS.map(([key]) => [key, value[key] ?? ''])));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Site settings</h1>
          <p className="muted">
            Official contact details and brand information published across the website.
            Unpublished fields show an honest &quot;being published&quot; state instead of invented details.
          </p>
        </div>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      {values === null && !error ? <p className="muted">Loading…</p> : (
        <form className="card" onSubmit={save}>
          <h2>Brand</h2>
          <div className="grid-2">
            {FIELDS.slice(0, 2).map(([key, label, type]) => (
              <div className="field" key={key}>
                <label htmlFor={`s-${key}`}>{label}</label>
                <input id={`s-${key}`} type={type} value={values[key]}
                  onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))} />
              </div>
            ))}
          </div>

          <h2>Contact channels</h2>
          <div className="grid-2">
            {FIELDS.slice(2, 6).map(([key, label, type]) => (
              <div className="field" key={key}>
                <label htmlFor={`s-${key}`}>{label}</label>
                <input id={`s-${key}`} type={type} value={values[key]}
                  onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))} />
              </div>
            ))}
          </div>

          <h2>Registered address</h2>
          <div className="grid-2">
            {FIELDS.slice(6, 12).map(([key, label, type]) => (
              <div className="field" key={key}>
                <label htmlFor={`s-${key}`}>{label}</label>
                <input id={`s-${key}`} type={type} value={values[key]}
                  onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))} />
              </div>
            ))}
          </div>

          <h2>Social links</h2>
          <div className="grid-2">
            {FIELDS.slice(12).map(([key, label, type]) => (
              <div className="field" key={key}>
                <label htmlFor={`s-${key}`}>{label}</label>
                <input id={`s-${key}`} type={type} value={values[key]}
                  onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))} />
              </div>
            ))}
          </div>

          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save site settings'}
          </button>
          <p className="hint">Writing settings requires the super_admin role; the server refuses anything less and the refusal is shown here verbatim.</p>
        </form>
      )}
    </div>
  );
}
