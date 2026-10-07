import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { getToken } from '../lib/auth';
import { searchDomains, type SearchResponse } from '../lib/domain-services-api';
import { AvailabilityChip, formatPrice } from '../components/domain-services/ui';

/**
 * Public Domain Services hub — the entry point for the whole Domain Services platform.
 *
 * The nine service cards mirror the reference layout (three titled groups: Find a Domain,
 * Domain Investing, Domain Tools and Services). The search box performs a REAL search through the
 * backend; when no registrar provider is configured, the honest "Service Provider Not Configured"
 * state is shown — never placeholder availability or prices.
 */
interface ServiceCardProps {
  to: string;
  icon: string;
  title: string;
  text: string;
  linkLabel: string;
  accent?: boolean;
  external?: boolean;
}

function ServiceCard({ to, icon, title, text, linkLabel, accent, external }: ServiceCardProps) {
  const link = external ? (
    <a className="ch247-dsvc-card__link" href={to}>
      {linkLabel} <span aria-hidden="true">→</span>
    </a>
  ) : (
    <Link className="ch247-dsvc-card__link" to={to}>
      {linkLabel} <span aria-hidden="true">→</span>
    </Link>
  );
  return (
    <article className="ch247-dsvc-card">
      <div className={accent ? 'ch247-dsvc-card__icon ch247-dsvc-card__icon--accent' : 'ch247-dsvc-card__icon'} aria-hidden="true">
        {icon}
      </div>
      <h3 className="ch247-dsvc-card__title">{title}</h3>
      <p className="ch247-dsvc-card__text">{text}</p>
      {link}
    </article>
  );
}

export default function DomainsMarketingPage() {
  usePageMeta('Domain Services', 'Search, register, transfer and invest in domain names at CloudHost247.');
  const token = getToken();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState<SearchResponse | null>(null);

  // Clean up a stale search result if the user signs out/in mid-session.
  useEffect(() => () => setSearch(null), []);

  // Honour `?q=` from the homepage domain search so the visitor does not have to type twice.
  useEffect(() => {
    const incoming = (params.get('q') ?? '').trim();
    if (!incoming) return undefined;
    let cancelled = false;
    setBusy(true);
    setError('');
    searchDomains(incoming)
      .then((response) => {
        if (!cancelled) setSearch(response);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'The search could not be completed right now.');
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [params]);

  async function onSearch(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setBusy(true);
    setError('');
    setSearch(null);
    try {
      const response = await searchDomains(trimmed);
      setSearch(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The search could not be completed right now.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <h1>Domain Services</h1>
          <p>Find, register, transfer and invest in domain names — all in one place.</p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page">
          <h2>Find your domain</h2>
          <p>Search a name across our supported extensions. Availability and pricing come live from our domain provider.</p>
          <form className="ch247-dsvc-search" onSubmit={onSearch} role="search">
            <label className="sr-only" htmlFor="domain-search-input">
              Domain name to search
            </label>
            <input
              id="domain-search-input"
              type="search"
              name="query"
              placeholder="Search a domain, e.g. example or example.com"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
              maxLength={253}
            />
            <button className="ch247-button" type="submit" disabled={busy || query.trim().length === 0}>
              {busy ? 'Searching…' : 'Search'}
            </button>
          </form>

          {error && (
            <p className="ch247-banner ch247-banner--error" role="alert" style={{ marginTop: '1rem' }}>
              {error}
            </p>
          )}

          {search && search.status === 'provider_not_configured' && (
            <div className="ch247-dsvc-provider-missing" role="status" style={{ marginTop: '1rem' }}>
              <strong>Service Provider Not Configured</strong>
              <p style={{ margin: '0.4rem 0 0' }}>
                Domain search needs a connected registrar provider before it can show live availability. No placeholder
                results are shown — once a Super Admin connects the provider, this search returns real data.
              </p>
            </div>
          )}

          {search && search.status !== 'provider_not_configured' && search.message && (
            <p className="ch247-banner ch247-banner--warning" role="status" style={{ marginTop: '1rem' }}>
              {search.message}
            </p>
          )}

          {search && search.status === 'completed' && search.results.length > 0 && (
            <div className="ch247-dsvc-result-grid" aria-live="polite">
              {search.results.slice(0, 12).map((result) => (
                <div className="ch247-dsvc-result" key={result.domainName}>
                  <div>
                    <div className="ch247-dsvc-result__domain">{result.domainName}</div>
                    <div className="ch247-dsvc-result__prices">
                      <span>
                        Reg <strong>{formatPrice(result.registrationPrice, result.currency)}</strong>
                      </span>
                      <span>
                        Renew <strong>{formatPrice(result.renewalPrice, result.currency)}</strong>
                      </span>
                      <span>
                        Transfer <strong>{formatPrice(result.transferPrice, result.currency)}</strong>
                      </span>
                    </div>
                  </div>
                  <AvailabilityChip status={result.availabilityStatus} />
                </div>
              ))}
            </div>
          )}

          {search && search.status === 'completed' && search.results.length > 12 && (
            <p style={{ marginTop: '0.75rem' }}>
              <Link to="/domains/search">See all {search.results.length} results and register a domain →</Link>
            </p>
          )}

          {search && search.status === 'completed' && search.results.some((r) => r.availabilityStatus === 'available') && !token && (
            <p style={{ marginTop: '1rem' }}>
              <Link className="ch247-button" to="/register">
                Create an account to register this domain
              </Link>
            </p>
          )}

          {/* ------------------------------------------------------------------ FIND A DOMAIN */}
          <div className="ch247-dsvc-group">
            <h2>Find a Domain</h2>
            <div className="ch247-dsvc-grid">
              <ServiceCard
                to="/domains/search"
                icon="🔍"
                title="Search for Domain Names"
                text="Check availability across our supported extensions and register in minutes."
                linkLabel="Search domains"
              />
              <ServiceCard
                to="/domains/transfer"
                icon="↔"
                title="Transfer Domain Names"
                text="Move your domains to CloudHost247 with an EPP code — transfers are tracked end to end."
                linkLabel="Transfer a domain"
              />
              <ServiceCard
                to="/domains/extensions"
                icon="🌿"
                title="gTLD Domain Extensions"
                text="Browse the full extension catalogue with registration, renewal and transfer pricing."
                linkLabel="Browse extensions"
              />
            </div>
          </div>

          {/* ------------------------------------------------------------ DOMAIN INVESTING */}
          <div className="ch247-dsvc-group">
            <h2>Domain Investing</h2>
            <div className="ch247-dsvc-grid">
              <ServiceCard
                to="/domains/auctions"
                icon="📢"
                title="Auctions for Domain Names"
                text="Bid on premium domains in a live marketplace. Get notified when you are outbid."
                linkLabel="Browse auctions"
                accent
              />
              <ServiceCard
                to="/domains/appraisal"
                icon="💎"
                title="Appraise Domain Name Value"
                text="Get an automated valuation estimate for any domain, powered by a real appraisal provider."
                linkLabel="Appraise a domain"
                accent
              />
              <ServiceCard
                to="/domains/club"
                icon="🏷"
                title="Discount Domain Club"
                text="Join the club for member pricing on eligible domain registrations and renewals."
                linkLabel="See member pricing"
                accent
              />
            </div>
          </div>

          {/* ------------------------------------------------- DOMAIN TOOLS AND SERVICES */}
          <div className="ch247-dsvc-group">
            <h2>Domain Tools and Services</h2>
            <div className="ch247-dsvc-grid">
              <ServiceCard
                to="/domains/whois"
                icon="👤"
                title="Find a Domain Owner (WHOIS/RDAP)"
                text="Look up registration data with modern RDAP. Privacy-protected records stay protected."
                linkLabel="Look up a domain"
              />
              <ServiceCard
                to="/domains/bulk-search"
                icon="📄"
                title="Bulk Domain Search"
                text="Paste or upload a list of domains and check them all at once, safely and rate-limited."
                linkLabel="Bulk search"
              />
              <ServiceCard
                to="/domains/broker"
                icon="🤝"
                title="Domain Broker Service"
                text="Want a domain that is already registered? Our brokers negotiate on your behalf."
                linkLabel="Request a broker"
              />
            </div>
          </div>

          <p style={{ marginTop: '2.5rem' }}>
            Domain registrations are governed by our Domain Registration Agreement and Domain Name Auto-Renewal and
            Deletion Policy — see the <Link to="/legal">Legal &amp; Policy Center</Link>.
          </p>
        </div>
      </section>
    </div>
  );
}
