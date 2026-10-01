import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { apiFetch } from '../lib/api';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import { formatDateTime, formatPrice, SectionCard, StatusChip } from '../components/domain-services/ui';
import type { MembershipDto } from '../lib/domain-services-api';

interface DomainRow {
  id: string;
  domain_name: string;
  verification_status: string;
  verification_token: string | null;
  ssl_status: string;
  created_at: string;
}

interface RegistrationRow {
  id: string;
  domain_name: string;
  registration_years: number;
  status: string;
  created_at: string;
  confirmed_at: string | null;
  invoice_number: string | null;
  invoice_status: string | null;
  error_code: string | null;
}

interface TransferRow {
  id: string;
  domain_name: string;
  status: string;
  statusLabel: string;
  current_registrar: string | null;
  created_at: string;
  invoice_number: string | null;
  invoice_status: string | null;
}

interface BidRow {
  id: string;
  auction_id: string;
  domain_name: string;
  auction_status: string;
  ends_at: string;
  amount: string;
  currency: string;
  status: string;
  is_winning: boolean;
}

interface WonAuctionRow {
  id: string;
  domain_name: string;
  status: string;
  current_highest_bid: string;
  currency: string;
  ends_at: string;
  payment_completed: boolean;
}

interface LostAuctionRow {
  id: string;
  domain_name: string;
  status: string;
  current_highest_bid: string | null;
  currency: string;
  ends_at: string;
}

interface BrokerCaseRow {
  id: string;
  brokerage_id: string;
  domain: string;
  status: string;
  current_offer: string | null;
  currency: string;
  payment_status: string;
  transfer_status: string;
  created_at: string;
  updated_at: string;
}

interface AppraisalRow {
  id: string;
  domain_name: string;
  status: string;
  estimated_value: string | null;
  currency: string | null;
  confidence: string | null;
  created_at: string;
}

interface SearchRow {
  id: string;
  search_type: string;
  query_label: string;
  status: string;
  result_count: number;
  available_count: number;
  created_at: string;
}

interface WhoisRow {
  id: string;
  domain_name: string;
  source: string;
  status: string;
  privacy_protected: boolean;
  created_at: string;
}

interface BulkSearchRow {
  id: string;
  query_label: string;
  status: string;
  source_type: string;
  submitted_count: number;
  accepted_count: number;
  rejected_count: number;
  created_at: string;
}

interface TransactionRow {
  id: string;
  transaction_type: string;
  status: string;
  amount: string;
  currency: string;
  created_at: string;
  invoice_number: string | null;
}

type TabId = 'domains' | 'registrations' | 'transfers' | 'auctions' | 'appraisals' | 'lookups' | 'club' | 'broker' | 'transactions';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'domains', label: 'My Domains' },
  { id: 'registrations', label: 'Registrations' },
  { id: 'transfers', label: 'Transfers' },
  { id: 'auctions', label: 'Auctions' },
  { id: 'appraisals', label: 'Appraisals' },
  { id: 'lookups', label: 'Searches & Lookups' },
  { id: 'club', label: 'Domain Club' },
  { id: 'broker', label: 'Broker Requests' },
  { id: 'transactions', label: 'Transactions' },
];

const BROKER_STATUS_LABELS: Record<string, string> = {
  request_submitted: 'Submitted',
  broker_assigned: 'Broker assigned',
  under_review: 'Under review',
  contacting_seller: 'Contacting seller',
  negotiation: 'Negotiating',
  offer_received: 'Offer received',
  offer_accepted: 'Offer accepted',
  payment_pending: 'Payment pending',
  transfer_pending: 'Transfer pending',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

/**
 * Domain Services dashboard. "My Domains" keeps the original Phase 6 behaviour (add a domain,
 * prove control via DNS TXT, request SSL, delete); every other tab is real, per-user data from
 * the Domain Services backend — always scoped to the signed-in customer.
 */
export default function DashboardDomainsPage() {
  usePageMeta('Domains', 'Manage your domains, registrations, transfers, auctions and domain services');
  const [tab, setTab] = useState<TabId>('domains');

  const [domains, setDomains] = useState<DomainRow[] | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [busy, setBusy] = useState('');

  const [registrations, setRegistrations] = useState<RegistrationRow[] | null>(null);
  const [transfers, setTransfers] = useState<TransferRow[] | null>(null);
  const [bids, setBids] = useState<BidRow[] | null>(null);
  const [won, setWon] = useState<WonAuctionRow[] | null>(null);
  const [appraisals, setAppraisals] = useState<AppraisalRow[] | null>(null);
  const [searches, setSearches] = useState<SearchRow[] | null>(null);
  const [bulkSearches, setBulkSearches] = useState<BulkSearchRow[] | null>(null);
  const [whoisLookups, setWhoisLookups] = useState<WhoisRow[] | null>(null);
  const [transactions, setTransactions] = useState<TransactionRow[] | null>(null);
  const [lost, setLost] = useState<LostAuctionRow[] | null>(null);
  const [membership, setMembership] = useState<MembershipDto | null | undefined>(undefined);
  const [brokerCases, setBrokerCases] = useState<BrokerCaseRow[] | null>(null);

  const loadDomains = useCallback(() => {
    let cancelled = false;
    apiFetch<{ domains: DomainRow[] }>('/api/v1/domains')
      .then((result) => !cancelled && setDomains(result.domains))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => loadDomains(), [loadDomains]);

  useEffect(() => {
    if (tab === 'registrations' && registrations === null) {
      apiFetch<{ registrations: RegistrationRow[] }>('/api/v1/domain-services/registrations')
        .then((r) => setRegistrations(r.registrations))
        .catch(() => setRegistrations([]));
    }
    if (tab === 'transfers' && transfers === null) {
      apiFetch<{ transfers: TransferRow[] }>('/api/v1/domain-services/transfers')
        .then((r) => setTransfers(r.transfers))
        .catch(() => setTransfers([]));
    }
    if (tab === 'auctions' && bids === null) {
      apiFetch<{ bids: BidRow[] }>('/api/v1/domain-services/auctions/my/bids')
        .then((r) => setBids(r.bids))
        .catch(() => setBids([]));
      apiFetch<{ auctions: WonAuctionRow[] }>('/api/v1/domain-services/auctions/my/won')
        .then((r) => setWon(r.auctions))
        .catch(() => setWon([]));
      apiFetch<{ auctions: LostAuctionRow[] }>('/api/v1/domain-services/auctions/my/lost')
        .then((r) => setLost(r.auctions ?? []))
        .catch(() => setLost([]));
    }
    if (tab === 'appraisals' && appraisals === null) {
      apiFetch<{ appraisals: AppraisalRow[] }>('/api/v1/domain-services/appraisals')
        .then((r) => setAppraisals(r.appraisals))
        .catch(() => setAppraisals([]));
    }
    if (tab === 'lookups' && searches === null) {
      apiFetch<{ searches: SearchRow[] }>('/api/v1/domain-services/searches')
        .then((r) => setSearches(r.searches))
        .catch(() => setSearches([]));
      apiFetch<{ searches: BulkSearchRow[] }>('/api/v1/domain-services/searches/bulk')
        .then((r) => setBulkSearches(r.searches ?? []))
        .catch(() => setBulkSearches([]));
      apiFetch<{ lookups: WhoisRow[] }>('/api/v1/domain-services/whois/history')
        .then((r) => setWhoisLookups(r.lookups))
        .catch(() => setWhoisLookups([]));
    }
    if (tab === 'club' && membership === undefined) {
      apiFetch<{ membership: MembershipDto | null }>('/api/v1/domain-services/club/membership')
        .then((r) => setMembership(r.membership ?? null))
        .catch(() => setMembership(null));
    }
    if (tab === 'broker' && brokerCases === null) {
      apiFetch<{ cases: BrokerCaseRow[] }>('/api/v1/account/domain-brokerage/cases')
        .then((r) => setBrokerCases(r.cases ?? []))
        .catch(() => setBrokerCases([]));
    }
    if (tab === 'transactions' && transactions === null) {
      apiFetch<{ transactions: TransactionRow[] }>('/api/v1/domain-services/transactions')
        .then((r) => setTransactions(r.transactions))
        .catch(() => setTransactions([]));
    }
  }, [tab, registrations, transfers, bids, appraisals, searches, transactions, membership, brokerCases]);

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
      loadDomains();
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
        loadDomains();
      } else if (action === 'verify') {
        const result = await apiFetch<{ verified: boolean; detail: string }>(`/api/v1/domains/${id}/verify`, {
          method: 'POST',
        });
        setMessage(result.verified ? 'Domain verified — you can now attach it to applications.' : `Not verified yet: ${result.detail}`);
        loadDomains();
      } else {
        const result = await apiFetch<{ note: string }>(`/api/v1/domains/${id}/ssl`, { method: 'POST' });
        setMessage(result.note);
        loadDomains();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'The action could not be completed');
    } finally {
      setBusy('');
    }
  }

  return (
    <div>
      <div className="ch247-section-heading">
        <div>
          <h1>Domains</h1>
          <p className="ch247-page__hint">Your domains and every Domain Services workflow on this account.</p>
        </div>
      </div>

      <nav className="ch247-tabs" aria-label="Domain sections">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={tab === entry.id ? 'is-active' : ''}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {message && <p className="ch247-banner ch247-banner--info" role="status">{message}</p>}
      {error && <CatalogErrorBanner message={error} />}

      {tab === 'domains' && (
        <>
          <SectionCard title="Add a domain you already own">
            <form onSubmit={addDomain} className="ch247-dsvc-search">
              <label className="sr-only" htmlFor="new-domain">Domain name</label>
              <input
                id="new-domain"
                type="text"
                value={newDomain}
                onChange={(event) => setNewDomain(event.target.value)}
                placeholder="example.com"
              />
              <button className="ch247-button" type="submit" disabled={busy === 'add' || !newDomain.trim()}>
                Add domain
              </button>
            </form>
            <p className="ch247-page__hint">
              Prefer to register or transfer a domain through us? Use <Link to="/domains/search">Domain Search</Link> or{' '}
              <Link to="/domains/transfer">Domain Transfer</Link>.
            </p>
          </SectionCard>

          <SectionCard title="Your domains" style={{ marginTop: "1rem" }}>
            {domains === null ? (
              <CatalogLoadingBanner label="Loading domains…" />
            ) : domains.length === 0 ? (
              <p className="ch247-page__hint">No domains on your account yet.</p>
            ) : (
              <div className="ch247-table-wrap">
                <table className="ch247-table">
                  <thead>
                    <tr><th>Domain</th><th>Verification</th><th>SSL</th><th>Added</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {domains.map((domain) => (
                      <tr key={domain.id}>
                        <td style={{ wordBreak: 'break-all' }}>{domain.domain_name}</td>
                        <td>{domain.verification_status}</td>
                        <td>{domain.ssl_status}</td>
                        <td>{formatDateTime(domain.created_at)}</td>
                        <td>
                          <button className="ch247-button ch247-button--small" type="button" onClick={() => void domainAction(domain.id, 'verify')} disabled={busy === `verify:${domain.id}`}>
                            Verify
                          </button>{' '}
                          <button className="ch247-button ch247-button--small" type="button" onClick={() => void domainAction(domain.id, 'ssl')} disabled={busy === `ssl:${domain.id}`}>
                            SSL
                          </button>{' '}
                          <button className="ch247-button ch247-button--small ch247-button--danger" type="button" onClick={() => void domainAction(domain.id, 'delete')} disabled={busy === `delete:${domain.id}`}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </>
      )}

      {tab === 'registrations' && (
        <SectionCard title="Domain registrations" actions={<Link className="ch247-button ch247-button--outline" to="/domains/search">Register a domain</Link>}>
          {registrations === null ? (
            <CatalogLoadingBanner label="Loading registrations…" />
          ) : registrations.length === 0 ? (
            <p className="ch247-page__hint">No domain registrations yet. Search for a domain to register one.</p>
          ) : (
            <div className="ch247-table-wrap">
              <table className="ch247-table">
                <thead><tr><th>Domain</th><th>Term</th><th>Status</th><th>Requested</th><th>Invoice</th></tr></thead>
                <tbody>
                  {registrations.map((registration) => (
                    <tr key={registration.id}>
                      <td style={{ wordBreak: 'break-all' }}>{registration.domain_name}</td>
                      <td>{registration.registration_years} year(s)</td>
                      <td><StatusChip status={registration.status} /></td>
                      <td>{formatDateTime(registration.created_at)}</td>
                      <td>{registration.invoice_number ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {tab === 'transfers' && (
        <SectionCard title="Domain transfers" actions={<Link className="ch247-button ch247-button--outline" to="/domains/transfer">Start a transfer</Link>}>
          {transfers === null ? (
            <CatalogLoadingBanner label="Loading transfers…" />
          ) : transfers.length === 0 ? (
            <p className="ch247-page__hint">No transfers yet.</p>
          ) : (
            <div className="ch247-table-wrap">
              <table className="ch247-table">
                <thead><tr><th>Domain</th><th>Status</th><th>From</th><th>Started</th><th>Invoice</th></tr></thead>
                <tbody>
                  {transfers.map((transfer) => (
                    <tr key={transfer.id}>
                      <td style={{ wordBreak: 'break-all' }}>{transfer.domain_name}</td>
                      <td>{transfer.statusLabel}</td>
                      <td>{transfer.current_registrar ?? '—'}</td>
                      <td>{formatDateTime(transfer.created_at)}</td>
                      <td>{transfer.invoice_number ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {tab === 'auctions' && (
        <>
          <SectionCard title="Your bids" actions={<Link className="ch247-button ch247-button--outline" to="/domains/auctions">Browse auctions</Link>}>
            {bids === null ? (
              <CatalogLoadingBanner label="Loading your bids…" />
            ) : bids.length === 0 ? (
              <p className="ch247-page__hint">You have not placed any bids yet.</p>
            ) : (
              <div className="ch247-table-wrap">
                <table className="ch247-table">
                  <thead><tr><th>Domain</th><th>Your bid</th><th>Status</th><th>Auction</th><th>Ends</th></tr></thead>
                  <tbody>
                    {bids.map((bid) => (
                      <tr key={bid.id}>
                        <td><Link to={`/domains/auctions/${bid.auction_id}`}>{bid.domain_name}</Link></td>
                        <td>{formatPrice(bid.amount, bid.currency)}</td>
                        <td>
                          {bid.is_winning ? 'Winning' : bid.status === 'won' ? 'Won' : bid.status === 'lost' ? 'Lost' : bid.status === 'outbid' ? 'Outbid' : bid.status}
                        </td>
                        <td>{bid.auction_status.replace(/_/g, ' ')}</td>
                        <td>{formatDateTime(bid.ends_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          <SectionCard title="Auctions you won" style={{ marginTop: "1rem" }}>
            {won === null ? (
              <CatalogLoadingBanner label="Loading won auctions…" />
            ) : won.length === 0 ? (
              <p className="ch247-page__hint">No auction wins yet.</p>
            ) : (
              <div className="ch247-table-wrap">
                <table className="ch247-table">
                  <thead><tr><th>Domain</th><th>Winning bid</th><th>Payment</th><th>Ended</th></tr></thead>
                  <tbody>
                    {won.map((auction) => (
                      <tr key={auction.id}>
                        <td><Link to={`/domains/auctions/${auction.id}`}>{auction.domain_name}</Link></td>
                        <td>{formatPrice(auction.current_highest_bid, auction.currency)}</td>
                        <td>{auction.payment_completed ? 'Paid' : <Link to={`/domains/auctions/${auction.id}`}>Complete payment</Link>}</td>
                        <td>{formatDateTime(auction.ends_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          <SectionCard title="Auctions you lost" style={{ marginTop: "1rem" }}>
            {lost === null ? (
              <CatalogLoadingBanner label="Loading lost auctions…" />
            ) : lost.length === 0 ? (
              <p className="ch247-page__hint">No lost auctions.</p>
            ) : (
              <div className="ch247-table-wrap">
                <table className="ch247-table">
                  <thead><tr><th>Domain</th><th>Winning bid</th><th>Auction</th><th>Ended</th></tr></thead>
                  <tbody>
                    {lost.map((auction) => (
                      <tr key={auction.id}>
                        <td><Link to={`/domains/auctions/${auction.id}`}>{auction.domain_name}</Link></td>
                        <td>{auction.current_highest_bid ? formatPrice(auction.current_highest_bid, auction.currency) : '—'}</td>
                        <td>{auction.status.replace(/_/g, ' ')}</td>
                        <td>{formatDateTime(auction.ends_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </>
      )}

      {tab === 'appraisals' && (
        <SectionCard title="Your domain appraisals" actions={<Link className="ch247-button ch247-button--outline" to="/domains/appraisal">Appraise a domain</Link>}>
          {appraisals === null ? (
            <CatalogLoadingBanner label="Loading appraisals…" />
          ) : appraisals.length === 0 ? (
            <p className="ch247-page__hint">No appraisals yet. Estimates are produced by the connected valuation provider.</p>
          ) : (
            <div className="ch247-table-wrap">
              <table className="ch247-table">
                <thead><tr><th>Domain</th><th>Estimated value</th><th>Confidence</th><th>Status</th><th>Requested</th></tr></thead>
                <tbody>
                  {appraisals.map((appraisal) => (
                    <tr key={appraisal.id}>
                      <td style={{ wordBreak: 'break-all' }}>{appraisal.domain_name}</td>
                      <td>{appraisal.estimated_value ? formatPrice(appraisal.estimated_value, appraisal.currency) : '—'}</td>
                      <td>{appraisal.confidence ?? '—'}</td>
                      <td><StatusChip status={appraisal.status} /></td>
                      <td>{formatDateTime(appraisal.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {tab === 'lookups' && (
        <>
          <SectionCard title="Your domain searches">
            {searches === null ? (
              <CatalogLoadingBanner label="Loading search history…" />
            ) : searches.length === 0 ? (
              <p className="ch247-page__hint">No searches yet.</p>
            ) : (
              <div className="ch247-table-wrap">
                <table className="ch247-table">
                  <thead><tr><th>Query</th><th>Type</th><th>Status</th><th>Available</th><th>When</th></tr></thead>
                  <tbody>
                    {searches.map((search) => (
                      <tr key={search.id}>
                        <td>{search.query_label}</td>
                        <td>{search.search_type}</td>
                        <td>{search.status.replace(/_/g, ' ')}</td>
                        <td>{search.available_count} / {search.result_count}</td>
                        <td>{formatDateTime(search.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          <SectionCard title="Your bulk searches" style={{ marginTop: "1rem" }} actions={<Link className="ch247-button ch247-button--outline" to="/domains/bulk-search">New bulk search</Link>}>
            {bulkSearches === null ? (
              <CatalogLoadingBanner label="Loading bulk searches…" />
            ) : bulkSearches.length === 0 ? (
              <p className="ch247-page__hint">No bulk searches yet.</p>
            ) : (
              <div className="ch247-table-wrap">
                <table className="ch247-table">
                  <thead><tr><th>List</th><th>Source</th><th>Status</th><th>Submitted</th><th>Accepted</th><th>Rejected</th><th>When</th></tr></thead>
                  <tbody>
                    {bulkSearches.map((bulk) => (
                      <tr key={bulk.id}>
                        <td>{bulk.query_label}</td>
                        <td>{bulk.source_type.toUpperCase()}</td>
                        <td>{bulk.status.replace(/_/g, ' ')}</td>
                        <td>{bulk.submitted_count}</td>
                        <td>{bulk.accepted_count}</td>
                        <td>{bulk.rejected_count}</td>
                        <td>{formatDateTime(bulk.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          <SectionCard title="Your WHOIS / RDAP lookups" style={{ marginTop: "1rem" }}>
            {whoisLookups === null ? (
              <CatalogLoadingBanner label="Loading lookup history…" />
            ) : whoisLookups.length === 0 ? (
              <p className="ch247-page__hint">No lookups yet.</p>
            ) : (
              <div className="ch247-table-wrap">
                <table className="ch247-table">
                  <thead><tr><th>Domain</th><th>Source</th><th>Status</th><th>Privacy</th><th>When</th></tr></thead>
                  <tbody>
                    {whoisLookups.map((lookup) => (
                      <tr key={lookup.id}>
                        <td style={{ wordBreak: 'break-all' }}>{lookup.domain_name}</td>
                        <td>{lookup.source.toUpperCase()}</td>
                        <td>{lookup.status.replace(/_/g, ' ')}</td>
                        <td>{lookup.privacy_protected ? 'Protected' : '—'}</td>
                        <td>{formatDateTime(lookup.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </>
      )}

      {tab === 'club' && (
        <SectionCard title="Discount Domain Club membership" actions={<Link className="ch247-button ch247-button--outline" to="/domains/club">View plans</Link>}>
          {membership === undefined ? (
            <CatalogLoadingBanner label="Loading membership…" />
          ) : membership === null ? (
            <p className="ch247-page__hint">
              You are not a Discount Domain Club member. <Link to="/domains/club">See member pricing</Link> to join and save
              on eligible domain registrations.
            </p>
          ) : (
            <div className="ch247-table-wrap">
              <table className="ch247-table">
                <tbody>
                  <tr><th scope="row">Plan</th><td>{membership.planName}</td></tr>
                  <tr><th scope="row">Status</th><td><StatusChip status={membership.status} /></td></tr>
                  <tr><th scope="row">Price</th><td>{formatPrice(membership.priceAmount, membership.currency)} / {membership.billingPeriod === 'monthly' ? 'month' : 'year'}</td></tr>
                  <tr><th scope="row">Member since</th><td>{membership.startsAt ? formatDateTime(membership.startsAt) : '—'}</td></tr>
                  <tr><th scope="row">Renewal date</th><td>{membership.renewsAt ? formatDateTime(membership.renewsAt) : '—'}</td></tr>
                  {membership.cancelledAt && <tr><th scope="row">Cancelled</th><td>{formatDateTime(membership.cancelledAt)}</td></tr>}
                </tbody>
              </table>
              <p className="ch247-page__hint" style={{ marginTop: '0.75rem' }}>
                Member pricing is applied automatically to eligible registrations at quote time. Membership charges appear
                under the Transactions tab; manage the subscription from the <Link to="/domains/club">Domain Club page</Link>.
              </p>
            </div>
          )}
        </SectionCard>
      )}

      {tab === 'broker' && (
        <SectionCard title="Domain broker requests" actions={<Link className="ch247-button ch247-button--outline" to="/domains/broker">Request a broker</Link>}>
          {brokerCases === null ? (
            <CatalogLoadingBanner label="Loading broker requests…" />
          ) : brokerCases.length === 0 ? (
            <p className="ch247-page__hint">
              No broker requests yet. If the domain you want is already registered, our{' '}
              <Link to="/domains/broker">Domain Broker Service</Link> can help you acquire it.
            </p>
          ) : (
            <div className="ch247-table-wrap">
              <table className="ch247-table">
                <thead><tr><th>Case</th><th>Domain</th><th>Status</th><th>Current offer</th><th>Payment</th><th>Transfer</th><th>Updated</th></tr></thead>
                <tbody>
                  {brokerCases.map((brokerCase) => (
                    <tr key={brokerCase.id}>
                      <td><Link to="/account/domain-brokerage">{brokerCase.brokerage_id}</Link></td>
                      <td style={{ wordBreak: 'break-all' }}>{brokerCase.domain}</td>
                      <td>{BROKER_STATUS_LABELS[brokerCase.status] ?? brokerCase.status.replace(/_/g, ' ')}</td>
                      <td>{brokerCase.current_offer ? formatPrice(brokerCase.current_offer, brokerCase.currency) : '—'}</td>
                      <td>{brokerCase.payment_status.replace(/_/g, ' ')}</td>
                      <td>{brokerCase.transfer_status.replace(/_/g, ' ')}</td>
                      <td>{formatDateTime(brokerCase.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {tab === 'transactions' && (
        <SectionCard title="Domain transactions">
          {transactions === null ? (
            <CatalogLoadingBanner label="Loading transactions…" />
          ) : transactions.length === 0 ? (
            <p className="ch247-page__hint">No domain transactions yet.</p>
          ) : (
            <div className="ch247-table-wrap">
              <table className="ch247-table">
                <thead><tr><th>Type</th><th>Amount</th><th>Status</th><th>Invoice</th><th>When</th></tr></thead>
                <tbody>
                  {transactions.map((transaction) => (
                    <tr key={transaction.id}>
                      <td>{transaction.transaction_type.replace(/_/g, ' ')}</td>
                      <td>{formatPrice(transaction.amount, transaction.currency)}</td>
                      <td><StatusChip status={transaction.status} /></td>
                      <td>{transaction.invoice_number ?? '—'}</td>
                      <td>{formatDateTime(transaction.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}
