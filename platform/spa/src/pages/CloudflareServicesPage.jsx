import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cloudflareApi, describeError } from '../lib/api.js';
import { statusClass, humanizeStatus } from '../lib/format.js';

/**
 * Customer Cloudflare services list.
 *
 * Each row is one Cloudflare-protected zone on the account. Everything the detail screen can do is
 * scoped per service and verified against Cloudflare live; this list is just the entry point.
 */
export default function CloudflareServicesPage() {
  const [services, setServices] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await cloudflareApi.services();
      setServices(res.services ?? []);
    } catch (e) {
      setServices([]);
      setError(describeError(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Cloudflare</h1>
          <p className="muted">Zones served through Cloudflare: DNS, firewall, caching, DNSSEC and analytics.</p>
        </div>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <section className="card">
        <h2>Your zones</h2>
        {services === null ? (
          <p className="muted">Loading Cloudflare services…</p>
        ) : services.length === 0 ? (
          <p className="muted">No Cloudflare services on this account yet. Order Cloudflare from the product catalog to protect a zone.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Zone</th>
                  <th scope="col">Plan</th>
                  <th scope="col">Status</th>
                  <th scope="col">Added</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {services.map((service) => (
                  <tr key={service.id}>
                    <td><strong>{service.zoneName}</strong></td>
                    <td>{service.cloudflarePlan ?? '—'}</td>
                    <td><span className={statusClass(service.status)}>{humanizeStatus(service.status)}</span></td>
                    <td>{service.createdAt ? new Date(service.createdAt).toLocaleDateString() : '—'}</td>
                    <td><Link className="btn btn-ghost" to={`/cloudflare/${service.id}`}>Manage</Link></td>
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
