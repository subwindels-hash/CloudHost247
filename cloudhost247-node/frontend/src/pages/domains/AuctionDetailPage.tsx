import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { usePageMeta } from '../../lib/usePageMeta';
import { getToken } from '../../lib/auth';
import { apiFetch } from '../../lib/api';
import type { AuctionDto } from '../../lib/domain-services-api';
import { auctionEndsLabel, formatDateTime, formatPrice } from '../../components/domain-services/ui';

interface AuctionDetailResponse {
  auction: AuctionDto;
  bids: Array<{ amount: string; currency: string; created_at: string; bidder_label: string }>;
}

/**
 * Auction detail + bidding. The minimum acceptable bid is computed and enforced SERVER-side
 * (current highest/minimum + increment); this form only submits the customer's intended amount.
 */
export default function AuctionDetailPage() {
  usePageMeta('Auction', 'Domain auction details and bidding.');
  const { id } = useParams<{ id: string }>();
  const token = getToken();

  const [detail, setDetail] = useState<AuctionDetailResponse | null>(null);
  const [error, setError] = useState('');
  const [bidAmount, setBidAmount] = useState('');
  const [bidBusy, setBidBusy] = useState(false);
  const [bidError, setBidError] = useState('');
  const [bidSuccess, setBidSuccess] = useState('');
  const [payBusy, setPayBusy] = useState(false);
  const [paymentStarted, setPaymentStarted] = useState(false);
  const [paymentResult, setPaymentResult] = useState<{ invoiceId: string; invoiceNumber: string; amount: string; currency: string } | null>(null);

  async function startWinnerPayment() {
    if (!id) return;
    setPayBusy(true);
    setBidError('');
    try {
      const result = await apiFetch<{ orderId: string; invoiceId: string; invoiceNumber: string; amount: string; currency: string }>(
        `/api/v1/domain-services/auctions/${id}/pay`,
        { method: 'POST' }
      );
      setPaymentResult(result);
      setPaymentStarted(true);
    } catch (err) {
      setBidError(err instanceof Error ? err.message : 'The payment order could not be created.');
    } finally {
      setPayBusy(false);
    }
  }

  const load = useCallback(() => {
    if (!id) return;
    apiFetch<AuctionDetailResponse>(`/api/v1/domain-services/auctions/${id}`)
      .then((response) => setDetail(response))
      .catch((err: Error) => setError(err.message));
  }, [id]);

  useEffect(() => {
    const interval = setInterval(load, 20_000);
    load();
    return () => clearInterval(interval);
  }, [load]);

  const minimumNextBid = detail
    ? (
        Number(detail.auction.currentHighestBid ?? detail.auction.minimumBid) + Number(detail.auction.bidIncrement)
      ).toFixed(2)
    : null;

  async function placeBid(event: React.FormEvent) {
    event.preventDefault();
    if (!id) return;
    setBidBusy(true);
    setBidError('');
    setBidSuccess('');
    try {
      const idempotencyKey = `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const response = await apiFetch<{ bidId: string; amount: string }>(`/api/v1/domain-services/auctions/${id}/bids`, {
        method: 'POST',
        body: JSON.stringify({ amount: bidAmount, idempotencyKey }),
      });
      setBidSuccess(`Bid of ${formatPrice(response.amount, detail?.auction.currency ?? null)} placed — you are the highest bidder.`);
      setBidAmount('');
      load();
    } catch (err) {
      setBidError(err instanceof Error ? err.message : 'The bid could not be placed right now.');
    } finally {
      setBidBusy(false);
    }
  }

  if (error) {
    return (
      <section className="ch247-section">
        <div className="ch247-page">
          <p className="ch247-banner ch247-banner--error" role="alert">{error}</p>
          <Link to="/domains/auctions">Back to auctions</Link>
        </div>
      </section>
    );
  }

  if (!detail) {
    return (
      <section className="ch247-section">
        <div className="ch247-page"><p className="ch247-page__hint">Loading auction…</p></div>
      </section>
    );
  }

  const { auction, bids } = detail;
  const actionable = auction.status === 'live' || auction.status === 'ending_soon';
  // The winner is the authenticated user whose highest bid equals the auction's highest bid.
  const isWinner = Boolean(
    token && auction.myHighestBid && auction.currentHighestBid && auction.myHighestBid === auction.currentHighestBid
  );

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <h1 style={{ wordBreak: 'break-all' }}>{auction.domainName}</h1>
          <p>
            {actionable ? <span className="ch247-dsvc-countdown">{auctionEndsLabel(auction.endsAt)}</span> : `Status: ${auction.status.replace(/_/g, ' ')}`}
            {' · '}Ends {formatDateTime(auction.endsAt)}
          </p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page">
          <dl className="ch247-dsvc-facts">
            <div className="ch247-dsvc-fact"><dt>Current highest bid</dt><dd>{auction.currentHighestBid ? formatPrice(auction.currentHighestBid, auction.currency) : 'No bids yet'}</dd></div>
            <div className="ch247-dsvc-fact"><dt>Minimum bid</dt><dd>{formatPrice(auction.minimumBid, auction.currency)}</dd></div>
            <div className="ch247-dsvc-fact"><dt>Bid increment</dt><dd>{formatPrice(auction.bidIncrement, auction.currency)}</dd></div>
            <div className="ch247-dsvc-fact"><dt>Bids</dt><dd>{auction.bidCount}</dd></div>
          </dl>

          {auction.myHighestBid && (
            <p className="ch247-banner ch247-banner--info">Your highest bid: {formatPrice(auction.myHighestBid, auction.currency)}</p>
          )}

          {actionable && !token && (
            <p><Link className="ch247-button" to="/login">Sign in to bid</Link></p>
          )}

          {actionable && token && (
            <form className="ch247-card" onSubmit={placeBid} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ flex: '1 1 220px' }}>
                Your bid ({auction.currency})
                <input
                  style={{ width: '100%' }}
                  type="number"
                  step="0.01"
                  min={minimumNextBid ?? undefined}
                  required
                  value={bidAmount}
                  onChange={(event) => setBidAmount(event.target.value)}
                  placeholder={minimumNextBid ?? ''}
                />
              </label>
              <button className="ch247-button" type="submit" disabled={bidBusy || !bidAmount}>
                {bidBusy ? 'Placing…' : 'Place bid'}
              </button>
              <span className="ch247-page__hint" style={{ paddingBottom: '0.6rem' }}>
                Minimum next bid: <strong>{minimumNextBid ? formatPrice(minimumNextBid, auction.currency) : '—'}</strong>
              </span>
              {bidError && <p className="ch247-banner ch247-banner--error" role="alert" style={{ width: '100%' }}>{bidError}</p>}
              {bidSuccess && <p className="ch247-banner ch247-banner--info" role="status" style={{ width: '100%' }}>{bidSuccess}</p>}
            </form>
          )}

          {!actionable && auction.status === 'ended' && token && isWinner && !paymentStarted && (
            <div className="ch247-card">
              <h2>You won this auction</h2>
              <p className="ch247-banner ch247-banner--info">
                Your bid of {formatPrice(auction.currentHighestBid, auction.currency)} is the winning bid. Complete
                payment to receive the domain — the transfer starts once payment is verified.
              </p>
              <button className="ch247-button" type="button" onClick={() => void startWinnerPayment()} disabled={payBusy}>
                {payBusy ? 'Creating order…' : `Pay ${formatPrice(auction.currentHighestBid, auction.currency)}`}
              </button>
            </div>
          )}

          {!actionable && auction.status === 'ended' && token && isWinner && paymentStarted && paymentResult && (
            <div className="ch247-card">
              <h2>Payment order created</h2>
              <p className="ch247-banner ch247-banner--info">
                Pay invoice {paymentResult.invoiceNumber} to complete your purchase of {auction.domainName}.
              </p>
              <p><Link className="ch247-button" to={`/invoices/${paymentResult.invoiceId}`}>Pay invoice {paymentResult.invoiceNumber}</Link></p>
            </div>
          )}

          {!actionable && auction.status === 'ended' && token && !isWinner && auction.currentHighestBid && (
            <p className="ch247-banner ch247-banner--info">This auction has ended. The winning bidder has been notified.</p>
          )}

          <h2 style={{ marginTop: '2rem' }}>Bidding history</h2>
          {bids.length === 0 ? (
            <p className="ch247-page__hint">No bids have been placed yet.</p>
          ) : (
            <div className="ch247-table-wrap">
              <table className="ch247-table">
                <thead>
                  <tr><th>Bidder</th><th>Amount</th><th>Placed</th></tr>
                </thead>
                <tbody>
                  {bids.map((bid, index) => (
                    <tr key={index}>
                      <td>{bid.bidder_label}</td>
                      <td>{formatPrice(bid.amount, bid.currency)}</td>
                      <td>{formatDateTime(bid.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="ch247-page__hint" style={{ marginTop: '1rem' }}>
            Bidder identities are anonymized. The server verifies every bid against the authoritative highest bid under
            a database lock — concurrent bids cannot race or manipulate the outcome.
          </p>
        </div>
      </section>
    </div>
  );
}
