import { useCallback, useEffect, useState } from 'react';
import { usePageMeta } from '../lib/usePageMeta';
import { apiFetch } from '../lib/api';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';

interface DomainRow {
  id: string;
  domain_name: string;
  verification_status: string;
  verification_token: string | null;
  ssl_status: string;
  created_at: string;
}

/**
 * Customer domains (spec §15): add a domain, prove ownership with a real DNS TXT record,
 * request SSL, and delete when no application still references it. The TXT instructions are
 * shown inline so the customer never has to guess.
 */
export default function DashboardDomainsPage() {
  usePageMeta('Domains', 'Manage your domains and SSL certificates');
  const [domains, setDomains] = useState<DomainRow[] | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    let cancelled = false;
    apiFetch<{ domains: DomainRow[] }>('/api/v1/domains')
      .then((result) => !cancelled && setDomains(result.domains))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  async function addDomain(event: React.FormEvent) {
    event.preventDefault();
    setBusy('add');
    setMessage('');
    try {
      const result = await apiFetch<{
        domain: DomainRow;
        verification: { recordName: string; recordValue: string | null };
      }>('/api/v1/domains', { method: 'POST', body: JSON.stringify({ domain: newDomain.trim() }) });
      setMessage(
        `Domain added. Create this DNS TXT record, then click Verify: ${result.verification.recordName} = "${result.verification.recordValue}"`
      );
      setNewDomain('');
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not add the domain');
    } finally {
      setBusy('');
    }
  }

  async function domainAction(id: string, action: 'verify' | 'ssl' | 'delete') {
    setBusy(`${action}:${id}`);
    setMessage('');
    try {
      if (action === 'delete') {
        if (!window.confirm('Delete this domain? Applications using it will lose their routing.')) return;
        await apiFetch(`/api/v1/domains/${id}`, { method: 'DELETE' });
        setMessage('Domain deleted.');
        load();
      } else if (action === 'verify') {
        const result = await apiFetch<{ verified: boolean; detail: string }>(`/api/v1/domains/${id}/verify`, {
          method: 'POST',
        });
        setMessage(result.verified ? 'Domain verified — you can now attach it to applications.' : `Not verified yet: ${result.detail}`);
        load();
      } else {
        const result = await apiFetch<{ note: string }>(`/api/v1/domains/${id}/ssl`, { method: 'POST' });
        setMessage(result.note);
        load();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <h1>Domains</h1>
        <p className="ch247-page__hint">
          Add a domain, prove ownership with a DNS TXT record, and SSL certificates are issued
          for verified domains used by your applications. Verification is a real DNS lookup —
          propagation can take a few minutes after you create the record.
        </p>
        <form className="ch247-inlineform" onSubmit={addDomain}>
          <input
            type="text"
            value={newDomain}
            onChange={(event) => setNewDomain(event.target.value)}
            placeholder="example.com"
            aria-label="Domain name"
          />
          <button type="submit" className="ch247-btn ch247-btn--primary" disabled={busy !== '' || !newDomain.trim()}>
            Add domain
          </button>
        </form>
        {message && <p className="ch247-banner ch247-banner--info">{message}</p>}
        {error && <CatalogErrorBanner message={error} />}
      </div>

      {domains === null && !error && <CatalogLoadingBanner label="Loading domains…" />}
      {domains !== null && domains.length === 0 && (
        <div className="ch247-card">
          <p className="ch247-page__hint">No domains added yet.</p>
        </div>
      )}

      {domains?.map((domain) => (
        <div key={domain.id} className="ch247-card ch247-instrow">
          <div className="ch247-instrow__main">
            <h2>{domain.domain_name}</h2>
            <p>
              <span className="ch247-badge">{domain.verification_status}</span>{' '}
              <span className="ch247-badge">SSL: {domain.ssl_status}</span>
            </p>
            {domain.verification_status !== 'verified' && domain.verification_token && (
              <p className="ch247-page__hint">
                TXT record: <code>_cloudhost247-verification.{domain.domain_name}</code> ={' '}
                <code>cloudhost247-verify={domain.verification_token}</code>
              </p>
            )}
          </div>
          <div className="ch247-instrow__side ch247-actions">
            {domain.verification_status !== 'verified' && (
              <button
                type="button"
                className="ch247-btn"
                disabled={busy !== ''}
                onClick={() => domainAction(domain.id, 'verify')}
              >
                Verify
              </button>
            )}
            {domain.verification_status === 'verified' && domain.ssl_status === 'none' && (
              <button
                type="button"
                className="ch247-btn"
                disabled={busy !== ''}
                onClick={() => domainAction(domain.id, 'ssl')}
              >
                Request SSL
              </button>
            )}
            <button
              type="button"
              className="ch247-btn ch247-btn--danger"
              disabled={busy !== ''}
              onClick={() => domainAction(domain.id, 'delete')}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
