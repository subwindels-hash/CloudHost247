import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../../lib/usePageMeta';
import { getToken } from '../../lib/auth';
import { apiFetch } from '../../lib/api';
import {
  quoteRegistration,
  searchDomains,
  type RegistrationQuote,
  type SearchResponse,
  type SearchResultRow,
} from '../../lib/domain-services-api';
import { AvailabilityChip, formatPrice } from '../../components/domain-services/ui';

/**
 * Domain search + registration checkout.
 *
 * The flow: search (provider-confirmed) → select an available/premium domain → server-side quote
 * (which re-verifies availability and applies any Domain Club discount) → domain contact form →
 * order creation. The customer then pays the invoice through the standard billing flow; the
 * domain is only registered after the payment webhook verifies settlement and the registrar
 * confirms — never because this page said so.
 */

interface ContactForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
  organization: string;
}

const EMPTY_CONTACT: ContactForm = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  addressLine1: '',
  city: '',
  state: '',
  postalCode: '',
  countryCode: '',
  organization: '',
};

export default function SearchPage() {
  usePageMeta('Domain Search', 'Search domain availability and register domains.');
  const token = getToken();

  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState<SearchResponse | null>(null);

  const [selected, setSelected] = useState<SearchResultRow | null>(null);
  const [years, setYears] = useState(1);
  const [quote, setQuote] = useState<RegistrationQuote | null>(null);
  const [contact, setContact] = useState<ContactForm>(EMPTY_CONTACT);
  const [orderError, setOrderError] = useState('');
  const [orderBusy, setOrderBusy] = useState(false);
  const [createdInvoice, setCreatedInvoice] = useState<{ invoiceId: string | null; invoiceNumber: string | null; amount: string; currency: string } | null>(null);

  async function onSearch(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setBusy(true);
    setError('');
    setSearch(null);
    setSelected(null);
    setQuote(null);
    setCreatedInvoice(null);
    try {
      const response = await searchDomains(trimmed);
      setSearch(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The search could not be completed right now.');
    } finally {
      setBusy(false);
    }
  }

  async function selectDomain(result: SearchResultRow) {
    setSelected(result);
    setQuote(null);
    setOrderError('');
    setCreatedInvoice(null);
    if (!token) return;
    try {
      const response = await quoteRegistration(result.domainName, years);
      setQuote(response.quote);
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : 'A quote could not be generated for this domain.');
    }
  }

  async function refreshQuote(nextYears: number) {
    setYears(nextYears);
    if (!selected || !token) return;
    try {
      const response = await quoteRegistration(selected.domainName, nextYears);
      setQuote(response.quote);
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : 'A quote could not be generated.');
    }
  }

  async function placeOrder(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setOrderBusy(true);
    setOrderError('');
    try {
      const response = await apiFetch<{
        registrationId: string;
        invoiceId: string | null;
        invoiceNumber: string | null;
        amount: string;
        currency: string;
      }>('/api/v1/domain-services/registrations', {
        method: 'POST',
        body: JSON.stringify({
          domainName: selected.domainName,
          years,
          contact: {
            firstName: contact.firstName,
            lastName: contact.lastName,
            organization: contact.organization || null,
            email: contact.email,
            phone: contact.phone,
            addressLine1: contact.addressLine1,
            city: contact.city,
            state: contact.state || null,
            postalCode: contact.postalCode || null,
            countryCode: contact.countryCode.toUpperCase(),
          },
        }),
      });
      setCreatedInvoice({
        invoiceId: response.invoiceId,
        invoiceNumber: response.invoiceNumber,
        amount: response.amount,
        currency: response.currency,
      });
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : 'The order could not be created right now.');
    } finally {
      setOrderBusy(false);
    }
  }

  const inputStyle = { width: '100%' } as const;

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <h1>Domain Search</h1>
          <p>Search a name or an exact domain. Availability and prices come from our domain provider.</p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page">
          <form className="ch247-dsvc-search" onSubmit={onSearch} role="search">
            <label className="sr-only" htmlFor="search-query">Domain name</label>
            <input
              id="search-query"
              type="search"
              placeholder="example or example.com"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              maxLength={253}
            />
            <button className="ch247-button" type="submit" disabled={busy || !query.trim()}>
              {busy ? 'Searching…' : 'Search'}
            </button>
          </form>

          {error && <p className="ch247-banner ch247-banner--error" role="alert">{error}</p>}

          {search?.status === 'provider_not_configured' && (
            <div className="ch247-dsvc-provider-missing" role="status">
              <strong>Service Provider Not Configured</strong>
              <p style={{ margin: '0.4rem 0 0' }}>
                Domain search requires a connected registrar provider. No availability or pricing can be shown until a
                Super Admin configures and tests the provider.
              </p>
            </div>
          )}
          {search && search.status !== 'provider_not_configured' && search.message && (
            <p className="ch247-banner ch247-banner--warning" role="status">{search.message}</p>
          )}

          {search?.status === 'completed' && (
            <div style={{ marginTop: '1rem' }}>
              {search.results.length === 0 && <p className="ch247-page__hint">No results were returned for that search.</p>}
              <div className="ch247-dsvc-result-grid">
                {search.results.map((result) => (
                  <div className="ch247-dsvc-result" key={result.domainName}>
                    <div>
                      <div className="ch247-dsvc-result__domain">{result.domainName}</div>
                      <div className="ch247-dsvc-result__prices">
                        <span>Reg <strong>{formatPrice(result.registrationPrice, result.currency)}</strong></span>
                        <span>Renew <strong>{formatPrice(result.renewalPrice, result.currency)}</strong></span>
                        <span>Transfer <strong>{formatPrice(result.transferPrice, result.currency)}</strong></span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <AvailabilityChip status={result.availabilityStatus} />
                      {(result.availabilityStatus === 'available' || result.availabilityStatus === 'premium') &&
                        (token ? (
                          <button type="button" className="ch247-button ch247-button--small" onClick={() => void selectDomain(result)}>
                            {selected?.domainName === result.domainName ? 'Selected' : 'Select'}
                          </button>
                        ) : (
                          <Link className="ch247-button ch247-button--small" to="/login">Sign in to register</Link>
                        ))}
                      {result.availabilityStatus === 'registered' && (
                        <Link className="ch247-button ch247-button--outline ch247-button--small" to="/domains/transfer">Transfer</Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {selected && (
            <section className="ch247-card" style={{ marginTop: '1.5rem' }}>
              <div className="ch247-section-heading">
                <div>
                  <h2>Register {selected.domainName}</h2>
                  <p className="ch247-page__hint">
                    Availability and price are re-verified server-side at quote time. Registration happens only after
                    your payment is verified and the registrar confirms.
                  </p>
                </div>
              </div>

              {!token && (
                <p>
                  <Link className="ch247-button" to="/login">Sign in to continue</Link>
                </p>
              )}

              {token && !createdInvoice && (
                <>
                  <div className="ch247-dsvc-toolbar">
                    <label htmlFor="reg-years">Registration term</label>
                    <select id="reg-years" value={years} onChange={(event) => void refreshQuote(Number(event.target.value))} style={{ maxWidth: 160 }}>
                      {[1, 2, 3, 5, 10].map((value) => (
                        <option key={value} value={value}>{value} year{value > 1 ? 's' : ''}</option>
                      ))}
                    </select>
                  </div>

                  {quote && (
                    <dl className="ch247-dsvc-kv">
                      <dt>Standard price</dt>
                      <dd>{formatPrice(quote.standardPrice, quote.currency)} / year</dd>
                      {quote.memberPrice && (
                        <>
                          <dt>Member price{quote.clubName ? ` (${quote.clubName})` : ''}</dt>
                          <dd><strong>{formatPrice(quote.memberPrice, quote.currency)} / year</strong></dd>
                          <dt>You save</dt>
                          <dd>{formatPrice(quote.discountAmount, quote.currency)} / year</dd>
                        </>
                      )}
                      <dt>Premium</dt>
                      <dd>{quote.isPremium ? 'Yes — provider-quoted premium price' : 'No'}</dd>
                      <dt>Estimated total ({quote.years} year{quote.years > 1 ? 's' : ''})</dt>
                      <dd><strong>{formatPrice(quote.memberPrice ?? quote.standardPrice, quote.currency)}</strong></dd>
                    </dl>
                  )}
                  {!quote && <p className="ch247-page__hint">Generating your quote…</p>}

                  <h3 style={{ marginTop: '1.25rem' }}>Domain contact information</h3>
                  <p className="ch247-page__hint">
                    Registry rules require registrant contact data. It is stored encrypted and used only for this
                    registration.
                  </p>
                  <form onSubmit={placeOrder} style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                    <label>First name<input style={inputStyle} required value={contact.firstName} onChange={(e) => setContact({ ...contact, firstName: e.target.value })} /></label>
                    <label>Last name<input style={inputStyle} required value={contact.lastName} onChange={(e) => setContact({ ...contact, lastName: e.target.value })} /></label>
                    <label>Organization (optional)<input style={inputStyle} value={contact.organization} onChange={(e) => setContact({ ...contact, organization: e.target.value })} /></label>
                    <label>Email<input style={inputStyle} type="email" required value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} /></label>
                    <label>Phone<input style={inputStyle} required placeholder="+1.5551234567" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} /></label>
                    <label>Address<input style={inputStyle} required value={contact.addressLine1} onChange={(e) => setContact({ ...contact, addressLine1: e.target.value })} /></label>
                    <label>City<input style={inputStyle} required value={contact.city} onChange={(e) => setContact({ ...contact, city: e.target.value })} /></label>
                    <label>State / Region<input style={inputStyle} value={contact.state} onChange={(e) => setContact({ ...contact, state: e.target.value })} /></label>
                    <label>Postal code<input style={inputStyle} value={contact.postalCode} onChange={(e) => setContact({ ...contact, postalCode: e.target.value })} /></label>
                    <label>Country code (2 letters)<input style={inputStyle} required maxLength={2} placeholder="US" value={contact.countryCode} onChange={(e) => setContact({ ...contact, countryCode: e.target.value })} /></label>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <button className="ch247-button" type="submit" disabled={orderBusy || !quote}>
                        {orderBusy ? 'Creating order…' : 'Continue to payment'}
                      </button>
                    </div>
                  </form>
                </>
              )}

              {createdInvoice && (
                <div>
                  <p className="ch247-banner ch247-banner--info">
                    Order created. Your registration will be submitted to the registrar once payment of{' '}
                    <strong>{formatPrice(createdInvoice.amount, createdInvoice.currency)}</strong> is verified.
                  </p>
                  <p>
                    {createdInvoice.invoiceId ? (
                      <Link className="ch247-button" to={`/invoices/${createdInvoice.invoiceId}`}>
                        Pay invoice {createdInvoice.invoiceNumber}
                      </Link>
                    ) : (
                      <Link className="ch247-button" to="/invoices">Go to your invoices</Link>
                    )}
                  </p>
                  <p>
                    <Link to="/dashboard/domains">Track the registration in your dashboard</Link>
                  </p>
                </div>
              )}

              {orderError && <p className="ch247-banner ch247-banner--error" role="alert">{orderError}</p>}
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
