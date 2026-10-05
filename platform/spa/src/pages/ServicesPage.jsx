import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { accountApi, describeError } from '../lib/api.js';
import { formatDate, humanizeStatus, statusClass } from '../lib/format.js';

/**
 * Hosting services and registered domains on the account.
 *
 * Read-only on purpose: the mutating flows for a service (provision, suspend, cancel, console) live
 * in their own modules, and several of them are refused by the server with a named reason until
 * provider egress exists. Showing only what can be done honestly beats buttons that cannot work.
 */
export default function ServicesPage() {
  const [services, setServices] = useState(null);
  const [domains, setDomains] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    const [s, d] = await Promise.allSettled([accountApi.services(), accountApi.domains()]);
    if (s.status === 'fulfilled') setServices(s.value.services);
    else { setServices([]); setError(describeError(s.reason)); }
    setDomains(d.status === 'fulfilled' ? d.value.domains : []);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Services</h1>
          <p className="muted">Hosting services and domains registered through CloudHost247.</p>
        </div>
        <Link className="btn btn-primary" to="/catalog">Browse products</Link>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <section className="card">
        <h2>Hosting services</h2>
        {services === null ? <p className="muted">Loading services…</p> : services.length === 0 ? (
          <p className="muted">No services yet. <Link to="/catalog">Order hosting</Link> to get started.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Service</th>
                  <th scope="col">Domain</th>
                  <th scope="col">Username</th>
                  <th scope="col">Next due</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {services.map((service) => (
                  <tr key={service.id}>
                    <td>
                      <strong>{service.label ?? service.package ?? 'Service'}</strong>
                      {service.package && service.label && <span className="muted"> · {service.package}</span>}
                    </td>
                    <td>{service.domain ?? '—'}</td>
                    <td>{service.username ?? '—'}</td>
                    <td>{formatDate(service.nextDueDate)}</td>
                    <td><span className={statusClass(service.status)}>{humanizeStatus(service.status)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Domains</h2>
        {domains === null ? <p className="muted">Loading domains…</p> : domains.length === 0 ? (
          <p className="muted">No domains on this account.</p>
        ) : (
          <ul className="list">
            {domains.map((domain) => (
              <li key={domain.id} className="stack">
                <div className="row">
                  <strong>{domain.domain}</strong>
                  <span className={statusClass(domain.status)}>{humanizeStatus(domain.status)}</span>
                </div>
                <p className="muted">
                  {domain.registrar ?? 'Registrar unknown'}
                  {' · expires '}{formatDate(domain.expiresAt)}
                  {domain.autoRenew ? ' · auto-renew on' : ' · auto-renew off'}
                </p>
                {domain.nameservers?.length > 0 && (
                  <p className="muted">Nameservers: {domain.nameservers.join(', ')}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
