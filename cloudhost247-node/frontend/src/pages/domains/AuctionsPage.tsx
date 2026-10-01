import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../../lib/usePageMeta';
import { getToken } from '../../lib/auth';
import { apiFetch } from '../../lib/api';
import type { AuctionDto } from '../../lib/domain-services-api';
import { auctionEndsLabel, formatPrice } from '../../components/domain-services/ui';

/** Auction marketplace browse page: live, ending-soon, scheduled and recently ended auctions. */
export default function AuctionsPage() {
  usePageMeta('Domain Auctions', 'Bid on premium domain names.');
  const token = getToken();

  const [auctions, setAuctions] = useState<AuctionDto[] | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page] = useState(1);

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), limit: '24' });
    if (search.trim()) params.set('search', search.trim());
    if (statusFilter) params.set('status', statusFilter);
    apiFetch<{ auctions: AuctionDto[]; total: number }>(`/api/v1/domain-services/auctions?${params.toString()}`)
      .then((response) => setAuctions(response.auctions))
      .catch((err: Error) => setError(err.message));
  }, [page, search, statusFilter]);

  useEffect(() => {
    const interval = setInterval(load, 30_000);
    load();
    return () => clearInterval(interval);
  }, [load]);

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <h1>Domain Auctions</h1>
          <p>Bid on premium domain names in a transparent, server-verified marketplace.</p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page">
          <form className="ch247-dsvc-toolbar" onSubmit={(event) => { event.preventDefault(); load(); }} role="search">
            <input
              type="search"
              placeholder="Search auction domains"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search auction domains"
            />
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status" style={{ maxWidth: 180 }}>
              <option value="">All statuses</option>
              <option value="live">Live</option>
              <option value="ending_soon">Ending soon</option>
              <option value="scheduled">Scheduled</option>
              <option value="paused">Paused</option>
              <option value="ended">Ended</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <button className="ch247-button" type="submit">Apply</button>
          </form>

          {error && <p className="ch247-banner ch247-banner--error" role="alert">{error}</p>}
          {auctions === null && <p className="ch247-page__hint">Loading auctions…</p>}
          {auctions !== null && auctions.length === 0 && (
            <p className="ch247-page__hint">
              No auctions match right now. New listings appear here as soon as they are scheduled — nothing is
              fabricated to fill the page.
            </p>
          )}

          <div className="ch247-dsvc-grid">
            {(auctions ?? []).map((auction) => (
              <article className="ch247-dsvc-card" key={auction.id}>
                <div className="ch247-dsvc-card__icon" aria-hidden="true">📢</div>
                <h3 className="ch247-dsvc-card__title" style={{ wordBreak: 'break-all' }}>{auction.domainName}</h3>
                <p className="ch247-dsvc-card__text">
                  {auction.status === 'scheduled' && `Starts ${new Date(auction.startsAt).toLocaleString()}`}
                  {(auction.status === 'live' || auction.status === 'ending_soon') && (
                    <span className="ch247-dsvc-countdown">{auctionEndsLabel(auction.endsAt)}</span>
                  )}
                  {auction.status === 'paused' && 'Temporarily paused by the marketplace.'}
                  {auction.status === 'ended' && 'Bidding closed — awaiting payment.'}
                  {auction.status === 'completed' && 'This auction has ended.'}
                  {auction.status === 'cancelled' && 'This auction was cancelled.'}
                </p>
                <dl className="ch247-dsvc-kv" style={{ fontSize: '0.9rem' }}>
                  <dt>Current bid</dt>
                  <dd><strong>{auction.currentHighestBid ? formatPrice(auction.currentHighestBid, auction.currency) : 'No bids yet'}</strong></dd>
                  <dt>Minimum bid</dt>
                  <dd>{formatPrice(auction.minimumBid, auction.currency)}</dd>
                  <dt>Bids</dt>
                  <dd>{auction.bidCount}</dd>
                </dl>
                <Link className="ch247-dsvc-card__link" to={`/domains/auctions/${auction.id}`}>
                  View auction <span aria-hidden="true">→</span>
                </Link>
              </article>
            ))}
          </div>

          {token && (
            <p style={{ marginTop: '1.5rem' }}>
              <Link to="/dashboard/domains">Your bids, won and lost auctions are in your dashboard.</Link>
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
